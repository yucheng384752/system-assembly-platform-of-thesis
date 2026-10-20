import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assemble, inventory, adapt, directory, repository } from '../assemble.mjs';
import { commands, execute } from '../preview.mjs';

test('actual kit inventory, deterministic assembly, closed imports and source preservation', async () => {
  const temp = await mkdtemp(path.join(directory, '.test-'));
  try {
    const before = await inventory(path.join(repository, 'kits'));
    const first = await assemble(path.join(temp, 'one'));
    const second = await assemble(path.join(temp, 'two'));
    assert.deepEqual(first, second);
    assert.equal(first.included.length, 9);
    assert.deepEqual(first.excluded.map(k => k.kit), ['entry-permission-kit', 'station-admin-kit', 'station-data-link-kit', 'tenant-auth-kit']);
    assert.ok(first.excluded.every(k => k.reason));
    assert.equal(first.overrides.length, 1);
    const after = await inventory(path.join(repository, 'kits'));
    assert.deepEqual(before, after);
    const modules = new Set(first.files.filter(f => f.path.startsWith('app/') && f.path.endsWith('.py'))
      .map(f => f.path.replace(/\/__init__\.py$/, '').replace(/\.py$/, '').replaceAll('/', '.')));
    for (const file of first.files) {
      const left = await readFile(path.join(temp, 'one', file.path));
      assert.deepEqual(left, await readFile(path.join(temp, 'two', file.path)));
      if (!file.path.endsWith('.py')) continue;
      // A fast local scan complements the AST checker; never imports the backend.
      for (const match of left.toString().matchAll(/^\s*(?:from|import) (app(?:\.[a-zA-Z_][\w]*)*)/gm)) {
        assert.ok(modules.has(match[1]), `${file.path}: missing ${match[1]}`);
      }
    }
    const routes = JSON.parse(await readFile(path.join(temp, 'one/app/preview_registry.json'), 'utf8'));
    assert.equal(routes.length, 12);
    for (const item of routes) assert.ok(modules.has(item.module));
    assert.equal(routes.find(r => r.module.endsWith('routes_generic_forms')).prefix, '/api');
    assert.equal(routes.find(r => r.module.endsWith('routes_mod_subscription')).prefix, '');
    await assert.rejects(assemble(path.join(temp, 'one')), /EEXIST/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('missing backends are explained and unknown collisions fail closed', async () => {
  const temp = await mkdtemp(path.join(directory, '.test-'));
  try {
    await mkdir(path.join(temp, 'contract-kit'));
    assert.match((await inventory(temp)).excluded[0].reason, /缺少/);
    for (const kit of ['a-kit', 'b-kit']) {
      await mkdir(path.join(temp, kit, 'src/backend/app'), { recursive: true });
      await writeFile(path.join(temp, kit, 'src/backend/app/conflict.py'), kit);
    }
    await assert.rejects(inventory(temp), /組裝衝突/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('T10: log timestamps are bound as datetimes while the response keeps its ISO string, and drifted sources fail closed', async () => {
  const logs = await readFile(path.join(repository, 'kits/logs-ops-kit/src/backend/app/api/routes_logs.py'), 'utf8');
  const patched = adapt('app/api/routes_logs.py', logs);
  assert.ok(patched.includes('params["since"] = datetime.fromisoformat(since.replace("Z", "+00:00"))'));
  assert.ok(patched.includes('params["until"] = datetime.fromisoformat(until.replace("Z", "+00:00"))'));
  assert.ok(patched.includes('{"since": datetime.fromisoformat(since), "tenant_id": str(tenant.id)},'));
  assert.ok(patched.includes('        "since": since,'), 'the response must still return the ISO string');
  assert.throws(() => adapt('app/api/routes_logs.py', ''), /來源已變更/);
});

test('T1 removes only preview rejection and registers all compatibility models', async () => {
  for (const name of ['api/routes_import_v2.py', 'services/import_v2.py']) {
    const original = await readFile(path.join(repository, 'kits/import-pipeline-kit/src/backend/app', name), 'utf8');
    assert.equal(adapt('app/' + name, original), original.replaceAll('\r\n', '\n'));
  }
  const temp = await mkdtemp(path.join(directory, '.test-'));
  try {
    await assemble(path.join(temp, 'assembled'));
    const imports = await readFile(path.join(temp, 'assembled/app/models/__init__.py'), 'utf8');
    for (const model of ['p1_record', 'p2_record', 'p2_item_v2', 'p3_record', 'p3_item_v2']) {
      assert.ok(imports.includes('import app.models.' + model));
      const source = await readFile(path.join(temp, 'assembled/app/models', model + '.py'), 'utf8');
      assert.ok(source.includes('(Base):'));
      assert.ok(!source.includes('__getattr__'));
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('compose commands use explicit project, propagate failure and stop reset on failure', () => {
  assert.deepEqual(commands('reset')[0], ['down', '--volumes', '--remove-orphans']);
  assert.throws(() => commands('other'), /用法/);
  const calls = [];
  assert.throws(() => execute('reset', (executable, args, options) => {
    calls.push({ executable, args, options });
    return { status: 2, signal: null, pid: 1, output: [], stdout: null, stderr: null };
  }), /失敗/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'docker');
  assert.ok(calls[0].args.includes('composer-preview'));
  assert.equal(calls[0].options.shell, false);
  assert.throws(() => execute('up', () => ({ error: new Error('ENOENT'), status: null, signal: null, pid: 0, output: [], stdout: null, stderr: null })), /無法執行/);
});

test('smoke import requires an id, READY, no errors and completed commit', async () => {
  const source = await readFile(path.join(directory, 'smoke.mjs'), 'utf8');
  const helpers = source.slice(source.indexOf('async function waitForJob('),
    source.indexOf("await check('import-pipeline-kit', '建立匯入工作並查詢'"));
  async function run(responses) {
    const calls = [];
    const call = async (method, route, options) => {
      calls.push({ method, route, options });
      assert.ok(responses.length, 'unexpected extra request');
      return responses.shift();
    };
    const importAndCommit = new Function('call', 'csv', 'setTimeout',
      helpers + '\nreturn importAndCommit;')(call, () => new Blob(['synthetic']),
      resolve => resolve());
    const result = await importAndCommit(null, 'entry_key,value', ['key,value'], 'entries.csv');
    assert.equal(calls[0].options.form.has('table_code'), false);
    assert.equal(calls[2].route, '/api/v2/import/jobs/synthetic/errors');
    assert.equal(calls[3].method, 'POST');
    assert.equal(calls[3].route, '/api/v2/import/jobs/synthetic/commit');
    assert.equal(responses.length, 0);
    return result;
  }
  const created = () => ({ status: 201, body: { id: 'synthetic' } });
  const ready = () => ({ status: 200, body: { status: 'READY' } });
  const clean = () => ({ status: 200, body: [] });
  assert.equal((await run([created(), ready(), clean(),
    { status: 200, body: {} }, { status: 200, body: { status: 'COMPLETED' } }])).status, 'COMPLETED');
  await assert.rejects(run([{ status: 201, body: {} }]), /建立/);
  await assert.rejects(run([{ status: 501, body: {} }]), /建立/);
  await assert.rejects(run([created(), { status: 200, body: { status: 'FAILED' } }]), /預期 READY/);
  await assert.rejects(run([created(), ready(), { status: 200, body: [{}] }]), /查錯誤/);
  await assert.rejects(run([created(), ready(), clean(), { status: 400, body: {} }]), /提交/);
  await assert.rejects(run([created(), ready(), clean(), { status: 200, body: {} },
    { status: 200, body: { status: 'FAILED' } }]), /預期 COMPLETED/);
});

test('container isolation, fake subscription and fixed dependency versions', async () => {
  const compose = await readFile(path.join(directory, 'docker-compose.yml'), 'utf8');
  // PostgreSQL stays on the internal network and is never published; only the backend is reachable, on loopback.
  assert.match(compose, /data:\r?\n    internal: true/);
  assert.deepEqual([...compose.matchAll(/- "([^"]+:\d+)"/g)].map(m => m[1]), ['127.0.0.1:${PREVIEW_API_PORT:-18000}:8000']);
  assert.match(compose, /MOD_API_BASE_URL: http:\/\/127\.0\.0\.1:8000\/_preview\/mod/);
  const requirements = await readFile(path.join(directory, 'requirements.txt'), 'utf8');
  for (const line of requirements.split(/\r?\n/).filter(l => l && !l.startsWith('#'))) assert.match(line, /^[\w-]+==[\w.]+$/);
});
