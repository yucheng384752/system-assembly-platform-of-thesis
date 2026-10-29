import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const kits = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'kits');

/** @param {string} dir @returns {Promise<string[]>} */
async function pythonFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await pythonFiles(full));
    else if (entry.name.endsWith('.py')) found.push(full);
  }
  return found;
}

// starlette is pinned to 0.38.6 (services/preview/requirements.txt), which has no HTTP_422_UNPROCESSABLE_CONTENT.
// Using it raises AttributeError while building the error response, so a client error becomes a 500.
test('kit backends only use status constants that the pinned starlette defines', async () => {
  const offenders = [];
  for (const file of await pythonFiles(kits)) {
    if ((await readFile(file, 'utf8')).includes('HTTP_422_UNPROCESSABLE_CONTENT')) offenders.push(path.relative(kits, file));
  }
  assert.deepEqual(offenders, []);
});
