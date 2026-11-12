// 嚴格輪流：同一個分支（工作樹）同一時間只有一個帳號可寫檔。
// 不同分支各有各的鎖，所以不同 worktree 可以並行。
// 鎖放在 git common dir（所有 worktree 共用、不進版控），而不是 mailbox。
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, '_');
export const lockPath = (lockDir, branch) => join(lockDir, `${slug(branch)}.json`);

export function readLock(lockDir, branch) {
  const p = lockPath(lockDir, branch);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`鎖檔損毀，請人工確認後刪除：${p}（${e.message}）`);
  }
}

export function acquire(lockDir, branch, holder, now = new Date()) {
  mkdirSync(lockDir, { recursive: true });
  const cur = readLock(lockDir, branch);
  if (cur && cur.holder !== holder) {
    throw new Error(`分支 ${branch} 目前由帳號 ${cur.holder} 持有（自 ${cur.since}），帳號 ${holder} 不可寫入`);
  }
  const next = { branch, holder, since: cur?.since ?? now.toISOString(), turns: cur?.turns ?? 0 };
  try {
    // 新建用 wx：兩個帳號同時搶時只有一個成功
    writeFileSync(lockPath(lockDir, branch), JSON.stringify(next, null, 2), { flag: cur ? 'w' : 'wx' });
  } catch (e) {
    throw new Error(`取得鎖失敗（可能同時被另一個帳號取得）：${e.message}`);
  }
  return next;
}

// 只有現任持有者能交棒，避免非持有者把鎖搶走。
export function transfer(lockDir, branch, from, to, now = new Date()) {
  const cur = readLock(lockDir, branch);
  if (!cur || cur.holder !== from) {
    throw new Error(`帳號 ${from} 不是分支 ${branch} 的持有者，不能交棒`);
  }
  const next = { branch, holder: to, since: now.toISOString(), turns: cur.turns + 1 };
  const p = lockPath(lockDir, branch);
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, p);
  return next;
}

export function release(lockDir, branch, holder) {
  const cur = readLock(lockDir, branch);
  if (!cur) return;
  if (cur.holder !== holder) throw new Error(`帳號 ${holder} 不是持有者，不能釋放`);
  rmSync(lockPath(lockDir, branch));
}
