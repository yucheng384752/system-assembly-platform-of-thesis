import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assemble, inventory, adapt, directory, repository, policyData, pythonCheck } from '../assemble.mjs';
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

test('T12: a registered code is domain-backed only when its physical table exists, and drifted sources fail closed', async () => {
  const sources = {
    'app/api/routes_generic_forms.py': 'kits/generic-forms-kit/src/backend/app/api/routes_generic_forms.py',
    'app/core/db_capabilities.py': 'kits/platform-core-kit/src/backend/app/core/db_capabilities.py',
  };
  const expected = { 'app/api/routes_generic_forms.py': 1, 'app/core/db_capabilities.py': 2 };
  for (const [name, source] of Object.entries(sources)) {
    const original = (await readFile(path.join(repository, source), 'utf8')).replaceAll('\r\n', '\n');
    const patched = adapt(name, original);
    assert.equal(patched.split('func.to_regclass(\'"\' + ').length - 1, expected[name], name);
    // The bare registry lookup is gone everywhere, so a registered code without a physical table cannot be domain-backed.
    assert.ok(!/select\(TableRegistry\.(id|table_code)\)\.where\(TableRegistry\.table_code == (code|station_code)\)/.test(patched), name);
    assert.throws(() => adapt(name, ''), /來源已變更/, name);
  }
});

test('T1 removes only preview rejection and registers all compatibility models', async () => {
  for (const name of ['api/routes_import_v2.py', 'services/import_v2.py']) {
    const original = await readFile(path.join(repository, 'kits/import-pipeline-kit/src/backend/app', name), 'utf8');
    const patched = adapt('app/' + name, original);
    assert.equal(patched.replace(/^.*require_access.*\n/gm, ''), original.replaceAll('\r\n', '\n') + '\n');
    assert.ok(patched.includes('require_access("import-pipeline-kit"'));
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

test('policy metadata uses catalog replacements, unavailable kits and workflow bindings', async () => {
  const policy = await policyData(await inventory(path.join(repository, 'kits')));
  assert.equal(Object.keys(policy.kits).length, 12);
  assert.equal(policy.kits['tenant-auth-kit'], undefined);
  for (const kit of ['entry-permission-kit', 'station-admin-kit', 'station-data-link-kit']) {
    assert.equal(policy.kits[kit].available, false);
  }
  assert.ok(policy.kits['import-pipeline-kit'].dependencies.includes('entry-permission-kit'));
  assert.deepEqual(policy.capabilities['analytics.trend'].subfeatures,
    [{ kit: 'analytics-kit', feature: 'trend-analysis' }]);
  assert.equal(policy.capabilities['db.forms.list'].kit, 'platform-core-kit');
  assert.deepEqual(policy.capabilities['db.edit-reasons.validate'].subfeatures,
    [{ kit: 'audit-edit-kit', feature: 'edit-reason' }]);
  assert.equal(policy.capabilities['stations.manage'].kit, 'station-admin-kit');
  // D121: declared-only endpoints stay closed; the preview's own /healthz is not one of them.
  assert.equal(policy.capabilities['subscriptions.manage'].unverified, true);
  assert.equal(policy.capabilities['query.records.search'].unverified, true);
  assert.equal(policy.capabilities['platform.health'].unverified, undefined);
  assert.equal(policy.capabilities['subscriptions.sync'].unverified, undefined);
});

test('recipe assembly only copies selected backends, invokes Python validation and closure, and stays deterministic', async () => {
  const temp = await mkdtemp(path.join(directory, '.test-'));
  try {
    const recipe = path.join(temp, 'recipe.json');
    await writeFile(recipe, JSON.stringify({ recipeVersion: '0.2.0', name: 'synthetic',
      sourceManifest: 'synthetic', database: { engine: 'postgresql' }, enabledKits: ['platform-core-kit'] }));
    const calls = [];
    // Only the process boundary is stubbed here; test_static.py exercises the real validator/checker.
    const run = (executable, args, options) => {
      calls.push({ executable, args, options });
      return { status: 0 };
    };
    const one = await assemble(path.join(temp, 'one'), undefined, { recipe, run });
    const two = await assemble(path.join(temp, 'two'), undefined, { recipe, run });
    assert.deepEqual(one, two);
    assert.deepEqual(one.included.map(i => i.kit), ['platform-core-kit']);
    assert.ok(one.excluded.some(i => i.kit === 'analytics-kit' && i.reason === 'Recipe 未選取'));
    assert.ok(!one.files.some(f => f.path.includes('routes_analytics') || f.path.includes('p1_record')));
    assert.ok(!one.files.some(f => f.path === 'app/preview_seed.py'));
    assert.equal(calls.length, 4);
    assert.ok(calls[0].args[1].endsWith('preview_gate.py'));
    assert.deepEqual(JSON.parse(calls[0].options.input).recipe.enabledKits, ['platform-core-kit']);
    assert.ok(calls[1].args[1].endsWith('check_tree.py'));
    assert.equal(calls[1].args[2], path.join(temp, 'one'));
    const policy = JSON.parse(await readFile(path.join(temp, 'one/app/preview_policy.json'), 'utf8'));
    assert.equal(policy.kits['analytics-kit'].available, true);
    assert.equal(policy.kits['analytics-kit'].assembled, false);
    await assert.rejects(assemble(path.join(temp, 'rejected'), undefined, {
      recipe, run: () => ({ status: 1, stderr: 'synthetic validation failure' }),
    }), /synthetic validation failure/);
    await assert.rejects(readFile(path.join(temp, 'rejected/assembly-report.json')), /ENOENT/);
    let count = 0;
    await assert.rejects(assemble(path.join(temp, 'gap'), undefined, {
      recipe, run: () => ++count === 1 ? { status: 0 } : { status: 1, stderr: 'missing app.models.station' },
    }), /missing app.models.station/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('recipe up passes JSON build argument without shell interpolation; plain up clears inherited recipe', async () => {
  const temp = await mkdtemp(path.join(directory, '.test-'));
  try {
    const recipe = path.join(temp, 'recipe with spaces.json');
    const content = { name: 'synthetic', description: 'literal $() and "quotes"' };
    await writeFile(recipe, '\uFEFF' + JSON.stringify(content));
    const calls = [];
    const run = (executable, args, options) => { calls.push({ executable, args, options }); return { status: 0 }; };
    execute('up', run, recipe);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].options.env.PREVIEW_RECIPE_JSON), content);
    assert.ok(calls[0].args.includes('--build'));
    assert.equal(calls[0].options.shell, false);
    execute('up', run);
    assert.equal(calls[1].options.env.PREVIEW_RECIPE_JSON, '');
    assert.throws(() => execute('down', run, recipe), /只適用/);
    await writeFile(recipe, '{');
    assert.throws(() => execute('up', run, recipe), SyntaxError);
    assert.equal(calls.length, 2);
    assert.throws(() => pythonCheck([], undefined, () => ({ error: new Error('unavailable') })), /unavailable/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('all service and background guard patches fail closed on source drift', async () => {
  for (const [kit, file] of [
    ['platform-core-kit', 'core/kit_broker.py'],
    ['import-pipeline-kit', 'api/routes_import_v2.py'],
    ['import-pipeline-kit', 'services/import_v2.py'],
    ['generic-forms-kit', 'api/routes_generic_forms.py'],
    ['upload-validation-kit', 'services/pdf_conversion.py'],
    ['mod-subscription-kit', 'services/mod_subscription.py'],
  ]) {
    const name = 'app/' + file;
    const original = await readFile(path.join(repository, 'kits', kit, 'src/backend', name), 'utf8');
    const patched = adapt(name, original);
    assert.ok(patched.includes('from app.preview_gate import require_access'), name);
    assert.ok(patched.includes('require_access('), name);
    assert.throws(() => adapt(name, ''), /來源已變更/, name);
  }
});
