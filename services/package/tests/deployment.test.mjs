import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleSystem } from '../assemble-system.mjs';
import { inventory, repository } from '../../preview/assemble.mjs';
import { systemExcluded } from '../assemble-system.mjs';

test('contract rejection cases and nonempty endpoint intersection warning', async () => {
  const temp = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), '.contracts-'));
  try {
    const kits = path.join(temp, 'kits');
    await cp(path.join(repository, 'kits'), kits, { recursive: true });
    const selected = (await inventory(kits, null, systemExcluded)).included;
    const recipe = path.join(temp, 'recipe.json');
    await writeFile(recipe, JSON.stringify({ recipeVersion: '0.2.0', name: 'deployment-test', enabledKits: selected }));
    const contractPath = path.join(kits, 'entry-permission-kit/kit.contract.json');
    const original = JSON.parse(await readFile(contractPath, 'utf8'));
    /** @type {Array<[string, (contract: any) => void, RegExp]>} */
    const cases = [
      ['duplicate-key', c => c.entryPoints.push(structuredClone(c.entryPoints[0])), /入口鍵重複/],
      ['audit-write', c => { c.entryPoints[0].access = 'write'; c.entryPoints[0].defaultRoles.push('audit'); }, /寫入入口含 audit/],
      ['unknown-role', c => c.entryPoints[0].defaultRoles.push('qc'), /未知角色/],
      ['duplicate-route', c => c.entryPoints.push({ ...structuredClone(c.entryPoints[0]), key: 'test.duplicate' }), /路由重複/],
      ['schema', c => { c.entryPoints[0].access = 'invalid'; }, /入口目錄格式錯誤/],
    ];
    // Python boundary is stubbed; these failures must come from the real Node assembler.
    const run = () => ({ status: 0, stdout: '' });
    for (const [name, mutate, expected] of cases) {
      const contract = structuredClone(original);
      mutate(contract);
      await writeFile(contractPath, JSON.stringify(contract));
      const output = path.join(temp, name);
      await assert.rejects(assembleSystem(output, { recipe, kits, run }), expected);
      await assert.rejects(stat(output), /ENOENT/);
    }
    await writeFile(contractPath, JSON.stringify(original));
    const endpoints = { '/api/edit': 'manager' };
    await writeFile(path.join(kits, 'platform-core-kit/src/backend/app/config/endpoint_permissions.json'), JSON.stringify(endpoints));
    const output = path.join(temp, 'warning');
    const manifest = await assembleSystem(output, { recipe, kits, run });
    assert.deepEqual(JSON.parse(await readFile(path.join(output, 'permissions/endpoint_permissions.json'), 'utf8')), endpoints);
    const report = JSON.parse(await readFile(path.join(output, 'validation/report.json'), 'utf8'));
    assert.deepEqual(report.warnings, ['舊端點權限層會與入口層取交集']);
    assert.ok(manifest.notProvided.includes('Kit workflow: entry-permission-kit/workflow.aov.json (source not provided)'));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('logs-ops own table is created by the explicit init step and its writer is started by the backend (found in the deployed-system check)', async () => {
  // The real container returned 500 for GET /api/logs/ because system_logs is plain DDL, not an ORM model, so create_all skips it.
  const temp = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), '.logs-'));
  try {
    const recipe = path.join(temp, 'recipe.json');
    const selected = (await inventory(path.join(repository, 'kits'), null, systemExcluded)).included;
    await writeFile(recipe, JSON.stringify({ recipeVersion: '0.2.0', name: 'logs-test', enabledKits: selected }));
    const output = path.join(temp, 'out');
    await assembleSystem(output, { recipe, run: () => ({ status: 0, stdout: '' }) });
    const init = await readFile(path.join(output, 'backend/app/system_init.py'), 'utf8');
    assert.match(init, /monitoring\._DDL_PG/, 'system_init must create system_logs');
    const main = await readFile(path.join(output, 'backend/app/main.py'), 'utf8');
    assert.match(main, /init_monitoring\(server_url=""\)/, 'main must start the log writer without a remote heartbeat');
    assert.match(main, /stop_heartbeat/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
