// Stage 1: assemble a real system package (real Python checks) for base kits + each optional kit.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repo = process.env.KV_REPO ?? process.cwd();
const out = 'C:/Users/gslab/Desktop/kv-out';
const python = 'C:/Users/gslab/Desktop/composer-refactor/services/preview/.test-venv/Scripts/python.exe';
// The required set as the catalog expands it (see catalog.test.ts): the required Kits plus the Kits they declare as dependencies.
const required = ['platform-core-kit', 'entry-permission-kit', 'station-data-link-kit', 'upload-validation-kit', 'import-pipeline-kit', 'generic-forms-kit', 'audit-edit-kit'];
const base = required;
const optional = ['query-traceability-kit', 'analytics-kit', 'audit-edit-kit', 'logs-ops-kit',
  'mod-subscription-kit', 'factory-core-kit', 'analytical-four-kit', 'station-admin-kit'];
const only = process.argv.slice(2);
const configs = [['required-only', required], ['base', base], ...optional.map(k => [k.replace(/-kit$/, ''), [...base, k]])];
mkdirSync(out, { recursive: true });
const rows = [];
for (const [name, kits] of configs) {
  if (only.length && !only.includes(name)) continue;
  const dir = path.join(out, name), recipe = path.join(out, `${name}.recipe.json`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  writeFileSync(recipe, JSON.stringify({ recipeVersion: '0.2.0', name: `kv-${name}`, sourceManifest: 'form-analysis.kit-manifest.json',
    database: { engine: 'postgresql' }, enabledKits: kits }));
  const t = Date.now();
  const r = spawnSync('node', ['services/package/assemble-system.mjs', dir, '--recipe', recipe],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, PREVIEW_PYTHON: python } });
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-4).join(' | ').slice(0, 400);
  rows.push({ name, ok: r.status === 0, secs, tail });
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} ${secs}s  ${r.status === 0 ? '' : tail}`);
}
writeFileSync(path.join(out, 'stage1.json'), JSON.stringify(rows, null, 2));
