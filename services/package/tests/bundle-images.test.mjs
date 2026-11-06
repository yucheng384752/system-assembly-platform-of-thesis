import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bundleImages, composeImages } from '../bundle-images.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
/** Stand-in for the Kit test gate; its own behavior is covered in selftest.test.mjs. */
const noTests = async () => [];
const IDS = { 'composer-demo-backend:1.2.3': 'a', 'postgres:16.6-bookworm': 'b', 'nginx:1.28.0-bookworm': 'c' };
/** @param {Buffer | string} data */
const hash = data => createHash('sha256').update(data).digest('hex');

/** A directory shaped like assembleSystem output, using the real Compose template. @param {(dir: string) => Promise<void>} work */
async function assembled(work) {
  const temp = await mkdtemp(path.join(directory, '.bundle-'));
  try {
    const template = await readFile(path.join(directory, '../templates/docker-compose.yml'), 'utf8');
    await mkdir(path.join(temp, 'deployment'));
    await writeFile(path.join(temp, 'deployment/docker-compose.yml'), template.replace(/@@[A-Z_]+@@/g, ''));
    const manifest = { format: 'composer-system-assembly', schemaVersion: '1.0.0', installable: false, systemId: 'demo',
      files: [{ path: 'deployment/docker-compose.yml', sha256: 'x', bytes: 1, role: 'deployment' }] };
    await writeFile(path.join(temp, 'system-manifest.json'), JSON.stringify(manifest));
    await work(temp);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

/** Docker stand-in: records calls, answers inspect with a fixed ID per tag and writes the saved archive. */
function fakeDocker({ failOn = '' } = {}) {
  /** @type {{args: string[], cwd?: string}[]} */
  const calls = [];
  /** @type {import('../bundle-images.mjs').Run} */
  const run = (_command, args, options) => {
    calls.push({ args, cwd: options.cwd });
    if (args[0] === failOn) return { status: 1, stdout: '', stderr: `${failOn} broke` };
    if (args[0] === 'image') return { status: 0, stdout: `sha256:${/** @type {string} */ (IDS[/** @type {keyof typeof IDS} */ (args[4])]).repeat(64)}\n` };
    if (args[0] === 'save') writeFileSync(args[2], `archive of ${args[3]}`);
    return { status: 0, stdout: '' };
  };
  return { calls, run };
}

test('composeImages reads only the services that name an image', async () => {
  const compose = await readFile(path.join(directory, '../templates/docker-compose.yml'), 'utf8');
  assert.deepEqual([...composeImages(compose)].sort(), [['postgres', 'postgres:16.6-bookworm'], ['proxy', 'nginx:1.28.0-bookworm']]);
});

test('bundleImages builds from the assembled directory and records every service exactly once', async () => assembled(async dir => {
  const docker = fakeDocker();
  const manifest = await bundleImages(dir, { systemVersion: '1.2.3', run: docker.run, tests: noTests });
  const build = docker.calls.find(c => c.args[0] === 'build');
  assert.ok(build);
  assert.equal(build.cwd, dir, 'the build context must be the assembled directory');
  assert.deepEqual(build.args.slice(-3), ['--tag', 'composer-demo-backend:1.2.3', '.']);
  assert.deepEqual(docker.calls.filter(c => c.args[0] === 'pull').map(c => c.args[1]).sort(), ['nginx:1.28.0-bookworm', 'postgres:16.6-bookworm']);
  assert.equal(manifest.systemVersion, '1.2.3');
  assert.deepEqual(manifest.images.flatMap((/** @type {{services: string[]}} */ i) => i.services).sort(), ['backend', 'guard', 'init', 'postgres', 'proxy']);
  const backend = manifest.images.find((/** @type {{services: string[]}} */ i) => i.services.includes('guard'));
  assert.deepEqual(backend.services, ['backend', 'init', 'guard'], 'guard must run the backend image');
  assert.equal(backend.id, 'sha256:' + 'a'.repeat(64));
  const onDisk = JSON.parse(await readFile(path.join(dir, 'system-manifest.json'), 'utf8'));
  assert.deepEqual(onDisk, manifest);
  for (const image of manifest.images) {
    const entry = manifest.files.find((/** @type {{path: string}} */ f) => f.path === image.archive);
    assert.ok(entry, image.archive);
    const data = await readFile(path.join(dir, image.archive));
    assert.equal(entry.sha256, hash(data)); assert.equal(entry.bytes, data.length); assert.equal(entry.role, 'image-archive');
  }
  const paths = manifest.files.map((/** @type {{path: string}} */ f) => f.path);
  assert.deepEqual(paths, [...paths].sort(), 'files stay sorted so the manifest is stable');
}));

test('bundleImages never overwrites an already bundled directory', async () => assembled(async dir => {
  await bundleImages(dir, { systemVersion: '1.2.3', run: fakeDocker().run, tests: noTests });
  const before = await readFile(path.join(dir, 'system-manifest.json'));
  const docker = fakeDocker();
  await assert.rejects(bundleImages(dir, { systemVersion: '1.2.4', run: docker.run, tests: noTests }), /不覆寫/);
  assert.deepEqual(await readFile(path.join(dir, 'system-manifest.json')), before);
  assert.equal(docker.calls.length, 0, 'it must refuse before touching Docker');
}));

test('a failing Docker step leaves the manifest unchanged', async () => assembled(async dir => {
  const before = await readFile(path.join(dir, 'system-manifest.json'));
  for (const failOn of ['build', 'pull', 'save']) {
    await rm(path.join(dir, 'images'), { recursive: true, force: true });
    await assert.rejects(bundleImages(dir, { systemVersion: '1.2.3', run: fakeDocker({ failOn }).run, tests: noTests }), new RegExp(`docker ${failOn} 失敗`));
    assert.deepEqual(await readFile(path.join(dir, 'system-manifest.json')), before, failOn);
  }
}));

test('a malformed image ID or version is rejected', async () => assembled(async dir => {
  for (const version of [undefined, '', '1.2', 'v1.2.3', '1.2.3; rm']) {
    await assert.rejects(bundleImages(dir, { systemVersion: version, run: fakeDocker().run, tests: noTests }), /systemVersion/);
  }
  /** @type {import('../bundle-images.mjs').Run} */
  const wrongId = (_c, args) => ({ status: 0, stdout: args[0] === 'image' ? 'not-an-id\n' : '' });
  await assert.rejects(bundleImages(dir, { systemVersion: '1.2.3', run: wrongId, tests: noTests }), /映像 ID 格式不符/);
}));

test('a Kit whose tests fail stops the release before anything is pulled, saved or written to the manifest', async () => assembled(async dir => {
  const manifestFile = path.join(dir, 'system-manifest.json');
  const withKits = { ...JSON.parse(await readFile(manifestFile, 'utf8')), kits: [{ kit: 'alpha-kit', sourceSha256: 's1' }, { kit: 'beta-kit', sourceSha256: 's2' }] };
  await writeFile(manifestFile, JSON.stringify(withKits));
  const before = await readFile(manifestFile);
  const docker = fakeDocker();
  const failing = async () => { throw new Error('Kit 測試閘門未通過，不產出安裝包：\nbeta-kit：測試未通過（結束碼 1）'); };
  await assert.rejects(bundleImages(dir, { systemVersion: '1.2.3', run: docker.run, tests: failing }), /beta-kit：測試未通過/);
  assert.deepEqual(await readFile(manifestFile), before);
  assert.deepEqual(docker.calls.map(c => c.args[0]), ['build'], 'only the build ran: no pull and no save once a Kit fails');
}));

test('the manifest records which tests passed for which source, so the signature covers the result', async () => assembled(async dir => {
  const manifestFile = path.join(dir, 'system-manifest.json');
  await writeFile(manifestFile, JSON.stringify({ ...JSON.parse(await readFile(manifestFile, 'utf8')), kits: [{ kit: 'alpha-kit', sourceSha256: 's1' }] }));
  /** @type {{image: string, kits: string[]}[]} */
  const asked = [];
  const passing = async (/** @type {{image: string, kits: string[]}} */ request) => {
    asked.push(request);
    return [{ kit: 'alpha-kit', status: 'passed', passed: 3, skipped: 0, testFiles: 1, testFilesSha256: 't1' }];
  };
  const manifest = await bundleImages(dir, { systemVersion: '1.2.3', run: fakeDocker().run, tests: passing });
  assert.deepEqual(asked.map(a => a.kits), [['alpha-kit']]);
  assert.equal(asked[0].image, 'composer-demo-backend:1.2.3', 'the tests run in the image that ships');
  assert.equal(manifest.selftest.status, 'passed');
  assert.deepEqual(manifest.selftest.kits, [{ kit: 'alpha-kit', status: 'passed', passed: 3, skipped: 0, testFiles: 1, testFilesSha256: 't1', sourceSha256: 's1' }]);
  assert.deepEqual(JSON.parse(await readFile(manifestFile, 'utf8')).selftest, manifest.selftest);
}));
