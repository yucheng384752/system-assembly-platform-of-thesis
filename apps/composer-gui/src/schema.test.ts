import { expect, test } from 'vitest';
import { schemas } from '../../../libs/ui-runtime/schema';
import { definitions, kits } from './fixtures';

test('Kit schema preserves baseline options and validates UI metadata', () => {
  const manifest = { manifestVersion: '0.1.0', name: 'mock', kits };
  expect(schemas.kit(manifest)).toBe(true);
  const invalid = structuredClone(manifest);
  invalid.kits[0].subfeatures[0].options[0].allowed_roles = ['Administrator' as 'User'];
  expect(schemas.kit(invalid)).toBe(false);
});
test('UI schema accepts table/select and rejects unknown renderer or action', () => {
  expect(schemas.ui(definitions['records-kit'])).toBe(true);
  expect(schemas.ui({ ...definitions['records-kit'], components: [{ type: 'chart' }] })).toBe(false);
  const invalid = JSON.stringify(definitions['records-kit']).replace('"filter","target_component_id"', '"execute","target_component_id"');
  expect(schemas.ui(JSON.parse(invalid))).toBe(false);
});
test('Recipe accepts legacy 0.2.0 and versioned 0.3.0 without a second values store', () => {
  const legacy = { recipeVersion: '0.2.0', name: 'mock', sourceManifest: 'mock', database: { engine: 'sqlite' }, enabledKits: ['records-kit'], selectedSubfeatureOptions: { 'records-kit::records': { 'name-label': 'Name' } } };
  expect(schemas.recipe(legacy)).toBe(true);
  const uiOverrides = { 'records-kit::records': { kitVersion: '1.0.0', schema_version: '1.0.0' } };
  expect(schemas.recipe({ ...legacy, recipeVersion: '0.3.0', uiOverrides })).toBe(true);
  expect(schemas.recipe({ ...legacy, uiOverrides })).toBe(false);
  expect(schemas.recipe({ ...legacy, recipeVersion: '0.3.0', uiOverrides: { bad: {} } })).toBe(false);
});
const workflowV2 = {
  format: 'composer-aov-list', version: 2,
  steps: [{ id: 'step-1', name: '收料', when: '到貨時', owner: '倉管', formIds: ['form-1'] }, { id: 'step-2', name: '檢驗', when: '', owner: '品管', formIds: ['form-2'] }],
  forms: [
    { id: 'form-1', name: '收料單', fields: [{ id: 'field-1', name: '批號', type: 'text', required: true, isKey: true }] },
    { id: 'form-2', name: '檢驗單', fields: [{ id: 'field-1', name: '批號', type: 'text', required: true, isKey: false }] },
  ],
  relations: [{ id: 'rel-1', kind: 'shared-key', from: { formId: 'form-1', fieldId: 'field-1' }, to: { formId: 'form-2', fieldId: 'field-1' }, origin: 'inferred', confirmed: true }],
};
test('Workflow v2 carries forms and confirmed relations only; v1 stays importable', () => {
  expect(schemas.aov(workflowV2)).toBe(true);
  expect(schemas.aov({ format: 'composer-aov-list', version: 1, steps: [{ id: 'a', name: '檢查', when: '', owner: '', formId: '' }] })).toBe(true);
  const invalid = (mutate: (doc: typeof workflowV2 & Record<string, unknown>) => void) => { const doc = structuredClone(workflowV2); mutate(doc); return schemas.aov(doc); };
  // Unconfirmed (inferred-only) relations must never be written to the file (D19).
  expect(invalid(doc => { (doc.relations[0] as { confirmed: boolean }).confirmed = false; })).toBe(false);
  // Data rows or sample content cannot ride along in a form definition (M01).
  expect(invalid(doc => { Object.assign(doc.forms[0], { rows: [['PRIVATE']] }); })).toBe(false);
  expect(invalid(doc => { doc.rows = []; })).toBe(false);
  expect(invalid(doc => { doc.forms[0].fields[0].type = 'blob'; })).toBe(false);
  expect(invalid(doc => { doc.forms[0].fields = []; })).toBe(false);
  expect(invalid(doc => { doc.relations[0].kind = 'lookup'; })).toBe(false);
  // A v2 document cannot fall back to the v1 single-form step shape.
  expect(invalid(doc => { Object.assign(doc.steps[0], { formId: 'form-1' }); })).toBe(false);
  expect(invalid(doc => { doc.steps[0].formIds = ['form-1', 'form-1']; })).toBe(false);
});
test('Recipe accepts an optional workflowRef and rejects malformed references (D29)', () => {
  const recipe = { recipeVersion: '0.3.0', name: 'mock', sourceManifest: 'mock', database: { engine: 'sqlite' }, enabledKits: ['records-kit'] };
  const sha256 = 'a'.repeat(64);
  expect(schemas.recipe(recipe)).toBe(true);
  expect(schemas.recipe({ ...recipe, workflowRef: { path: 'workflow.aov.json', sha256 } })).toBe(true);
  for (const workflowRef of [{ path: 'workflow.aov.json', sha256: 'A'.repeat(64) }, { path: '../workflow.json', sha256 }, { path: 'workflow.aov.json' }, { path: 'workflow.aov.json', sha256, rows: [] }]) {
    expect(schemas.recipe({ ...recipe, workflowRef })).toBe(false);
  }
});
