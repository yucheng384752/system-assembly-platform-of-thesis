import { describe, expect, test } from 'vitest';
import { schemas } from '../../../libs/ui-runtime/schema';
import { parseActionCatalog } from '../../../libs/ui-runtime/registry';
import actionData from '../../../config/actions.json';
import { importAov, type AovDocument } from './workflow';
import type { FormField } from './localData';
import {
  emptyGraph, exportAovGraph, graphActionIds, graphDepths, graphErrors, importAovGraph, importWorkflow, integrityErrors, isIsoDate,
  listToGraph, nodeErrors, nodeOfForm, orderedNodes, suggestActions, validationError, type AovGraphDocument, type GraphNode,
} from './workflowGraph';
import { actionCatalog } from './workflow';

const field = (id: string, name: string, type: FormField['type'] = 'text', isKey = false): FormField => ({ id, name, type, required: true, isKey });
const node = (id: string, name: string, extra: Partial<GraphNode> = {}): GraphNode =>
  ({ id, name, when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null, ...extra });

// Three levels: main flow, a sub-flow of 收料, and a detail flow of the sub-flow's node. 追溯 needs a confirmed relation.
function sample(): AovGraphDocument {
  return {
    format: 'composer-aov-list', version: 4, rootGraphId: 'graph-root',
    graphs: [
      { id: 'graph-root', name: '主流程', nodes: [
        node('node-1', '收料', { actionId: 'define-form', formId: 'form-1', childGraphId: 'graph-sub' }),
        node('node-2', '檢驗', { actionId: 'import-records', formId: 'form-2', params: { allowDuplicate: true } }),
        node('node-3', '追溯', { actionId: 'trace-records', formId: 'form-3' }),
      ], edges: [{ id: 'edge-1', from: 'node-1', to: 'node-2' }, { id: 'edge-2', from: 'node-2', to: 'node-3' }] },
      { id: 'graph-sub', name: '收料作業', nodes: [node('node-4', '點收', { childGraphId: 'graph-detail' })], edges: [] },
      { id: 'graph-detail', name: '點收細項', nodes: [node('node-5', '核對數量'), node('node-6', '拍照存證')], edges: [{ id: 'edge-3', from: 'node-5', to: 'node-6' }] },
    ],
    layout: { 'graph-root': { 'node-1': { x: 0, y: 0 }, 'node-2': { x: 160, y: 0 }, 'node-3': { x: 320, y: 0 } } },
    forms: [
      { id: 'form-1', name: '收料單', fields: [field('field-1', '批號', 'text', true), field('field-2', '數量', 'integer')] },
      { id: 'form-2', name: '檢驗單', fields: [field('field-1', '批號', 'text', true)] },
      { id: 'form-3', name: '追溯單', fields: [field('field-1', '批號', 'text', true)] },
    ],
    relations: [{ id: 'relation-1', kind: 'shared-key', from: { formId: 'form-1', fieldId: 'field-1' }, to: { formId: 'form-3', fieldId: 'field-1' }, origin: 'user', confirmed: true }],
  };
}

describe('D70/D71: 圖形文件的結構規範', () => {
  test('範例文件在結構與完成度上都沒有問題，深度為 1、2、3', () => {
    const doc = sample();
    expect(integrityErrors(doc)).toEqual([]);
    expect(graphErrors(doc)).toEqual([]);
    expect([...graphDepths(doc)]).toEqual([['graph-root', 1], ['graph-sub', 2], ['graph-detail', 3]]);
  });

  // The limit exists so parsing stays bounded: a fourth level must be refused, never truncated.
  test('第 3 層的節點不可再有子流程', () => {
    const doc = sample();
    doc.graphs.push({ id: 'graph-4', name: '第四層', nodes: [node('node-7', '再往下')], edges: [] });
    doc.graphs[2].nodes[0].childGraphId = 'graph-4';
    expect(integrityErrors(doc)).toEqual(['節點「核對數量」不可再有子流程：流程最多 3 層。']);
  });

  test.each([
    ['子流程被兩個節點共用', (d: AovGraphDocument) => { d.graphs[0].nodes[2].childGraphId = 'graph-sub'; }, '被多個節點引用，子流程不可共用'],
    ['主流程被當成子流程', (d: AovGraphDocument) => { d.graphs[2].nodes[0].childGraphId = 'graph-root'; }, '主流程不可作為其他節點的子流程'],
    ['子流程沒有被任何節點引用', (d: AovGraphDocument) => { d.graphs.push({ id: 'graph-x', name: '孤兒', nodes: [], edges: [] }); }, '無法從主流程到達'],
    ['兩個子流程互相引用而脫離主流程', (d: AovGraphDocument) => {
      d.graphs.push({ id: 'graph-a', name: 'A', nodes: [node('node-a', 'a', { childGraphId: 'graph-b' })], edges: [] },
        { id: 'graph-b', name: 'B', nodes: [node('node-b', 'b', { childGraphId: 'graph-a' })], edges: [] });
    }, '無法從主流程到達'],
    ['引用不存在的子流程', (d: AovGraphDocument) => { d.graphs[1].nodes[0].childGraphId = 'graph-nope'; }, '引用的子流程不存在'],
    ['連線跨越子流程', (d: AovGraphDocument) => { d.graphs[0].edges.push({ id: 'edge-9', from: 'node-1', to: 'node-4' }); }, '不在此子流程的節點'],
    ['節點連到自己', (d: AovGraphDocument) => { d.graphs[0].edges.push({ id: 'edge-9', from: 'node-1', to: 'node-1' }); }, '連到自己'],
    ['重複的連線', (d: AovGraphDocument) => { d.graphs[0].edges.push({ id: 'edge-9', from: 'node-1', to: 'node-2' }); }, '重複的連線'],
    ['連線形成循環（迴圈在 AoV 沒有意義，D18）', (d: AovGraphDocument) => { d.graphs[0].edges.push({ id: 'edge-9', from: 'node-3', to: 'node-1' }); }, '形成循環'],
    ['識別碼重複', (d: AovGraphDocument) => { d.graphs[1].nodes[0].id = 'node-1'; }, '節點的識別碼重複'],
    ['同一張表單屬於兩個節點', (d: AovGraphDocument) => { d.graphs[0].nodes[2].formId = 'form-2'; }, '不可屬於多個節點'],
    ['引用不存在的表單', (d: AovGraphDocument) => { d.graphs[0].nodes[0].formId = 'form-9'; }, '引用的表單不存在'],
    ['引用不存在的動作', (d: AovGraphDocument) => { d.graphs[0].nodes[0].actionId = 'no-such-action'; }, '不存在的動作'],
    ['設定了動作沒有的參數', (d: AovGraphDocument) => { d.graphs[0].nodes[0].params = { unknown: 1 }; }, '動作沒有的參數'],
    ['沒有動作卻有參數', (d: AovGraphDocument) => { d.graphs[1].nodes[0].params = { flowCode: 'x' }; }, '沒有動作，不可設定參數'],
    ['參數型別不正確', (d: AovGraphDocument) => { d.graphs[0].nodes[1].params = { allowDuplicate: 'yes' }; }, '型別不正確'],
    ['版面含有不存在的節點', (d: AovGraphDocument) => { d.layout['graph-root']['node-9'] = { x: 0, y: 0 }; }, '版面含有不存在的節點'],
    ['關聯引用不存在的欄位', (d: AovGraphDocument) => { d.relations[0].to.fieldId = 'field-9'; }, '關聯引用的表單或欄位不存在'],
  ])('結構錯誤被擋下：%s', (_name, mutate, message) => {
    const doc = sample(); mutate(doc);
    expect(integrityErrors(doc)[0]).toContain(message);
  });

  test('同一個動作可出現在不同節點與不同層，Kit 推導取聯集', () => {
    const doc = sample();
    doc.graphs[2].nodes[1].actionId = 'trace-records';
    doc.graphs[2].nodes[0].actionId = 'define-form';
    expect(graphActionIds(doc)).toEqual(['define-form', 'import-records', 'trace-records']);
    expect(graphActionIds(emptyGraph)).toEqual([]);
  });
});

describe('D72: 欄位驗證規則', () => {
  test.each([
    ['整數的最小值不是整數', { ...field('f', '數量', 'integer'), validation: { minimum: 1.5 } }, '必須是整數'],
    ['最小值大於最大值', { ...field('f', '數量', 'decimal'), validation: { minimum: 5, maximum: 1 } }, '最小值不可大於最大值'],
    ['文字欄位套用數值規則', { ...field('f', '名稱', 'text'), validation: { minimum: 1 } }, '型別不支援'],
    ['是／否欄位沒有規則可用', { ...field('f', '合格', 'boolean'), validation: { maxLength: 3 } }, '型別不支援'],
    ['日期欄位套用數值規則', { ...field('f', '日期', 'date'), validation: { maximum: 3 } }, '型別不支援'],
    ['不存在的日期', { ...field('f', '日期', 'date'), validation: { minimumDate: '2026-02-30' } }, 'ISO 日期'],
    ['月份超出範圍', { ...field('f', '日期', 'date'), validation: { maximumDate: '2026-13-01' } }, 'ISO 日期'],
    ['最早日期晚於最晚日期', { ...field('f', '日期', 'date'), validation: { minimumDate: '2026-06-01', maximumDate: '2026-01-01' } }, '最早日期不可晚於最晚日期'],
  ])('規則自相矛盾被指出：%s', (_name, f, message) => {
    expect(validationError(f)).toContain(message);
  });

  test('合法的規則不報錯', () => {
    for (const f of [
      { ...field('f', '數量', 'integer'), validation: { minimum: 0, maximum: 100 } },
      { ...field('f', '重量', 'decimal'), validation: { minimum: 0.5 } },
      { ...field('f', '等級', 'text'), validation: { maxLength: 10, allowedValues: ['A', 'B'] } },
      { ...field('f', '日期', 'date'), validation: { minimumDate: '2028-02-29', maximumDate: '2028-12-31' } },
      field('f', '無規則'),
    ]) expect(validationError(f)).toBe('');
  });

  // ISO 8601 calendar date: right shape and a date that exists (D72).
  test.each([['2028-02-29', true], ['2026-02-29', false], ['2026-04-31', false], ['2026-2-1', false], ['2026/01/01', false], ['26-01-01', false], ['2026-01-01T00:00:00Z', false]])('isIsoDate(%s)', (text, expected) => {
    expect(isIsoDate(text)).toBe(expected);
  });

  test('錯誤的規則在表單上顯示為完成度錯誤，且擋下匯出', () => {
    const doc = sample();
    doc.forms[0].fields[1].validation = { minimum: 10, maximum: 1 };
    expect(integrityErrors(doc)).toEqual([]);
    expect(graphErrors(doc)).toEqual(['節點「收料」的表單「收料單」的欄位「數量」的最小值不可大於最大值。']);
    expect(() => exportAovGraph(doc)).toThrow('流程規格尚未完成');
  });

  test('契約擋下非 ISO 日期字串與未知規則', () => {
    const doc = sample();
    doc.forms[0].fields.push({ ...field('field-3', '到貨日', 'date'), validation: { minimumDate: '2026/01/01' } });
    expect(schemas.aov(JSON.parse(JSON.stringify(doc)))).toBe(false);
    const unknown = sample();
    (unknown.forms[0].fields[0] as FormField & { validation: Record<string, unknown> }).validation = { pattern: '^a' };
    expect(schemas.aov(JSON.parse(JSON.stringify(unknown)))).toBe(false);
  });
});

describe('順序、表單歸屬與建議', () => {
  test('節點依連線先後排列，子流程緊接在所屬節點之後，並帶有層級', () => {
    expect(orderedNodes(sample()).map(({ node, depth }) => `${depth}:${node.id}`))
      .toEqual(['1:node-1', '2:node-4', '3:node-5', '3:node-6', '1:node-2', '1:node-3']);
  });

  // The stored order is only a tiebreaker; edges win, so "earlier" really means "before" in the workflow.
  test('連線優先於儲存順序，沒有連線的節點維持儲存順序', () => {
    const doc = sample();
    doc.graphs[0].nodes.reverse();
    expect(orderedNodes(doc).filter(e => e.depth === 1).map(e => e.node.id)).toEqual(['node-1', 'node-2', 'node-3']);
    doc.graphs[0].edges = [];
    expect(orderedNodes(doc).filter(e => e.depth === 1).map(e => e.node.id)).toEqual(['node-3', 'node-2', 'node-1']);
  });

  test('排序遇到壞資料也不會卡住或遺漏節點', () => {
    const doc = sample();
    doc.graphs[0].edges.push({ id: 'edge-9', from: 'node-3', to: 'node-1' });
    doc.graphs[2].nodes[0].childGraphId = 'graph-root';
    expect(orderedNodes(doc).map(e => e.node.id).sort()).toEqual(['node-1', 'node-2', 'node-3', 'node-4', 'node-5', 'node-6']);
  });

  test('表單屬於擁有它的節點，沒有擁有者時為空', () => {
    expect(nodeOfForm(sample(), 'form-2')?.name).toBe('檢驗');
    expect(nodeOfForm(sample(), 'form-9')).toBeUndefined();
  });

  test('有已確認的關聯而還沒有查詢追溯節點時建議加入；已有（任何層）或沒有關聯則不建議', () => {
    const doc = sample();
    doc.graphs[0].nodes[2].actionId = null;
    expect(suggestActions(doc)).toEqual([{ actionId: 'trace-records', reason: '已確認 1 條表單關聯，可加入「查詢追溯」節點，以關聯欄位查詢前後步驟的紀錄。' }]);
    doc.graphs[2].nodes[0].actionId = 'trace-records';
    expect(suggestActions(doc)).toEqual([]);
    doc.graphs[2].nodes[0].actionId = null;
    doc.relations = [];
    expect(suggestActions(doc)).toEqual([]);
  });
});

describe('D73: 節點完成條件', () => {
  const find = (doc: AovGraphDocument, id: string) => doc.graphs.flatMap(g => g.nodes).find(n => n.id === id)!;

  test('動作需要的標準表單與關聯缺少時，逐項指出', () => {
    const doc = sample();
    find(doc, 'node-1').formId = null;
    expect(nodeErrors(doc, find(doc, 'node-1'))).toEqual(['節點「收料」的動作「建立表單」需要一張已建立欄位的標準表單。']);
    doc.relations = [];
    expect(nodeErrors(doc, find(doc, 'node-3'))).toEqual(['節點「追溯」的動作「查詢追溯」需要表單至少有一條已確認的關聯。']);
  });

  test('必填參數未填時指出；沒填但有預設值就用預設值', () => {
    const doc = sample();
    expect(find(doc, 'node-3').params).toEqual({});
    expect(nodeErrors(doc, find(doc, 'node-3'))).toEqual([]);
    find(doc, 'node-3').params = { flowCode: '   ' };
    expect(nodeErrors(doc, find(doc, 'node-3'))).toEqual(['節點「追溯」的「流程代碼」尚未填寫。']);
  });

  // The catalog has no numeric parameter yet, so one is added for this test only.
  test('數值參數超出範圍時指出', () => {
    const action = actionCatalog.actions.find(a => a.id === 'define-form')!;
    action.parameters.push({ id: 'limit', name: '上限', type: 'number', required: true, minimum: 1, maximum: 10 });
    try {
      const doc = sample();
      const target = find(doc, 'node-1');
      expect(nodeErrors(doc, target)).toEqual(['節點「收料」的「上限」尚未填寫。']);
      target.params = { limit: 11 };
      expect(nodeErrors(doc, target)).toEqual(['節點「收料」的「上限」須介於 1 與 10。']);
      target.params = { limit: 10 };
      expect(nodeErrors(doc, target)).toEqual([]);
    } finally { action.parameters.pop(); }
  });

  test('純業務節點不需要任何條件，但表單必須有節點', () => {
    const doc = sample();
    expect(nodeErrors(doc, find(doc, 'node-4'))).toEqual([]);
    find(doc, 'node-3').formId = null;
    expect(graphErrors(doc)).toContain('表單「追溯單」尚未指派給任何節點。');
  });

  test('空的主流程要求至少一個節點', () => {
    expect(graphErrors(emptyGraph)).toEqual(['請至少建立一個節點。']);
  });

  test('動作目錄的參數定義自相矛盾時整份目錄被拒絕', () => {
    const withParameter = (parameter: object) => ({ ...actionData, actions: [{ ...actionData.actions[0], parameters: [parameter] }] });
    const ok = { id: 'p', name: 'P', type: 'number', required: false };
    expect(() => parseActionCatalog(withParameter({ ...ok, minimum: 1, maximum: 5, default: 3 }))).not.toThrow();
    expect(() => parseActionCatalog(withParameter({ ...ok, minimum: 5, maximum: 1 }))).toThrow('最小值大於最大值');
    expect(() => parseActionCatalog(withParameter({ ...ok, default: 'x' }))).toThrow('預設值型別');
    expect(() => parseActionCatalog(withParameter({ ...ok, minimum: 1, maximum: 5, default: 9 }))).toThrow('預設值超出範圍');
    expect(() => parseActionCatalog(withParameter({ ...ok, type: 'text', minimum: 1 }))).toThrow('不是數值');
    expect(() => parseActionCatalog({ ...actionData, actions: [{ ...actionData.actions[0], parameters: [ok, ok] }] })).toThrow('重複');
  });
});

describe('匯入與匯出', () => {
  test('匯出再匯入得到相同文件，且不寫入任何 Kit 資料', () => {
    const doc = sample();
    doc.forms[0].fields[1].validation = { minimum: 0, maximum: 999 };
    doc.forms[0].fields.push({ ...field('field-3', '到貨日', 'date'), validation: { minimumDate: '2026-01-01', maximumDate: '2026-12-31' } });
    const text = exportAovGraph(doc);
    expect(importAovGraph(text).value).toEqual(doc);
    expect(JSON.parse(text).version).toBe(4);
    expect(text).not.toMatch(/Kit|capability|requires/i);
  });

  test('結構錯誤的文件整份拒絕並保留原流程', () => {
    const doc = sample(); doc.graphs[0].nodes[2].childGraphId = 'graph-sub';
    expect(() => importAovGraph(JSON.stringify(doc))).toThrow('子流程不可共用。原流程已保留。');
    expect(() => importAovGraph('{"nope":1}')).toThrow('原流程已保留');
  });

  test('目前的列表編輯畫面遇到 version 4 明確回報尚未支援', () => {
    expect(() => importAov(JSON.stringify(sample()))).toThrow('尚未支援。原流程已保留。');
  });
});

describe('D75: 舊格式轉為 version 4', () => {
  const step = (id: string, name: string, formIds: string[], actions: AovDocument['steps'][number]['actions'] = []) => ({ id, name, when: `${name}時`, owner: '品管', formIds, actions });
  const v3 = (steps: AovDocument['steps'], forms: AovDocument['forms'] = []): AovDocument => ({ format: 'composer-aov-list', version: 3, steps, forms, relations: [] });
  const forms = [{ id: 'form-1', name: '收料單', fields: [field('field-1', '批號', 'text', true)] }, { id: 'form-2', name: '檢驗單', fields: [field('field-1', '批號', 'text', true)] }];
  const nodesOf = (doc: AovGraphDocument) => doc.graphs[0].nodes;

  test('單一動作加單一表單的步驟成為一個節點，沿用步驟名稱、時機與職務', () => {
    const { value, notices } = listToGraph(v3([step('step-1', '收料', ['form-1'], [{ actionId: 'define-form', formIds: ['form-1'] }])], [forms[0]]));
    expect(notices).toEqual([]);
    expect(nodesOf(value)).toEqual([node('node-1', '收料', { when: '收料時', owner: '品管', actionId: 'define-form', formId: 'form-1' })]);
    expect(integrityErrors(value)).toEqual([]);
  });

  test('步驟依序展開並以連線串接，含沒有動作的步驟', () => {
    const { value } = listToGraph(v3([step('step-1', '收料', []), step('step-2', '出貨', [])]));
    expect(nodesOf(value).map(n => [n.name, n.actionId])).toEqual([['收料', null], ['出貨', null]]);
    expect(value.graphs[0].edges).toEqual([{ id: 'edge-1', from: 'node-1', to: 'node-2' }]);
    expect(value.layout['graph-root']['node-2']).toEqual({ x: 160, y: 0 });
  });

  // One node holds one form, so an action over several forms cannot convert losslessly; the user must be told.
  test('動作作用於多張表單時列出提示，其餘表單各成一個沒有動作的節點，沒有表單遺失', () => {
    const { value, notices } = listToGraph(v3([step('step-1', '收料', ['form-1', 'form-2'], [{ actionId: 'import-records', formIds: ['form-1', 'form-2'] }])], forms));
    expect(notices).toEqual(['步驟「收料」的動作「匯入紀錄」原本作用於 2 張表單，節點只能有一張表單；第一張歸此節點，其餘各成一個沒有動作的節點。']);
    expect(nodesOf(value).map(n => [n.name, n.actionId, n.formId])).toEqual([['收料：匯入紀錄', 'import-records', 'form-1'], ['收料：檢驗單', null, 'form-2']]);
    expect(integrityErrors(value)).toEqual([]);
    expect(value.forms.map(f => f.id)).toEqual(['form-1', 'form-2']);
  });

  test('只有表單的步驟是單一節點；有動作但沒有表單的動作節點也保留', () => {
    const { value } = listToGraph(v3([step('step-1', '收料', ['form-1'], []), step('step-2', '追溯', [], [{ actionId: 'trace-records', formIds: [] }])], [forms[0]]));
    expect(nodesOf(value).map(n => [n.name, n.actionId, n.formId])).toEqual([['收料', null, 'form-1'], ['追溯', 'trace-records', null]]);
  });

  test('節點超過上限時明確失敗，不截斷', () => {
    const steps = Array.from({ length: 101 }, (_, i) => step(`step-${i + 1}`, `步驟${i + 1}`, []));
    expect(() => listToGraph(v3(steps))).toThrow('超過單一流程 100 個節點的上限');
  });

  test('importWorkflow 對 version 1、2、3、4 都回傳 version 4 並合併提示', () => {
    const v1 = { format: 'composer-aov-list', version: 1, steps: [{ id: 'a', name: '檢查', when: '', owner: '', formId: 'form-1' }] };
    const fromV1 = importWorkflow(JSON.stringify(v1));
    expect(fromV1.value.version).toBe(4);
    expect(fromV1.notices).toEqual(['舊版流程規格不含表單定義，已清除以下步驟的表單指派：「檢查」。']);
    const v2 = { format: 'composer-aov-list', version: 2, steps: [{ id: 'a', name: '收料', when: '', owner: '', formIds: ['form-1'] }], forms: [forms[0]], relations: [] };
    expect(nodesOf(importWorkflow(JSON.stringify(v2)).value).map(n => n.formId)).toEqual(['form-1']);
    const text = exportAovGraph(sample());
    expect(importWorkflow(text).value).toEqual(sample());
    expect(() => importWorkflow('not json')).toThrow('原流程已保留');
  });
});
