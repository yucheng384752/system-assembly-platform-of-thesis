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

// factory-core-kit keeps its own synchronous tables with append-only guards; its migration runs in the explicit init step.
const factoryInit = `    # factory-core-kit: tables and append-only guards (Alembic revision), after the shared schema exists.
    from app.factory_api.deploy import init_schema, make_engine
    factory_engine = make_engine(os.environ["DATABASE_URL"])
    try:
        init_schema(factory_engine)
    finally:
        factory_engine.dispose()
`;

// factory-core-kit evaluates guards in a node child process (contract 8.1 item 16). Only the node binary is taken from the node image
// (same Debian release as the python base, so the libraries match); the bundle is one self-contained file built by the assembler.
const evaluatorStage = 'FROM node:22.12.0-bookworm-slim AS evaluator-node\n';
const evaluatorCopy = 'COPY --from=evaluator-node /usr/local/bin/node /usr/local/bin/node\nCOPY evaluator/ /system/evaluator/\n';

/**
 * Combines requirement files into the one the image installs: every package pinned with `==` (a conflicting pin is an error), plus
 * `--extra-index-url` lines for Kits that need a package index of their own. The only such index in use is the PyTorch CPU wheels,
 * which keeps the image from pulling the CUDA build (several gigabytes) for a service that only runs embeddings on the CPU.
 * @param {string[]} texts
 */
export function mergeRequirements(texts) {
  const pins = new Map();
  const indexes = new Set();
  for (const line of texts.join('\n').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))) {
    if (line.startsWith('--')) {
      const option = /^--extra-index-url\s+(\S+)$/.exec(line);
      if (!option) throw new Error(`不支援的依賴檔選項：${line}`);
      let url;
      try { url = new URL(option[1]); } catch { throw new Error(`額外套件來源不是網址：${line}`); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`額外套件來源必須是不含帳密的 https 網址：${line}`);
      indexes.add(url.href);
      continue;
    }
    const match = /^([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+-]+)$/.exec(line);
    if (!match) throw new Error(`依賴未固定版本：${line}`);
    const key = match[1].toLowerCase().replace(/[-_.]+/g, '-');
    if (pins.has(key) && pins.get(key) !== line) throw new Error(`依賴版本衝突：${line}`);
    pins.set(key, line);
  }
  return [...[...indexes].sort().map(url => `--extra-index-url ${url}`), ...[...pins.values()].sort()].join('\n') + '\n';
}

/** @param {string} kits @param {string[]} selected @param {string[]} sources
 * @returns {Promise<Map<string, string>>} */
export async function deploymentArtifacts(kits, selected, sources) {
  const webhook = selected.includes('mod-subscription-kit');
  const factory = selected.includes('factory-core-kit');
  const routers = sources.filter(n => /^app\/api\/routes_[^/]+\.py$/.test(n)).sort().map(name => {
    const stem = path.posix.basename(name, '.py');
    if (!prefixes.has(stem)) throw new Error(`路由缺少明確註冊規則：${name}`);
    return `app.include_router(import_module("app.api.${stem}").router, prefix=${JSON.stringify(prefixes.get(stem))}${tenantFree.has(stem) ? '' : ', dependencies=[Depends(get_current_tenant)]'})`;
  }).join('\n');
  const required = ['DATABASE_URL', 'ENTRY_PERMISSION_JWT_SECRET', 'DEFAULT_TENANT_ID', 'SECRET_KEY', ...(webhook ? ['MOD_WEBHOOK_SECRET'] : [])];
  const artifacts = new Map();
  for (const [output, template] of [
    ['backend/app/main.py', 'main.py'], ['backend/app/system_init.py', 'system_init.py'],
    ['.dockerignore', 'dockerignore'], ['backend/app/secret_files.py', 'secret_files.py'], ['backend/app/guard.py', 'guard.py'], ['backend/app/license_hardware.py', 'license_hardware.py'], ['backend/app/license_gate.py', 'license_gate.py'],
    ['deployment/docker-compose.yml', 'docker-compose.yml'], ['deployment/backend.Dockerfile', 'backend.Dockerfile'],
    ['deployment/nginx.conf', 'nginx.conf'], ['deployment/.env.example', 'env.example'], ['deployment/README.md', 'README.md'],
  ]) {
    const source = await readFile(new URL(`./templates/${template}`, import.meta.url), 'utf8');
    artifacts.set(output, source.replaceAll('\r\n', '\n')
      .replaceAll('@@REQUIRED@@', JSON.stringify(required))
      .replaceAll('@@ROUTERS@@', routers)
      .replaceAll('@@FACTORY_INIT@@\n', factory ? factoryInit : '')
      .replaceAll('@@EVALUATOR_NODE@@\n', factory ? evaluatorStage : '')
      .replaceAll('@@EVALUATOR_COPY@@\n', factory ? evaluatorCopy : '')
      .replaceAll('@@WEBHOOK_ENV@@', webhook ? '      MOD_WEBHOOK_SECRET_FILE: /run/secrets/mod_webhook_secret\n' : '')
      .replaceAll('@@WEBHOOK_SECRET_REF@@', webhook ? '      - mod_webhook_secret\n' : '')
      .replaceAll('@@WEBHOOK_SECRET_DEF@@', webhook ? '  mod_webhook_secret:\n    file: ../secrets/mod_webhook_secret\n' : '')
      .replaceAll('@@WEBHOOK_EXAMPLE@@', ''));
  }
  const requirements = [await readFile(path.join(preview, 'requirements.txt'), 'utf8')];
  for (const kit of [...selected].sort()) {
    try { requirements.push(await readFile(path.join(kits, kit, 'requirements.txt'), 'utf8')); }
    catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
  }
  artifacts.set('deployment/backend/requirements.txt', mergeRequirements(requirements));
  return artifacts;
}
