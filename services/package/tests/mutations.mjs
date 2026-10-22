import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(here, '../assemble-system.mjs'), 'utf8');
const tests = await readFile(path.join(here, 'package.test.mjs'), 'utf8');
const shared = pathToFileURL(path.resolve(here, '../../preview/assemble.mjs')).href;
const mutations = [
  ['remove-preview-exclusion', ".replace('\\nfrom app.preview_gate import require_access\\n', '')", ''],
  ['remove-T12', 'adapt(name, original)', '(name === \'app/core/db_capabilities.py\' ? original : adapt(name, original))'],
  ['remove-notIncluded', 'notIncluded: excluded,', ''],
];
for (const [name, anchor, replacement] of mutations) {
  assert.equal(source.split(anchor).length - 1, 1, `mutation anchor: ${name}`);
  const temp = await mkdtemp(path.join(here, '.mutation-'));
  try {
    await writeFile(path.join(temp, 'assemble-system.mjs'), source.replace(anchor, replacement)
      .replace('../preview/assemble.mjs', shared));
    await writeFile(path.join(temp, 'package.test.mjs'), tests.replace('../assemble-system.mjs', './assemble-system.mjs')
      .replace('../../preview/assemble.mjs', shared));
    const result = spawnSync(process.execPath, ['--test', path.join(temp, 'package.test.mjs')], { encoding: 'utf8', shell: false });
    assert.ifError(result.error);
    assert.equal(result.status, 1, `${name} must fail tests: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /10 Kits: tree, manifest, T12, exclusions and identical output bytes/);
    console.log(`${name}: killed (exit ${result.status})`);
    console.log(result.stdout.split(/\r?\n/).filter(line => /fail |預覽項目|AssertionError|TypeError/.test(line)).slice(0, 4).join('\n'));
  } finally { await rm(temp, { recursive: true, force: true }); }
}
