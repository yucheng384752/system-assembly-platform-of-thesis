import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appSource, frontendTree, selectedPages } from '../frontend.mjs';
import { scanExclusions } from '../assemble-system.mjs';

const kits = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../kits');
const MINIMAL = ['platform-core-kit', 'generic-forms-kit', 'audit-edit-kit', 'station-data-link-kit', 'upload-validation-kit', 'import-pipeline-kit', 'entry-permission-kit'];

test('tabs and imports come only from the selected Kits', () => {
  const source = appSource(selectedPages(MINIMAL));
  assert.match(source, /import \{ UploadPage \}/);
  assert.match(source, /import \{ FormsPage \}/);
  assert.doesNotMatch(source, /QueryPage|AnalyticsPage|DeveloperLogsPage/);
  assert.doesNotMatch(source, /RegisterPage|ManagerPage|AdminPage/);
});

test('every page renders only behind the login gate', () => {
  const source = appSource(selectedPages(MINIMAL));
  for (const page of ['UploadPage', 'FormsPage', 'DataflowPage', 'EditReasonsPage']) {
    assert.match(source, new RegExp(`signedIn && tab === "[A-Za-z]+" \\? <${page} />`));
  }
});

test('forms page without the audit edit modal is rejected at assembly, not at build', () => {
  assert.throws(() => selectedPages(['generic-forms-kit', 'platform-core-kit']), /audit-edit-kit/);
});

test('the tree has no excluded-Kit pages, tenant selection or admin key code', async () => {
  const tree = await frontendTree(kits, MINIMAL);
  const names = [...tree.keys()];
  for (const name of ['frontend/src/pages/RegisterPage.tsx', 'frontend/src/pages/ManagerPage.tsx', 'frontend/src/pages/AdminPage.tsx', 'frontend/src/services/adminAuth.ts', 'frontend/src/services/tenantMap.ts']) {
    assert.ok(!names.includes(name), name);
  }
  for (const name of ['frontend/package.json', 'frontend/package-lock.json', 'frontend/index.html', 'frontend/src/App.tsx', 'frontend/src/pages/LoginPage.tsx', 'frontend/src/pages/UploadPage.tsx']) {
    assert.ok(names.includes(name), name);
  }
  const text = [...tree.entries()].filter(([name]) => /\.(tsx?|json)$/.test(name) && !name.includes('package-lock') && !name.includes('locales') && !name.endsWith('vite.config.ts')).map(([, data]) => data.toString('utf8')).join('\n');
  assert.doesNotMatch(text, /X-Admin-API-Key|localhost:8000|VITE_API_KEY/);
  scanExclusions(tree);
});

test('without the upload Kit the upload page and its helpers are left out', async () => {
  const tree = await frontendTree(kits, ['platform-core-kit', 'entry-permission-kit', 'query-traceability-kit']);
  assert.ok(![...tree.keys()].some(name => name.includes('UploadPage') || name.includes('pages/upload/') || name.includes('CSVEditor')));
  assert.ok(tree.has('frontend/src/pages/QueryPage.tsx'));
});

test('a selection with no page cannot produce a frontend', async () => {
  await assert.rejects(frontendTree(kits, ['platform-core-kit', 'entry-permission-kit']), /沒有任何前端頁面/);
});

test('the session token is the only credential the bundle handles', async () => {
  const tree = await frontendTree(kits, MINIMAL);
  const auth = tree.get('frontend/src/services/auth.ts')?.toString('utf8') ?? '';
  assert.match(auth, /sessionStorage/);
  assert.doesNotMatch(auth, /localStorage/);
  assert.equal([...tree.values()].some(data => /import\.meta\.env\??\.VITE_API_KEY/.test(data.toString('utf8'))), false);
});

// bundleFrontend with a fake npm: the contract is what lands in the manifest, not what Vite emits.
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { bundleFrontend } from '../bundle-frontend.mjs';

async function assembled(temp) {
  await mkdir(path.join(temp, 'frontend'), { recursive: true });
  await writeFile(path.join(temp, 'system-manifest.json'), JSON.stringify({ format: 'composer-system-assembly', notProvided: ['TLS', 'frontend bundle (built at release by bundle-frontend.mjs)'], files: [{ path: 'backend/app/main.py', sha256: 'x', bytes: 1, role: 'backend-entry' }] }));
}

// dist and node_modules are laid down by each test before the call; the fake only records and answers.
function fakeNpm({ build = true } = {}) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return args[0] === 'run' && !build ? { status: 1, stderr: 'build broke' } : { status: 0 };
  };
  return { run, calls };
}

test('the build writes dist hashes into the manifest and removes the toolchain', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bundle-frontend-'));
  try {
    await assembled(temp);
    const { run, calls } = fakeNpm();
    await mkdir(path.join(temp, 'frontend/dist/assets'), { recursive: true });
    await writeFile(path.join(temp, 'frontend/dist/index.html'), '<html></html>');
    await writeFile(path.join(temp, 'frontend/dist/assets/app.js'), 'x');
    await mkdir(path.join(temp, 'frontend/node_modules'), { recursive: true });
    const manifest = await bundleFrontend(temp, { run });
    assert.deepEqual(calls.map(c => c.args.slice(0, 2).join(' ')), ['ci --ignore-scripts', 'run build']);
    assert.ok(calls.every(c => c.cwd === path.join(temp, 'frontend')));
    assert.deepEqual(manifest.files.filter(f => f.role === 'frontend-bundle').map(f => f.path), ['frontend/dist/assets/app.js', 'frontend/dist/index.html']);
    const index = manifest.files.find(f => f.path === 'frontend/dist/index.html');
    assert.equal(index.sha256, createHash('sha256').update('<html></html>').digest('hex'));
    assert.equal(manifest.notProvided.some(item => /frontend bundle/.test(item)), false);
    assert.deepEqual(JSON.parse(await readFile(path.join(temp, 'system-manifest.json'), 'utf8')), manifest);
    assert.equal(await stat(path.join(temp, 'frontend/node_modules')).catch(() => null), null);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('a failed build leaves no node_modules and reports the npm error', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bundle-frontend-'));
  try {
    await assembled(temp);
    await mkdir(path.join(temp, 'frontend/node_modules'), { recursive: true });
    const { run } = fakeNpm({ build: false });
    await assert.rejects(bundleFrontend(temp, { run }), /npm run 失敗：build broke/);
    assert.equal(await stat(path.join(temp, 'frontend/node_modules')).catch(() => null), null);
    assert.equal(JSON.parse(await readFile(path.join(temp, 'system-manifest.json'), 'utf8')).files.length, 1);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('a build without index.html is refused and a second bundling is refused', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bundle-frontend-'));
  try {
    await assembled(temp);
    await mkdir(path.join(temp, 'frontend/dist'), { recursive: true });
    await writeFile(path.join(temp, 'frontend/dist/other.js'), 'x');
    await assert.rejects(bundleFrontend(temp, { run: () => ({ status: 0 }) }), /沒有 index\.html/);
    await writeFile(path.join(temp, 'frontend/dist/index.html'), 'x');
    await bundleFrontend(temp, { run: () => ({ status: 0 }) });
    await assert.rejects(bundleFrontend(temp, { run: () => ({ status: 0 }) }), /已含前端建置結果/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
