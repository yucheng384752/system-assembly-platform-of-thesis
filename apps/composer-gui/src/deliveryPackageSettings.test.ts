import { expect, test } from 'vitest';
import { exportRecipe } from '../../../libs/ui-runtime/recipe';
import { schemas } from '../../../libs/ui-runtime/schema';
import { exportFormLibrary, type FormLibrary } from '../../../libs/aov-integration/formLibrary';
import { emptyProjectDetails, exportProjectDetails, type ProjectDetails } from '../../../libs/aov-integration/projectDetails';
import { initialRecipe } from './App';
import { catalog } from './previewCatalog';
import { buildDeliveryPackage } from './deliveryPackage';
import { sha256Hex } from './workflow';
import { exportAovGraph, listToGraph } from './workflowGraph';
import type { AovDocument } from './workflow';
import { readZip } from './testZip';

const details: ProjectDetails = {
  ...emptyProjectDetails,
  materials: [{ key: 'ingot', name: '原料錫錠', dimension: 'mass', baseUnit: 'kg' }],
  nodes: { n1: { kind: 'pick', location: 'wh.raw', material: 'ingot' } },
};
const library: FormLibrary = { format: 'composer-form-library', version: 1, forms: [
  { id: 'slip', name: '入庫單', subject: ['lot.ingot'], fields: { lot: { label: '批號', type: 'string' }, weight: { label: '總重量', type: 'quantity', unit: 'kg' } } }] };
const decode = (data: Uint8Array) => new TextDecoder().decode(data);

const legacy: AovDocument = {
  format: 'composer-aov-list', version: 3,
  steps: [{ id: 'step-1', name: '收料', when: '', owner: '倉管', formIds: ['form-1'], actions: [] }],
  forms: [{ id: 'form-1', name: '收料單', fields: [{ id: 'field-1', name: '批號', type: 'text', required: true, isKey: true }] }],
  relations: [],
};
async function inputs() {
  const workflowText = exportAovGraph(listToGraph(legacy).value);
  const recipeText = exportRecipe({ ...initialRecipe, clientName: '示範客戶', workflowRef: { path: 'workflow.aov.json', sha256: await sha256Hex(workflowText) } }, catalog);
  return { workflowText, recipeText };
}

test('節點細項與表單庫有內容時成為交付包的兩個檔案，位元組與單獨下載相同，並記在檔案清單與檢查報告', async () => {
  const { workflowText, recipeText } = await inputs();
  const detailsText = exportProjectDetails(details), formsText = exportFormLibrary(library);
  const built = await buildDeliveryPackage(recipeText, workflowText, catalog, {}, undefined, { detailsText, formsText });
  const files = Object.fromEntries(readZip(built.bytes).map(e => [e.path, decode(e.data)]));
  expect(files['aov/project-details.json']).toBe(detailsText);
  expect(files['aov/form-library.json']).toBe(formsText);
  expect(schemas.packageManifest(built.manifest)).toBe(true);
  expect(built.manifest.artifacts.find(a => a.role === 'project-details')).toMatchObject({ path: 'aov/project-details.json', sha256: await sha256Hex(detailsText) });
  expect(built.manifest.artifacts.find(a => a.role === 'form-library')).toMatchObject({ path: 'aov/form-library.json', sha256: await sha256Hex(formsText) });
  expect(files['README.md']).toContain('aov/project-details.json');
  expect(files['README.md']).toContain('aov/form-library.json');
  const ids = JSON.parse(files['validation/report.json']).staticChecks.map((c: { id: string }) => c.id);
  expect(ids).toEqual(expect.arrayContaining(['project-details', 'form-library']));
  expect((await buildDeliveryPackage(recipeText, workflowText, catalog, {}, undefined, { detailsText, formsText })).bytes).toEqual(built.bytes);
});

test('沒有細項、沒有表單庫時交付包與以前完全相同：不放空檔案', async () => {
  const { workflowText, recipeText } = await inputs();
  const plain = await buildDeliveryPackage(recipeText, workflowText, catalog);
  const same = await buildDeliveryPackage(recipeText, workflowText, catalog, {}, undefined, {});
  expect(same.bytes).toEqual(plain.bytes);
  expect(plain.manifest.artifacts.some(a => a.role === 'project-details' || a.role === 'form-library')).toBe(false);
});

test('只放表單庫也可以；格式不符、含密碼類欄位名稱、不是 JSON 的檔案都拒絕並指出是哪一個', async () => {
  const { workflowText, recipeText } = await inputs();
  const only = await buildDeliveryPackage(recipeText, workflowText, catalog, {}, undefined, { formsText: exportFormLibrary(library) });
  expect(only.manifest.artifacts.map(a => a.role)).toContain('form-library');
  expect(only.manifest.artifacts.map(a => a.role)).not.toContain('project-details');

  const broken = JSON.stringify({ ...library, forms: [{ ...library.forms[0], subject: [] }] });
  await expect(buildDeliveryPackage(recipeText, workflowText, catalog, {}, undefined, { formsText: broken })).rejects.toThrow(/表單庫不符合格式：.*尚未指定描述的對象/);
  const leaking = JSON.stringify({ ...library, forms: [{ ...library.forms[0], fields: { password: { type: 'string' } } }] });
  await expect(buildDeliveryPackage(recipeText, workflowText, catalog, {}, undefined, { formsText: leaking })).rejects.toThrow(/表單庫含疑似連線或密碼欄位：\$\.forms\[0\]\.fields\.password/);
  await expect(buildDeliveryPackage(recipeText, workflowText, catalog, {}, undefined, { detailsText: '{oops' })).rejects.toThrow('節點細項不是有效的 JSON。');
  const halfDone = JSON.stringify({ ...details, nodes: { n1: { kind: 'sink', direction: '', location: '', material: '' } } });
  await expect(buildDeliveryPackage(recipeText, workflowText, catalog, {}, undefined, { detailsText: halfDone })).rejects.toThrow(/節點細項不符合格式：.*尚未選擇入庫或出庫的方向/);
});
