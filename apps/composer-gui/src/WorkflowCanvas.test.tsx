// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { actionCatalog } from './workflow';
import { WorkflowCanvas } from './WorkflowCanvas';
import { emptyGraph, integrityErrors, listToGraph, type AovGraphDocument } from './workflowGraph';
import { addCanvasNode, addChildGraph, addFactory, addLogic, connectCanvasNodes, deleteCanvasNode, patchCanvasNode } from './canvasEditing';
import { addTool, openToolGroups, startLogic } from './testNav';
afterEach(cleanup);
let current = emptyGraph;
function Editor({ initial = emptyGraph }: { initial?: AovGraphDocument }) {
  const [doc, setDoc] = useState(initial); current = doc;
  const [path, setPath] = useState<string[]>([]);
  return <WorkflowCanvas value={doc} onChange={setDoc} path={path} onPathChange={setPath} />;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
// The canvas opens on the factory list (D79); most tests start from a fresh production logic.
function fresh() { const view = render(<Editor />); startLogic(); return view; }
const work = () => current.graphs[0].nodes.filter(n => n.kind === 'node');
const edges = () => current.graphs[0].edges.map(e => `${e.from}>${e.to}`);

test('A-C10: confirming a relation in one node updates both endpoints', () => {
  const doc = listToGraph({ format: 'composer-aov-list', version: 3, steps: ['收料', '檢驗'].map((name, i) => ({ id: `step-${i}`, name, when: '', owner: '作業員', actions: [], formIds: [`form-${i}`] })),
    forms: ['收料單', '檢驗單'].map((name, i) => ({ id: `form-${i}`, name, fields: [{ id: 'lot', name: '批號', type: 'text', required: true, isKey: true }] })), relations: [] }).value;
  render(<Editor initial={doc} />); click(/^開啟：主流程/); click('收料'); click(/確認關聯/);
  expect(current.relations).toHaveLength(1);
  click('檢驗');
  expect(screen.getByRole('button', { name: /移除關聯/ })).toBeTruthy();
  expect(screen.getByText(/收料單（收料・作業員）/)).toBeTruthy();
});
test('A-C1/C2: keyboard alternatives add unconnected nodes, connect them by choice and reject a cycle without changing the document', () => {
  fresh();
  addTool('業務節點');
  fireEvent.change(screen.getByLabelText('名稱'), { target: { value: '收料' } });
  addTool('業務節點');
  fireEvent.change(screen.getByLabelText('名稱'), { target: { value: '檢驗' } });
  // D84: a new node starts with no lines at all; the user chooses what it follows.
  expect(edges()).toEqual([]);
  fireEvent.click(screen.getByRole('checkbox', { name: '收料' }));
  expect(edges()).toEqual(['node-1>node-2']);
  click('收料');
  fireEvent.click(screen.getByRole('checkbox', { name: '檢驗' }));
  expect(screen.getByRole('alert').textContent).toContain('循環');
  expect(edges()).toEqual(['node-1>node-2']);
  expect(integrityErrors(current)).toEqual([]);
});
test('A-C5/C7: parameter controls follow the catalog, show missing and range errors, and clear on action change', () => {
  const action = actionCatalog.actions.find(a => a.id === 'import-records')!;
  const original = action.parameters;
  action.parameters = [{ id: 'count', name: '筆數', type: 'number', required: true, minimum: 1, maximum: 10 }];
  try {
    fresh(); addTool('匯入資料列');
    expect(screen.getByText(/「筆數」尚未填寫/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('筆數（必填）'), { target: { value: '11' } });
    expect(screen.getByText(/須介於 1 與 10/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('動作'), { target: { value: 'trace-records' } });
    expect(work()[0].params).toEqual({ flowCode: 'default' });
    fireEvent.change(screen.getByLabelText('流程代碼（必填）'), { target: { value: '' } });
    expect(screen.getByText(/「流程代碼」尚未填寫/)).toBeTruthy();
  } finally { action.parameters = original; }
});
test('A-C6: impossible calendar date remains a visible completeness error', () => {
  fresh(); addTool('建立表單'); click('新增空白表單'); click('新增欄位');
  fireEvent.change(screen.getByLabelText('欄位 1 型別'), { target: { value: 'date' } });
  fireEvent.change(screen.getByLabelText('最早日期'), { target: { value: '2026-02-30' } });
  expect(screen.getByText(/日期必須是有效的 ISO 日期/)).toBeTruthy();
  expect(current.forms[0].fields[0].validation?.minimumDate).toBe('2026-02-30');
});
test('A-C8: upload stores only inferred fields in the selected node, never sample rows', async () => {
  fresh(); addTool('建立表單');
  const file = new File(['批號,數量\nPRIVATE_SAMPLE_SENTINEL,3'], '標準.csv');
  Object.defineProperty(file, 'text', { value: async () => '批號,數量\nPRIVATE_SAMPLE_SENTINEL,3' });
  fireEvent.change(screen.getByLabelText('選擇標準 CSV 樣本'), { target: { files: [file] } });
  await waitFor(() => expect(current.forms).toHaveLength(1));
  expect(current.forms[0].fields.map(f => f.type)).toEqual(['text', 'integer']);
  expect(work()[0].formId).toBe(current.forms[0].id);
  expect(JSON.stringify(current)).not.toContain('PRIVATE_SAMPLE_SENTINEL');
});
test('A-C3/C4: third level disables child creation and circles contain names only', () => {
  const { container } = fresh();
  for (let i = 0; i < 2; i++) { addTool('業務節點'); click('建立子流程'); click('進入子流程'); }
  addTool('業務節點');
  expect((screen.getByRole('button', { name: '建立子流程' }) as HTMLButtonElement).disabled).toBe(true);
  expect(current.graphs).toHaveLength(3);
  // Every circle shows its name only; the start and end of the opened sub-flow are there too (D80).
  expect([...container.querySelectorAll('.business-node')].map(n => n.textContent).sort()).toEqual(['開始', '結束', '業務節點'].sort());
});
test('deletion needs in-page confirmation and cascades through descendants, forms, relations and layout; only the lines of the deleted node go', () => {
  let doc = addLogic(addFactory(emptyGraph, 'A 廠')!.value, 'factory-1', '')!.value;
  doc = addCanvasNode(doc, 'graph-1', null);
  doc = addCanvasNode(doc, 'graph-1', null);
  for (const [from, to] of [['graph-1-start', 'node-1'], ['node-1', 'node-2'], ['node-2', 'graph-1-end']]) doc = connectCanvasNodes(doc, 'graph-1', from, to, true);
  doc = patchCanvasNode(doc, 'node-1', { name: '收料' });
  doc = addChildGraph(doc, 'node-1');
  doc = addCanvasNode(doc, 'graph-2', null);
  doc = patchCanvasNode(doc, 'node-3', { formId: 'form-1' });
  doc.forms = [{ id: 'form-1', name: '標準表單', fields: [] }];
  render(<Editor initial={doc} />);
  click(/^開啟：生產邏輯 1/); click('收料'); click('刪除節點');
  expect(current.forms).toHaveLength(1);
  const region = screen.getByRole('region', { name: '確認刪除節點' }).textContent!;
  expect(region).toContain('標準表單'); expect(region).not.toContain('開始');
  click('確認刪除');
  expect(current.forms).toEqual([]);
  expect(current.graphs).toHaveLength(1);
  expect(current.layout['graph-2']).toBeUndefined();
  // 收料 sat between the start and node-2; its lines go with it and nothing is drawn in their place (D84).
  expect(edges()).toEqual(['node-2>graph-1-end']);
  expect(integrityErrors(current)).toEqual([]);
  expect(deleteCanvasNode(doc, 'node-1').value.graphs).toHaveLength(1);
});

// The canvas keeps the whole width until a node is chosen; details are never a permanent empty column.
test('node details exist only while a node is selected and close from the button or an empty canvas click', () => {
  const { container } = fresh();
  const details = () => screen.queryByRole('region', { name: '節點細項' });
  expect(details()).toBeNull();
  expect(container.querySelector('.workflow-columns')?.classList.contains('has-details')).toBe(false);
  addTool('業務節點');
  expect(details()).not.toBeNull();
  expect(container.querySelector('.workflow-columns')?.classList.contains('has-details')).toBe(true);
  click('關閉細項');
  expect(details()).toBeNull();
  fireEvent.click(container.querySelector('ul.step-list button')!);
  expect(details()).not.toBeNull();
  fireEvent.click(container.querySelector('.react-flow__pane')!);
  expect(details()).toBeNull();
  // Closing never removes the node itself.
  expect(work()).toHaveLength(1);
});

// Both side regions scroll on their own, so a keyboard user must be able to focus them.
test('the toolbox and the details scroll on their own and can be focused from the keyboard', () => {
  fresh();
  expect(screen.getByRole('region', { name: '工具箱' }).getAttribute('tabindex')).toBe('0');
  addTool('業務節點');
  expect(screen.getByRole('region', { name: '節點細項' }).getAttribute('tabindex')).toBe('0');
});

// D80: the start and end are made by the system; selecting one explains that and offers no way to change or remove it.
test('the start and end cannot be edited, deleted or given a predecessor they should not have', () => {
  fresh();
  click('開始');
  expect(screen.getByText(/由系統建立，每個流程各有一個，不能修改或刪除/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '刪除節點' })).toBeNull();
  expect(screen.queryByLabelText('名稱')).toBeNull();
  addTool('業務節點'); click('結束');
  // The end lists what leads into it (the end itself and nothing after it are offered).
  expect(screen.getByRole('checkbox', { name: '業務節點' })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: '結束' })).toBeNull();
  expect(screen.queryByRole('button', { name: '刪除節點' })).toBeNull();
  // A normal node can follow the start but never the end.
  click('業務節點');
  expect(screen.queryByRole('checkbox', { name: '結束' })).toBeNull();
  expect(screen.getByRole('checkbox', { name: '開始' })).toBeTruthy();
});

// D84: the add button is an icon to the right of the tool name; its accessible name still says what it does.
test('each tool has an icon button to the right of its name, named for assistive technology', () => {
  fresh(); openToolGroups();
  const tools = screen.getByRole('region', { name: '工具箱' });
  const cards = [...tools.querySelectorAll('section.tool-card')];
  expect(cards).toHaveLength(actionCatalog.actions.length + 1);
  for (const card of cards) {
    const name = card.querySelector('h4')!.textContent!;
    const button = card.querySelector('button')!;
    expect(button.nextElementSibling).toBeNull();
    expect(card.querySelector('h4')!.nextElementSibling).toBe(button);
    expect(button.querySelector('svg')).toBeTruthy();
    expect(button.getAttribute('title')).toBe(`加入到畫布：${name}`);
    expect(screen.getByRole('button', { name: `加入到畫布：${name}` })).toBe(button);
    expect(card.textContent!.replace(`加入到畫布：${name}`, '')).toBe(name);
  }
});

// D84: lines are directed. The arrow marker is declared once a line is drawn (jsdom has no node sizes, so how the path meets it is checked in the browser).
test('a drawn line is directed and ends in an arrow', () => {
  const { container } = fresh();
  addTool('業務節點');
  expect(container.querySelector('marker')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '開始' }));
  expect(edges()).toEqual(['graph-1-start>node-1']);
  const marker = container.querySelector('marker');
  expect(marker).toBeTruthy();
  expect(marker!.querySelector('polyline')).toBeTruthy();
  expect(marker!.id).toContain('arrowclosed');
});

// D85: the toolbox opens in two steps. Categories come from the actions' own category (catalog order); a closed category hides its tools.
test('the toolbox shows categories first and opens one category at a time to reach its tools', () => {
  fresh();
  const tools = screen.getByRole('region', { name: '工具箱' });
  const toggles = [...tools.querySelectorAll('.tool-group > h3 > button')] as HTMLButtonElement[];
  const categories = [...new Set(actionCatalog.actions.map(a => a.category))];
  expect(toggles.map(b => b.textContent)).toEqual([...categories, '一般']);
  expect(toggles.every(b => b.getAttribute('aria-expanded') === 'false')).toBe(true);
  expect(screen.queryByRole('button', { name: /^加入到畫布/ })).toBeNull();
  fireEvent.click(toggles[0]);
  expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
  const inFirst = actionCatalog.actions.filter(a => a.category === categories[0]).map(a => `加入到畫布：${a.name}`);
  expect(screen.getAllByRole('button', { name: /^加入到畫布/ }).map(b => b.getAttribute('title'))).toEqual(inFirst);
  expect(screen.queryByRole('button', { name: '加入到畫布：業務節點' })).toBeNull();
  fireEvent.click(toggles.at(-1)!);
  expect(screen.getByRole('button', { name: '加入到畫布：業務節點' })).toBeTruthy();
  fireEvent.click(toggles[0]);
  expect(screen.queryByRole('button', { name: `加入到畫布：${actionCatalog.actions[0].name}` })).toBeNull();
  expect(screen.getByRole('button', { name: '加入到畫布：業務節點' })).toBeTruthy();
});

// D87: the form's fields are laid out like the CSV they came from: field names across the top, one row per setting.
test('field settings are a table with a column per field and a row per setting, scrollable from the keyboard', () => {
  fresh(); addTool('建立表單'); click('新增空白表單'); click('新增欄位'); click('新增欄位');
  const region = screen.getByRole('region', { name: '欄位設定' });
  expect(region.getAttribute('tabindex')).toBe('0');
  const table = within(region).getByRole('table');
  // The first row holds the field names; the first column names each setting.
  const header = within(within(table).getAllByRole('row')[0]);
  expect(header.getAllByRole('textbox').map(i => i.getAttribute('aria-label'))).toEqual(['欄位 1 名稱', '欄位 2 名稱']);
  expect(within(table).getAllByRole('rowheader').map(h => h.textContent)).toEqual(['型別', '必填', '識別欄位', '驗證', '操作']);
  // Every setting row has one cell per field.
  const rows = within(table).getAllByRole('row');
  expect(rows).toHaveLength(6);
  for (const row of rows.slice(1)) expect(within(row).getAllByRole('cell')).toHaveLength(2);
  expect(within(rows[2]).getAllByRole('checkbox').map(c => c.getAttribute('aria-label'))).toEqual(['欄位 1 必填', '欄位 2 必填']);
  expect(within(rows[3]).getAllByRole('checkbox').map(c => c.getAttribute('aria-label'))).toEqual(['欄位 1 識別欄位', '欄位 2 識別欄位']);
  // The settings still change the document, and a column is removed from its own 操作 cell after the usual confirmation.
  fireEvent.click(screen.getByLabelText('欄位 2 識別欄位'));
  expect(current.forms[0].fields.map(f => f.isKey)).toEqual([false, true]);
  fireEvent.click(screen.getByRole('button', { name: '刪除欄位 1' }));
  click('確認刪除表單內容');
  expect(current.forms[0].fields).toHaveLength(1);
  expect(within(within(screen.getByRole('table')).getAllByRole('row')[0]).getAllByRole('textbox')).toHaveLength(1);
});
