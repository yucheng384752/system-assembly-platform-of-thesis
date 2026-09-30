import { expect, test } from 'vitest';
import { exportRecipe } from '../../../libs/ui-runtime/recipe';
import { schemas } from '../../../libs/ui-runtime/schema';
import { initialRecipe } from './App';
import { catalog } from './previewCatalog';
import { buildDeliveryPackage, MANIFEST_FILE, sensitiveKeys } from './deliveryPackage';
import { exportAov, sha256Hex, type AovDocument } from './workflow';
import { readZip } from './testZip';

const workflow: AovDocument = {
  format: 'composer-aov-list', version: 2,
  steps: [{ id: 'step-1', name: '收料', when: '', owner: '倉管', formIds: ['form-1'] }],
  forms: [{ id: 'form-1', name: '收料單', fields: [{ id: 'field-1', name: '批號', type: 'text', required: true, isKey: true }] }],
  relations: [],
};
async function inputs() {
  const workflowText = exportAov(workflow);
  const recipeText = exportRecipe({ ...initialRecipe, clientName: '示範客戶', workflowRef: { path: 'workflow.aov.json', sha256: await sha256Hex(workflowText) } }, catalog);
  return { workflowText, recipeText };
}
const decode = (data: Uint8Array) => new TextDecoder().decode(data);

test('the package holds only real artifacts, each listed with a matching checksum, and says it is not installable (D21, D32, A15)', async () => {
  const { workflowText, recipeText } = await inputs();
  const built = await buildDeliveryPackage(recipeText, workflowText, catalog);
  const files = Object.fromEntries(readZip(built.bytes).map(e => [e.path, e.data]));
  expect(Object.keys(files)).toEqual([MANIFEST_FILE, 'README.md', 'config/system.recipe.json', 'aov/workflow.aov.json', 'validation/report.json']);
  const manifest = JSON.parse(decode(files[MANIFEST_FILE]));
  expect(schemas.packageManifest(manifest)).toBe(true);
  expect(manifest).toEqual(built.manifest);
  expect(manifest.installable).toBe(false);
  for (const artifact of manifest.artifacts) {
    expect(await sha256Hex(decode(files[artifact.path]))).toBe(artifact.sha256);
    expect(files[artifact.path].length).toBe(artifact.bytes);
  }
  // The packed files are byte-identical to the separate downloads, so either route yields the same settings.
  expect(decode(files['config/system.recipe.json'])).toBe(recipeText);
  expect(decode(files['aov/workflow.aov.json'])).toBe(workflowText);
  expect(manifest.kits).toEqual(initialRecipe.enabledKits.map(id => ({ id, version: catalog.kits.find(k => k.id === id)!.version })));
  // Nothing that looks deployable: no Kit sources, scripts or empty §12 folders; missing parts are named instead.
  expect(Object.keys(files).some(path => /^(kits|frontend|database|permissions|docs|deployment)\/|\.(ps1|sh|exe|py)$/.test(path))).toBe(false);
  expect(manifest.notProvided.map((item: { path: string }) => item.path)).toEqual(['kits/', 'frontend/', 'database/migrations/', 'permissions/', 'docs/', 'deployment/']);
  const report = JSON.parse(decode(files['validation/report.json']));
  expect(report.rehearsal.status).toBe('not-run');
  expect(report.siteVerification.status).toBe('not-run');
  expect(decode(files['README.md'])).toContain('不是可安裝的系統');
  expect(built.fileName).toBe(`my-system-delivery-${(await sha256Hex(decode(files[MANIFEST_FILE]))).slice(0, 12)}.zip`);
});
test('identical settings give an identical package; changing the Workflow changes it (D31)', async () => {
  const { workflowText, recipeText } = await inputs();
  const first = await buildDeliveryPackage(recipeText, workflowText, catalog);
  expect((await buildDeliveryPackage(recipeText, workflowText, catalog)).bytes).toEqual(first.bytes);
  const renamed = exportAov({ ...workflow, steps: [{ ...workflow.steps[0], name: '進料' }] });
  const relinked = exportRecipe({ ...JSON.parse(recipeText), workflowRef: { path: 'workflow.aov.json', sha256: await sha256Hex(renamed) } }, catalog);
  expect((await buildDeliveryPackage(relinked, renamed, catalog)).fileName).not.toBe(first.fileName);
});
test('a Recipe that points at a different Workflow is refused instead of packed (D35)', async () => {
  const { recipeText } = await inputs();
  const other = exportAov({ ...workflow, steps: [{ ...workflow.steps[0], name: '進料' }] });
  await expect(buildDeliveryPackage(recipeText, other, catalog)).rejects.toThrow('校驗碼與流程規格不符');
});
test('credential-like key names block the package and are named by path (A15)', async () => {
  const { workflowText, recipeText } = await inputs();
  const leaked = JSON.stringify({ ...JSON.parse(recipeText), deploymentConfig: { database: { password: 'x' } } });
  await expect(buildDeliveryPackage(leaked, workflowText, catalog)).rejects.toThrow('$.deploymentConfig、系統設定檔 $.deploymentConfig.database.password');
  expect(sensitiveKeys({ a: [{ apiKey: 1 }], name: 'password' })).toEqual(['$.a[0].apiKey']);
});
