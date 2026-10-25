import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shared = pathToFileURL(path.resolve(root, '../preview/assemble.mjs')).href;
/** @param {string} testFile */
function run(testFile) {
  const result = spawnSync(process.execPath, ['--test', testFile], { encoding: 'utf8', shell: false });
  assert.ifError(result.error);
  return result;
}
const baseline = run(path.join(here, 'package.test.mjs'));
assert.equal(baseline.status, 0, `baseline must pass before mutation: ${baseline.stdout}\n${baseline.stderr}`);
console.log('baseline: passed');
/** @type {Array<[string, string, string, string, string]>} */
const mutations = [
  ['remove-required-compose', 'templates/docker-compose.yml', '${SECRET_KEY:?SECRET_KEY is required}', '${SECRET_KEY}', '11 Kits'],
  ['remove-required-webhook', 'deployment.mjs', '${MOD_WEBHOOK_SECRET:?MOD_WEBHOOK_SECRET is required}', '${MOD_WEBHOOK_SECRET}', '11 Kits'],
  ['remove-preview-exclusion', 'assemble-system.mjs', ".replace('\\nfrom app.preview_gate import require_access\\n', '')", '', '11 Kits'],
  ['remove-entry-directory', 'assemble-system.mjs', "put('permissions/entry_points.json', json(await entryDirectory(kits, plan.included)), 'permission-directory');", '', '11 Kits'],
  ['remove-notProvided-update', 'assemble-system.mjs', "notProvided: ['frontend build (WP2)', 'TLS', 'machine API key authentication',", "notProvided: ['formal entry file (WP3)', 'deployment and startup (WP3)',", '11 Kits'],
  ['remove-entry-required', 'assemble-system.mjs', "if (!recipe.enabledKits.includes('entry-permission-kit')) throw new Error('必須選入 entry-permission-kit；機器 API key 替代認證尚未提供');", '', 'missing entry-permission Kit'],
  ['remove-startup-secret-check', 'templates/main.py', 'if not os.environ.get(name, "").strip():', 'if False:', '11 Kits'],
  ['remove-T12', 'assemble-system.mjs', 'adapt(name, original)', "(name === 'app/core/db_capabilities.py' ? original : adapt(name, original))", '11 Kits'],
  ['remove-notIncluded', 'assemble-system.mjs', 'notIncluded: excluded,', '', '11 Kits'],
];
for (const [name, file, anchor, replacement, testName] of mutations) {
  const temp = await mkdtemp(path.join(here, '.mutation-'));
  try {
    for (const module of ['assemble-system.mjs', 'deployment.mjs']) {
      await writeFile(path.join(temp, module), (await readFile(path.join(root, module), 'utf8')).replace('../preview/assemble.mjs', shared));
    }
    await cp(path.join(root, 'templates'), path.join(temp, 'templates'), { recursive: true });
    await writeFile(path.join(temp, 'package.test.mjs'), (await readFile(path.join(here, 'package.test.mjs'), 'utf8'))
      .replace('../assemble-system.mjs', './assemble-system.mjs').replace('../../preview/assemble.mjs', shared));
    const target = path.join(temp, file);
    const source = await readFile(target, 'utf8');
    assert.equal(source.split(anchor).length - 1, 1, `mutation anchor: ${name}`);
    await writeFile(target, source.replace(anchor, replacement));
    const result = run(path.join(temp, 'package.test.mjs'));
    assert.equal(result.status, 1, `${name} must fail tests: ${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(result.stderr, /SyntaxError|ERR_MODULE_NOT_FOUND/);
    assert.ok(result.stdout.split(/\r?\n/).some(line => /✖|not ok/.test(line) && line.includes(testName)),
      `${name} must fail its intended test: ${result.stdout}`);
    console.log(`${name}: killed (exit ${result.status}; ${testName})`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
