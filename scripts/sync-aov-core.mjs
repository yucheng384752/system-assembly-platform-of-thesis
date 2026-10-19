// Copies the core of aov-project into libs/aov-core as a pinned snapshot (D103) and records where it came from.
// Usage: node scripts/sync-aov-core.mjs <path to aov-project>   (a dev tool; nothing at runtime depends on that path)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const source = process.argv[2];
if (!source) { console.error('用法：node scripts/sync-aov-core.mjs <aov-project 路徑>'); process.exit(2); }
const from = resolve(source, 'packages/core/src');
const to = resolve(import.meta.dirname, '../libs/aov-core');

// Hash line endings as LF so a CRLF checkout on Windows still matches the recorded value.
const lfHash = (/** @type {Buffer} */ buffer) => createHash('sha256').update(buffer.toString('utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))).digest('hex');

/** @param {string} dir @returns {string[]} */
const list = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? list(path) : path.endsWith('.ts') ? [path] : [];
}).sort();

const git = (/** @type {string[]} */ ...args) => execFileSync('git', ['-c', `safe.directory=${resolve(source).split(sep).join('/')}`, '-C', resolve(source), ...args], { encoding: 'utf8' }).trim();
let commit; let dirty;
try { commit = git('rev-parse', 'HEAD'); dirty = git('status', '--porcelain', '--', 'packages/core/src') !== ''; }
catch { console.error('來源不是 git 專案，無法記錄版本；請先在 aov-project 建立提交。'); process.exit(1); }
if (dirty) { console.error('來源的 packages/core/src 有未提交變更，請先提交再同步，否則版本紀錄不可信。'); process.exit(1); }

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const files = list(from).map(path => {
  const rel = relative(from, path).split(sep).join('/');
  const target = join(to, rel);
  mkdirSync(join(target, '..'), { recursive: true });
  cpSync(path, target);
  return { path: rel, sha256: lfHash(readFileSync(path)) };
});
writeFileSync(join(to, 'VERSION.json'), JSON.stringify({
  note: '固定版本快照，請勿手動修改；以 scripts/sync-aov-core.mjs 重新同步（D103）。',
  source: 'aov-project/packages/core/src', commit, files,
}, null, 2) + '\n', 'utf8');
console.log(`已複製 ${files.length} 個檔案，來源提交 ${commit.slice(0, 7)}`);
