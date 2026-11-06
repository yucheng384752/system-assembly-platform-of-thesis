import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { systemExcluded } from '../assemble-system.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const kits = path.join(repository, 'kits');

/** Every Kit a recipe can select: a kits/ folder named *-kit that the assembler does not exclude. */
async function selectableKits() {
  const entries = await readdir(kits, { withFileTypes: true });
  return entries.filter(e => e.isDirectory() && /^[a-z][a-z0-9-]*-kit$/.test(e.name) && !systemExcluded.has(e.name)).map(e => e.name).sort();
}

/** @param {string} dir @returns {Promise<string[]>} */
async function testFiles(dir) {
  try {
    return (await readdir(dir)).filter(name => /^test_.*\.py$/.test(name)).sort();
  } catch { return []; }
}

// D182: the release gate refuses a package whose Kit has no tests, so a new Kit without tests would block every release that selects it.
// This test finds that in the repository, long before a release is attempted.
test('every Kit that can be selected has tests, so no release is blocked by a Kit that was added without them', async () => {
  const missing = [];
  for (const kit of await selectableKits()) {
    const files = await testFiles(path.join(kits, kit, 'tests'));
    let tests = 0;
    for (const file of files) tests += (await readFile(path.join(kits, kit, 'tests', file), 'utf8')).match(/^\s*(?:async )?def test_/gm)?.length ?? 0;
    if (tests === 0) missing.push(kit);
  }
  assert.deepEqual(missing, [], `these Kits have no test functions under tests/: ${missing.join(', ')} (see docs/kit-authoring.md)`);
});

test('the Kit folder list is not empty, so the check above cannot pass by finding nothing', async () => {
  const found = await selectableKits();
  assert.ok(found.length >= 12, `expected the baseline Kits, found ${found.length}`);
  assert.ok(found.includes('platform-core-kit') && found.includes('entry-permission-kit'));
});

test('excluded Kits are exactly the ones the assembler refuses, and they are not silently required to have tests', async () => {
  assert.deepEqual([...systemExcluded.keys()].sort(), ['station-admin-kit', 'tenant-auth-kit']);
});

test('the authoring guide names the gates that enforce it', async () => {
  const guide = await readFile(path.join(repository, 'docs/kit-authoring.md'), 'utf8');
  for (const needle of ['發布閘門', '現場自檢', 'adminRoutes', 'tests/', 'PYTHONPATH']) assert.ok(guide.includes(needle), needle);
});
