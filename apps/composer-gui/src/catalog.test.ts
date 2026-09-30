import { expect, test } from 'vitest';
import raw from '../../../kits/form-analysis.kit-manifest.json?raw';
import { flows, kits, loadKits, parseManifest, selectKits } from './catalog';

test('real manifest accepts BOM, validates schema and applies D03 without mutating baseline', () => {
  expect(parseManifest('\uFEFF' + raw.replace(/^\uFEFF/, '')).kits).toHaveLength(12);
  expect(() => parseManifest('{"kits":[]}')).toThrow('kit:');
  expect(kits).toHaveLength(12);
  expect(kits.some(k => k.id === 'tenant-auth-kit')).toBe(false);
  expect(kits.flatMap(k => k.dependencies)).not.toContain('tenant-auth-kit');
  expect(kits.find(k => k.id === 'entry-permission-kit')?.required).toBe(false);
  expect(parseManifest(raw).kits.some(k => k.id === 'tenant-auth-kit')).toBe(true);
});
test('selection expands required flows, required Kits, flow prerequisites and Kit dependencies', () => {
  const result = selectKits(kits, ['analytics']);
  expect(result.selectedFlows).toEqual(['data-import', 'query-trace', 'analytics']);
  expect(result.enabledKits).toEqual(expect.arrayContaining(['platform-core-kit', 'entry-permission-kit', 'upload-validation-kit', 'query-traceability-kit', 'analytics-kit']));
  expect(result.reasons.join()).toContain('因為');
  expect(selectKits(kits, []).enabledKits).not.toContain('analytics-kit');
});
test('missing references, duplicate IDs and cycles fail with paths', () => {
  const a = { ...kits[0], id: 'a', required: false, dependencies: ['b'] };
  const b = { ...a, id: 'b', dependencies: ['a'] };
  expect(() => selectKits([a], [], ['a'], [])).toThrow('a → b');
  expect(() => selectKits([a, b], [], ['a'], [])).toThrow('a → b → a');
  expect(() => selectKits([a, a], [], [], [])).toThrow('重複');
  expect(() => selectKits(kits, ['missing'])).toThrow('缺少');
  expect(() => selectKits(kits, ['analytics'], [], flows.map(f => f.id === 'query-trace' ? { ...f, requiresFlows: ['analytics'] } : f))).toThrow('相依循環');
  const invalid = JSON.parse(raw.replace(/^\uFEFF/, '')); invalid.kits[0].dependencies = ['missing-kit'];
  expect(() => loadKits(JSON.stringify(invalid))).toThrow('missing-kit');
});
