import { describe, expect, it } from 'vitest';
import machining from '../../fixtures/aov-merge/factory/process.machining.json';
import bakery from '../../fixtures/aov-merge/c/project.valid.json';
import type { ProjectFile } from '../aov-core';
import { buildExecutablePlan, type CapabilityMap } from './executablePlan';
import { migrateProcessDefinition, type FieldReportItem, type ProcessMigrationOptions } from './processMigration';

// process.machining.json is B's own mock sample (build_machining_template), dumped without edits.
const fresh = () => structuredClone(machining) as Record<string, any>;
const nodeMap = { 'n-out': 'src_flour', 'n-turn': 'mix', 'n-mill': 'bake', 'n-drill': 'proof', 'n-qc': 'qc' };
const options = (over: Partial<ProcessMigrationOptions> = {}): ProcessMigrationOptions => ({ nodeMap, quantityUnit: 'pcs', ...over });
function migrated(input: unknown = fresh(), over: Partial<ProcessMigrationOptions> = {}) {
  const result = migrateProcessDefinition(input, options(over));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
}
const item = (report: FieldReportItem[], sourcePath: string, disposition: FieldReportItem['disposition']) =>
  report.find(r => r.sourcePath === sourcePath && r.disposition === disposition);

describe('migrateProcessDefinition：B 的工時與資源帶入計畫輸入', () => {
  it('有工時的節點帶入 specified，單位取自呼叫端；資源帶入且欄位改成計畫的命名', () => {
    const { timings, resources } = migrated();
    expect(timings.mix).toEqual({ state: 'specified', setupMin: 10, perUnitMin: 2, quantityUnit: 'pcs' });
    expect(timings.qc).toEqual({ state: 'specified', setupMin: 10, perUnitMin: 0, quantityUnit: 'pcs' });
    expect(resources.mix).toEqual({ capability: 'turning', operatorSkill: 'turning' });
    expect(resources).not.toHaveProperty('src_flour');
  });

  it('setup 與 per_unit 皆為 0 的節點是缺值而不是 0：B 的預設值就是 0，分不出沒填', () => {
    const { timings, report } = migrated();
    expect(timings.src_flour).toEqual({ state: 'missing' });
    expect(item(report, '/nodes/*/latency', 'needs-input')).toMatchObject({ ids: expect.arrayContaining(['n-out']), summary: expect.stringContaining('缺值') });
  });

  it('沒有提供 quantityUnit 時不編造單位：有工時的節點全部缺值並說明', () => {
    const { timings, report } = migrated(fresh(), { quantityUnit: undefined });
    expect(timings.mix).toEqual({ state: 'missing' });
    expect(report.find(r => r.summary.includes('quantityUnit'))).toMatchObject({ disposition: 'needs-input', ids: ['n-turn', 'n-mill', 'n-drill', 'n-qc'] });
  });

  it('時間單位不是分鐘時不換算：所有工時缺值', () => {
    const input = fresh();
    input.time_unit = 'h';
    const { timings, report } = migrated(input);
    expect(Object.values(timings).every(t => t.state === 'missing')).toBe(true);
    expect(item(report, '/time_unit', 'needs-input')).toBeDefined();
  });

  it('負的工時視為缺值並列出該節點，不帶入負數', () => {
    const input = fresh();
    input.nodes[1].latency.setup = -3;
    const { timings, report } = migrated(input);
    expect(timings.mix).toEqual({ state: 'missing' });
    expect(report.find(r => r.summary.includes('負數'))).toMatchObject({ ids: ['n-turn'] });
  });

  it('nodeMap 沒有列出的 B 節點不帶入任何東西，並在報告中點名', () => {
    const { timings, resources, report } = migrated();
    expect(Object.keys(timings).sort()).toEqual(Object.values(nodeMap).sort());
    expect(Object.keys(resources)).not.toContain('n-in');
    expect(item(report, '/nodes/*', 'dropped')).toMatchObject({ ids: ['n-in', 'n-scrap'] });
  });
});

describe('migrateProcessDefinition：拒絕案例', () => {
  const rejects = (input: unknown, code: string, over: Partial<ProcessMigrationOptions> = {}) => {
    const result = migrateProcessDefinition(input, options(over));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(e => e.code === code), JSON.stringify(result.errors)).toBe(true);
  };

  it('結構錯誤：非物件、nodes 不是陣列、節點 id 重複或缺失、latency 不是數字', () => {
    rejects('x', 'broken-structure');
    rejects({ ...fresh(), nodes: 'x' }, 'broken-structure');
    const dup = fresh();
    dup.nodes[1].id = 'n-out';
    rejects(dup, 'broken-structure');
    const noId = fresh();
    delete noId.nodes[0].id;
    rejects(noId, 'broken-structure');
    const text = fresh();
    text.nodes[1].latency.setup = '10';
    rejects(text, 'broken-structure');
  });

  it('nodeMap 寫錯 B 節點 id、或兩個 B 節點對到同一個計畫節點時整份拒絕', () => {
    rejects(fresh(), 'node-map', { nodeMap: { ...nodeMap, 'n-typo': 'qc2' } });
    rejects(fresh(), 'node-map', { nodeMap: { ...nodeMap, 'n-in': 'mix' } });
  });
});

describe('migrateProcessDefinition：逐欄報告', () => {
  it('B 模型的每個欄位都有去向：帶入、捨棄、延後或需補資料，沒有靜默消失', () => {
    const { report } = migrated();
    const expected: [string, FieldReportItem['disposition']][] = [
      ['/nodes/*/latency', 'carried'], ['/nodes/*/resource', 'carried'],
      ['/nodes/*/function', 'deferred'], ['/nodes/*/kind', 'dropped'], ['/nodes/*/name', 'dropped'],
      ['/nodes/*/split', 'dropped'], ['/nodes/*/join', 'dropped'], ['/nodes/*/subgraph', 'dropped'], ['/nodes/*/position', 'dropped'],
      ['/edges/*', 'dropped'], ['/edges/*/transfer_time', 'deferred'],
      ['/products/*', 'dropped'], ['/rework_rules/*', 'dropped'], ['/id', 'dropped'],
    ];
    for (const [path, disposition] of expected) expect(item(report, path, disposition), `${path} ${disposition}`).toBeDefined();
  });

  it('function 列出實際出現的值，供撰寫對應表時對照；子步驟依決策 17 捨棄並指出節點', () => {
    const { report } = migrated();
    expect(item(report, '/nodes/*/function', 'deferred')!.summary).toContain('mfg.machining:turning');
    expect(item(report, '/nodes/*/subgraph', 'dropped')).toMatchObject({ ids: ['n-turn', 'n-mill', 'n-drill', 'n-qc'], summary: expect.stringContaining('決策 17') });
  });

  it('B 模型以外的欄位在出現的層級被標為 unknown，而不是忽略', () => {
    const input = fresh();
    input.nodes[0].color = 'red';
    input.extra = 1;
    const { report } = migrated(input);
    expect(item(report, '/nodes/*', 'unknown')).toMatchObject({ ids: ['n-out'], summary: expect.stringContaining('color') });
    expect(item(report, '/', 'unknown')).toBeDefined();
  });

  it('相同輸入得到相同報告（確定性）', () => {
    expect(migrated().report).toEqual(migrated().report);
  });
});

describe('遷移結果餵給 buildExecutablePlan', () => {
  const mapping: CapabilityMap = {
    format: 'composer-action-capability-map', version: 1, entries: [],
    categoryDefaults: ['source', 'sink', 'assemble', 'hold', 'transform', 'measure', 'judge'].map(category => ({ category: category as never, capability: `test.${category}`, kitId: 'test-kit', executor: 'system' as const })),
  };
  const published = (): ProjectFile => {
    const p = structuredClone(bakery) as unknown as ProjectFile;
    p.meta = { ...p.meta, status: 'published' };
    return p;
  };
  const scope = { factoryId: 'example-factory', graphId: 'main' };

  it('工時與資源進入計畫節點，且進入 planId', async () => {
    const { timings, resources } = migrated();
    const withData = await buildExecutablePlan({ project: published(), mapping, scope, timings, resources });
    const without = await buildExecutablePlan({ project: published(), mapping, scope });
    if (!withData.ok || !without.ok) throw new Error('預期建置成功');
    const mix = (withData.plan.nodes as any[]).find(n => n.nodeId === 'mix');
    expect(mix.timing).toMatchObject({ state: 'specified', setupMin: 10 });
    expect(mix.resource).toEqual({ capability: 'turning', operatorSkill: 'turning' });
    expect(withData.plan.planId).not.toBe(without.plan.planId);
  });

  it('timings 或 resources 指到計畫沒有的節點時整份拒絕，不靜默忽略', async () => {
    for (const key of ['timings', 'resources'] as const) {
      const result = await buildExecutablePlan({ project: published(), mapping, scope, [key]: { ghost: key === 'timings' ? { state: 'missing' } : { capability: 'x' } } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some(e => e.code === 'unknown-node' && e.nodeId === 'ghost')).toBe(true);
    }
  });

  it('tuning 指到不存在的參數時整份拒絕', async () => {
    const result = await buildExecutablePlan({ project: published(), mapping, scope, tuning: { nope: {} } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(e => e.code === 'unknown-param')).toBe(true);
  });
});
