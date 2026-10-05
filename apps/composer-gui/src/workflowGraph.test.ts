import { describe, expect, test } from 'vitest';
import { schemas } from '../../../libs/ui-runtime/schema';
import { parseActionCatalog } from '../../../libs/ui-runtime/registry';
import actionData from '../../../config/actions.json';
import { importAov, type AovDocument } from './workflow';
import type { FormField } from './localData';
import {
  emptyGraph, exportAovGraph, graphActionIds, graphDepths, graphErrors, importAovGraph, importWorkflow, integrityErrors, isIsoDate,
  listToGraph, newGraphParts, nodeErrors, nodeOfForm, nodePlace, orderedNodes, suggestActions, validationError,
  type AovGraphDocument, type Graph, type GraphNode,
} from './workflowGraph';
import { actionCatalog } from './workflow';

const field = (id: string, name: string, type: FormField['type'] = 'text', isKey = false): FormField => ({ id, name, type, required: true, isKey });
const node = (id: string, name: string, extra: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind: 'node', name, when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null, ...extra });
// A graph with its start and end (D80): the start leads to every node nothing else leads to, every node that leads nowhere reaches the end.
function graph(id: string, name: string, nodes: GraphNode[], between: [string, string][] = []): Graph {
  const [start, end] = newGraphParts(id, name).graph.nodes;
  const heads = nodes.filter(n => !between.some(([, to]) => to === n.id)); const tails = nodes.filter(n => !between.some(([from]) => from === n.id));
  const pairs: [string, string][] = [...heads.map(n => [start.id, n.id] as [string, string]), ...between, ...tails.map(n => [n.id, end.id] as [string, string])];
  return { id, name, nodes: [start, ...nodes, end], edges: pairs.map(([from, to], i) => ({ id: `${id}-edge-${i + 1}`, from, to })) };
}
const at = (doc: AovGraphDocument, id: string) => doc.graphs.flatMap(g => g.nodes).find(n => n.id === id)!;
const graphOf = (doc: AovGraphDocument, id: string) => doc.graphs.find(g => g.id === id)!;

// One factory with a production logic and two sub-levels, so the depths are 1, 2 and 3. 追溯 needs a confirmed relation.
function sample(): AovGraphDocument {
  return {
    format: 'composer-aov-list', version: 5, factories: [{ id: 'factory-1', name: 'A 廠', logicGraphIds: ['graph-root'] }],
    graphs: [
      graph('graph-root', '錫膏流程', [
        node('node-1', '收料', { actionId: 'define-form', formId: 'form-1', childGraphId: 'graph-sub' }),
        node('node-2', '檢驗', { actionId: 'import-records', formId: 'form-2', params: { allowDuplicate: true } }),
        node('node-3', '追溯', { actionId: 'trace-records', formId: 'form-3' }),
      ], [['node-1', 'node-2'], ['node-2', 'node-3']]),
      graph('graph-sub', '收料作業', [node('node-4', '點收', { childGraphId: 'graph-detail' })]),
      graph('graph-detail', '點收細項', [node('node-5', '核對數量'), node('node-6', '拍照存證')], [['node-5', 'node-6']]),
    ],
    layout: { 'graph-root': { 'node-1': { x: 120, y: 0 }, 'node-2': { x: 240, y: 0 }, 'node-3': { x: 360, y: 0 } } },
    forms: [
      { id: 'form-1', name: '收料單', fields: [field('field-1', '批號', 'text', true), field('field-2', '數量', 'integer')] },
      { id: 'form-2', name: '檢驗單', fields: [field('field-1', '批號', 'text', true)] },
      { id: 'form-3', name: '追溯單', fields: [field('field-1', '批號', 'text', true)] },
    ],
    relations: [{ id: 'relation-1', kind: 'shared-key', from: { formId: 'form-1', fieldId: 'field-1' }, to: { formId: 'form-3', fieldId: 'field-1' }, origin: 'user', confirmed: true }],
  };
}
// The same document with a second factory that owns one more form.
function twoFactories(): AovGraphDocument {
  const doc = sample();
  doc.factories.push({ id: 'factory-2', name: 'B 廠', logicGraphIds: ['graph-b'] });
  doc.graphs.push(graph('graph-b', '包裝流程', [node('node-7', '包裝', { formId: 'form-4' })]));
  doc.forms.push({ id: 'form-4', name: '包裝單', fields: [field('field-1', '批號', 'text', true)] });
  return doc;
}

describe('D70/D71/D78: 圖形文件的結構規範', () => {
  test('範例文件在結構與完成度上都沒有問題，深度為 1、2、3', () => {
    const doc = sample();
    expect(integrityErrors(doc)).toEqual([]);
    expect(graphErrors(doc)).toEqual([]);
    expect([...graphDepths(doc)]).toEqual([['graph-root', 1], ['graph-sub', 2], ['graph-detail', 3]]);
  });

  // The limit exists so parsing stays bounded: a fourth level must be refused, never truncated.
  test('第 3 層的節點不可再有子流程；工廠不算層', () => {
    const doc = sample();
    doc.graphs.push(graph('graph-4', '第四層', [node('node-7', '再往下')]));
    at(doc, 'node-5').childGraphId = 'graph-4';
    expect(integrityErrors(doc)).toEqual(['節點「核對數量」不可再有子流程：流程最多 3 層。']);
  });

  test.each([
    ['子流程被兩個節點共用', (d: AovGraphDocument) => { at(d, 'node-3').childGraphId = 'graph-sub'; }, '被多個節點引用，子流程不可共用'],
    ['生產邏輯被當成子流程', (d: AovGraphDocument) => { at(d, 'node-5').childGraphId = 'graph-root'; }, '生產邏輯不可作為其他節點的子流程'],
    ['子流程沒有被任何節點引用', (d: AovGraphDocument) => { d.graphs.push(graph('graph-x', '孤兒', [])); }, '無法從任何生產邏輯到達'],
    ['兩個子流程互相引用而脫離生產邏輯', (d: AovGraphDocument) => {
      d.graphs.push(graph('graph-a', 'A', [node('node-a', 'a', { childGraphId: 'graph-b' })]), graph('graph-b', 'B', [node('node-b', 'b', { childGraphId: 'graph-a' })]));
    }, '無法從任何生產邏輯到達'],
    ['引用不存在的子流程', (d: AovGraphDocument) => { at(d, 'node-4').childGraphId = 'graph-nope'; }, '引用的子流程不存在'],
    ['連線跨越子流程', (d: AovGraphDocument) => { graphOf(d, 'graph-root').edges.push({ id: 'edge-9', from: 'node-1', to: 'node-4' }); }, '不在此子流程的節點'],
    ['節點連到自己', (d: AovGraphDocument) => { graphOf(d, 'graph-root').edges.push({ id: 'edge-9', from: 'node-1', to: 'node-1' }); }, '連到自己'],
    ['重複的連線', (d: AovGraphDocument) => { graphOf(d, 'graph-root').edges.push({ id: 'edge-9', from: 'node-1', to: 'node-2' }); }, '重複的連線'],
    ['連線形成循環（迴圈在 AoV 沒有意義，D18）', (d: AovGraphDocument) => { graphOf(d, 'graph-root').edges.push({ id: 'edge-9', from: 'node-3', to: 'node-1' }); }, '形成循環'],
    ['識別碼重複', (d: AovGraphDocument) => { at(d, 'node-4').id = 'node-1'; }, '節點的識別碼重複'],
    ['同一張表單屬於兩個節點', (d: AovGraphDocument) => { at(d, 'node-3').formId = 'form-2'; }, '不可屬於多個節點'],
    ['引用不存在的表單', (d: AovGraphDocument) => { at(d, 'node-1').formId = 'form-9'; }, '引用的表單不存在'],
    ['引用不存在的動作', (d: AovGraphDocument) => { at(d, 'node-1').actionId = 'no-such-action'; }, '不存在的動作'],
    ['設定了動作沒有的參數', (d: AovGraphDocument) => { at(d, 'node-1').params = { unknown: 1 }; }, '動作沒有的參數'],
    ['沒有動作卻有參數', (d: AovGraphDocument) => { at(d, 'node-4').params = { flowCode: 'x' }; }, '沒有動作，不可設定參數'],
    ['參數型別不正確', (d: AovGraphDocument) => { at(d, 'node-2').params = { allowDuplicate: 'yes' }; }, '型別不正確'],
    ['版面含有不存在的節點', (d: AovGraphDocument) => { d.layout['graph-root']['node-9'] = { x: 0, y: 0 }; }, '版面含有不存在的節點'],
    ['關聯引用不存在的欄位', (d: AovGraphDocument) => { d.relations[0].to.fieldId = 'field-9'; }, '關聯引用的表單或欄位不存在'],
    ['工廠引用不存在的生產邏輯', (d: AovGraphDocument) => { d.factories[0].logicGraphIds.push('graph-nope'); }, '引用的生產邏輯不存在'],
    ['同一個生產邏輯被兩個工廠列出', (d: AovGraphDocument) => { d.factories.push({ id: 'factory-2', name: 'B 廠', logicGraphIds: ['graph-root'] }); }, '生產邏輯的識別碼重複'],
    ['工廠識別碼重複', (d: AovGraphDocument) => { d.factories.push({ id: 'factory-1', name: 'B 廠', logicGraphIds: [] }); }, '工廠的識別碼重複'],
  ])('結構錯誤被擋下：%s', (_name, mutate, message) => {
    const doc = sample(); mutate(doc);
    expect(integrityErrors(doc)[0]).toContain(message);
  });

  test('同一個動作可出現在不同節點、不同層與不同工廠，Kit 推導取聯集', () => {
    const doc = twoFactories();
    at(doc, 'node-6').actionId = 'trace-records';
    at(doc, 'node-5').actionId = 'define-form';
    at(doc, 'node-7').actionId = 'link-forms';
    expect(graphActionIds(doc)).toEqual(['define-form', 'import-records', 'trace-records', 'link-forms']);
    expect(graphActionIds(emptyGraph)).toEqual([]);
  });
});

describe('D80: 開始與結束', () => {
  test('每張圖建立時就有各一個開始與結束，開始在前、結束在後', () => {
    const { graph: made, layout } = newGraphParts('graph-1', '生產邏輯 1');
    expect(made.nodes.map(n => [n.kind, n.name])).toEqual([['start', '開始'], ['end', '結束']]);
    expect(layout['graph-1-start'].x).toBeLessThan(layout['graph-1-end'].x);
  });

  test.each([
    ['缺少結束', (d: AovGraphDocument) => { const g = graphOf(d, 'graph-sub'); g.nodes = g.nodes.filter(n => n.kind !== 'end'); g.edges = g.edges.filter(e => e.to !== 'graph-sub-end'); }, '必須剛好有一個開始與一個結束'],
    ['兩個開始', (d: AovGraphDocument) => { graphOf(d, 'graph-sub').nodes.push({ ...node('extra-start', '開始'), kind: 'start' }); }, '必須剛好有一個開始與一個結束'],
    ['開始有前置連線', (d: AovGraphDocument) => {
      const g = graphOf(d, 'graph-root'); g.nodes.push(node('node-9', '孤立')); g.edges.push({ id: 'edge-9', from: 'node-9', to: 'graph-root-start' });
    }, '開始不可有前置連線'],
    ['結束有後續連線', (d: AovGraphDocument) => {
      const g = graphOf(d, 'graph-root'); g.nodes.push(node('node-9', '孤立')); g.edges.push({ id: 'edge-9', from: 'graph-root-end', to: 'node-9' });
    }, '結束不可有後續連線'],
    ['開始帶有動作', (d: AovGraphDocument) => { at(d, 'graph-root-start').actionId = 'define-form'; }, '不可設定動作、參數、表單或子流程'],
    ['結束帶有子流程', (d: AovGraphDocument) => { d.graphs.push(graph('graph-extra', '額外', [node('node-8', '額外節點')])); at(d, 'graph-sub-end').childGraphId = 'graph-extra'; }, '不可設定動作、參數、表單或子流程'],
  ])('結構錯誤被擋下：%s', (_name, mutate, message) => {
    const doc = sample(); mutate(doc);
    expect(integrityErrors(doc)[0]).toContain(message);
  });

  // The path rule is a completeness problem the user can fix on the canvas, so it is shown, not rejected on import.
  test('每個一般節點都要在開始到結束的路徑上，否則指出節點與缺少的一端', () => {
    const doc = sample();
    graphOf(doc, 'graph-root').nodes.push(node('node-9', '孤立'));
    expect(integrityErrors(doc)).toEqual([]);
    expect(graphErrors(doc)).toEqual(['節點「孤立」尚未接到開始與結束。']);
    graphOf(doc, 'graph-root').edges.push({ id: 'edge-9', from: 'graph-root-start', to: 'node-9' });
    expect(graphErrors(doc)).toEqual(['節點「孤立」尚未接到結束。']);
    graphOf(doc, 'graph-root').edges.push({ id: 'edge-10', from: 'node-9', to: 'graph-root-end' });
    expect(graphErrors(doc)).toEqual([]);
  });

  test('只有開始與結束的圖不算完成：需要至少一個一般節點', () => {
    const doc = sample();
    doc.graphs[1] = graph('graph-sub', '收料作業', []);
    expect(graphErrors(doc)).toContain('「收料作業」尚未建立節點。');
  });
});

describe('D78/D79: 工廠與生產邏輯的完成度', () => {
  test('還沒有工廠、工廠沒有生產邏輯、工廠或生產邏輯沒有名稱時分別指出', () => {
    expect(graphErrors(emptyGraph)).toEqual(['請先建立工廠與生產邏輯。']);
    const bare: AovGraphDocument = { ...emptyGraph, factories: [{ id: 'factory-1', name: 'A 廠', logicGraphIds: [] }] };
    expect(graphErrors(bare)).toEqual(['工廠「A 廠」尚未建立生產邏輯。']);
    const unnamed = sample(); unnamed.factories[0].name = ' '; graphOf(unnamed, 'graph-root').name = '';
    expect(graphErrors(unnamed)).toEqual(['有工廠尚未命名。', '有生產邏輯或子流程尚未命名。']);
  });

  test('一個工廠可有多個生產邏輯，工廠只是容器：深度仍由生產邏輯算起', () => {
    const doc = twoFactories();
    doc.factories[0].logicGraphIds.push('graph-c');
    doc.graphs.push(graph('graph-c', '焊接流程', [node('node-8', '焊接')]));
    expect(integrityErrors(doc)).toEqual([]);
    expect(graphErrors(doc)).toEqual([]);
    expect(graphDepths(doc).get('graph-c')).toBe(1);
    expect(graphDepths(doc).get('graph-b')).toBe(1);
  });

  // D81: forms of different factories are not linked; the editor offers no such candidate and an imported file is refused.
  test('關聯不可跨工廠，同一工廠內的不同生產邏輯之間可以', () => {
    const cross = twoFactories();
    cross.relations.push({ id: 'relation-2', kind: 'shared-key', from: { formId: 'form-1', fieldId: 'field-1' }, to: { formId: 'form-4', fieldId: 'field-1' }, origin: 'user', confirmed: true });
    expect(integrityErrors(cross)).toEqual(['關聯不可跨工廠：「收料單」與「包裝單」屬於不同的工廠。']);
    const same = twoFactories();
    same.factories[0].logicGraphIds.push('graph-b'); same.factories.pop();
    same.relations.push({ id: 'relation-2', kind: 'shared-key', from: { formId: 'form-1', fieldId: 'field-1' }, to: { formId: 'form-4', fieldId: 'field-1' }, origin: 'user', confirmed: true });
    expect(integrityErrors(same)).toEqual([]);
  });

  test('節點的所在工廠與生產邏輯可查，供功能推導的原因說明使用', () => {
    const doc = twoFactories();
    expect([nodePlace(doc, 'node-5')?.factory.name, nodePlace(doc, 'node-5')?.logic.name]).toEqual(['A 廠', '錫膏流程']);
    expect(nodePlace(doc, 'node-7')?.factory.name).toBe('B 廠');
    expect(nodePlace(doc, 'node-99')).toBeUndefined();
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
  const real = (doc: AovGraphDocument) => orderedNodes(doc).filter(e => e.node.kind === 'node');
  test('節點依連線先後排列，子流程緊接在所屬節點之後，並帶有層級', () => {
    expect(real(sample()).map(({ node, depth }) => `${depth}:${node.id}`)).toEqual(['1:node-1', '2:node-4', '3:node-5', '3:node-6', '1:node-2', '1:node-3']);
  });

  test('工廠與生產邏輯依列出的順序讀取', () => {
    const doc = twoFactories();
    expect(real(doc).filter(e => e.depth === 1).map(e => e.node.id)).toEqual(['node-1', 'node-2', 'node-3', 'node-7']);
    doc.factories.reverse();
    expect(real(doc).filter(e => e.depth === 1).map(e => e.node.id)).toEqual(['node-7', 'node-1', 'node-2', 'node-3']);
  });

  // The stored order is only a tiebreaker; edges win, so "earlier" really means "before" in the workflow.
  test('連線優先於儲存順序，沒有連線的節點維持儲存順序', () => {
    const doc = sample();
    graphOf(doc, 'graph-root').nodes.reverse();
    expect(real(doc).filter(e => e.depth === 1).map(e => e.node.id)).toEqual(['node-1', 'node-2', 'node-3']);
    graphOf(doc, 'graph-root').edges = [];
    expect(real(doc).filter(e => e.depth === 1).map(e => e.node.id)).toEqual(['node-3', 'node-2', 'node-1']);
  });

  test('排序遇到壞資料也不會卡住或遺漏節點', () => {
    const doc = sample();
    graphOf(doc, 'graph-root').edges.push({ id: 'edge-9', from: 'node-3', to: 'node-1' });
    at(doc, 'node-5').childGraphId = 'graph-root';
    const ids = orderedNodes(doc).map(e => e.node.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });

  test('表單屬於擁有它的節點，沒有擁有者時為空', () => {
    expect(nodeOfForm(sample(), 'form-2')?.name).toBe('檢驗');
    expect(nodeOfForm(sample(), 'form-9')).toBeUndefined();
  });

  test('有已確認的關聯而還沒有查詢追溯節點時建議加入；已有（任何層）或沒有關聯則不建議', () => {
    const doc = sample();
    at(doc, 'node-3').actionId = null;
    expect(suggestActions(doc)).toEqual([{ actionId: 'trace-records', reason: '已確認 1 條表單關聯，可加入「查詢追溯」節點，以關聯欄位查詢前後步驟的紀錄。' }]);
    at(doc, 'node-5').actionId = 'trace-records';
    expect(suggestActions(doc)).toEqual([]);
    at(doc, 'node-5').actionId = null;
    doc.relations = [];
    expect(suggestActions(doc)).toEqual([]);
  });
});

describe('D73: 節點完成條件', () => {
  test('動作需要的標準表單與關聯缺少時，逐項指出', () => {
    const doc = sample();
    at(doc, 'node-1').formId = null;
    expect(nodeErrors(doc, at(doc, 'node-1'))).toEqual(['節點「收料」的動作「建立表單」需要一張已建立欄位的標準表單。']);
    doc.relations = [];
    expect(nodeErrors(doc, at(doc, 'node-3'))).toEqual(['節點「追溯」的動作「查詢追溯」需要表單至少有一條已確認的關聯。']);
  });

  test('必填參數未填時指出；沒填但有預設值就用預設值', () => {
    const doc = sample();
    expect(at(doc, 'node-3').params).toEqual({});
    expect(nodeErrors(doc, at(doc, 'node-3'))).toEqual([]);
    at(doc, 'node-3').params = { flowCode: '   ' };
    expect(nodeErrors(doc, at(doc, 'node-3'))).toEqual(['節點「追溯」的「流程代碼」尚未填寫。']);
  });

  // The catalog has no numeric parameter yet, so one is added for this test only.
  test('數值參數超出範圍時指出', () => {
    const action = actionCatalog.actions.find(a => a.id === 'define-form')!;
    action.parameters.push({ id: 'limit', name: '上限', type: 'number', required: true, minimum: 1, maximum: 10 });
    try {
      const doc = sample();
      const target = at(doc, 'node-1');
      expect(nodeErrors(doc, target)).toEqual(['節點「收料」的「上限」尚未填寫。']);
      target.params = { limit: 11 };
      expect(nodeErrors(doc, target)).toEqual(['節點「收料」的「上限」須介於 1 與 10。']);
      target.params = { limit: 10 };
      expect(nodeErrors(doc, target)).toEqual([]);
    } finally { action.parameters.pop(); }
  });

  test('純業務節點不需要任何條件，但表單必須有節點；開始與結束沒有完成度問題', () => {
    const doc = sample();
    expect(nodeErrors(doc, at(doc, 'node-4'))).toEqual([]);
    expect(nodeErrors(doc, at(doc, 'graph-root-start'))).toEqual([]);
    at(doc, 'node-3').formId = null;
    expect(graphErrors(doc)).toContain('表單「追溯單」尚未指派給任何節點。');
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
  test('匯出再匯入得到相同文件（含多個工廠與開始結束），且不寫入任何 Kit 資料', () => {
    const doc = twoFactories();
    doc.forms[0].fields[1].validation = { minimum: 0, maximum: 999 };
    doc.forms[0].fields.push({ ...field('field-3', '到貨日', 'date'), validation: { minimumDate: '2026-01-01', maximumDate: '2026-12-31' } });
    const text = exportAovGraph(doc);
    expect(importAovGraph(text).value).toEqual(doc);
    expect(JSON.parse(text).version).toBe(5);
    expect(text).not.toMatch(/Kit|capability|requires/i);
  });

  test('結構錯誤的文件整份拒絕並保留原流程', () => {
    const doc = sample(); at(doc, 'node-3').childGraphId = 'graph-sub';
    expect(() => importAovGraph(JSON.stringify(doc))).toThrow('子流程不可共用。原流程已保留。');
    expect(() => importAovGraph('{"nope":1}')).toThrow('原流程已保留');
  });

  test('舊的列表編輯路徑遇到 version 4 以上明確回報尚未支援', () => {
    expect(() => importAov(JSON.stringify(sample()))).toThrow('尚未支援。原流程已保留。');
  });
});

describe('D75/D82: 舊格式轉為 version 5', () => {
  const step = (id: string, name: string, formIds: string[], actions: AovDocument['steps'][number]['actions'] = []) => ({ id, name, when: `${name}時`, owner: '品管', formIds, actions });
  const v3 = (steps: AovDocument['steps'], forms: AovDocument['forms'] = []): AovDocument => ({ format: 'composer-aov-list', version: 3, steps, forms, relations: [] });
  const forms = [{ id: 'form-1', name: '收料單', fields: [field('field-1', '批號', 'text', true)] }, { id: 'form-2', name: '檢驗單', fields: [field('field-1', '批號', 'text', true)] }];
  const nodesOf = (doc: AovGraphDocument) => doc.graphs[0].nodes.filter(n => n.kind === 'node');

  test('單一動作加單一表單的步驟成為一個節點，沿用步驟名稱、時機與職務，並放進預設工廠', () => {
    const { value, notices } = listToGraph(v3([step('step-1', '收料', ['form-1'], [{ actionId: 'define-form', formIds: ['form-1'] }])], [forms[0]]));
    expect(notices).toEqual([]);
    expect(nodesOf(value)).toEqual([node('node-1', '收料', { when: '收料時', owner: '品管', actionId: 'define-form', formId: 'form-1' })]);
    expect(value.factories).toEqual([{ id: 'factory-1', name: '預設工廠', logicGraphIds: ['graph-root'] }]);
    expect(integrityErrors(value)).toEqual([]);
    expect(graphErrors(value)).not.toContain('節點「收料」尚未接到開始與結束。');
  });

  test('步驟依序展開並以連線串接在開始與結束之間，含沒有動作的步驟', () => {
    const { value } = listToGraph(v3([step('step-1', '收料', []), step('step-2', '出貨', [])]));
    expect(nodesOf(value).map(n => [n.name, n.actionId])).toEqual([['收料', null], ['出貨', null]]);
    expect(value.graphs[0].edges.map(e => `${e.from}>${e.to}`)).toEqual(['graph-root-start>node-1', 'node-1>node-2', 'node-2>graph-root-end']);
    expect(value.layout['graph-root']['node-2']).toEqual({ x: 320, y: 0 });
    expect(graphErrors(value)).toEqual([]);
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

  test('沒有任何步驟的舊文件得到只有開始與結束的生產邏輯，並要求補上節點', () => {
    const { value } = listToGraph(v3([]));
    expect(value.graphs[0].nodes.map(n => n.kind)).toEqual(['start', 'end']);
    expect(integrityErrors(value)).toEqual([]);
    expect(graphErrors(value)).toEqual(['「主流程」尚未建立節點。']);
  });

  test('節點超過上限時明確失敗，不截斷', () => {
    const steps = Array.from({ length: 99 }, (_, i) => step(`step-${i + 1}`, `步驟${i + 1}`, []));
    expect(() => listToGraph(v3(steps))).toThrow('超過單一流程 98 個節點的上限');
    expect(() => listToGraph(v3(steps.slice(1)))).not.toThrow();
  });

  // D82: a version 4 document keeps working: the main flow moves into a default factory and every graph gets a start and an end.
  test('version 4 升級：放進預設工廠，開始接到沒有入線的節點，沒有出線的節點接到結束，每張圖都補齊', () => {
    const plain = { when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null };
    const v4 = { format: 'composer-aov-list', version: 4, rootGraphId: 'graph-root',
      graphs: [
        { id: 'graph-root', name: '主流程', nodes: [{ id: 'node-1', name: '收料', ...plain }, { id: 'node-2', name: '檢驗', ...plain, childGraphId: 'graph-sub' }, { id: 'node-3', name: '備註', ...plain }], edges: [{ id: 'edge-1', from: 'node-1', to: 'node-2' }] },
        { id: 'graph-sub', name: '檢驗作業', nodes: [{ id: 'node-4', name: '目視', ...plain }], edges: [] },
      ],
      layout: { 'graph-root': { 'node-1': { x: 0, y: 40 }, 'node-2': { x: 200, y: 40 }, 'node-3': { x: 200, y: 160 } } }, forms: [], relations: [] };
    const { value, notices } = importWorkflow(JSON.stringify(v4));
    expect(value.version).toBe(5);
    expect(notices).toEqual(['舊版流程已放入「預設工廠」，並為每個流程補上開始與結束節點，請確認連線。']);
    expect(value.factories).toEqual([{ id: 'factory-1', name: '預設工廠', logicGraphIds: ['graph-root'] }]);
    expect(integrityErrors(value)).toEqual([]);
    for (const g of value.graphs) expect(g.nodes.filter(n => n.kind !== 'node').map(n => n.kind)).toEqual(['start', 'end']);
    const edges = graphOf(value, 'graph-root').edges.map(e => `${e.from}>${e.to}`);
    expect(edges).toEqual(expect.arrayContaining(['graph-root-start>node-1', 'graph-root-start>node-3', 'node-2>graph-root-end', 'node-3>graph-root-end', 'node-1>node-2']));
    expect(edges).toHaveLength(5);
    expect(graphErrors(value).filter(e => e.includes('尚未接到'))).toEqual([]);
    expect(value.layout['graph-root']['graph-root-start'].x).toBeLessThan(0);
    expect(value.layout['graph-root']['graph-root-end'].x).toBeGreaterThan(200);
  });

  test('importWorkflow 對 version 1 到 5 都回傳 version 5 並合併提示', () => {
    const v1 = { format: 'composer-aov-list', version: 1, steps: [{ id: 'a', name: '檢查', when: '', owner: '', formId: 'form-1' }] };
    const fromV1 = importWorkflow(JSON.stringify(v1));
    expect(fromV1.value.version).toBe(5);
    expect(fromV1.notices).toEqual(['舊版流程規格不含表單定義，已清除以下步驟的表單指派：「檢查」。']);
    const v2 = { format: 'composer-aov-list', version: 2, steps: [{ id: 'a', name: '收料', when: '', owner: '', formIds: ['form-1'] }], forms: [forms[0]], relations: [] };
    expect(nodesOf(importWorkflow(JSON.stringify(v2)).value).map(n => n.formId)).toEqual(['form-1']);
    const text = exportAovGraph(sample());
    expect(importWorkflow(text).value).toEqual(sample());
    expect(() => importWorkflow('not json')).toThrow('原流程已保留');
  });
});
