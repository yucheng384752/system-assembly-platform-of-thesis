import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { prefixes, tenantFree, repository, directory as preview } from '../preview/assemble.mjs';

/** @param {string} name */
const readJson = async name => JSON.parse((await readFile(name, 'utf8')).replace(/^\uFEFF/, ''));
/** @param {string} kits @param {string[]} selected */
export async function entryDirectory(kits, selected) {
  const entryPoints = [];
  for (const kitId of [...selected].sort()) {
    const contract = await readJson(path.join(kits, kitId, 'kit.contract.json'));
    for (const entry of contract.entryPoints ?? []) entryPoints.push({ ...entry, kitId });
  }
  const document = { format: 'composer-entry-points', version: 1, entryPoints,
    publicPaths: ['/healthz', '/api/auth/login', ...(selected.includes('mod-subscription-kit') ? ['/api/mod/subscriptions/webhook'] : [])] };
  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(await readJson(path.join(repository, 'schemas/entry-points.schema.json')));
  if (!validate(document)) throw new Error(`入口目錄格式錯誤：${ajv.errorsText(validate.errors)}`);
  const keys = new Set(), routes = new Set();
  for (const entry of entryPoints) {
    if (keys.has(entry.key)) throw new Error(`入口鍵重複：${entry.key}`);
    keys.add(entry.key);
    for (const role of entry.defaultRoles) {
      if (!['admin', 'manager', 'operator', 'audit'].includes(role)) throw new Error(`未知角色：${role}`);
    }
    if (entry.access === 'write' && entry.defaultRoles.includes('audit')) throw new Error(`寫入入口含 audit：${entry.key}`);
    for (const route of entry.routes) {
      // Parameter names do not make otherwise identical route patterns distinct.
      const key = `${route.method} ${route.path.replace(/\{[^}]+\}/g, '{}')}`;
      if (routes.has(key)) throw new Error(`路由重複：${key}`);
      routes.add(key);
    }
  }
  return document;
}

/** @param {string} kits @param {string[]} selected @param {string[]} sources
 * @returns {Promise<Map<string, string>>} */
export async function deploymentArtifacts(kits, selected, sources) {
  const webhook = selected.includes('mod-subscription-kit');
  const routers = sources.filter(n => /^app\/api\/routes_[^/]+\.py$/.test(n)).sort().map(name => {
    const stem = path.posix.basename(name, '.py');
    if (!prefixes.has(stem)) throw new Error(`路由缺少明確註冊規則：${name}`);
    return `app.include_router(import_module("app.api.${stem}").router, prefix=${JSON.stringify(prefixes.get(stem))}${tenantFree.has(stem) ? '' : ', dependencies=[Depends(get_current_tenant)]'})`;
  }).join('\n');
  const required = ['DATABASE_URL', 'ENTRY_PERMISSION_JWT_SECRET', 'DEFAULT_TENANT_ID', 'SECRET_KEY', ...(webhook ? ['MOD_WEBHOOK_SECRET'] : [])];
  const artifacts = new Map();
  for (const [output, template] of [
    ['backend/app/main.py', 'main.py'], ['backend/app/system_init.py', 'system_init.py'],
    ['deployment/docker-compose.yml', 'docker-compose.yml'], ['deployment/backend.Dockerfile', 'backend.Dockerfile'],
    ['deployment/nginx.conf', 'nginx.conf'], ['deployment/.env.example', 'env.example'], ['deployment/README.md', 'README.md'],
  ]) {
    const source = await readFile(new URL(`./templates/${template}`, import.meta.url), 'utf8');
    artifacts.set(output, source.replaceAll('\r\n', '\n')
      .replaceAll('@@REQUIRED@@', JSON.stringify(required))
      .replaceAll('@@ROUTERS@@', routers)
      .replaceAll('@@WEBHOOK_ENV@@', webhook ? '      MOD_WEBHOOK_SECRET: ${MOD_WEBHOOK_SECRET:?MOD_WEBHOOK_SECRET is required}\n' : '')
      .replaceAll('@@WEBHOOK_EXAMPLE@@', webhook ? '# MOD_WEBHOOK_SECRET: required external MOD webhook shared secret\nMOD_WEBHOOK_SECRET=\n' : ''));
  }
  const requirements = [await readFile(path.join(preview, 'requirements.txt'), 'utf8')];
  for (const kit of [...selected].sort()) {
    try { requirements.push(await readFile(path.join(kits, kit, 'requirements.txt'), 'utf8')); }
    catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
  }
  const pins = new Map();
  for (const line of requirements.join('\n').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))) {
    const match = /^([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+-]+)$/.exec(line);
    if (!match) throw new Error(`依賴未固定版本：${line}`);
    const key = match[1].toLowerCase().replace(/[-_.]+/g, '-');
    if (pins.has(key) && pins.get(key) !== line) throw new Error(`依賴版本衝突：${line}`);
    pins.set(key, line);
  }
  artifacts.set('deployment/backend/requirements.txt', [...pins.values()].sort().join('\n') + '\n');
  return artifacts;
}
