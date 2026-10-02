import { describe, expect, test } from 'vitest';
import { schemas } from '../../../libs/ui-runtime/schema';
import { checkActionCatalog, checkRegistry, parseActionCatalog, parseRegistry, type Capability, type Consume, type KitRegistry } from '../../../libs/ui-runtime/registry';
import actions from '../../../config/actions.json';
import genericForms from '../../../config/registry/generic-forms-kit.json';
import platformCore from '../../../config/registry/platform-core-kit.json';
import queryTrace from '../../../config/registry/query-traceability-kit.json';
import stationLink from '../../../config/registry/station-data-link-kit.json';

const entries = [genericForms, stationLink, queryTrace, platformCore].map(parseRegistry);
const clone = (): KitRegistry[] => structuredClone(entries);
const of = (kind: string, issues = checkRegistry(entries)) => issues.filter(i => i.kind === kind);

describe('登錄資料契約', () => {
  test('四個範例 Kit 與動作分類表符合契約', () => {
    for (const entry of [genericForms, stationLink, queryTrace, platformCore]) expect(schemas.kitRegistry(entry)).toBe(true);
    expect(() => parseActionCatalog(actions)).not.toThrow();
  });

  // D67: a difference between contract and source must be explained, so nobody can record it silently.
  const cases: [string, KitRegistry, (c: KitRegistry) => void][] = [
    ['無法證實卻沒有說明', queryTrace as KitRegistry, c => { delete (c.capabilities.find(x => !x.verified) as Partial<Capability>).note; }],
    ['沒有實作卻標為已驗證', queryTrace as KitRegistry, c => { c.capabilities.find(x => !x.implementedBy)!.verified = true; }],
    ['契約未宣告卻沒有說明', genericForms as KitRegistry, c => { delete (c.capabilities.find(x => !x.declared) as Partial<Capability>).note; }],
    ['api 能力缺少 method', genericForms as KitRegistry, c => { delete (c.capabilities.find(x => x.kind === 'api') as Partial<Capability>).method; }],
    ['原始碼相依沒有證據', queryTrace as KitRegistry, c => { delete (c.consumes.find(x => !x.declared) as Partial<Consume>).evidence; }],
    ['api 能力的實作沒有指向 mService', genericForms as KitRegistry, c => { delete c.capabilities.find(x => x.kind === 'api')!.implementedBy!.mService; }],
    ['來源路徑不在基線副本內', genericForms as KitRegistry, c => { c.functions[0].source.path = '../outside.py'; }],
  ];
  test.each(cases)('登錄契約拒絕：%s', (_name, source, mutate) => {
    const copy = structuredClone(source);
    expect(schemas.kitRegistry(copy)).toBe(true);
    mutate(copy);
    expect(schemas.kitRegistry(copy)).toBe(false);
  });

  test('動作識別碼不可重複', () => {
    expect(() => parseActionCatalog({ ...actions, actions: [actions.actions[0], actions.actions[0]] })).toThrow(/重複/);
  });
});

describe('登錄資料檢查', () => {
  // The sample data must be internally consistent; every remaining finding has to be a real baseline difference.
  test('範例資料沒有自相矛盾', () => {
    expect(checkRegistry(entries).filter(i => i.severity === 'error')).toEqual([]);
  });

  test('動作需要的 capability 都存在於登錄資料', () => {
    expect(checkActionCatalog(parseActionCatalog(actions), entries)).toEqual([]);
  });

  test('基線版的契約與原始碼差異被如實列出', () => {
    // Declared in the contract, but no route in the source.
    expect(of('unverified').map(i => i.subject)).toEqual(['query.records.search']);
    // db.tenants.read was provided only by the abolished tenant-auth-kit (D03); consumers are left dangling.
    expect(of('unresolved-consume').map(i => `${i.kitId}:${i.subject}`).sort())
      .toEqual(['generic-forms-kit:db.tenants.read', 'station-data-link-kit:db.tenants.read']);
    // Two contracts claim the same db.* capabilities; only platform-core-kit implements them.
    expect(of('multiple-declarers').map(i => i.subject).sort()).toEqual(['db.forms.list', 'db.records.search', 'db.tables.resolve']);
    // The contract misses what the source really exposes, including the model query-traceability imports directly.
    const undeclared = of('undeclared').map(i => i.subject);
    expect(undeclared).toEqual(expect.arrayContaining(['forms.create', 'dataflows.links.upsert', 'forms.station-model', 'query.trace.lot', 'db.records.trend']));
  });

  test('query-traceability-kit 對通用表格的原始碼相依被記錄，對應 D26', () => {
    const use = queryTrace.consumes.find(c => c.capability === 'forms.station-model');
    expect(use?.declared).toBe(false);
    const model = genericForms.capabilities.find(c => c.id === 'forms.station-model');
    expect(model?.implementedBy?.kitId).toBe('generic-forms-kit');
    // A data model belongs to a Kit; it is not realised by an mService.
    expect(model?.implementedBy?.mService).toBeUndefined();
  });

  // D05: a capability is only credible when its Functions chain from the mService inputs to its outputs.
  test('Function 無法串接時組裝檢查失敗並指出缺口', () => {
    const copy = clone();
    const csv = copy.find(e => e.kitId === 'generic-forms-kit')!.mServices.find(s => s.id === 'csv-import')!;
    csv.functions = csv.functions.filter(id => id !== 'parse-csv');
    const found = of('chain-broken', checkRegistry(copy));
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toContain('rows');
  });

  test('Function 輸入型別與可用型別不同時被擋下', () => {
    const copy = clone();
    copy.find(e => e.kitId === 'query-traceability-kit')!.functions.find(f => f.id === 'group-by-station')!.input[0].type = 'string';
    expect(of('chain-broken', checkRegistry(copy)).some(i => i.message.includes('型別'))).toBe(true);
  });

  test('capability 指向不存在的 mService 時報錯，指向未登錄的 Kit 時列為缺口', () => {
    const copy = clone();
    copy.find(e => e.kitId === 'generic-forms-kit')!.capabilities.find(c => c.id === 'forms.list')!.implementedBy!.mService = 'missing';
    expect(of('broken-reference', checkRegistry(copy)).length).toBeGreaterThan(0);
    const withoutCore = clone().filter(e => e.kitId !== 'platform-core-kit');
    expect(of('unresolved-provider', checkRegistry(withoutCore)).length).toBeGreaterThan(0);
  });

  test('動作需要未登錄的 capability 時被檢出', () => {
    const catalog = parseActionCatalog({ ...actions, actions: [{ id: 'x', name: '測試', description: '測試', requires: ['no.such.capability'] }] });
    expect(checkActionCatalog(catalog, entries).map(i => i.subject)).toEqual(['x']);
  });
});
