import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTAINER_SCRIPT, PYTEST, SYSTEM_TESTS, parseKitResults, runKitTests, systemTestsSha256, testFilesSha256 } from '../selftest.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../..');

/** A kits folder with the given Kits, each holding one test file. @param {string[]} kits @param {(dir: string) => Promise<void>} work */
async function kitsFolder(kits, work) {
  const temp = await mkdtemp(path.join(directory, '.kits-'));
  try {
    for (const kit of kits) { await mkdir(path.join(temp, kit, 'tests'), { recursive: true }); await writeFile(path.join(temp, kit, 'tests/test_a.py'), `# ${kit}\n`); }
    await work(temp);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

/** A Docker stand-in that answers every call with the given output. @param {string} stdout @param {number} [status] */
const docker = (stdout, status = 0) => {
  /** @type {{args: string[]}[]} */
  const calls = [];
  // The system suite (guard, license gate, self-check) runs in every call; unless a test says otherwise it passes.
  if (!stdout.includes('@@KIT system') && !stdout.includes('@@PIP_FAILED') && status === 0) stdout += '@@KIT system\n@@END system 0\n9 passed in 0.2s\n';
  return { calls, run: /** @type {never} */ ((/** @type {string} */ _command, /** @type {string[]} */ args) => { calls.push({ args }); return { status, stdout }; }) };
};
const ok = (/** @type {string} */ kit, n = 4) => `@@KIT ${kit}\n@@END ${kit} 0\n${n} passed in 0.5s\n`;

test('the pytest pin matches the one the Kits declare for their tests', async () => {
  const declared = (await readFile(path.join(repository, 'kits/platform-core-kit/requirements-test.txt'), 'utf8')).split(/\r?\n/).find(l => l.startsWith('pytest'));
  assert.equal(PYTEST, declared);
});

test('the tests run in the shipped image as a non-root user with the Kits mounted read-only', async () => kitsFolder(['alpha-kit'], async dir => {
  const d = docker(ok('alpha-kit'));
  await runKitTests({ image: 'img:1', kits: ['alpha-kit'], kitsDir: dir, run: d.run });
  const args = d.calls[0].args;
  assert.equal(args[0], 'run');
  assert.ok(args.includes('img:1'));
  assert.equal(args[args.indexOf('--user') + 1], '10001:10001');
  assert.ok(args.some(a => a.endsWith(':/kits:ro')), 'Kit sources are mounted read-only so a test cannot alter what ships');
  assert.ok(args.some(a => a.endsWith(':/config:ro')), 'the capability registry is readable for tests that compare it with the contract');
  assert.ok(args.includes('PYTHONPATH=/system/backend'), 'tests import the merged backend that ships, so a Kit that needs another Kit still works');
  assert.match(CONTAINER_SCRIPT, /pytest/);
}));

test('every Kit is run in its own pytest process, because all Kit backends are a package named app', () => {
  assert.match(CONTAINER_SCRIPT, /\(cd "\/kits\/\$kit" && python -B -m pytest/);
});

test('a Kit without tests fails the gate and is named', async () => kitsFolder(['alpha-kit'], async dir => {
  const out = `${ok('alpha-kit')}@@KIT beta-kit\n@@NOTESTS beta-kit\n`;
  await assert.rejects(runKitTests({ image: 'img:1', kits: ['alpha-kit', 'beta-kit'], kitsDir: dir, run: docker(out).run }), /beta-kit：沒有測試/);
}));

test('a failing Kit fails the gate and its last output lines are shown; passing Kits are not blamed', async () => kitsFolder(['alpha-kit', 'beta-kit'], async dir => {
  const out = `${ok('alpha-kit')}@@KIT beta-kit\n@@END beta-kit 1\nFAILED tests/test_a.py::test_x - assert 1 == 2\n1 failed, 2 passed in 0.2s\n`;
  const error = await runKitTests({ image: 'img:1', kits: ['alpha-kit', 'beta-kit'], kitsDir: dir, run: docker(out).run }).catch(e => e);
  assert.match(error.message, /beta-kit：測試未通過（結束碼 1）/);
  assert.match(error.message, /test_x/);
  assert.doesNotMatch(error.message, /alpha-kit/);
}));

test('zero collected tests is a failure, not a pass', async () => kitsFolder(['alpha-kit'], async dir => {
  const out = '@@KIT alpha-kit\n@@END alpha-kit 5\nno tests ran in 0.01s\n';
  await assert.rejects(runKitTests({ image: 'img:1', kits: ['alpha-kit'], kitsDir: dir, run: docker(out).run }), /沒有收集到任何測試/);
}));

test('a Kit that never reported (the container died early) fails instead of being skipped silently', async () => kitsFolder(['alpha-kit', 'beta-kit'], async dir => {
  await assert.rejects(runKitTests({ image: 'img:1', kits: ['alpha-kit', 'beta-kit'], kitsDir: dir, run: docker(ok('alpha-kit'), 137).run }), /beta-kit：測試沒有執行（容器結束碼 137）/);
}));

test('a pytest that cannot be installed is reported as such, not as a Kit failure', async () => kitsFolder(['alpha-kit'], async dir => {
  await assert.rejects(runKitTests({ image: 'img:1', kits: ['alpha-kit'], kitsDir: dir, run: docker('@@PIP_FAILED\nno network\n', 97).run }), /測試工具安裝失敗/);
}));

test('passing results carry the counts and a hash of the test files, which changes when a test changes', async () => kitsFolder(['alpha-kit'], async dir => {
  const records = await runKitTests({ image: 'img:1', kits: ['alpha-kit'], kitsDir: dir, run: docker(ok('alpha-kit', 7)).run });
  assert.equal(records[0].passed, 7);
  assert.equal(records[0].testFiles, 1);
  assert.deepEqual(records.map(r => r.kit), ['alpha-kit', 'system'], 'the system suite is recorded after the Kits');
  await writeFile(path.join(dir, 'alpha-kit/tests/test_a.py'), '# changed\n');
  assert.notEqual((await testFilesSha256(dir, 'alpha-kit')).sha256, records[0].testFilesSha256);
}));

test('Kit identifiers that could break out of the shell command are refused', async () => {
  await assert.rejects(runKitTests({ image: 'img:1', kits: ['x; rm -rf /'], run: docker('').run }), /Kit 識別字不合法/);
});

test('parseKitResults separates the Kits', () => {
  const parsed = parseKitResults(`${ok('a-kit')}${ok('b-kit', 2)}`);
  assert.deepEqual([...parsed.keys()], ['a-kit', 'b-kit']);
  assert.equal(parsed.get('b-kit')?.exitCode, 0);
});

test('the system suite runs the guard, license gate and self-check tests with the package folder mounted read-only', async () => kitsFolder(['alpha-kit'], async dir => {
  const d = docker(ok('alpha-kit'));
  await runKitTests({ image: 'img:1', kits: ['alpha-kit'], kitsDir: dir, run: d.run });
  assert.ok(d.calls[0].args.some(a => a.endsWith(':/services/package:ro')));
  for (const name of SYSTEM_TESTS) assert.match(CONTAINER_SCRIPT, new RegExp(name));
  assert.deepEqual(SYSTEM_TESTS, ['test_guard.py', 'test_license_gate.py', 'test_selfcheck.py']);
}));

test('a failing system suite stops the release just like a failing Kit', async () => kitsFolder(['alpha-kit'], async dir => {
  const out = `${ok('alpha-kit')}@@KIT system
@@END system 1
FAILED test_selfcheck.py::Gate::test_x
1 failed, 20 passed in 0.5s
`;
  await assert.rejects(runKitTests({ image: 'img:1', kits: ['alpha-kit'], kitsDir: dir, run: docker(out).run }), /system：測試未通過（結束碼 1）/);
}));

test('every system test file exists, so the hash recorded in the manifest covers real files', async () => {
  const hashed = await systemTestsSha256(path.join(repository, 'services/package'));
  assert.equal(hashed.count, SYSTEM_TESTS.length);
});
