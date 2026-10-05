import { describe, expect, test } from 'vitest';
import { deriveKits } from '../../../libs/ui-runtime/actions';
import { parseActionCatalog, parseRegistry, type KitRegistry } from '../../../libs/ui-runtime/registry';
import actionData from '../../../config/actions.json';
import genericForms from '../../../config/registry/generic-forms-kit.json';
import platformCore from '../../../config/registry/platform-core-kit.json';
import queryTrace from '../../../config/registry/query-traceability-kit.json';
import stationLink from '../../../config/registry/station-data-link-kit.json';
import { flows, kits, selectKits } from './catalog';

const catalog = parseActionCatalog(actionData);
const entries = [genericForms, stationLink, queryTrace, platformCore].map(parseRegistry);
const ids = (actionIds: string[], data = entries) => deriveKits(actionIds, catalog, data).kits.map(k => k.kitId);
const tableActions = ['define-form', 'import-records', 'link-forms', 'trace-records'];

describe('由 Action 推導 Kit', () => {
  // D69: any table-related action brings both Kits, and the user cannot end up without them.
  test.each(tableActions)('表格相關的動作「%s」一律帶出通用表格管理與站點資料串聯', action => {
    expect(ids([action])).toEqual(expect.arrayContaining(['generic-forms-kit', 'station-data-link-kit']));
  });

  test('沒有任何動作時不選任何 Kit', () => {
    expect(deriveKits([], catalog, entries)).toEqual({ kits: [], ambiguities: [], gaps: [] });
  });

  test('同一個動作重複出現不會重複記錄原因', () => {
    expect(deriveKits(['trace-records', 'trace-records'], catalog, entries)).toEqual(deriveKits(['trace-records'], catalog, entries));
  });

  test('未知的動作直接報錯，不略過', () => {
    expect(() => deriveKits(['no-such-action'], catalog, entries)).toThrow('no-such-action');
  });

  test('查詢追溯：實作者、必帶 Kit 與原始碼相依都被選入，並逐項記錄原因', () => {
    const derived = deriveKits(['trace-records'], catalog, entries);
    expect(derived.kits.map(k => k.kitId)).toEqual(['generic-forms-kit', 'platform-core-kit', 'query-traceability-kit', 'station-data-link-kit']);
    const reasons = (kitId: string) => derived.kits.find(k => k.kitId === kitId)!.reasons;
    // The implementer of the action's capabilities.
    expect(reasons('query-traceability-kit').map(r => r.kind)).toEqual(['action-capability', 'action-capability']);
    // station-data-link-kit has no source, so only the fixed rule can bring it in.
    expect(reasons('station-data-link-kit').map(r => r.kind)).toEqual(['action-kit']);
    // The baseline contract hides why query-trace needs generic forms (D26); the registry shows it.
    expect(reasons('generic-forms-kit')).toContainEqual({ kind: 'dependency', fromKit: 'query-traceability-kit', capability: 'forms.station-model', declared: false });
    // db.* is implemented by platform-core-kit although station-data-link-kit declares it.
    expect(reasons('platform-core-kit').every(r => r.kind === 'dependency')).toBe(true);
  });

  test('樣本以外的缺口不被隱藏：db.tenants.read 沒有實作者', () => {
    const derived = deriveKits(['trace-records'], catalog, entries);
    expect(derived.gaps.map(g => `${g.kind}|${g.kitId}|${g.subject}`).sort())
      .toEqual(['unresolved-consume|generic-forms-kit|db.tenants.read', 'unresolved-consume|station-data-link-kit|db.tenants.read']);
  });

  test('capability 無法證實時列為缺口，且不因此選入任何 Kit', () => {
    const custom = parseActionCatalog({ ...actionData, actions: [{ id: 'search', name: '搜尋', category: '測試', description: '搜尋', requires: ['query.records.search'], parameters: [], needs: [] }] });
    const derived = deriveKits(['search'], custom, entries);
    expect(derived.kits).toEqual([]);
    expect(derived.gaps).toHaveLength(1);
    expect(derived.gaps[0]).toMatchObject({ kind: 'missing-provider' });
    expect(derived.gaps[0].message).toContain('/api/v2/query/records');
  });

  test('必帶的 Kit 尚未登錄時仍選入，但列為缺口', () => {
    const custom = parseActionCatalog({ ...actionData, actions: [{ id: 'x', name: '測試', category: '測試', description: '測試', requires: ['forms.create'], parameters: [], needs: [], requiresKits: [{ kitId: 'unregistered-kit', reason: '測試' }] }] });
    const derived = deriveKits(['x'], custom, entries);
    expect(derived.kits.find(k => k.kitId === 'unregistered-kit')).toMatchObject({ registered: false });
    expect(derived.gaps.map(g => g.kind)).toContain('kit-not-registered');
  });

  // Two different implementers must not be resolved by guessing.
  test('同一 capability 有多個實作者時不自動選擇', () => {
    const copy: KitRegistry[] = structuredClone(entries);
    const trace = copy.find(e => e.kitId === 'query-traceability-kit')!;
    trace.capabilities.push({ id: 'forms.create', kind: 'api', method: 'POST', path: '/x', declared: false, implementedBy: { kitId: 'query-traceability-kit', mService: 'lot-search' }, verified: true, note: '測試' });
    const derived = deriveKits(['define-form'], catalog, copy);
    expect(derived.ambiguities).toHaveLength(1);
    expect(derived.ambiguities[0]).toMatchObject({ capability: 'forms.create', neededBy: { actionId: 'define-form' } });
    expect(derived.ambiguities[0].candidates.map(c => c.kitId).sort()).toEqual(['generic-forms-kit', 'query-traceability-kit']);
    expect(derived.kits.some(k => k.reasons.some(r => r.kind === 'action-capability' && r.capability === 'forms.create'))).toBe(false);
  });
});

// D62 replaces the fixed selection only after the new derivation agrees with it where both have an answer (D68).
describe('與固定流程選配一致', () => {
  const baseline = selectKits(kits, ['query-trace']);
  const queryTraceFlow = flows.filter(f => ['query-trace', 'generic-forms'].includes(f.id)).flatMap(f => f.kits);

  test('流程選配列出的 Kit 全部出現在推導結果', () => {
    expect(ids(['trace-records'])).toEqual(expect.arrayContaining(queryTraceFlow));
  });

  test('推導多出來的 Kit 都是基線版選配本來就會啟用的', () => {
    const extra = ids(['trace-records']).filter(id => !queryTraceFlow.includes(id));
    expect(extra).toEqual(['platform-core-kit']);
    expect(baseline.enabledKits).toEqual(expect.arrayContaining(extra));
  });
});
