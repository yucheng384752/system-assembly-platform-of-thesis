import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { mergeDelivery } from '../merge-delivery.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const RECIPE = JSON.stringify({ name: 'demo', recipeVersion: '0.2.0', enabledKits: ['platform-core-kit'] });

async function write(root, name, data) {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), data);
}

async function fixture(run, { recipe = RECIPE, name = 'demo', extra = [] } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'merge-delivery-'));
  try {
    const system = path.join(temp, 'system'), delivery = path.join(temp, 'delivery');
    await write(system, 'config/system.recipe.json', RECIPE);
    await write(system, 'system-manifest.json', JSON.stringify({ format: 'composer-system-assembly', systemId: 'demo', installable: false,
      files: [{ path: 'config/system.recipe.json', sha256: hash(RECIPE), bytes: RECIPE.length, role: 'recipe' }] }));
    const files = [['README.md', 'readme', 'hello'], ['config/system.recipe.json', 'recipe', recipe], ['aov/workflow.aov.json', 'workflow', '{}'],
      ['validation/report.json', 'validation-report', '{"ok":true}'], ['docs/manual-user.md', 'manual', '# manual'], ...extra];
    for (const [file, , text] of files) await write(delivery, file, text);
    await write(delivery, 'package-manifest.json', JSON.stringify({ format: 'composer-delivery-package', version: 1, installable: false, clientName: 'Acme',
      recipe: { name, recipeVersion: '0.2.0' }, artifacts: files.map(([file, role, text]) => ({ path: file, role, sha256: hash(text), bytes: Buffer.byteLength(text) })) }));
    return await run(system, delivery);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

test('delivery artifacts are placed beside the system files and recorded with hashes', () => fixture(async (system, delivery) => {
  const manifest = await mergeDelivery(system, delivery);
  const paths = manifest.files.map(f => f.path);
  assert.deepEqual(paths, [...paths].sort());
  for (const name of ['docs/delivery-README.md', 'aov/workflow.aov.json', 'validation/delivery-report.json', 'docs/manual-user.md']) {
    const entry = manifest.files.find(f => f.path === name);
    assert.ok(entry, name);
    assert.equal(entry.sha256, hash(await readFile(path.join(system, name))));
  }
  assert.equal(manifest.files.filter(f => f.path === 'config/system.recipe.json').length, 1);
  assert.equal(manifest.delivery.clientName, 'Acme');
  assert.deepEqual(JSON.parse(await readFile(path.join(system, 'system-manifest.json'), 'utf8')), manifest);
}));

test('the delivery report never replaces the system validation report', () => fixture(async (system, delivery) => {
  await write(system, 'validation/report.json', 'system report');
  await mergeDelivery(system, delivery);
  assert.equal(await readFile(path.join(system, 'validation/report.json'), 'utf8'), 'system report');
}));

test('a different recipe is refused and nothing is written', () => fixture(async (system, delivery) => {
  await assert.rejects(mergeDelivery(system, delivery), /Recipe 與系統包的 Recipe 不同/);
  assert.equal(await stat(path.join(system, 'docs')).catch(() => null), null);
}, { recipe: JSON.stringify({ name: 'demo', recipeVersion: '0.2.0', enabledKits: ['logs-ops-kit'] }) }));

test('a delivery for another system is refused', () => fixture(async (system, delivery) => {
  await assert.rejects(mergeDelivery(system, delivery), /系統名稱/);
}, { name: 'other' }));

test('a tampered delivery file is refused', () => fixture(async (system, delivery) => {
  await writeFile(path.join(delivery, 'README.md'), 'changed');
  await assert.rejects(mergeDelivery(system, delivery), /與 manifest 不符：README\.md/);
}));

test('an unknown delivery file is refused instead of being copied blindly', () => fixture(async (system, delivery) => {
  await assert.rejects(mergeDelivery(system, delivery), /未知檔案：scripts\/run\.sh/);
}, { extra: [['scripts/run.sh', 'readme', 'echo hi']] }));

test('merging twice is refused', () => fixture(async (system, delivery) => {
  await mergeDelivery(system, delivery);
  await assert.rejects(mergeDelivery(system, delivery), /已併入/);
}));
