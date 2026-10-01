import { expect, test } from 'vitest';
import { exportRecipe, importRecipe } from '../../../libs/ui-runtime/recipe';
import { resolveKit } from '../../../libs/ui-runtime/resolve';
import { definitions, kits, sources } from './fixtures';

const catalog = { kits, definitions, sources };
const key = 'records-kit::records';
const legacy = {
  recipeVersion: '0.2.0', name: 'mock', sourceManifest: 'mock-fixtures', database: { engine: 'sqlite' },
  enabledKits: ['records-kit', 'entry-permission-kit'],
  selectedSubfeatureOptions: { [key]: { 'name-label': '自訂欄位', 'name-width': 250 } },
};

// D60: optional references must round-trip without changing old files or permitting arbitrary paths.
test('場域引用往返保留且拒絕不合法路徑與校驗碼', () => {
  const { recipe } = importRecipe(JSON.stringify(legacy), catalog);
  expect(importRecipe(exportRecipe(recipe, catalog), catalog).recipe.siteRef).toBeUndefined();
  const siteRef = { path: 'site.profile.json' as const, sha256: 'a'.repeat(64) };
  expect(importRecipe(exportRecipe({ ...recipe, siteRef }, catalog), catalog).recipe.siteRef).toEqual(siteRef);
  for (const invalid of [
    { ...siteRef, path: '../site.profile.json' }, { ...siteRef, path: 'other.json' },
    { ...siteRef, sha256: 'A'.repeat(64) }, { path: siteRef.path }, { ...siteRef, extra: true },
  ]) expect(() => importRecipe(JSON.stringify({ ...recipe, siteRef: invalid }), catalog)).toThrow();
});

test('legacy import migrates versions, resolves values and round-trips without mutating input', () => {
  const original = JSON.stringify(legacy);
  const { recipe, notices } = importRecipe(original, catalog);
  expect(notices.join()).toContain('版本取自目前 Kit');
  const resolved = resolveKit({ kit: kits[0], definition: definitions['records-kit'], sources,
    overrides: recipe.selectedSubfeatureOptions, versions: recipe.uiOverrides });
  expect(resolved.definition.components.find(c => c.type === 'table')).toMatchObject({ columns: [{ label: '自訂欄位', width: 250 }, {}] });
  expect(resolved.provenance[`${key}/name-label`].source).toContain('system: Recipe.selectedSubfeatureOptions');
  expect(importRecipe(exportRecipe(recipe, catalog), catalog).recipe).toEqual(recipe);
  // The Workflow reference survives the explicit export projection unchanged (D29).
  const workflowRef = { path: 'workflow.aov.json', sha256: 'b'.repeat(64) };
  expect(JSON.parse(exportRecipe({ ...recipe, workflowRef }, catalog)).workflowRef).toEqual(workflowRef);
  expect(importRecipe(exportRecipe({ ...recipe, workflowRef }, catalog), catalog).recipe.workflowRef).toEqual(workflowRef);
  expect(JSON.stringify(legacy)).toBe(original);
  const defaults = importRecipe(JSON.stringify({ ...legacy, selectedSubfeatureOptions: undefined }), catalog).recipe;
  expect(defaults.selectedSubfeatures['records-kit']).toEqual(['records']);
});

test('invalid recipes and stale references are rejected, including hidden drafts', () => {
  const { recipe } = importRecipe(JSON.stringify(legacy), catalog);
  const invalid = [
    { ...recipe, recipeVersion: '9.0.0' },
    { ...recipe, enabledKits: ['unknown-kit'] },
    { ...recipe, selectedSubfeatures: { 'records-kit': ['missing'] } },
    { ...recipe, selectedSubfeatureOptions: { 'records-kit::missing': {} } },
    { ...recipe, selectedSubfeatureOptions: { 'other-kit::records': {} } },
    { ...recipe, uiOverrides: {} },
    { ...recipe, uiOverrides: { [key]: { kitVersion: '2.0.0', schema_version: '1.0.0' } } },
    { ...recipe, selectedSubfeatures: { 'records-kit': [] }, selectedSubfeatureOptions: { [key]: { 'name-width': 1 } } },
    { ...recipe, selectedSubfeatureOptions: { [key]: { secret: 'mock-secret' } } },
    { ...recipe, selectedSubfeatureOptions: { [key]: { 'name-width': { password: 'mock-secret' } } } },
    { ...recipe, selectedSubfeatureOptions: { [key]: { 'filter-default': 'missing' } } },
  ];
  for (const value of invalid) expect(() => importRecipe(JSON.stringify(value), catalog)).toThrow();
  expect(() => importRecipe('{', catalog)).toThrow();
  const missing = structuredClone(definitions);
  missing['records-kit'].components = missing['records-kit'].components.filter(c => c.type !== 'table');
  expect(() => importRecipe(JSON.stringify(recipe), { ...catalog, definitions: missing })).toThrow();
  expect(() => importRecipe(JSON.stringify(recipe), { ...catalog, sources: {} })).toThrow('未知來源');
});

test('export projects selected UI settings, excluding rows, credentials and deselected drafts', () => {
  const { recipe } = importRecipe(JSON.stringify(legacy), catalog);
  const contaminated = { ...recipe, tableData: sources['mock-records'].rows, password: 'mock-secret',
    database: { ...recipe.database, password: 'mock-db-secret' }, deploymentConfig: { token: 'mock-token' } };
  const exported = exportRecipe(contaminated, catalog);
  for (const forbidden of ['tableData', 'Mock A', 'Mock B', 'password', 'mock-secret', 'mock-db-secret', 'deploymentConfig', 'mock-token']) {
    expect(exported).not.toContain(forbidden);
  }
  const hidden = { ...recipe, selectedSubfeatures: { 'records-kit': [] } };
  expect(JSON.parse(exportRecipe(hidden, catalog)).selectedSubfeatureOptions).toEqual({});
  expect(hidden.selectedSubfeatureOptions[key]['name-label']).toBe('自訂欄位');
  const deselected = { ...recipe, enabledKits: ['entry-permission-kit'] };
  expect(exportRecipe(deselected, catalog)).not.toContain('records-kit');
  expect(importRecipe(JSON.stringify(contaminated), catalog).notices.join()).toContain('不保留');
});
