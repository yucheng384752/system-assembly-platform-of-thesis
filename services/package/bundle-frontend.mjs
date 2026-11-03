import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

/** @typedef {(command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding) =>
 * {status?: number | null, stdout?: string | Buffer | null, stderr?: string | Buffer | null, error?: Error}} Run */

/** @param {Buffer | string} data */
const sha256 = data => createHash('sha256').update(data).digest('hex');
/** @param {string} a @param {string} b */
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const NOT_PROVIDED = 'frontend bundle (built at release by bundle-frontend.mjs)';

/** @param {string} directory @returns {Promise<string[]>} */
async function walk(directory) {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) names.push(...(await walk(path.join(directory, entry.name))).map(name => `${entry.name}/${name}`));
    else names.push(entry.name);
  }
  return names.sort(compare);
}

/** Build frontend/dist inside an assembled directory. Needs Node and the npm registry, so it is a release step.
 * The lock file pins every package; install scripts never run.
 * @param {string} dir assembled output of assembleSystem
 * @param {{run?: Run}} [options] */
export async function bundleFrontend(dir, { run = spawnSync } = {}) {
  const manifestFile = path.join(dir, 'system-manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (manifest.format !== 'composer-system-assembly') throw new Error('不是系統組裝目錄');
  if (manifest.files.some(/** @param {{path: string}} f */ f => f.path.startsWith('frontend/dist/'))) throw new Error('已含前端建置結果；不覆寫，請用新的組裝目錄');
  const frontend = path.join(dir, 'frontend');
  if (!(await stat(frontend).catch(() => null))?.isDirectory()) throw new Error('組裝目錄沒有 frontend');

  /** @param {string[]} args */
  const npm = args => {
    const result = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { encoding: 'utf8', cwd: frontend, maxBuffer: 1 << 26, shell: process.platform === 'win32' });
    if (result.error || result.status !== 0) throw new Error(`npm ${args[0]} 失敗：${String(result.stderr ?? result.error?.message ?? '').trim().slice(0, 300)}`);
  };
  try {
    npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    npm(['run', 'build']);
    const names = await walk(path.join(frontend, 'dist'));
    if (!names.includes('index.html')) throw new Error('建置結果沒有 index.html');
    const added = [];
    for (const name of names) {
      const data = await readFile(path.join(frontend, 'dist', name));
      added.push({ path: `frontend/dist/${name}`, sha256: sha256(data), bytes: data.length, role: 'frontend-bundle' });
    }
    const updated = { ...manifest,
      notProvided: manifest.notProvided.filter(/** @param {string} item */ item => item !== NOT_PROVIDED),
      files: [...manifest.files, ...added].sort((a, b) => compare(a.path, b.path)) };
    await writeFile(manifestFile, Buffer.from(JSON.stringify(updated, null, 2) + '\n'));
    return updated;
  } finally {
    // The installed tree never carries the build toolchain.
    await rm(path.join(frontend, 'node_modules'), { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('用法：node services/package/bundle-frontend.mjs <組裝目錄>');
    await bundleFrontend(path.resolve(process.argv[2]));
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
