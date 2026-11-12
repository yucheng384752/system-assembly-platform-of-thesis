// 兩個帳號的 session 登記檔在各自的 sessions/ 內，互相看不到，所以 SendMessage 找不到對方。
// 作法：把「還活著的」登記檔鏡像到對方資料夾；只碰自己鏡像過的檔案（記在 manifest），
// 絕不動對方原有的檔案。預設只回報計畫，--apply 才寫入。
// .key 檔當成不透明位元組複製，不讀內容。
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

const pidOf = (file) => {
  const m = /^(\d+)\.(json|[0-9a-f]+\.key)$/.exec(file);
  return m ? Number(m[1]) : null;
};
const manifestName = (srcLabel) => `.mirrored-from-${srcLabel}.json`;

function readManifest(dir, label) {
  const p = join(dir, manifestName(label));
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`鏡像清單損毀：${p}（${e.message}）`);
  }
}

export function planMirror(srcConfig, dstConfig, srcLabel, isAlive = pidAlive) {
  const src = join(srcConfig, 'sessions');
  const dst = join(dstConfig, 'sessions');
  // 來源資料夾裡由本工具鏡像進來的檔案不是來源自己的 session，不可往回鏡像（避免回音）
  const echoes = existsSync(src)
    ? readdirSync(src).filter((f) => /^\.mirrored-from-.+\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(join(src, f), 'utf8')))
    : [];
  const live = existsSync(src)
    ? readdirSync(src).filter((f) => {
        const pid = pidOf(f);
        return pid !== null && !echoes.includes(f) && isAlive(pid);
      })
    : [];
  const mirrored = existsSync(dst) ? readManifest(dst, srcLabel) : [];
  // 對方已有同名但不是我們鏡像的檔案：不覆蓋，回報衝突
  const copy = live.filter((f) => !existsSync(join(dst, f)) || mirrored.includes(f));
  const skippedConflict = live.filter((f) => !copy.includes(f));
  const remove = mirrored.filter((f) => !live.includes(f));
  return { src, dst, copy, remove, skippedConflict, mirrored, srcLabel };
}

export function applyMirror(plan) {
  mkdirSync(plan.dst, { recursive: true });
  for (const f of plan.copy) copyFileSync(join(plan.src, f), join(plan.dst, f));
  for (const f of plan.remove) rmSync(join(plan.dst, f), { force: true });
  const kept = plan.mirrored.filter((f) => !plan.remove.includes(f));
  const next = [...new Set([...kept, ...plan.copy])];
  writeFileSync(join(plan.dst, manifestName(plan.srcLabel)), JSON.stringify(next, null, 2));
}
