import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assembleSystem, systemSource, scanExclusions, systemExcluded } from '../assemble-system.mjs';
import { inventory, repository, files, prefixes, tenantFree } from '../../preview/assemble.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const minimal = ['platform-core-kit', 'generic-forms-kit', 'audit-edit-kit', 'station-data-link-kit', 'upload-validation-kit', 'import-pipeline-kit', 'entry-permission-kit'];
/** @param {Buffer} data */
const hash = data => createHash('sha256').update(data).digest('hex');
/** @param {(temp: string) => Promise<void>} work */
async function fixture(work) {
  const temp = await mkdtemp(path.join(directory, '.test-'));
  try { await work(temp); } finally { await rm(temp, { recursive: true, force: true }); }
}
/** @param {string} temp @param {string[]} enabledKits */
async function recipeFile(temp, enabledKits) {
  const name = path.join(temp, 'recipe.json');
  await writeFile(name, JSON.stringify({ recipeVersion: '0.2.0', name: 'wp1-case',
    sourceManifest: 'form-analysis.kit-manifest.json', database: { engine: 'postgresql' }, enabledKits }));
  return name;
}
// No Python or Docker process is launched. Real AST/FK verification is by Claude.
const stub = () => ({ status: 0, stdout: '' });

for (const size of [11, 7]) test(`${size} Kits: tree, manifest, T12, exclusions and identical output bytes`, async () => fixture(async temp => {
  const before = await inventory(path.join(repository, 'kits'), null, systemExcluded);
  const selected = size === 11 ? before.included : minimal;
  const recipe = await recipeFile(temp, selected);
  /** @type {{executable: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding}[]} */
  const calls = [];
  /** @type {import('../assemble-system.mjs').Run} */
  const run = (executable, args, options) => { calls.push({ executable, args, options }); return stub(); };
  const one = path.join(temp, 'one'), two = path.join(temp, 'two');
  const manifest = await assembleSystem(one, { recipe, run });
  assert.deepEqual(await assembleSystem(two, { recipe, run }), manifest);
  assert.equal(manifest.kits.length, size);
  assert.deepEqual(manifest.kits.map(k => k.kit), [...selected].sort());
  for (const kit of manifest.kits) {
    assert.equal(kit.version, 'c4b2b7b-ui.1');
    assert.match(kit.sourceSha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(manifest.notIncluded.map(k => k.kit), ['station-admin-kit', 'tenant-auth-kit']);
  assert.ok(manifest.notIncluded.every(k => k.reason.length > 3));
  assert.equal(manifest.notSelected.length, 11 - size);
  assert.ok(!manifest.notProvided.some(s => /formal entry file|deployment and startup/.test(s)));
  for (const item of ['TLS', 'machine API key authentication', 'executable upgrade migrations', 'frontend build (WP2)', 'hash-locked dependency file（建議 --require-hashes）']) assert.ok(manifest.notProvided.includes(item), item);
  assert.equal(manifest.installable, false);
  for (const name of ['kits', 'config', 'database/migrations', 'permissions', 'aov', 'validation', 'backend', 'deployment']) assert.ok((await stat(path.join(one, name))).isDirectory());
  const names = await files(one);
  for (const required of ['backend/app/main.py', 'backend/app/system_init.py', 'permissions/entry_points.json',
    'deployment/docker-compose.yml', 'deployment/backend.Dockerfile', 'deployment/nginx.conf',
    'deployment/.env.example', 'deployment/README.md', 'deployment/backend/requirements.txt']) assert.ok(names.includes(required), required);
  assert.deepEqual(names, await files(two));
  assert.deepEqual(manifest.files.map(f => f.path), names.filter(n => n !== 'system-manifest.json').sort());
  for (const name of names) {
    const data = await readFile(path.join(one, name));
    assert.deepEqual(data, await readFile(path.join(two, name)));
    assert.doesNotMatch(name + '\n' + data.toString(), /COMPOSER_PREVIEW|preview-local-only|preview_seed|preview_gate|preview_registry|preview_support|preview_policy|\/_preview\/|preview_fake/i);
    assert.doesNotMatch(data.toString(), /@@[A-Z_]+@@/);
    if (name === 'system-manifest.json') continue;
    const entry = manifest.files.find(f => f.path === name);
    assert.ok(entry);
    assert.equal(entry.sha256, hash(data)); assert.equal(entry.bytes, data.length); assert.ok(entry.role);
  }
  assert.ok(names.includes('backend/app/main.py'));
  await checkDeployment(one, selected);
  const modelImports = await readFile(path.join(one, 'backend/app/models/__init__.py'), 'utf8');
  assert.match(modelImports, /import app.models.core.tenant_api_key/);
  assert.match(modelImports, /import app.models.p1_record/);
  for (const [name, count] of /** @type {[string, number][]} */ ([['app/api/routes_generic_forms.py', 1], ['app/core/db_capabilities.py', 2]])) {
    const source = await readFile(path.join(one, 'backend', name), 'utf8');
    assert.equal(source.split('func.to_regclass(\'"\' + ').length - 1, count);
    assert.doesNotMatch(source, /require_access/);
  }
  assert.equal(calls.length, 4);
  assert.ok(calls[0].args[1].endsWith('preview_gate.py'));
  assert.deepEqual(JSON.parse(String(calls[0].options.input)).recipe.enabledKits, selected);
  assert.ok(calls[1].args[1].endsWith('check_tree.py'));
  assert.equal(calls[1].args[2], path.join(one, 'backend'));
  assert.equal(calls[1].options.shell, false);
  await assert.rejects(assembleSystem(one, { recipe, run }), /EEXIST/);
  assert.deepEqual(before, await inventory(path.join(repository, 'kits'), null, systemExcluded));
}));

test('exclusion scan rejects every preview marker, including fake service and gate', () => {
  for (const token of ['COMPOSER_PREVIEW', 'preview-local-only', 'preview_seed', 'preview_gate', 'preview_registry', 'preview_support', 'preview_policy', '/_preview/mod', 'preview_fake']) {
    assert.throws(() => scanExclusions(new Map([['backend/app/injected.py', Buffer.from(token)]])), /預覽項目/);
  }
});

test('T12 anchor drift rejects assembly adaptation; only added gate code is removed', async () => {
  for (const name of ['app/api/routes_generic_forms.py', 'app/core/db_capabilities.py']) assert.throws(() => systemSource(name, Buffer.from('')), /來源已變更/);
  for (const name of ['app/api/routes_import_v2.py', 'app/services/import_v2.py']) {
    const original = await readFile(path.join(repository, 'kits/import-pipeline-kit/src/backend', name));
    assert.equal(systemSource(name, original).toString(), original.toString().replaceAll('\r\n', '\n'));
  }
});

test('validation/checker failure propagates, cleans new output, preserves existing directory', async () => fixture(async temp => {
  const recipe = await recipeFile(temp, minimal);
  const out = path.join(temp, 'out');
  await assert.rejects(assembleSystem(out, { recipe, run: () => ({ status: 1, stderr: 'invalid recipe' }) }), /invalid recipe/);
  await assert.rejects(stat(out), /ENOENT/);
  let count = 0;
  await assert.rejects(assembleSystem(out, { recipe, run: () => ++count === 1 ? stub() : { status: 1, stderr: 'foreign key to missing table' } }), /foreign key to missing table/);
  await assert.rejects(stat(out), /ENOENT/);
  await assert.rejects(assembleSystem(out, { recipe, run: () => ({ error: new Error('spawn unavailable') }) }), /spawn unavailable/);
  await assert.rejects(assembleSystem(temp, { recipe, run: stub }), /EEXIST/);
  assert.ok(await readFile(recipe));
}));

test('unknown/excluded/duplicate Kits and missing executable dependencies are rejected', async () => fixture(async temp => {
  for (const selected of [['../outside'], ['tenant-auth-kit'], ['station-admin-kit'], ['entry-permission-kit'], [...minimal, minimal[0]], ['generic-forms-kit']]) {
    const recipe = await recipeFile(temp, selected);
    await assert.rejects(assembleSystem(path.join(temp, 'out'), { recipe, run: stub }), /Kit|kit|依賴|enabledKits/);
  }
}));

test('optional import diagnostics are retained without claiming runtime validation', async () => fixture(async temp => {
  const recipe = await recipeFile(temp, minimal);
  let count = 0;
  await assembleSystem(path.join(temp, 'out'), { recipe,
    run: () => ++count === 1 ? stub() : { status: 0, stdout: 'OPTIONAL_IMPORTS: ["app.example:1: optional app.absent"]\n' } });
  const report = JSON.parse(await readFile(path.join(temp, 'out/validation/report.json'), 'utf8'));
  assert.deepEqual(report.optionalImports, ['app.example:1: optional app.absent']);
  assert.equal(report.runtime, 'not-run');
}));

/** @param {string} out @param {string[]} selected */
async function checkDeployment(out, selected) {
  /** @param {string} name */
  const read = name => readFile(path.join(out, name), 'utf8');
  const main = await read('backend/app/main.py');
  const init = await read('backend/app/system_init.py');
  const compose = await read('deployment/docker-compose.yml');
  const dockerfile = await read('deployment/backend.Dockerfile');
  const proxy = await read('deployment/nginx.conf');
  const entries = JSON.parse(await read('permissions/entry_points.json'));
  const expected = [];
  for (const kitId of [...selected].sort()) {
    const contract = JSON.parse((await readFile(path.join(repository, 'kits', kitId, 'kit.contract.json'), 'utf8')).replace(/^\uFEFF/, ''));
    expected.push(...(contract.entryPoints ?? []).map(/** @param {Record<string, unknown>} entry */ entry => ({ ...entry, kitId })));
  }
  assert.deepEqual(entries.entryPoints, expected);
  assert.ok(expected.length > 0);
  const webhook = selected.includes('mod-subscription-kit');
  assert.deepEqual(entries.publicPaths, ['/healthz', '/api/auth/login', ...(webhook ? ['/api/mod/subscriptions/webhook'] : [])]);
  const secretNames = ['DATABASE_URL', 'SECRET_KEY', 'ENTRY_PERMISSION_JWT_SECRET', ...(webhook ? ['MOD_WEBHOOK_SECRET'] : [])];
  for (const name of [...secretNames, 'DEFAULT_TENANT_ID']) assert.ok(main.includes('"' + name + '"'), name);
  assert.ok(compose.includes('$' + '{DEFAULT_TENANT_ID:?'));
  for (const name of secretNames) {
    // D138/D142: private values reach the container only as mounted files, never as environment values.
    assert.ok(compose.includes(name + '_FILE: /run/secrets/' + name.toLowerCase()), name);
    assert.ok(!compose.includes('$' + '{' + name), name + ' must not be interpolated from the environment');
    assert.ok(compose.includes('file: ../secrets/' + name.toLowerCase()), name);
  }
  assert.ok(compose.includes('POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password'));
  assert.ok(!compose.includes('$' + '{POSTGRES_PASSWORD'));
  if (!webhook) { assert.ok(!main.includes('MOD_WEBHOOK_SECRET')); assert.ok(!compose.includes('MOD_WEBHOOK_SECRET')); }
  assert.ok(main.indexOf('load_secret_files()') < main.indexOf('Required environment variable'));
  const gate = main.lastIndexOf('app.middleware("http")(license_gate_middleware)');
  assert.ok(gate > main.lastIndexOf('app.include_router(') && gate > main.indexOf('app.middleware("http")(entry_permission_middleware)'),
    'the license gate must be the outermost (last added) middleware');
  for (const mount of ['/system/license', '/system/trust/root.pem:ro', '/system/manifest/system-manifest.json:ro']) assert.ok(compose.includes(mount), mount);
  assert.match(compose, /LICENSE_DIR:\?/);
  assert.match(await read('backend/app/license_gate.py'), /OPEN_PATHS = frozenset\(\{"\/healthz"\}\)/);
  // D136: the guard is the only component that sees the machine, so it must stay as small and closed as designed.
  const guard = compose.slice(compose.indexOf('\n  guard:'), compose.indexOf('\n  proxy:'));
  for (const hardening of ['user: "0:0"', 'read_only: true', 'cap_drop: [ALL]', 'no-new-privileges:true', 'network_mode: none',
    '- /sys:/host/sys:ro', '"app.guard"', 'GUARD_RESULT_FILE: /guard/result.json']) assert.ok(guard.includes(hardening), hardening);
  for (const forbidden of ['ports:', 'networks:', 'expose:', '/system/license', 'secrets', 'DATABASE_URL', '/var/run/docker.sock', 'privileged']) {
    assert.ok(!guard.includes(forbidden), 'guard must not have ' + forbidden);
  }
  assert.ok(compose.includes('guard:/guard:ro'), 'the backend reads the guard report read-only');
  assert.equal(compose.match(/- \/sys:\/host\/sys:ro/g)?.length, 1, 'only the guard sees the host /sys');
  assert.match(await read('backend/app/guard.py'), /def collect\(sys_root\)/);
  assert.match(await read('backend/app/license_hardware.py'), /def evaluate\(/);
  assert.match(await read('deployment/.env.example'), /LICENSE_BLOCK_WINDOW=/);
  assert.match(main, /if not os.environ.get\(name, ""\).strip\(\)/);
  assert.ok(main.indexOf('Required environment variable') < main.indexOf('from app.api.deps'));
  assert.ok(main.indexOf('app.middleware("http")(endpoint_permission_middleware)') < main.indexOf('app.middleware("http")(entry_permission_middleware)'));
  assert.match(main, /machine_auth=machine_access_unavailable/);
  assert.match(main, /async def machine_access_unavailable[\s\S]*?status_code=401/);
  assert.doesNotMatch(main, /create_all|app.core.auth/);
  assert.match(main, /SELECT 1/); assert.match(main, /get_table_names/);
  assert.match(main, /db.get\(Tenant, TENANT_ID\) is None/);
  assert.equal(main.match(/status_code=503/g)?.length, 3);
  assert.match(init, /import app.models/);
  assert.match(init, /run_sync\(database.Base.metadata.create_all\)/);
  assert.match(init, /if existing is None:/);
  assert.match(init, /name=system_id, code=system_id/);
  assert.doesNotMatch(init, /create_admin|EpUser|EpRole/);
  // Preview's unannotated selected=null parameter has an overly narrow inferred type.
  const selectedInventory = /** @type {(kits: string, selected: string[] | null, excluded: Map<string, string>) => ReturnType<typeof inventory>} */ (inventory);
  const plan = await selectedInventory(path.join(repository, 'kits'), selected, systemExcluded);
  const routers = [...plan.sources.keys()].filter(n => /^app\/api\/routes_[^/]+\.py$/.test(n)).sort();
  const actual = main.split('\n').filter(line => line.startsWith('app.include_router('));
  assert.equal(actual.length, routers.length);
  routers.forEach((name, i) => {
    const stem = path.posix.basename(name, '.py');
    assert.ok(actual[i].includes('app.api.' + stem));
    assert.ok(actual[i].includes('prefix=' + JSON.stringify(prefixes.get(stem))));
    assert.equal(actual[i].includes('Depends(get_current_tenant)'), !tenantFree.has(stem));
  });
  assert.match(compose, /image: postgres:16.6-bookworm/);
  assert.match(compose, /internal: true/);
  assert.equal(compose.match(/ports:/g)?.length, 1);
  assert.match(compose, /expose: \["8000"\]/);
  assert.ok(compose.includes('$' + '{PROXY_BIND:-127.0.0.1}:$' + '{HTTP_PORT:-8080}:80'));
  assert.match(compose, /profiles: \["init"\]/);
  assert.match(compose, /app.system_init/);
  assert.match(compose, /urllib.request.urlopen\('http:\/\/127.0.0.1:8000\/healthz'/);
  assert.match(dockerfile, /FROM python:3.12.8-slim-bookworm/);
  assert.match(dockerfile, /USER 10001:10001/);
  assert.match(dockerfile, /COPY kits\/ \/system\/kits\//);
  assert.match(proxy, /location \/api\//); assert.match(proxy, /location = \/healthz/);
  assert.match(proxy, /return 503 "前端尚未納入此套件版本/);
  assert.match(proxy, /location = \/license/);
  assert.equal(proxy.match(/proxy_pass/g)?.length, 3);
  for (const line of (await read('deployment/.env.example')).split('\n').filter(s => s && !s.startsWith('#'))) assert.match(line, /^[A-Z_]+=$/);
  const requirements = (await read('deployment/backend/requirements.txt')).trim().split('\n');
  assert.ok(requirements.includes('PyJWT==2.15.1')); assert.ok(requirements.includes('bcrypt==5.0.0'));
  assert.equal(new Set(requirements).size, requirements.length);
  const inputs = [await readFile(path.join(repository, 'services/preview/requirements.txt'), 'utf8')];
  for (const kit of selected) {
    try { inputs.push(await readFile(path.join(repository, 'kits', kit, 'requirements.txt'), 'utf8')); }
    catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
  }
  assert.deepEqual(requirements, [...new Set(inputs.join('\n').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')))].sort());
  const config = await read('backend/app/core/config.py');
  for (const field of ['database_url', 'secret_key']) assert.ok(config.includes(field + ': str = Field(\n        '));
  assert.doesNotMatch(config, /(?:database_url|secret_key): str = Field\(\n\s*default=/);
}

test('missing entry-permission Kit is rejected before writing output', async () => fixture(async temp => {
  // Core has no dependency on EP: dependency validation cannot mask a removed mandatory-auth check.
  for (const selected of [['platform-core-kit'], minimal.filter(k => k !== 'entry-permission-kit')]) {
    const recipe = await recipeFile(temp, selected);
    const out = path.join(temp, 'out');
    await assert.rejects(assembleSystem(out, { recipe, run: stub }), /必須選入 entry-permission-kit；機器 API key 替代認證尚未提供/);
    await assert.rejects(stat(out), /ENOENT/);
  }
}));

test('default secret scan rejects credential values', () => {
  assert.doesNotThrow(() => scanExclusions(new Map([['runtime.py', Buffer.from('app.state.ep_secret = secret\n')]])));
  for (const value of ['SECRET_KEY="secret"', 'SECRET_KEY=secret', 'password: "password"', 'password: password', 'default="change-me"', 'postgresql://app:app_secure_password@localhost/db']) {
    assert.throws(() => scanExclusions(new Map([['injected', Buffer.from(value)]])), /預設秘密/);
  }
});
