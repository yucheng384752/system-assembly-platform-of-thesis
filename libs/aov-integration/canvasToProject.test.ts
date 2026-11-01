import { describe, expect, it } from 'vitest';
import { compile, type ProjectMeta } from '../aov-core';
import { emptyGraph, type AovGraphDocument, type GraphNode } from '../../apps/composer-gui/src/workflowGraph';
import { convertCanvas, reportLogics, type ConvertResult } from './canvasToProject';
import { buildExecutablePlan, validateExecutablePlan, verifyPlanId, type CapabilityMap } from './executablePlan';
import { emptyProjectDetails, type NodeBehavior, type ProjectDetails } from './projectDetails';

const node = (id: string, name: string, kind: GraphNode['kind'] = 'node', childGraphId: string | null = null): GraphNode =>
  ({ id, kind, name, when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId });
const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to });
const canvas = (nodes: GraphNode[], edges: { id: string; from: string; to: string }[], extra: AovGraphDocument['graphs'] = []): AovGraphDocument => ({
  ...emptyGraph,
  factories: [{ id: 'f1', name: '工廠', logicGraphIds: ['g1'] }],
  graphs: [{ id: 'g1', name: '生產邏輯', nodes: [node('start', '開始', 'start'), ...nodes, node('end', '結束', 'end')], edges }, ...extra],
});
const meta: ProjectMeta = { id: 'tin-bar', name: '錫棒入庫', version: 1, status: 'draft' };
const details = (nodes: Record<string, NodeBehavior>): ProjectDetails => ({
  ...emptyProjectDetails,
  materials: [{ key: 'ingot', name: '原料錫錠', dimension: 'mass', baseUnit: 'kg' }, { key: 'bar', name: '錫棒', dimension: 'mass', baseUnit: 'kg' }, { key: 'unused', name: '未使用', dimension: 'count', baseUnit: 'pcs' }],
  nodes,
});
const run = (doc: AovGraphDocument, nodes: Record<string, NodeBehavior>, over: Partial<{ factoryId: string; graphId: string }> = {}): ConvertResult =>
  convertCanvas({ doc, factoryId: 'f1', graphId: 'g1', details: details(nodes), meta, ...over });
const messages = (r: ConvertResult) => (r.ok ? [] : r.issues.map(i => i.message));

const simple = canvas([node('n1', '領料'), node('n2', '入庫')], [edge('start', 'n1'), edge('n1', 'n2'), edge('n2', 'end')]);
const pick: NodeBehavior = { kind: 'pick', location: 'wh.raw', material: 'ingot' };
const stockIn: NodeBehavior = { kind: 'sink', direction: 'stock-in', location: 'wh.fg', material: 'ingot' };

describe('畫布轉成 aov-core 專案檔（領料、入庫、出庫）', () => {
  it('領料到入庫：領料是來源、入庫是終點，連線接在主輸出與輸入，且能被 aov-core 編譯', () => {
    const result = run(simple, { n1: pick, n2: stockIn });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.nodes).toEqual([
      { id: 'n1', name: '領料', category: 'source', inputs: [], outputs: [{ id: 'out', type: 'lot.ingot', role: 'main' }], boundary: { kind: 'warehouse', location: 'wh.raw' } },
      { id: 'n2', name: '入庫', category: 'sink', inputs: [{ id: 'in', type: 'lot.ingot' }], outputs: [], boundary: { kind: 'warehouse', location: 'wh.fg' } },
    ]);
    expect(result.project.flows).toEqual([{ id: 'n1-n2', from: { node: 'n1', port: 'out' }, to: { node: 'n2', port: 'in' } }]);
    expect(compile(result.project).ok).toBe(true);
  });

  it('入庫、出庫給客戶、出庫到外部是同一種終點，只有邊界種類不同', () => {
    const boundaryOf = (direction: 'stock-in' | 'ship-customer' | 'ship-external') => {
      const r = run(simple, { n1: pick, n2: { ...stockIn, direction } });
      if (!r.ok) throw new Error(messages(r).join('；'));
      const sink = r.project.nodes[1];
      return [sink.category, sink.boundary?.kind];
    };
    expect(boundaryOf('stock-in')).toEqual(['sink', 'warehouse']);
    expect(boundaryOf('ship-customer')).toEqual(['sink', 'customer']);
    expect(boundaryOf('ship-external')).toEqual(['sink', 'external']);
  });

  it('只帶流程用到的物料型別，開始與結束節點不進專案檔', () => {
    const r = run(simple, { n1: pick, n2: stockIn });
    expect(r.ok && r.project.artifactTypes.map(t => t.id)).toEqual(['lot.ingot']);
    expect(r.ok && r.project.artifactTypes[0]).toEqual({ id: 'lot.ingot', name: '原料錫錠', extends: 'material', quantity: { dimension: 'mass', baseUnit: 'kg' } });
    expect(r.ok && r.project.nodes.map(n => n.id)).toEqual(['n1', 'n2']);
  });

  it('沒有設定物料流類別的節點被指出，不被當成別的類別', () => {
    const r = run(simple, { n1: pick });
    expect(messages(r)).toEqual(['節點「入庫」還沒有設定物料流類別（領料、入庫或出庫）。']);
    expect(!r.ok && r.issues[0].nodeId).toBe('n2');
  });

  it('兩端型別不合：由 aov-core 的檢查回報，並帶回節點', () => {
    const r = run(simple, { n1: pick, n2: { ...stockIn, material: 'bar' } });
    expect(r).toEqual({ ok: false, issues: [{ message: '型別不相容：領料.out（lot.ingot）→ 入庫.in（lot.bar）', nodeId: 'n2', edgeId: 'n1-n2' }] });
  });

  it('入庫之後還接節點、領料接在別的節點之後：指出並說明原因', () => {
    const after = canvas([node('n1', '領料'), node('n2', '入庫'), node('n3', '再入庫')], [edge('n1', 'n2'), edge('n2', 'n3')]);
    expect(messages(run(after, { n1: pick, n2: stockIn, n3: stockIn }))).toEqual(['節點「入庫」是入庫，之後不能再接其他節點。']);
    const before = canvas([node('n1', '領料'), node('n2', '領料二')], [edge('n1', 'n2')]);
    expect(messages(run(before, { n1: pick, n2: pick }))).toEqual(['節點「領料二」是領料，是流程的起點，不能接在其他節點之後。']);
  });

  it('只轉最上層：節點底下的子流程不進專案檔', () => {
    const child = { id: 'g2', name: '子流程', nodes: [node('c1', '細項'), node('cs', '開始', 'start'), node('ce', '結束', 'end')], edges: [] };
    const doc = canvas([node('n1', '領料', 'node', 'g2'), node('n2', '入庫')], [edge('n1', 'n2')], [child]);
    const r = run(doc, { n1: pick, n2: stockIn });
    expect(r.ok && r.project.nodes.map(n => n.id)).toEqual(['n1', 'n2']);
  });

  it('找不到生產邏輯、沒有節點、細項檔本身有錯：各自以業務語言回報', () => {
    expect(messages(run(simple, {}, { graphId: 'zz' }))).toEqual(['找不到要轉換的生產邏輯。']);
    expect(messages(run(simple, {}, { factoryId: 'zz' }))).toEqual(['找不到要轉換的生產邏輯。']);
    expect(messages(run(canvas([], []), {}))).toEqual(['這個生產邏輯還沒有任何節點。']);
    expect(messages(run(simple, { n1: { ...pick, material: 'ghost' }, n2: stockIn }))[0]).toContain('物料型別不存在');
  });
});

describe('畫布到可執行計畫（端對端）', () => {
  // Test data only: which Kit function a pick or a stock-in lands on is not decided yet.
  const mapping: CapabilityMap = {
    format: 'composer-action-capability-map', version: 1, entries: [],
    categoryDefaults: [
      { category: 'source', capability: 'test.work-step', kitId: 'test-kit', executor: 'manual' },
      { category: 'sink', capability: 'test.work-step', kitId: 'test-kit', executor: 'manual' },
    ],
  };
  const scope = { factoryId: 'f1', graphId: 'g1' };
  const converted = (direction: 'stock-in' | 'ship-customer' | 'ship-external' = 'stock-in') => {
    const r = run(simple, { n1: pick, n2: { ...stockIn, direction } });
    if (!r.ok) throw new Error(messages(r).join('；'));
    return { ...r.project, meta: { ...r.project.meta, status: 'published' as const } };
  };

  it('轉出的專案檔能建成計畫，通過計畫檔的結構檢查，planId 可重算', async () => {
    const built = await buildExecutablePlan({ project: converted(), mapping, scope });
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    expect(validateExecutablePlan(built.plan)).toEqual([]);
    expect(await verifyPlanId(built.plan)).toBe(true);
    const nodes = (built.plan as Record<string, any>).nodes;
    expect(nodes.map((n: any) => [n.nodeId, n.category, n.executable])).toEqual([['n1', 'source', true], ['n2', 'sink', true]]);
  });

  it('沒有 Kit 功能可對應的節點不會被當成可執行：缺少對應時計畫保留節點並標為不可執行', async () => {
    const built = await buildExecutablePlan({ project: converted(), mapping: { ...mapping, categoryDefaults: [] }, scope });
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const nodes = (built.plan as Record<string, any>).nodes;
    expect(nodes.every((n: any) => n.executable === false)).toBe(true);
  });

  it('入庫與出庫的方向會改變計畫內容，因此得到不同的 planId', async () => {
    const ids = await Promise.all((['stock-in', 'ship-customer', 'ship-external'] as const).map(async d => {
      const built = await buildExecutablePlan({ project: converted(d), mapping, scope });
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      return built.plan.planId;
    }));
    expect(new Set(ids).size).toBe(3);
  });

  it('同一份畫布與細項轉兩次、建兩次得到相同的計畫', async () => {
    const a = await buildExecutablePlan({ project: converted(), mapping, scope });
    const b = await buildExecutablePlan({ project: converted(), mapping, scope });
    expect(a).toEqual(b);
  });
});

describe('畫面用的逐生產邏輯報告', () => {
  it('每個生產邏輯各自回報可否轉換與原因', () => {
    const doc = { ...simple, factories: [{ id: 'f1', name: '岱暉', logicGraphIds: ['g1', 'g9'] }], graphs: [...simple.graphs, { id: 'g9', name: '另一條', nodes: [node('m1', '加工')], edges: [] }] };
    const report = reportLogics(doc, details({ n1: pick, n2: stockIn }));
    expect(report.map(r => [r.label, r.ok])).toEqual([['岱暉 / 生產邏輯', true], ['岱暉 / 另一條', false]]);
    expect(report[1].issues[0].message).toBe('節點「加工」還沒有設定物料流類別（領料、入庫或出庫）。');
  });
  it('細項本身還沒填完時不報告轉換結果，避免同一個錯誤重複出現', () => {
    expect(reportLogics(simple, details({ n1: { kind: 'sink', direction: '', location: '', material: '' } }))).toEqual([]);
  });
});
