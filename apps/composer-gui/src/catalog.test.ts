import { expect, test } from 'vitest';
import raw from '../../../kits/form-analysis.kit-manifest.json?raw';
import { flows, kits, loadKits, parseManifest, selectKits } from './catalog';
import { emptyGraph, suggestActions } from './workflowGraph';

test('real manifest accepts BOM, validates schema and applies D03 without mutating baseline', () => {
  expect(parseManifest('\uFEFF' + raw.replace(/^\uFEFF/, '')).kits).toHaveLength(12);
  expect(() => parseManifest('{"kits":[]}')).toThrow('kit:');
  expect(kits).toHaveLength(13);
  expect(kits.some(k => k.id === 'tenant-auth-kit')).toBe(false);
  expect(kits.flatMap(k => k.dependencies)).not.toContain('tenant-auth-kit');
  expect(kits.find(k => k.id === 'entry-permission-kit')?.required).toBe(false);
  expect(parseManifest(raw).kits.some(k => k.id === 'tenant-auth-kit')).toBe(true);
});
test('selection expands required flows, required Kits, flow prerequisites and Kit dependencies', () => {
  const result = selectKits(kits, ['analytics']);
  // D26: tracing needs table management, so query-trace pulls in generic-forms.
  expect(result.selectedFlows).toEqual(['data-import', 'generic-forms', 'query-trace', 'analytics']);
  expect(result.enabledKits).toContain('generic-forms-kit');
  expect(result.enabledKits).toEqual(expect.arrayContaining(['platform-core-kit', 'entry-permission-kit', 'upload-validation-kit', 'query-traceability-kit', 'analytics-kit']));
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
test('suggestions follow a fixed rule: only confirmed form relations suggest query-trace', () => {
  // Forms alone do not imply tracing; the suggestion is a program rule, not a model guess (spec 4.2 step 4).
  expect(suggestActions(emptyGraph)).toEqual([]);
  const relation = { id: 'r', kind: 'shared-key' as const, from: { formId: 'f1', fieldId: 'lot' }, to: { formId: 'f2', fieldId: 'lot' }, origin: 'user' as const, confirmed: true as const };
  const graph = { ...emptyGraph, relations: [relation, { ...relation, id: 'r2', to: { formId: 'f3', fieldId: 'lot' } }] };
  expect(suggestActions(graph).map(s => s.actionId)).toEqual(['trace-records']);
  expect(suggestActions(graph)[0].reason).toContain('已確認 2 條表單關聯');
});
