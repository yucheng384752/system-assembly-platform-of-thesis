import { describe, expect, it } from 'vitest';
import bakery from '../../fixtures/aov-merge/c/project.valid.json';
import version from '../aov-core/VERSION.json';
import type { ProjectFile } from '../aov-core';
import { buildExecutablePlan, computePlanId, validateExecutablePlan, verifyPlanId, type CapabilityMap, type PlanBuildInput } from './executablePlan';

// The mapping below is test data only. The real action-to-capability table is confirmed by the user and does not exist yet.
const mapping: CapabilityMap = {
  format: 'composer-action-capability-map', version: 1,
  entries: [{ actionId: 'mix-dough', capability: 'test.work-step', kitId: 'test-kit' }, { actionId: 'bake-bread', capability: 'test.work-step', kitId: 'test-kit' }],
};
const scope = { factoryId: 'example-factory', graphId: 'main' };

function published(): ProjectFile {
  const p = structuredClone(bakery) as unknown as ProjectFile;
  p.meta = { ...p.meta, status: 'published' };
  p.actions = [
    { id: 'mix-dough', name: 'Mix', behavior: 'assemble', executor: 'manual' },
    { id: 'bake-bread', name: 'Bake', behavior: 'transform', executor: 'auto' },
    { id: 'no-executor', name: 'Receive', behavior: 'source' },
  ];
  p.nodes.find(n => n.id === 'mix')!.action = 'mix-dough';
  p.nodes.find(n => n.id === 'bake')!.action = 'bake-bread';
  return p;
}
const input = (over: Partial<PlanBuildInput> = {}): PlanBuildInput => ({ project: published(), mapping, scope, ...over });
async function built(over: Partial<PlanBuildInput> = {}) {
  const result = await buildExecutablePlan(input(over));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.plan as Record<string, any>;
}
async function rejected(over: Partial<PlanBuildInput>, code: string) {
  const result = await buildExecutablePlan(input(over));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('預期拒絕');
  expect(result.errors.some(e => e.code === code), JSON.stringify(result.errors)).toBe(true);
}

describe('buildExecutablePlan：A 的編譯結果轉成可執行計畫', () => {
  it('產生通過 schema 的計畫，planId 可重算，且固定使用 aov-core 快照的 commit', async () => {
    const plan = await built();
    expect(validateExecutablePlan(plan)).toEqual([]);
    expect(await verifyPlanId(plan as never)).toBe(true);
    expect(plan.source.aovCoreCommit).toBe(version.commit);
    expect(plan.order).toEqual(plan.nodes.map((n: any) => n.nodeId));
  });

  it('相同輸入兩次得到相同位元組（確定性）', async () => {
    expect(await built()).toEqual(await built());
  });

  it('有動作且在對應表內的節點可執行並帶 binding；沒有動作的節點保留但不可執行並說明原因', async () => {
    const plan = await built();
    const byId = Object.fromEntries(plan.nodes.map((n: any) => [n.nodeId, n]));
    expect(byId.mix).toMatchObject({ executable: true, actionId: 'mix-dough', binding: { capability: 'test.work-step', kitId: 'test-kit' } });
    expect(byId.src_flour).toMatchObject({ executable: false, reason: expect.stringContaining('沒有引用業務動作') });
    expect(byId.src_flour).not.toHaveProperty('binding');
  });

  it('動作不在對應表時不猜名稱：節點不可執行，原因指出動作 id', async () => {
    const plan = await built({ mapping: { ...mapping, entries: mapping.entries.slice(0, 1) } });
    expect(plan.nodes.find((n: any) => n.nodeId === 'bake')).toMatchObject({ executable: false, reason: expect.stringContaining('bake-bread') });
  });

  it('動作沒有執行者、節點也沒設定時不可執行，不由編譯端猜 manual', async () => {
    const project = published();
    project.nodes.find(n => n.id === 'src_flour')!.action = 'no-executor';
    const plan = await built({ project, mapping: { ...mapping, entries: [...mapping.entries, { actionId: 'no-executor', capability: 'test.receive', kitId: 'test-kit' }] } });
    expect(plan.nodes.find((n: any) => n.nodeId === 'src_flour')).toMatchObject({ executable: false, reason: expect.stringContaining('執行者') });
  });

  it('缺工時一律為 missing；有提供才是 specified，不會變成 0', async () => {
    const plan = await built({ timings: { mix: { state: 'specified', setupMin: 5, perUnitMin: 2, quantityUnit: 'kg' } } });
    const byId = Object.fromEntries(plan.nodes.map((n: any) => [n.nodeId, n]));
    expect(byId.mix.timing).toMatchObject({ state: 'specified', setupMin: 5 });
    expect(byId.bake.timing).toEqual({ state: 'missing' });
  });

  it('flow 的 artifactType 取自輸出埠位；資訊型別為 data、物料為 material', async () => {
    const plan = await built();
    expect(plan.flows.find((f: any) => f.id === 'f1')).toMatchObject({ artifactType: 'lot.flour', kind: 'material' });
  });

  it('對應表版本與內容進入 planId：改對應表，planId 與 source.mapping 都變', async () => {
    const a = await built();
    const b = await built({ mapping: { ...mapping, version: 2 } });
    expect(b.planId).not.toBe(a.planId);
    expect(b.source.mapping.sha256).not.toBe(a.source.mapping.sha256);
  });

  it('表單內容一變，節點的 contentSha256 與 planId 都改變；舊計畫不受影響', async () => {
    const withForm = (label: string) => {
      const p = published();
      p.forms = [{ id: 'bake-record', name: 'Bake record', subject: ['lot.dough'], fields: { temp: { label, type: 'number', unit: 'degC' } } }];
      p.nodes.find(n => n.id === 'bake')!.form = 'bake-record';
      return p;
    };
    const a = await built({ project: withForm('Temperature') });
    const b = await built({ project: withForm('Oven temperature') });
    const formOf = (plan: Record<string, any>) => plan.nodes.find((n: any) => n.nodeId === 'bake').form;
    expect(formOf(a).formId).toBe('bake-record');
    expect(formOf(b).contentSha256).not.toBe(formOf(a).contentSha256);
    expect(b.planId).not.toBe(a.planId);
    expect(await verifyPlanId(a as never)).toBe(true);
  });

  it('只有 tuning 指定的參數可由工廠調整，並帶允許範圍', async () => {
    const project = published();
    project.params = [...project.params!, { id: 'mix_minutes', type: 'number', unit: 'min', default: 10 }, { id: 'plant', type: 'string', default: 'x' }];
    const plan = await built({ project, tuning: { mix_minutes: { range: { min: 5, max: 20 } } } });
    expect(plan.params.slice(1)).toEqual([
      { id: 'mix_minutes', type: 'number', unit: 'min', default: 10, tunable: true, range: { min: 5, max: 20 } },
      { id: 'plant', type: 'string', default: 'x', tunable: false },
    ]);
  });
});

describe('buildExecutablePlan：拒絕案例', () => {
  it('草稿版本不可編成計畫', async () => {
    await rejected({ project: structuredClone(bakery) as unknown as ProjectFile }, 'not-published');
  });
  it('對應表格式錯誤、動作重複、版本無效都拒絕，不挑一筆', async () => {
    await rejected({ mapping: { ...mapping, format: 'x' } as never }, 'mapping');
    await rejected({ mapping: { ...mapping, entries: [...mapping.entries, { actionId: 'mix-dough', capability: 'other', kitId: 'other-kit' }] } }, 'mapping');
    await rejected({ mapping: { ...mapping, version: 0 } }, 'mapping');
  });
  it('A 的驗證失敗（連線指向不存在的節點）時整份拒絕並帶出 compile 診斷', async () => {
    const project = published();
    project.flows[0].to.node = 'ghost';
    const result = await buildExecutablePlan(input({ project }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.every(e => e.code.startsWith('compile:'))).toBe(true);
  });
  it('內容在封存後被改，verifyPlanId 為 false，重算值與宣告不同', async () => {
    const plan = await built();
    plan.nodes[0].name = 'tampered';
    expect(await verifyPlanId(plan as never)).toBe(false);
    expect(await computePlanId(plan)).not.toBe(plan.planId);
  });
});

describe('buildExecutablePlan：子 AoV 展開', () => {
  function withSubgraph() {
    const parent = published();
    const bake = structuredClone(parent.nodes.find(n => n.id === 'bake')!);
    delete bake.action;
    const sub: ProjectFile = {
      formatVersion: 1, meta: { id: 'bake-sub', name: 'Bake sub', version: 1, status: 'published', kind: 'subgraph' },
      artifactTypes: parent.artifactTypes.filter(t => ['lot.dough', 'lot.bread'].includes(t.id)),
      nodes: [bake], flows: [],
    };
    parent.nodes = parent.nodes.map(n => n.id === 'bake'
      ? { id: 'bake', name: 'Bake', category: 'subgraph', ref: 'bake-sub@1', inputs: [{ id: 'bake.dough', type: 'lot.dough' }], outputs: [{ id: 'bake.bread', type: 'lot.bread' }] }
      : n);
    parent.flows = parent.flows.map(f => f.id === 'f5' ? { ...f, to: { node: 'bake', port: 'bake.dough' } } : f.id === 'f6' ? { ...f, from: { node: 'bake', port: 'bake.bread' } } : f);
    return { parent, sub };
  }

  it('計畫是展開後的平面圖：沒有子流程節點，內部節點帶前綴與 expandedFrom，來源記錄子 AoV 版本與雜湊', async () => {
    const { parent, sub } = withSubgraph();
    const plan = await built({ project: parent, subgraphs: [sub] });
    expect(plan.nodes.some((n: any) => n.category === 'subgraph')).toBe(false);
    expect(plan.nodes.find((n: any) => n.nodeId === 'bake/bake')).toMatchObject({ expandedFrom: 'bake@bake-sub@1' });
    expect(plan.source.subgraphs).toEqual([{ id: 'bake-sub', version: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
  });

  it('改子 AoV 後新計畫的 planId 改變，舊計畫仍可驗證', async () => {
    const { parent, sub } = withSubgraph();
    const before = await built({ project: parent, subgraphs: [sub] });
    const changed = structuredClone(sub);
    changed.meta.version = 2;
    changed.nodes[0].name = 'Bake v2';
    parent.nodes.find(n => n.id === 'bake')!.ref = 'bake-sub@2';
    const after = await built({ project: parent, subgraphs: [sub, changed] });
    expect(after.planId).not.toBe(before.planId);
    expect(await verifyPlanId(before as never)).toBe(true);
  });

  it('子 AoV 找不到或未發佈時整份拒絕', async () => {
    const { parent, sub } = withSubgraph();
    await rejected({ project: parent, subgraphs: [] }, 'compile:C-subgraph');
    await rejected({ project: parent, subgraphs: [{ ...sub, meta: { ...sub.meta, status: 'draft' } }] }, 'compile:C-subgraph');
  });
});
