import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

/** @param {Buffer | string} data */
const sha256 = data => createHash('sha256').update(data).digest('hex');
/** @param {string} a @param {string} b */
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Where each GUI delivery artifact lands in the system package. `null` means "must already be identical there". */
const PLACEMENT = /** @type {Record<string, {to: string | null, role: string}>} */ ({
  'README.md': { to: 'docs/delivery-README.md', role: 'delivery-readme' },
  'config/system.recipe.json': { to: null, role: 'recipe' },
  'aov/workflow.aov.json': { to: 'aov/workflow.aov.json', role: 'delivery-workflow' },
  'aov/kit-workflows.json': { to: 'aov/kit-workflows.json', role: 'delivery-workflow' },
  'aov/kit-workflows.md': { to: 'aov/kit-workflows.md', role: 'delivery-workflow' },
  'validation/report.json': { to: 'validation/delivery-report.json', role: 'delivery-validation-report' },
  'config/site/site.profile.json': { to: 'config/site/site.profile.json', role: 'site-profile' },
});

/** Fold the Composer configuration delivery package (an unzipped directory) into an assembled system directory,
 * so the client receives one signed archive. Nothing is overwritten; a different recipe is an error.
 * @param {string} dir assembled (and bundled) system directory
 * @param {string} delivery unzipped configuration delivery package */
export async function mergeDelivery(dir, delivery) {
  const manifestFile = path.join(dir, 'system-manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (manifest.format !== 'composer-system-assembly') throw new Error('不是系統組裝目錄');
  if (manifest.delivery) throw new Error('已併入設定交付包；不覆寫，請用新的組裝目錄');
  const source = JSON.parse(await readFile(path.join(delivery, 'package-manifest.json'), 'utf8'));
  if (source.format !== 'composer-delivery-package') throw new Error('不是設定交付包');
  if (source.clientName === undefined || !Array.isArray(source.artifacts)) throw new Error('設定交付包的 manifest 不完整');
  if (source.recipe?.name !== manifest.systemId) throw new Error(`設定交付包的系統名稱（${source.recipe?.name}）與系統包（${manifest.systemId}）不同`);

  /** @type {Map<string, Buffer>} */
  const incoming = new Map();
  /** @type {{path: string, sha256: string, bytes: number, role: string}[]} */
  const added = [];
  const existing = new Set(manifest.files.map(/** @param {{path: string}} f */ f => f.path));
  for (const artifact of source.artifacts) {
    const data = await readFile(path.join(delivery, artifact.path));
    if (sha256(data) !== artifact.sha256 || data.length !== artifact.bytes) throw new Error(`設定交付包檔案與 manifest 不符：${artifact.path}`);
    if (artifact.path === 'config/system.recipe.json') {
      const mine = JSON.parse(await readFile(path.join(dir, 'config/system.recipe.json'), 'utf8'));
      if (!isDeepStrictEqual(JSON.parse(data.toString('utf8')), mine)) throw new Error('設定交付包的 Recipe 與系統包的 Recipe 不同');
      continue;
    }
    const placement = artifact.role === 'manual' && /^docs\/manual-[a-z]+\.md$/.test(artifact.path)
      ? { to: artifact.path, role: 'manual' } : PLACEMENT[artifact.path];
    if (!placement?.to) throw new Error(`設定交付包含未知檔案：${artifact.path}`);
    if (existing.has(placement.to) || incoming.has(placement.to)) throw new Error(`系統包已有同名檔案：${placement.to}`);
    incoming.set(placement.to, data);
    added.push({ path: placement.to, sha256: artifact.sha256, bytes: artifact.bytes, role: placement.role });
  }
  for (const [name, data] of incoming) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), data);
  }
  const updated = { ...manifest,
    delivery: { source: 'composer-delivery-package', manifestSha256: sha256(await readFile(path.join(delivery, 'package-manifest.json'))), clientName: source.clientName },
    files: [...manifest.files, ...added].sort((a, b) => compare(a.path, b.path)) };
  await writeFile(manifestFile, Buffer.from(JSON.stringify(updated, null, 2) + '\n'));
  return updated;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5 || process.argv[3] !== '--delivery') throw new Error('用法：node services/package/merge-delivery.mjs <組裝目錄> --delivery <解壓後的設定交付包目錄>');
    await mergeDelivery(path.resolve(process.argv[2]), path.resolve(process.argv[4]));
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
