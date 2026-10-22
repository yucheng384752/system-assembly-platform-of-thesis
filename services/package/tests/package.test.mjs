import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assembleSystem, systemSource, scanExclusions } from '../assemble-system.mjs';
import { inventory, repository, files } from '../../preview/assemble.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const minimal = ['platform-core-kit', 'generic-forms-kit', 'audit-edit-kit', 'station-data-link-kit', 'upload-validation-kit', 'import-pipeline-kit'];
const hash = data => createHash('sha256').update(data).digest('hex');
async function fixture(work) {
  const temp = await mkdtemp(path.join(directory, '.test-'));
  try { await work(temp); } finally { await rm(temp, { recursive: true, force: true }); }
}
async function recipeFile(temp, enabledKits) {
  const name = path.join(temp, 'recipe.json');
  await writeFile(name, JSON.stringify({ recipeVersion: '0.2.0', name: 'wp1-case',
    sourceManifest: 'form-analysis.kit-manifest.json', database: { engine: 'postgresql' }, enabledKits }));
  return name;
}
// No Python or Docker process is launched. Real AST/FK verification is by Claude.
const stub = () => ({ status: 0, stdout: '' });

for (const size of [10, 6]) test(`${size} Kits: tree, manifest, T12, exclusions and identical output bytes`, async () => fixture(async temp => {
  const before = await inventory(path.join(repository, 'kits'));
  const selected = size === 10 ? before.included : minimal;
  const recipe = await recipeFile(temp, selected);
  const calls = [];
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
  assert.deepEqual(manifest.notIncluded.map(k => k.kit), ['entry-permission-kit', 'station-admin-kit', 'tenant-auth-kit']);
  assert.ok(manifest.notIncluded.every(k => k.reason.length > 3));
  assert.equal(manifest.notSelected.length, 10 - size);
  assert.ok(manifest.notProvided.includes('formal entry file (WP3)'));
  assert.equal(manifest.installable, false);
  for (const name of ['kits', 'config', 'database/migrations', 'permissions', 'aov', 'validation', 'backend']) assert.ok((await stat(path.join(one, name))).isDirectory());
  const names = await files(one);
  assert.deepEqual(names, await files(two));
  assert.deepEqual(manifest.files.map(f => f.path), names.filter(n => n !== 'system-manifest.json'));
  for (const name of names) {
    const data = await readFile(path.join(one, name));
    assert.deepEqual(data, await readFile(path.join(two, name)));
    assert.doesNotMatch(name + '\n' + data.toString(), /COMPOSER_PREVIEW|preview-local-only|preview_seed|preview_gate|preview_registry|preview_support|preview_policy|\/_preview\/|preview_fake/i);
    if (name === 'system-manifest.json') continue;
    const entry = manifest.files.find(f => f.path === name);
    assert.equal(entry.sha256, hash(data)); assert.equal(entry.bytes, data.length); assert.ok(entry.role);
  }
  assert.ok(!names.includes('backend/app/main.py'));
  const modelImports = await readFile(path.join(one, 'backend/app/models/__init__.py'), 'utf8');
  assert.match(modelImports, /import app.models.core.tenant_api_key/);
  assert.match(modelImports, /import app.models.p1_record/);
  for (const [name, count] of [['app/api/routes_generic_forms.py', 1], ['app/core/db_capabilities.py', 2]]) {
    const source = await readFile(path.join(one, 'backend', name), 'utf8');
    assert.equal(source.split('func.to_regclass(\'"\' + ').length - 1, count);
    assert.doesNotMatch(source, /require_access/);
  }
  assert.equal(calls.length, 4);
  assert.ok(calls[0].args[1].endsWith('preview_gate.py'));
  assert.deepEqual(JSON.parse(calls[0].options.input).recipe.enabledKits, selected);
  assert.ok(calls[1].args[1].endsWith('check_tree.py'));
  assert.equal(calls[1].args[2], path.join(one, 'backend'));
  assert.equal(calls[1].options.shell, false);
  await assert.rejects(assembleSystem(one, { recipe, run }), /EEXIST/);
  assert.deepEqual(before, await inventory(path.join(repository, 'kits')));
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
    await assert.rejects(assembleSystem(path.join(temp, 'out'), { recipe, run: stub }), /Kit|依賴|enabledKits/);
  }
}));

test('optional import diagnostics are retained without claiming runtime validation', async () => fixture(async temp => {
  const recipe = await recipeFile(temp, minimal);
  let count = 0;
  await assembleSystem(path.join(temp, 'out'), { recipe,
    run: () => ++count === 1 ? stub() : { status: 0, stdout: 'OPTIONAL_IMPORTS: ["app.example:1: optional app.absent"]\n' } });
  const report = JSON.parse(await readFile(path.join(temp, 'out/validation/report.json')));
  assert.deepEqual(report.optionalImports, ['app.example:1: optional app.absent']);
  assert.equal(report.runtime, 'not-run');
}));
