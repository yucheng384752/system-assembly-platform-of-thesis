import { describe, expect, it } from 'vitest';
import bakery from '../../fixtures/aov-merge/c/project.valid.json';
import type { ProjectFile } from '../aov-core';
import { buildExecutablePlan, type CapabilityMap, type PlanBuildInput, type PlanTiming } from '../aov-integration/executablePlan';
import { estimateGantt, GANTT_DISCLAIMER, type GanttConditions, type GanttResult } from './ganttEstimate';
import { renderGanttSvg } from './ganttSvg';

// Bakery line: src_flour, src_yeast -> mix -> proof -> bake -> measure -> qc -> (ok | rework | ng); mix also sends loss to sink_scrap.
const mapping: CapabilityMap = {
  format: 'composer-action-capability-map', version: 1, entries: [],
  categoryDefaults: ['source', 'sink', 'assemble', 'hold', 'transform', 'measure', 'judge'].map(category => ({ category: category as never, capability: `test.${category}`, kitId: 'test-kit', executor: 'system' as const })),
};
const spec = (setupMin: number, perUnitMin = 0): PlanTiming => ({ state: 'specified', setupMin, perUnitMin, quantityUnit: 'kg' });
const timings: Record<string, PlanTiming> = { mix: spec(10, 2), proof: spec(60), bake: spec(30, 1), measure: spec(5), qc: spec(5) };
const flowIds = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11'];
const allTransfers = Object.fromEntries(flowIds.map(id => [id, { state: 'specified' as const, minutes: 5 }]));

async function planOf(over: Partial<PlanBuildInput> = {}) {
  const project = structuredClone(bakery) as unknown as ProjectFile;
  project.meta = { ...project.meta, status: 'published' };
  const result = await buildExecutablePlan({ project, mapping, scope: { factoryId: 'example-factory', graphId: 'main' }, timings, transfers: allTransfers, ...over });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.plan;
}
type Ok = Extract<GanttResult, { ok: true }>;
async function estimate(over: Partial<PlanBuildInput> = {}, cond: GanttConditions = { quantity: 10, branchChoices: { qc: 'ok' } }): Promise<Ok> {
  const result = estimateGantt(await planOf(over), cond);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
}
const row = (e: Ok, id: string) => e.rows.find(r => r.nodeId === id)!;

describe('estimateGantt：依連線相依、工時與移轉時間的估算', () => {
  it('串接路徑：每列起訖等於上游結束加移轉時間，工時等於 setup 加 per_unit 乘數量', async () => {
    const e = await estimate();
    expect(row(e, 'mix')).toMatchObject({ start: 5, end: 35 }); // 5 + 10 + 2*10
    expect(row(e, 'proof')).toMatchObject({ start: 40, end: 100 });
    expect(row(e, 'bake')).toMatchObject({ start: 105, end: 145 });
    expect(row(e, 'qc')).toMatchObject({ start: 160, end: 165 });
    expect(row(e, 'sink_fg')).toMatchObject({ start: 170, end: 170, milestone: true });
    expect(e.total).toBe(170);
    expect(e.disclaimer).toBe(GANTT_DISCLAIMER);
  });

  it('平行路徑：下游從最晚到達的上游開始', async () => {
    const e = await estimate({ timings: { ...timings, src_yeast: spec(20) } });
    expect(row(e, 'mix').start).toBe(25); // yeast 20 + 5 beats flour 0 + 5
    // The slower input is also tested in the other position, so taking the first or the last predecessor fails.
    expect(row(await estimate({ timings: { ...timings, src_flour: spec(20) } }), 'mix').start).toBe(25);
  });

  it('判定節點必須指定分支；只有被選的分支及其下游進入估算', async () => {
    const plan = await planOf();
    const missing = estimateGantt(plan, { quantity: 10 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors).toEqual([expect.objectContaining({ code: 'branch-required', nodeId: 'qc' })]);

    const rework = estimateGantt(plan, { quantity: 10, branchChoices: { qc: 'rework' } }) as Ok;
    expect(rework.rows.map(r => r.nodeId)).toContain('sink_rework');
    expect(rework.rows.map(r => r.nodeId)).not.toContain('sink_fg');
  });

  it('其他輸出埠位不是分支：mix 的 loss 線到報廢終點，不論判定選哪個都在估算內', async () => {
    const e = await estimate();
    expect(row(e, 'sink_scrap')).toMatchObject({ start: 40, milestone: true });
  });

  it('指定不存在的分支埠位、或對非判定節點指定分支時拒絕', async () => {
    const plan = await planOf();
    for (const branchChoices of [{ qc: 'nope' }, { qc: 'ok', mix: 'dough' }, { qc: 'ok', ghost: 'x' }] as Record<string, string>[]) {
      const r = estimateGantt(plan, { quantity: 10, branchChoices });
      expect(r.ok, JSON.stringify(branchChoices)).toBe(false);
      if (!r.ok) expect(r.errors.some(x => x.code === 'branch-unknown')).toBe(true);
    }
  });
});

describe('estimateGantt：缺資料與 0 分開', () => {
  it('缺工時的節點沒有結束時間，下游起點也未知；總時長為未知而不是被當成 0', async () => {
    const { bake: _omitted, ...withoutBake } = timings;
    const e = await estimate({ timings: withoutBake });
    expect(row(e, 'bake')).toMatchObject({ start: 105, reasons: ['缺工時'] });
    expect(row(e, 'bake').end).toBeUndefined();
    expect(row(e, 'measure').start).toBeUndefined();
    expect(row(e, 'measure').reasons[0]).toContain('上游');
    expect(e.total).toBeNull();
    expect(e.lowerBound).toBe(100);
    expect(e.incomplete).toEqual(expect.arrayContaining(['bake', 'measure', 'qc', 'sink_fg']));
  });

  it('明確填 0 的工時是 0（起訖相同），與缺工時不同', async () => {
    const e = await estimate({ timings: { ...timings, proof: spec(0) } });
    expect(row(e, 'proof')).toMatchObject({ start: 40, end: 40, reasons: [] });
    expect(e.total).not.toBeNull();
  });

  it('缺移轉時間預設也算缺資料；明確選擇以 0 估算時才計算，並在條件中說明', async () => {
    const { f3: _omitted, ...withoutF3 } = allTransfers;
    const plan = await planOf({ transfers: withoutF3 });
    const strict = estimateGantt(plan, { quantity: 10, branchChoices: { qc: 'ok' } }) as Ok;
    expect(row(strict, 'proof').start).toBeUndefined();
    expect(row(strict, 'proof').reasons).toEqual(['連線「f3」缺移轉時間']);
    const loose = estimateGantt(plan, { quantity: 10, branchChoices: { qc: 'ok' }, treatMissingTransferAsZero: true }) as Ok;
    expect(row(loose, 'proof')).toMatchObject({ start: 35, transferAssumedZero: true });
    expect(loose.conditions.join('\n')).toContain('以 0 估算');
  });

  it('沒提供任何移轉時間的計畫（建置時未帶）在嚴格模式下，有連線的節點都缺資料', async () => {
    const e = await estimate({ transfers: {} });
    expect(row(e, 'mix').start).toBeUndefined();
    expect(e.total).toBeNull();
  });
});

describe('estimateGantt：數量與單位', () => {
  it('有節點的工時隨數量增加卻沒給數量時拒絕；全部工時固定則不需要數量', async () => {
    const plan = await planOf();
    const r = estimateGantt(plan, { branchChoices: { qc: 'ok' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('quantity-required');
    expect(estimateGantt(plan, { quantity: 0, branchChoices: { qc: 'ok' } }).ok).toBe(false);
    const fixed = await planOf({ timings: { mix: spec(10), proof: spec(60), bake: spec(30), measure: spec(5), qc: spec(5) } });
    expect(estimateGantt(fixed, { branchChoices: { qc: 'ok' } }).ok).toBe(true);
  });

  it('隨數量增加的節點使用不同單位時拒絕，不混算', async () => {
    const plan = await planOf({ timings: { ...timings, bake: { state: 'specified', setupMin: 30, perUnitMin: 1, quantityUnit: 'pcs' } } });
    const r = estimateGantt(plan, { quantity: 10, branchChoices: { qc: 'ok' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some(x => x.code === 'quantity-unit-mixed')).toBe(true);
  });
});

describe('estimateGantt：輸入防護', () => {
  it('不符 schema 的計畫、順序違反連線的計畫都拒絕', async () => {
    expect(estimateGantt({ nope: 1 }).ok).toBe(false);
    const plan = await planOf();
    const reversed = { ...plan, order: [...(plan.order as string[])].reverse() };
    const r = estimateGantt(reversed, { quantity: 10, branchChoices: { qc: 'ok' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('plan-order');
  });

  it('相同輸入得到相同結果（確定性）', async () => {
    expect(await estimate()).toEqual(await estimate());
  });
});

describe('buildExecutablePlan：移轉時間輸入', () => {
  it('沒給的連線標為 missing，給了的帶入並進入 planId；指到不存在的連線整份拒絕', async () => {
    const none = await planOf({ transfers: undefined });
    expect((none.flows as any[]).every(f => f.transferMin.state === 'missing')).toBe(true);
    const some = await planOf();
    expect((some.flows as any[]).find(f => f.id === 'f1').transferMin).toEqual({ state: 'specified', minutes: 5 });
    expect(some.planId).not.toBe(none.planId);
    const project = structuredClone(bakery) as unknown as ProjectFile;
    project.meta = { ...project.meta, status: 'published' };
    const bad = await buildExecutablePlan({ project, mapping, scope: { factoryId: 'x', graphId: 'y' }, transfers: { ghost: { state: 'missing' } } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.some(e => e.code === 'unknown-flow')).toBe(true);
  });
});

describe('renderGanttSvg', () => {
  it('標示估算與不含資源競用；完整列畫成長條、里程碑畫成菱形', async () => {
    const svg = renderGanttSvg(await estimate());
    expect(svg).toContain('流程預估，未計入實際資源競用');
    expect(svg).toContain('總時長 170 分鐘');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('<rect x=');
  });

  it('缺資料的列以文字「缺資料」標示並說明原因，總時長標為未知而不是 0', async () => {
    const { bake: _omitted, ...withoutBake } = timings;
    const svg = renderGanttSvg(await estimate({ timings: withoutBake }));
    expect(svg).toContain('缺資料：缺工時');
    expect(svg).toContain('總時長未知（已知部分至少 100 分鐘）');
    expect(svg).not.toContain('總時長 0');
  });

  it('起點已知但缺工時的列，標記與說明文字畫在畫布內，不會被切掉而看不見', async () => {
    const { bake: _omitted, ...withoutBake } = timings;
    const svg = renderGanttSvg(await estimate({ timings: withoutBake }));
    const width = Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)![1]);
    const marker = /<rect x="([\d.]+)"[^>]*stroke-dasharray/.exec(svg);
    const reason = /<text x="([\d.]+)"[^>]*>缺資料：缺工時/.exec(svg);
    expect(marker && reason).toBeTruthy();
    expect(Number(marker![1])).toBeLessThan(width);
    // The reason text needs room to its right; about 14px per full-width character.
    expect(width - Number(reason![1])).toBeGreaterThan('缺資料：缺工時'.length * 14);
  });

  it('節點名稱中的標記字元被跳脫，輸出不含可執行內容', async () => {
    const project = structuredClone(bakery) as unknown as ProjectFile;
    project.meta = { ...project.meta, status: 'published' };
    project.nodes.find(n => n.id === 'mix')!.name = '<script>alert(1)</script>&"';
    const plan = await buildExecutablePlan({ project, mapping, scope: { factoryId: 'x', graphId: 'y' }, timings, transfers: allTransfers });
    if (!plan.ok) throw new Error(JSON.stringify(plan.errors));
    const e = estimateGantt(plan.plan, { quantity: 10, branchChoices: { qc: 'ok' } }) as Ok;
    const svg = renderGanttSvg(e);
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;script&gt;');
  });
});
