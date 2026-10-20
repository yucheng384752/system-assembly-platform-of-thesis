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

test('legacy import guards precede mutations and preserve indentation', async () => {
  const route = await readFile(path.join(repository, 'kits/import-pipeline-kit/src/backend/app/api/routes_import_v2.py'), 'utf8');
  const patched = adapt('app/api/routes_import_v2.py', route);
  assert.equal([...patched.matchAll(/reject_table_code\(table_registry.table_code\)/g)].length, 4);
  assert.ok(patched.includes('            reject_table_code(table_registry.table_code)\n            return table_registry, normalized'));
  const commit = patched.slice(patched.indexOf('async def commit_import_job('));
  assert.ok(commit.indexOf('await reject_job') < commit.indexOf('job.status ='));
  const service = adapt('app/services/import_v2.py', await readFile(path.join(repository, 'kits/import-pipeline-kit/src/backend/app/services/import_v2.py'), 'utf8'));
  const body = service.slice(service.indexOf('    async def commit_job('));
  assert.ok(body.indexOf('await reject_job') < body.indexOf('self._touch_status('));
  assert.throws(() => adapt('app/services/import_v2.py', ''), /來源已變更/);
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

test('container isolation, fake subscription and fixed dependency versions', async () => {
  const compose = await readFile(path.join(directory, 'docker-compose.yml'), 'utf8');
  // PostgreSQL stays on the internal network and is never published; only the backend is reachable, on loopback.
  assert.match(compose, /data:\r?\n    internal: true/);
  assert.deepEqual([...compose.matchAll(/- "([^"]+:\d+)"/g)].map(m => m[1]), ['127.0.0.1:${PREVIEW_API_PORT:-18000}:8000']);
  assert.match(compose, /MOD_API_BASE_URL: http:\/\/127\.0\.0\.1:8000\/_preview\/mod/);
  const requirements = await readFile(path.join(directory, 'requirements.txt'), 'utf8');
  for (const line of requirements.split(/\r?\n/).filter(l => l && !l.startsWith('#'))) assert.match(line, /^[\w-]+==[\w.]+$/);
});
