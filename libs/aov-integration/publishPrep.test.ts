import { describe, expect, it } from 'vitest';
import { emptyGraph, type AovGraphDocument, type GraphNode } from '../../apps/composer-gui/src/workflowGraph';
import { validateExecutablePlan, verifyPlanId } from './executablePlan';
import { emptyProjectDetails, type ProjectDetails } from './projectDetails';
import { checkFormBundle } from './formBundle';
import { preparePlan, type PrepInput } from './publishPrep';

const node = (id: string, name: string): GraphNode => ({ id, kind: 'node', name, when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null });
const doc: AovGraphDocument = {
  ...emptyGraph,
  factories: [{ id: 'f1', name: '岱暉', logicGraphIds: ['g1'] }],
  graphs: [{ id: 'g1', name: '錫棒入庫', nodes: [node('n1', '領料'), node('n2', '入庫')], edges: [{ id: 'e1', from: 'n1', to: 'n2' }] }],
};
const details: ProjectDetails = {
  ...emptyProjectDetails,
  materials: [{ key: 'ingot', name: '原料錫錠', dimension: 'mass', baseUnit: 'kg' }],
  nodes: { n1: { kind: 'pick', location: 'wh.raw', material: 'ingot' }, n2: { kind: 'sink', direction: 'stock-in', location: 'wh.fg', material: 'ingot' } },
};
const input = (over: Partial<PrepInput> = {}): PrepInput => ({ doc, factoryId: 'f1', graphId: 'g1', details, projectId: 'tin-bar', projectName: '錫棒入庫', version: 1, ...over });
const issues = async (over: Partial<PrepInput>) => { const r = await preparePlan(input(over)); return r.ok ? [] : r.issues.map(i => i.message); };

describe('發布準備：畫布到計畫檔', () => {
  it('產生通過結構檢查、planId 可重算的計畫檔，檔名帶專案、版本與 planId 前段', async () => {
    const r = await preparePlan(input());
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const plan = JSON.parse(r.plan.text);
    expect(validateExecutablePlan(plan)).toEqual([]);
    expect(await verifyPlanId(plan)).toBe(true);
    expect(plan.planId).toBe(r.planId);
    expect(r.plan.name).toBe(`tin-bar-v1-${r.planId.slice(0, 12)}.plan.json`);
    expect(plan.scope).toEqual({ factoryId: 'f1', graphId: 'g1' });
    expect(plan.source).toMatchObject({ templateId: 'tin-bar', templateVersion: 1 });
  });

  it('沒有 Kit 功能對應時，節點都保留但標為不可執行並說明原因：不假裝可以開工', async () => {
    const r = await preparePlan(input());
    if (!r.ok) throw new Error('expected ok');
    expect(r.summary.nodes).toBe(2);
    expect(r.summary.notExecutable.map(n => n.name)).toEqual(['領料', '入庫']);
    expect(r.summary.notExecutable.every(n => n.reason.length > 0)).toBe(true);
  });

  it('沒有表單時不產生表單檔包，也不產生空檔', async () => {
    const r = await preparePlan(input());
    expect(r.ok && r.forms).toBeUndefined();
    expect(r.ok && r.summary.forms).toBe(0);
  });

  it('同樣輸入得到同樣的檔案內容；改版本或入庫方向就得到不同的 planId', async () => {
    const a = await preparePlan(input()), b = await preparePlan(input());
    expect(a).toEqual(b);
    const v2 = await preparePlan(input({ version: 2 }));
    const ship = await preparePlan(input({ details: { ...details, nodes: { ...details.nodes, n2: { kind: 'sink', direction: 'ship-customer', location: 'wh.fg', material: 'ingot' } } } }));
    const ids = [a, v2, ship].map(r => r.ok ? r.planId : '');
    expect(new Set(ids).size).toBe(3);
  });

  it('轉換的問題原樣帶回（節點沒設定），不會產生計畫檔', async () => {
    expect(await issues({ details: { ...details, nodes: { n1: details.nodes.n1 } } })).toEqual(['節點「入庫」還沒有設定物料流類別（領料、入庫或出庫）。']);
  });

  it('版本、識別碼、名稱不合格時先擋下，並說明怎麼改', async () => {
    expect(await issues({ version: 0 })).toEqual(['版本必須是 1 以上的整數。']);
    expect(await issues({ version: 1.5 })).toEqual(['版本必須是 1 以上的整數。']);
    expect(await issues({ projectId: '錫棒' })).toEqual(['專案識別碼只能用英文字母、數字、底線與連字號，且必須以英文字母開頭。']);
    expect(await issues({ projectName: '  ' })).toEqual(['請填寫專案名稱。']);
  });

  it('有填單節點時一併產生表單檔包，檔包通過檢查且檔名與計畫成對', async () => {
    const slip = { id: 'stock-in-slip', name: '入庫單', subject: ['lot.ingot'], fields: { lot: { label: '批號', type: 'string' as const } } };
    const withSlip: AovGraphDocument = { ...doc, graphs: [{ ...doc.graphs[0], nodes: [node('n1', '領料'), node('n3', '填入庫單'), node('n2', '入庫')], edges: [{ id: 'e1', from: 'n1', to: 'n3' }, { id: 'e2', from: 'n3', to: 'n2' }] }] };
    const r = await preparePlan(input({
      doc: withSlip, forms: { format: 'composer-form-library', version: 1, forms: [slip] },
      details: { ...details, nodes: { ...details.nodes, n3: { kind: 'fill', material: 'ingot', form: 'stock-in-slip', requires: { lot: { type: 'string' } } } } },
    }));
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.summary.forms).toBe(1);
    expect(r.forms?.name).toBe(r.plan.name.replace('.plan.json', '.forms.json'));
    expect(await checkFormBundle(JSON.parse(r.forms!.text))).toEqual([]);
    const plan = JSON.parse(r.plan.text);
    expect(JSON.parse(r.forms!.text).forms[0].contentSha256).toBe(plan.nodes.find((n: any) => n.nodeId === 'n3').form.contentSha256);
  });
});
