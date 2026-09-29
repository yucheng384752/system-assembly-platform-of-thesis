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
