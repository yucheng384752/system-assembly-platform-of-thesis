import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

/** @typedef {(command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding) =>
 * {status?: number | null, stdout?: string | Buffer | null, stderr?: string | Buffer | null, error?: Error}} Run */

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Same pin as kits/platform-core-kit/requirements-test.txt (a test keeps the two equal). pytest is installed into a throwaway
// directory of the test container, never into the image that ships.
export const PYTEST = 'pytest==9.1.1';
const KIT_ID = /^[a-z][a-z0-9-]*-kit$/;

/** @param {Buffer | string} data */
const sha256 = data => createHash('sha256').update(data).digest('hex');

/** @param {string} directory @returns {Promise<string[]>} */
async function files(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name === '.pytest_cache') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(full));
    else if (entry.isFile()) found.push(full);
  }
  return found.sort();
}

/** Hash of a Kit's test files (paths and bytes), so the manifest says exactly which tests passed.
 * @param {string} kitsDir @param {string} kit */
export async function testFilesSha256(kitsDir, kit) {
  const root = path.join(kitsDir, kit, 'tests');
  const lines = [];
  for (const file of await files(root)) lines.push(`${path.relative(root, file).split(path.sep).join('/')}\0${sha256(await readFile(file))}`);
  return { sha256: sha256(lines.join('\n')), count: lines.length };
}

/** The shell run inside the test container: one pytest process per Kit, because every Kit's backend is a package named `app`.
 * Markers are printed so the result of each Kit can be told apart. */
export const CONTAINER_SCRIPT = [
  `pip install -q --no-cache-dir --disable-pip-version-check --user ${PYTEST} >/tmp/pip.log 2>&1 || { echo '@@PIP_FAILED'; tail -n 5 /tmp/pip.log; exit 97; }`,
  'export PATH="$HOME/.local/bin:$PATH"',
  'for kit in "$@"; do',
  '  echo "@@KIT $kit"',
  '  if [ ! -d "/kits/$kit/tests" ]; then echo "@@NOTESTS $kit"; continue; fi',
  '  (cd "/kits/$kit" && python -B -m pytest -p no:cacheprovider -q tests > /tmp/out.log 2>&1); code=$?',
  '  echo "@@END $kit $code"; tail -n 25 /tmp/out.log',
  'done',
].join('\n');

/** Reads the container output into one record per Kit. @param {string} output */
export function parseKitResults(output) {
  /** @type {Map<string, {kit: string, exitCode: number | null, noTests: boolean, lines: string[]}>} */
  const results = new Map();
  /** @type {{kit: string, exitCode: number | null, noTests: boolean, lines: string[]} | undefined} */
  let current;
  for (const line of output.split(/\r?\n/)) {
    const start = /^@@KIT (\S+)$/.exec(line);
    if (start) { current = { kit: start[1], exitCode: null, noTests: false, lines: [] }; results.set(start[1], current); continue; }
    if (!current) continue;
    if (line.startsWith('@@NOTESTS ')) { current.noTests = true; continue; }
    const end = /^@@END (\S+) (\d+)$/.exec(line);
    if (end) { current.exitCode = Number(end[2]); continue; }
    current.lines.push(line);
  }
  return results;
}

/** @param {string[]} lines @param {string} word */
const count = (lines, word) => {
  const summary = [...lines].reverse().find(line => /\b(passed|failed|error|errors|skipped)\b/.test(line) && / in [0-9.]+s/.test(line)) ?? '';
  const match = new RegExp(`(\\d+) ${word}`).exec(summary);
  return match ? Number(match[1]) : 0;
};

/**
 * Runs every selected Kit's tests inside the freshly built backend image and refuses to continue unless all of them pass.
 * Needs Docker and network (pytest is installed in the container), so it belongs to the release step, not to assembly.
 * @param {{image: string, kits: string[], kitsDir?: string, run?: Run}} options
 */
export async function runKitTests({ image, kits, kitsDir = path.join(repository, 'kits'), run = spawnSync }) {
  for (const kit of kits) if (!KIT_ID.test(kit)) throw new Error(`Kit 識別字不合法：${kit}`);
  const result = run('docker', ['run', '--rm', '--user', '10001:10001', '--tmpfs', '/tmp:rw,exec,size=512m', '--env', 'HOME=/tmp',
    '--volume', `${path.resolve(kitsDir)}:/kits:ro`, '--entrypoint', 'sh', image, '-c', CONTAINER_SCRIPT, 'selftest', ...kits],
  { encoding: 'utf8', maxBuffer: 1 << 26 });
  const output = String(result.stdout ?? '');
  if (result.error) throw new Error(`測試容器無法執行：${result.error.message}`);
  if (output.includes('@@PIP_FAILED')) throw new Error(`測試工具安裝失敗，無法執行 Kit 測試：${output.split('@@PIP_FAILED')[1].trim().slice(0, 300)}`);
  const parsed = parseKitResults(output);
  const failures = [];
  const records = [];
  for (const kit of kits) {
    const found = parsed.get(kit);
    if (!found) { failures.push(`${kit}：測試沒有執行${result.status ? `（容器結束碼 ${result.status}）` : ''}`); continue; }
    if (found.noTests) { failures.push(`${kit}：沒有測試（每個選入系統的 Kit 都必須有 tests/，見 docs/kit-authoring.md）`); continue; }
    const passed = count(found.lines, 'passed');
    const skipped = count(found.lines, 'skipped');
    if (found.exitCode !== 0 || passed === 0) {
      const reason = found.exitCode === 5 ? '沒有收集到任何測試' : `測試未通過（結束碼 ${found.exitCode}）`;
      failures.push(`${kit}：${reason}\n${found.lines.filter(Boolean).slice(-12).map(line => `    ${line}`).join('\n')}`);
      continue;
    }
    const tests = await testFilesSha256(kitsDir, kit);
    records.push({ kit, status: 'passed', passed, skipped, testFiles: tests.count, testFilesSha256: tests.sha256 });
  }
  if (failures.length) throw new Error(`Kit 測試閘門未通過，不產出安裝包：\n${failures.join('\n')}`);
  return records;
}
