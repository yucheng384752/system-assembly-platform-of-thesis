import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { adapt, inventory, policyData, pythonCheck, directory as preview, repository } from '../preview/assemble.mjs';

/** @param {unknown} value */
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
/** @param {string} name */
const readJson = async name => JSON.parse((await readFile(name, 'utf8')).replace(/^\uFEFF/, ''));
/** @param {Buffer | string} data */
const sha256 = data => createHash('sha256').update(data).digest('hex');
/** @param {string} a @param {string} b */
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const excluded = [
  { kit: 'entry-permission-kit', reason: '僅契約，無正式後端實作' },
  { kit: 'station-admin-kit', reason: 'T2：缺少 routes_stations.py，無可啟動來源' },
  { kit: 'tenant-auth-kit', reason: 'D03：已廢除' },
];

// These are only the additions made by adapt(); baseline authorization stays intact.
/** @param {string} name @param {Buffer} source */
export function systemSource(name, source) {
  const original = source.toString('utf8').replaceAll('\r\n', '\n');
  if (/preview_gate|require_access/.test(original)) throw new Error(`來源含預覽閘門，停止：${name}`);
  return Buffer.from(adapt(name, original)
    .replace(/^\s*require_access\([^\n]*\)\n/gm, '')
    .replace('\nfrom app.preview_gate import require_access\n', ''));
}

/** @param {Map<string, Buffer>} tree */
export function scanExclusions(tree) {
  for (const [name, data] of tree) {
    if (/COMPOSER_PREVIEW|preview-local-only|preview_seed|preview_gate|preview_registry|preview_support|preview_policy|\/_preview\/|preview_fake/i.test(name + '\n' + data.toString('utf8'))) {
      throw new Error(`系統包含預覽項目：${name}`);
    }
  }
}

/** WP1 only: no startup entry, installation, migration execution or network calls.
 * run is the same synchronous process boundary used by preview tests.
 * @param {string} output
 * @param {{recipe?: string, kits?: string, run?: typeof spawnSync}} [options]
 */
export async function assembleSystem(output, { recipe: recipeFile, kits = path.join(repository, 'kits'), run = spawnSync } = {}) {
  if (!recipeFile) throw new Error('必須提供 Recipe 檔案');
  const recipe = await readJson(recipeFile);
  const all = await inventory(kits);
  const catalog = /** @type {{kits: Record<string, {dependencies: string[]}>}} */ (await policyData(all, kits));
  const schema = await readJson(path.join(repository, 'schemas/recipe.schema.json'));
  // Reuse offline validation, never copy its runtime gate into the package.
  pythonCheck([path.join(preview, 'app/preview_gate.py')], JSON.stringify({ recipe, catalog, schema }), run);
  if (!Array.isArray(recipe.enabledKits) || !recipe.enabledKits.length ||
      new Set(recipe.enabledKits).size !== recipe.enabledKits.length) throw new Error('enabledKits 必須是非空且不重複的陣列');
  for (const kit of recipe.enabledKits) {
    if (!all.included.includes(kit)) throw new Error(`Kit 無正式來源或已排除：${kit}`);
    for (const dep of catalog.kits[kit].dependencies) {
      if (all.included.includes(dep) && !recipe.enabledKits.includes(dep)) throw new Error(`${kit} 缺少依賴 ${dep}`);
    }
  }
  const plan = await inventory(kits, recipe.enabledKits);
  const suite = await readJson(path.join(kits, 'form-analysis.kit-manifest.json'));
  const overlay = await readJson(path.join(repository, 'config/kits/overlay.json'));
  /** @type {Map<string, Buffer>} */
  const tree = new Map();
  /** @type {Map<string, string>} */
  const roles = new Map();
  /** @param {string} name @param {Buffer} data @param {string} role */
  const put = (name, data, role) => { tree.set(name, data); roles.set(name, role); };
  for (const [name, source] of plan.sources) {
    if (name === 'app/models/__init__.py') continue;
    if (name === 'app/main.py') throw new Error('Kit 自帶入口需要另行審核，停止');
    put(`backend/${name}`, name.endsWith('.py') ? systemSource(name, source.data) : source.data, 'backend-source');
  }
  const models = [...tree.keys()].filter(n => n.startsWith('backend/app/models/') && n.endsWith('.py') && !n.endsWith('__init__.py')).sort(compare);
  put('backend/app/models/__init__.py', Buffer.from(models.map(n => `import ${n.slice('backend/'.length, -3).replaceAll('/', '.')}`).join('\n') + '\n'), 'model-registration');
  for (const name of [...tree.keys()]) {
    let parent = path.posix.dirname(name);
    while (parent !== 'backend' && parent !== '.') {
      if (!tree.has(`${parent}/__init__.py`)) put(`${parent}/__init__.py`, Buffer.from(''), 'python-package');
      parent = path.posix.dirname(parent);
    }
  }
  const versions = [];
  for (const kit of plan.included) {
    const definition = suite.kits.find(/** @param {{id: string, version?: string}} k */ k => k.id === kit);
    const version = definition?.version ?? overlay.version;
    if (!version) throw new Error(`Kit 缺少版本：${kit}`);
    const sourceFiles = [...plan.sources].filter(([, item]) => item.kit === kit)
      .sort(([a], [b]) => compare(a, b)).map(([name, item]) => ({ path: name, sha256: sha256(item.data) }));
    versions.push({ kit, version, versionSource: definition?.version ? 'kit-manifest' : 'config/kits/overlay.json', sourceSha256: sha256(json(sourceFiles)) });
    for (const name of ['kit.contract.json', 'manifest.json']) put(`kits/${kit}/${name}`, await readFile(path.join(kits, kit, name)), 'kit-metadata');
    put(`aov/${kit}/workflow.aov.json`, await readFile(path.join(kits, kit, 'workflow.aov.json')), 'kit-workflow');
  }
  put('config/system.recipe.json', json(recipe), 'recipe');
  put('permissions/endpoint_permissions.json', await readFile(path.join(kits, 'platform-core-kit/src/backend/app/config/endpoint_permissions.json')), 'permission-declarations');
  put('database/migrations/plan.json', json({ status: 'not-provided', migrations: [], reason: '正式 migration 與執行流程待 WP3；不以 create_all 冒充 migration' }), 'migration-plan');
  const manifest = {
    format: 'composer-system-assembly', schemaVersion: '1.0.0', installable: false,
    recipeVersion: recipe.recipeVersion, kitManifestVersion: suite.manifestVersion,
    systemId: recipe.name, kits: versions,
    notIncluded: excluded,
    notSelected: all.included.filter(kit => !plan.included.includes(kit)),
    notProvided: ['formal entry file (WP3)', 'frontend build (WP2)', 'deployment and startup (WP3)',
      'executable migrations (WP3)', 'authentication and authorization verification (WP3/WP5)',
      'manuals and merged delivery (WP4)', 'installation and field verification (WP5)'],
    overrides: plan.overrides,
    files: /** @type {{path: string, sha256: string, bytes: number, role: string | undefined}[]} */ ([]),
  };
  scanExclusions(tree);
  // Reserve only a new directory; a failed checker leaves no apparently valid package.
  await mkdir(output, { recursive: false });
  try {
    for (const [name, data] of tree) {
      await mkdir(path.dirname(path.join(output, name)), { recursive: true });
      await writeFile(path.join(output, name), data);
    }
    const result = pythonCheck([path.join(preview, 'check_tree.py'), path.join(output, 'backend')], undefined, run);
    const optional = result.split(/\r?\n/).find(line => line.startsWith('OPTIONAL_IMPORTS: '));
    const optionalImports = optional ? JSON.parse(optional.slice('OPTIONAL_IMPORTS: '.length)) : [];
    // Store module-relative diagnostics only; checker stdout contains no build paths or timestamps.
    put('validation/report.json', json({ recipeValidation: 'accepted-by-run-interface',
      backendClosure: 'accepted-by-run-interface', optionalImports,
      exclusionScan: 'passed', runtime: 'not-run', fieldVerification: 'not-run' }), 'validation-report');
    await mkdir(path.join(output, 'validation'));
    await writeFile(path.join(output, 'validation/report.json'), /** @type {Buffer} */ (tree.get('validation/report.json')));
    manifest.files = [...tree].sort(([a], [b]) => compare(a, b)).map(([name, data]) => ({
      path: name, sha256: sha256(data), bytes: data.length, role: roles.get(name),
    }));
    // Manifest cannot hash itself; its bytes are covered by the later signed delivery envelope.
    scanExclusions(new Map([...tree, ['system-manifest.json', json(manifest)]]));
    await writeFile(path.join(output, 'system-manifest.json'), json(manifest));
    return manifest;
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5 || process.argv[3] !== '--recipe') throw new Error('用法：node services/package/assemble-system.mjs <新目錄> --recipe <檔案>');
    await assembleSystem(path.resolve(process.argv[2]), { recipe: process.argv[4] });
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
