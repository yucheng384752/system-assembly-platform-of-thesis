import { expect, test } from 'vitest';
import { exportRecipe } from '../../../libs/ui-runtime/recipe';
import { schemas } from '../../../libs/ui-runtime/schema';
import { initialRecipe } from './App';
import { catalog } from './previewCatalog';
import { buildDeliveryPackage, MANIFEST_FILE, sensitiveKeys } from './deliveryPackage';
import { exportAov, sha256Hex, type AovDocument } from './workflow';
import { readZip } from './testZip';
import { fragmentPath, loadFragments, manualRoles } from './manual';

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
  const built = await buildDeliveryPackage(recipeText, workflowText, catalog, { selectedFlows: ['data-import'] });
  const files = Object.fromEntries(readZip(built.bytes).map(e => [e.path, e.data]));
  // D52: complete draft coverage now adds real manuals; they receive the same checksum checks as every artifact.
  expect(Object.keys(files)).toEqual([MANIFEST_FILE, 'README.md', 'config/system.recipe.json', 'aov/workflow.aov.json', 'validation/report.json',
    ...manualRoles.map(role => `docs/manual-${role}.md`)]);
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
  expect(Object.keys(files).some(path => /^(kits|frontend|database|permissions|deployment)\/|\.(ps1|sh|exe|py)$/.test(path))).toBe(false);
  expect(manifest.notProvided.map((item: { path: string }) => item.path)).toEqual(['kits/', 'frontend/', 'database/migrations/', 'permissions/', 'deployment/']);
  expect(built.manifest.artifacts.filter(a => a.role === 'manual')).toHaveLength(3);
  for (const role of manualRoles) {
    const path = `docs/manual-${role}.md`;
    expect(decode(files[path])).toContain('本手冊含草稿內容，尚未經審閱');
    expect(decode(files[path])).toContain('操作順序：上傳頁 → 匯入工作頁 → 錯誤檢視頁');
    expect(decode(files['README.md'])).toContain(path);
  }
  const report = JSON.parse(decode(files['validation/report.json']));
  expect(report.rehearsal.status).toBe('not-run');
  expect(report.siteVerification.status).toBe('not-run');
  expect(report.staticChecks).toContainEqual({ id: 'manuals', status: 'passed', description: expect.stringContaining('含草稿內容') });
  expect(decode(files['README.md'])).toContain('不是可安裝的系統');
  expect(built.fileName).toBe(`my-system-delivery-${(await sha256Hex(decode(files[MANIFEST_FILE]))).slice(0, 12)}.zip`);
});

// D34: a single absent or invalid fragment withholds all three manuals, never the configuration package itself.
test('missing and malformed manuals are named in notProvided and the report without blocking delivery', async () => {
  const { recipeText, workflowText } = await inputs();
  const kit = catalog.kits.find(k => k.id === initialRecipe.enabledKits[0])!;
  const path = fragmentPath(kit, 'mis');
  for (const malformed of [false, true]) {
    const fragments = loadFragments(); delete fragments[path];
    if (malformed) fragments[path] = { error: '缺少章節：操作步驟' };
    const built = await buildDeliveryPackage(recipeText, workflowText, catalog, { fragments });
    expect(schemas.packageManifest(built.manifest)).toBe(true);
    expect(built.manifest.artifacts).toHaveLength(4);
    const missing = built.manifest.notProvided.find(item => item.path === 'docs/')!;
    expect(missing.reason).toContain(kit.id); expect(missing.reason).toContain('mis'); expect(missing.reason).toContain(path);
    const files = Object.fromEntries(readZip(built.bytes).map(e => [e.path, decode(e.data)]));
    expect(Object.keys(files).some(p => p.startsWith('docs/'))).toBe(false);
    expect(files['README.md']).toContain(missing.reason);
    const report = JSON.parse(files['validation/report.json']);
    expect(report.staticChecks).toContainEqual({ id: 'manuals', status: 'not-provided', description: expect.stringContaining(`${kit.displayName}（維護人員）`) });
  }
});

// D51: packaging must pass the actual selected subfeatures and flows, not substitute all catalog options.
test('manuals follow selected options and flows while ignoring user override values', async () => {
  const { recipeText, workflowText } = await inputs();
  const recipe = JSON.parse(recipeText);
  const selected = catalog.kits.flatMap(k => k.subfeatures.map(sub => ({ kit: k, sub })))
    .find(({ kit, sub }) => recipe.enabledKits.includes(kit.id) && sub.options.length)!;
  recipe.selectedSubfeatures[selected.kit.id] = [selected.sub.id];
  recipe.selectedSubfeatureOptions[`${selected.kit.id}::${selected.sub.id}`] = { [selected.sub.options[0].id]: 'OVERRIDE_SENTINEL' };
  const withOption = await buildDeliveryPackage(JSON.stringify(recipe), workflowText, catalog, { selectedFlows: ['data-import'] });
  const manual = (bytes: Uint8Array) => decode(readZip(bytes).find(e => e.path === 'docs/manual-user.md')!.data);
  expect(manual(withOption.bytes)).toContain(`| ${selected.sub.options[0].displayName} |`);
  expect(manual(withOption.bytes)).not.toContain('OVERRIDE_SENTINEL');
  recipe.selectedSubfeatures = {};
  const withoutOption = await buildDeliveryPackage(JSON.stringify(recipe), workflowText, catalog, { selectedFlows: [] });
  expect(manual(withoutOption.bytes)).not.toContain(`| ${selected.sub.options[0].displayName} |`);
  expect(manual(withoutOption.bytes)).not.toContain('操作順序：上傳頁');
  expect(withoutOption.bytes).not.toEqual(withOption.bytes);
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
