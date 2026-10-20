import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const directory = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(directory, '../..');
const excluded = new Map([
  ['tenant-auth-kit', 'D03：已廢除，不納入身分驗證'],
  ['station-admin-kit', 'T2：缺少 routes_stations.py，無可啟動來源'],
  ['station-data-link-kit', 'T3：缺少 routes_import.py，無可啟動來源'],
]);
// Reference registry prefixes, plus three routers present only in the actual kits.
const prefixes = new Map([
  ['routes_kit_broker', '/api/kit'], ['routes_upload', '/api'],
  ['routes_validate', '/api'], ['routes_import_v2', '/api/v2/import'],
  ['routes_query_v2', '/api/v2/query'], ['routes_analytics', ''],
  ['routes_edit', '/api/edit'], ['routes_audit_events', ''],
  ['routes_logs', '/api/logs'], ['routes_generic_forms', '/api'],
  ['routes_mod_subscription', ''], ['routes_admin_permissions', ''],
]);

/** @param {string} root @returns {Promise<string[]>} */
export async function files(root) {
  const result = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (entry.isSymbolicLink()) throw new Error(`不接受符號連結：${root}/${entry.name}`);
    if (entry.name === '__pycache__') continue;
    if (entry.isDirectory()) {
      for (const child of await files(path.join(root, entry.name))) result.push(`${entry.name}/${child}`);
    } else result.push(entry.name);
  }
  return result;
}

/** @param {string} text @param {string} anchor @param {string} replacement @param {number} count */
function replaceExact(text, anchor, replacement, count) {
  if (text.split(anchor).length - 1 !== count) throw new Error(`來源已變更，拒絕套用預覽補丁：${anchor}`);
  return text.replaceAll(anchor, replacement);
}

/** Only assembled copies change; fail closed if the baseline anchors move.
 * @param {string} name @param {string} text */
export function adapt(name, text) {
  text = text.replaceAll('\r\n', '\n');
  // T10 (D107): the baseline passes ISO strings to asyncpg timestamp parameters, which asyncpg rejects. The response
  // keeps the string it always returned; only the bound query parameters become datetimes.
  if (name === 'app/api/routes_logs.py') {
    text = replaceExact(text, '        params["since"] = since', '        params["since"] = datetime.fromisoformat(since.replace("Z", "+00:00"))', 1);
    text = replaceExact(text, '        params["until"] = until', '        params["until"] = datetime.fromisoformat(until.replace("Z", "+00:00"))', 1);
    text = replaceExact(text, '            {"since": since, "tenant_id": str(tenant.id)},', '            {"since": datetime.fromisoformat(since), "tenant_id": str(tenant.id)},', 1);
  }
  const checks = {
    'app/core/kit_broker.py': [
      ['    payload = payload or {}', '    require_access("platform-core-kit", capability)'],
    ],
    'app/api/routes_import_v2.py': [
      ['            logger.info(f"Starting background processing for job {job_id}")', '            require_access("import-pipeline-kit")'],
      ['            logger.info(f"Starting background commit for job {job_id}")', '            require_access("import-pipeline-kit", "import.job.commit")'],
    ],
    'app/services/import_v2.py': [
      ['        logger.info(f"Starting commit_job for {job_id}")', '        require_access("import-pipeline-kit", "import.job.commit")'],
    ],
    'app/api/routes_generic_forms.py': [
      ['    try:\n        df, exc = _parse_csv_content(content)', '    try:\n        require_access("generic-forms-kit")'],
    ],
    'app/services/pdf_conversion.py': [
      ['async def process_pdf_conversion_job_background(job_id: uuid.UUID) -> None:',
        'async def process_pdf_conversion_job_background(job_id: uuid.UUID) -> None:\n    require_access("upload-validation-kit")'],
    ],
    'app/services/mod_subscription.py': [
      ['    """Apply a webhook event to the matching subscription record."""', '    require_access("mod-subscription-kit")'],
    ],
  };
  for (const [anchor, check] of checks[name] ?? []) {
    const replacement = anchor.startsWith('async def') ? check :
      anchor.startsWith('    try:') ? check + '\n        df, exc = _parse_csv_content(content)' :
        check + '\n' + anchor;
    text = replaceExact(text, anchor, replacement, 1);
  }
  if (checks[name]) {
    // Keep __future__ imports first; delayed helper imports do not initialize the gate.
    text += '\nfrom app.preview_gate import require_access\n';
  }
  return text;
}

const readJson = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));

export async function policyData(plan, kits = path.join(repository, 'kits')) {
  const manifest = await readJson(path.join(kits, 'form-analysis.kit-manifest.json'));
  const overlay = await readJson(path.join(repository, 'config/kits/overlay.json'));
  const definitions = [...manifest.kits.filter(k => !overlay.replacements[k.id]), ...overlay.add];
  const catalog = { kits: {}, capabilities: {} };
  for (const item of definitions.sort((a, b) => a.id.localeCompare(b.id))) {
    catalog.kits[item.id] = {
      available: plan.included.includes(item.id), assembled: plan.included.includes(item.id),
      dependencies: item.dependencies.map(id => overlay.replacements[id] ?? id),
      subfeatures: Object.fromEntries((item.subfeatures ?? []).map(f => [f.id, !!f.defaultSelected])),
    };
    let registry, workflow;
    try { registry = await readJson(path.join(repository, 'config/registry', `${item.id}.json`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { workflow = await readJson(path.join(kits, item.id, 'workflow.aov.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let contract;
    try { contract = await readJson(path.join(kits, item.id, 'kit.contract.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Contract-only declarations still identify unavailable endpoints; registry wins.
    const capabilities = new Map((contract?.provides?.api ?? []).map(c => [c.capability, { ...c, id: c.capability }]));
    for (const c of registry?.capabilities ?? []) capabilities.set(c.id, c);
    for (const c of capabilities.values()) {
      const owner = c.implementedBy?.kitId ?? item.id;
      const previous = catalog.capabilities[c.id];
      if (previous && previous.kit !== owner) throw new Error(`能力歸屬衝突：${c.id}`);
      catalog.capabilities[c.id] = { kit: owner, ...(c.method ? { method: c.method, path: c.path } : {}),
        subfeatures: [...(previous?.subfeatures ?? []),
          ...(workflow?.nodes ?? []).filter(n => n.capabilityIds?.includes(c.id) && n.subfeatureId)
            .map(n => ({ kit: item.id, feature: n.subfeatureId }))] };
    }
  }
  return catalog;
}

export function pythonCheck(args, input, run = spawnSync) {
  const result = run(process.env.PREVIEW_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
    ['-I', ...args], { input, encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) {
    throw new Error(`Python 預覽驗證失敗：${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
}

/** @param {string} kits @returns {Promise<{included: string[], excluded: {kit: string, reason: string}[], sources: Map<string, {kit: string, data: Buffer}>, overrides: string[]}>} */
export async function inventory(kits, selected = null) {
  const included = [], omitted = [], overrides = [];
  /** @type {Map<string, {kit: string, data: Buffer}>} */
  const sources = new Map();
  for (const entry of (await readdir(kits, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (!entry.isDirectory()) continue;
    const kit = entry.name;
    if (excluded.has(kit)) { omitted.push({ kit, reason: excluded.get(kit) ?? '' }); continue; }
    if (selected && !selected.includes(kit)) { omitted.push({ kit, reason: 'Recipe 未選取' }); continue; }
    const backend = path.join(kits, kit, 'src/backend');
    let names;
    try { names = await files(backend); }
    catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
      omitted.push({ kit, reason: '只有契約或前端，缺少 src/backend' }); continue;
    }
    if (!names.some(n => n.startsWith('app/') && n.endsWith('.py') && !n.endsWith('__init__.py'))) {
      omitted.push({ kit, reason: '沒有可執行的 app Python 來源' }); continue;
    }
    included.push(kit);
    for (const name of names.filter(n => n.startsWith('app/'))) {
      const data = await readFile(path.join(backend, name));
      const previous = sources.get(name);
      if (previous && !previous.data.equals(data)) {
        if (name !== 'app/core/monitoring.py' ||
          [previous.kit, kit].sort().join(',') !== 'logs-ops-kit,platform-core-kit') {
          throw new Error(`組裝衝突：${name} (${previous.kit}, ${kit})`);
        }
        overrides.push(`${name}: logs-ops-kit 覆蓋 platform-core-kit 的 no-op（來源明定）`);
        if (previous.kit === 'logs-ops-kit') continue;
      }
      sources.set(name, { kit, data });
    }
  }
  return { included, excluded: omitted, sources, overrides };
}

/** Output must be a new directory: never delete or overwrite user files.
 * @param {string} output @param {string} [kits] */
export async function assemble(output, kits = path.join(repository, 'kits'), options = {}) {
  const all = await inventory(kits);
  const catalog = await policyData(all, kits);
  const schema = await readJson(path.join(repository, 'schemas/recipe.schema.json'));
  const recipe = options.recipe ? await readJson(options.recipe) : null;
  if (recipe) pythonCheck([path.join(directory, 'app/preview_gate.py')],
    JSON.stringify({ recipe, catalog, schema }), options.run);
  const plan = recipe ? await inventory(kits, recipe.enabledKits) : all;
  for (const [kit, item] of Object.entries(catalog.kits)) item.assembled = plan.included.includes(kit);
  /** @type {Map<string, Buffer>} */
  const tree = new Map();
  /** @type {{module: string, prefix: string, tenant: boolean}[]} */
  const routers = [];
  for (const [name, source] of plan.sources) {
    if (name === 'app/models/__init__.py') continue;
    tree.set(name, name.endsWith('.py') ? Buffer.from(adapt(name, source.data.toString('utf8'))) : source.data);
    if (name.startsWith('app/api/routes_') && name.endsWith('.py')) {
      const stem = path.posix.basename(name, '.py');
      if (!prefixes.has(stem)) throw new Error(`路由缺少明確註冊規則：${name}`);
      routers.push({ module: `app.api.${stem}`, kit: source.kit, prefix: prefixes.get(stem) ?? '',
        tenant: !['routes_kit_broker', 'routes_admin_permissions', 'routes_audit_events', 'routes_mod_subscription'].includes(stem) });
    }
  }
  for (const name of await files(path.join(directory, 'app'))) {
    if (recipe && name.startsWith('models/') && !plan.included.includes('import-pipeline-kit')) continue;
    if (recipe && name === 'preview_seed.py' && !plan.included.includes('generic-forms-kit')) continue;
    if (tree.has(`app/${name}`)) throw new Error(`預覽檔案意外覆蓋 Kit：app/${name}`);
    tree.set(`app/${name}`, await readFile(path.join(directory, 'app', name)));
  }
  const models = [...tree.keys()].filter(n => n.startsWith('app/models/') && n.endsWith('.py') && !n.endsWith('__init__.py')).sort();
  tree.set('app/models/__init__.py', Buffer.from(models.map(n => `import ${n.slice(0, -3).replaceAll('/', '.')}`).join('\n') + '\n'));
  tree.set('app/preview_registry.json', Buffer.from(JSON.stringify(routers.sort((a, b) => a.module.localeCompare(b.module)), null, 2) + '\n'));
  tree.set('app/preview_policy.json', Buffer.from(JSON.stringify(catalog, null, 2) + '\n'));
  tree.set('app/recipe.schema.json', Buffer.from(JSON.stringify(schema, null, 2) + '\n'));
  tree.set('app/initial_recipe.json', Buffer.from(JSON.stringify(recipe, null, 2) + '\n'));
  for (const name of [...tree.keys()]) {
    let parent = path.posix.dirname(name);
    while (parent !== '.') {
      if (!tree.has(`${parent}/__init__.py`)) tree.set(`${parent}/__init__.py`, Buffer.from(''));
      parent = path.posix.dirname(parent);
    }
  }
  for (const kit of plan.included) {
    tree.set(`kits/${kit}/kit.contract.json`, await readFile(path.join(kits, kit, 'kit.contract.json')));
  }
  const report = { included: plan.included.map(kit => ({ kit, reason: '具有後端 app 來源' })),
    excluded: plan.excluded, overrides: plan.overrides,
    adaptations: ['重建 models/__init__.py，僅載入現有模型', 'P1/P2/P3 由預覽相容模型提供，保留基線匯入檢查',
      'preview_support 提供空 tenant_api_keys 外鍵目標，非驗證模型'],
    unavailableRoutes: ['platform.health 由預覽 /healthz 提供；registry verified 不變',
      'reference 的 routes_ut、traceability 無來源，不註冊'],
    files: [...tree].sort(([a], [b]) => a < b ? -1 : 1).map(([name, data]) => ({ path: name,
      sha256: createHash('sha256').update(data).digest('hex'), source: plan.sources.get(name)?.kit ?? 'preview' })) };
  await mkdir(output, { recursive: false });
  for (const [name, data] of tree) {
    await mkdir(path.dirname(path.join(output, name)), { recursive: true });
    await writeFile(path.join(output, name), data);
  }
  await writeFile(path.join(output, 'assembly-report.json'), JSON.stringify(report, null, 2) + '\n');
  if (recipe) pythonCheck([path.join(directory, 'check_tree.py'), output], undefined, options.run);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = process.argv[2];
    if (!output || !(process.argv.length === 3 || (process.argv.length === 5 && process.argv[3] === '--recipe'))) {
      throw new Error('用法：node services/preview/assemble.mjs <新的輸出目錄> [--recipe <檔>]');
    }
    const report = await assemble(path.resolve(output), undefined, { recipe: process.argv[4] });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(`預覽組裝失敗：${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
}
