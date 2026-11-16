// @vitest-environment jsdom
import { useState } from 'react';
import { useStoreApi, useReactFlow } from '@xyflow/react';
import { act } from '@testing-library/react';
import type { ViewFlowNode } from './CanvasViewElements';
import { expandedView, layeredView, toLayoutPosition } from './canvasView';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { actionCatalog } from './workflow';
import { WorkflowCanvas } from './WorkflowCanvas';
import { emptyGraph, integrityErrors, listToGraph, type AovGraphDocument } from './workflowGraph';
import { addCanvasNode, addChildGraph, addFactory, addLogic, connectCanvasNodes, deleteCanvasNode, patchCanvasNode, setEdgeForm } from './canvasEditing';
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

let canvasStore: ReturnType<typeof useStoreApi<ViewFlowNode>>;
let canvasFlow: ReturnType<typeof useReactFlow<ViewFlowNode>>;
function CanvasProbe() { canvasStore = useStoreApi<ViewFlowNode>(); canvasFlow = useReactFlow<ViewFlowNode>(); return null; }
function LayerEditor({ initial, resetKey = 0 }: { initial: AovGraphDocument; resetKey?: number }) {
  const [doc, setDoc] = useState(initial); current = doc;
  const [path, setPath] = useState(['graph-1']);
  return <WorkflowCanvas value={doc} onChange={setDoc} path={path} onPathChange={setPath} resetKey={resetKey} toolbarExtra={<CanvasProbe />} />;
}
function layerDocument() {
  let doc = addLogic(addFactory(emptyGraph, '測試工廠')!.value, 'factory-1', '')!.value;
  doc = patchCanvasNode(addCanvasNode(doc, 'graph-1', null), 'node-1', { name: '組裝' });
  doc = patchCanvasNode(addCanvasNode(doc, 'graph-1', null), 'node-2', { name: '出貨' });
  doc = addChildGraph(doc, 'node-1');
  doc = patchCanvasNode(addCanvasNode(doc, 'graph-2', null), 'node-3', { name: '鎖附' });
  return connectCanvasNodes(doc, 'graph-1', 'node-1', 'node-2', true);
}
const switchView = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));

test('expanded view renders frame titles and child nodes; renaming and predecessors belong to the child graph', () => {
  const doc = layerDocument();
  const { container } = render(<LayerEditor initial={doc} />);
  expect((screen.getByRole('radio', { name: '單層' }) as HTMLInputElement).checked).toBe(true);
  switchView('展開');
  expect(container.querySelector('.canvas-view-frame strong')?.textContent).toBe('組裝');
  expect([...container.querySelectorAll('.business-node')].map(n => n.textContent)).toContain('鎖附');
  expect(screen.getByRole('region', { name: '組裝的子流程' })).toBeTruthy();
  expect(current).toEqual(doc);
  click('鎖附');
  fireEvent.change(screen.getByLabelText('名稱'), { target: { value: '鎖附確認' } });
  expect(current.graphs[0]).toEqual(doc.graphs[0]);
  expect(current.graphs[1].nodes.find(n => n.id === 'node-3')?.name).toBe('鎖附確認');
  expect(screen.queryByRole('checkbox', { name: '出貨' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '開始' }));
  expect(current.graphs[1].edges).toEqual([{ id: 'edge-2', from: 'graph-2-start', to: 'node-3' }]);
  switchView('單層');
  expect(container.querySelector('.canvas-view-frame')).toBeNull();
  expect(current.layout).toEqual(doc.layout);
});

test('expanded cross-graph connection is rejected without changing the document; same-graph connection succeeds', () => {
  const doc = layerDocument(); render(<LayerEditor initial={doc} />); switchView('展開');
  act(() => canvasStore.getState().onConnect?.({ source: 'node-2', target: 'node-3', sourceHandle: null, targetHandle: null }));
  expect(screen.getByRole('alert').textContent).toBe('連線只能在同一個流程內。');
  expect(current).toEqual(doc);
  act(() => canvasStore.getState().onConnect?.({ source: 'graph-2-start', target: 'node-3', sourceHandle: null, targetHandle: null }));
  expect(current.graphs[0]).toEqual(doc.graphs[0]);
  expect(current.graphs[1].edges).toHaveLength(1);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('expanded deletion only removes the selected child node and its own layout', () => {
  const doc = layerDocument(); render(<LayerEditor initial={doc} />); switchView('展開');
  click('鎖附'); click('刪除節點'); click('確認刪除');
  expect(current.graphs[0]).toEqual(doc.graphs[0]);
  expect(current.layout['graph-1']).toEqual(doc.layout['graph-1']);
  expect(current.graphs[1].nodes.map(n => n.id)).toEqual(['graph-2-start', 'graph-2-end']);
  expect(current.layout['graph-2']['node-3']).toBeUndefined();
});

test('layered notice, bands and non-editable correspondence lines reset on graph change and import', () => {
  const doc = layerDocument(); const view = render(<LayerEditor initial={doc} />); switchView('疊層');
  expect(screen.getByText('系統邏輯疊層：公司需要，待開發。僅供檢視與編輯流程，不影響計畫與工單。').getAttribute('role')).toBe('status');
  expect(view.container.querySelectorAll('.canvas-view-band')).toHaveLength(2);
  const link = canvasStore.getState().edges.find(e => e.id.startsWith('view-link:'))!;
  expect(link).toMatchObject({ selectable: false, reconnectable: false, type: 'straight' });
  expect(link.markerEnd).toBeUndefined();
  click('組裝'); click('進入子流程');
  expect((screen.getByRole('radio', { name: '單層' }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByText(/系統邏輯疊層：/)).toBeNull();
  switchView('展開'); view.rerender(<LayerEditor initial={doc} resetKey={1} />);
  expect((screen.getByRole('radio', { name: '單層' }) as HTMLInputElement).checked).toBe(true);
  expect(current).toEqual(doc);
});

test.each(['展開', '疊層'])('%s moves child positions back into child layout and ignores decoration changes', mode => {
  const doc = layerDocument(); render(<LayerEditor initial={doc} />); switchView(mode);
  const projected = (mode === '展開' ? expandedView : layeredView)(doc, 'graph-1').nodes.find(n => n.id === 'node-3')!;
  const position = { x: projected.position.x + 45, y: projected.position.y + 20 };
  act(() => canvasStore.getState().onNodesChange?.([{ type: 'position', id: 'node-3', position }]));
  expect(current.layout['graph-2']['node-3']).toEqual(toLayoutPosition(projected, position));
  expect(current.layout['graph-1']).toEqual(doc.layout['graph-1']);
  const before = current;
  act(() => canvasStore.getState().onNodesChange?.([{ type: 'position', id: 'view-frame:graph-2', position }, { type: 'select', id: 'view-frame:graph-2', selected: true }]));
  expect(current).toBe(before);
  expect(screen.queryByRole('region', { name: '節點細項' })).toBeNull();
});

test('toolbox adds to selected child; frame drop overrides selection and converts display coordinates', () => {
  const doc = layerDocument(); const { container } = render(<LayerEditor initial={doc} />); switchView('展開');
  click('鎖附'); addTool('業務節點');
  expect(current.graphs[1].nodes).toHaveLength(4);
  expect(current.graphs[0]).toEqual(doc.graphs[0]);
  click('出貨');
  const frame = expandedView(current, 'graph-1').frames[0];
  const position = { x: frame.position.x + 20, y: frame.position.y + 20 };
  const point = canvasFlow.flowToScreenPosition(position);
  const drop = new MouseEvent('drop', { bubbles: true, clientX: point.x, clientY: point.y });
  Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'business' } });
  fireEvent(container.querySelector('.workflow-canvas')!, drop);
  const added = current.graphs[1].nodes.at(-1)!;
  expect(current.graphs[1].nodes).toHaveLength(5);
  expect(current.layout['graph-2'][added.id]).toEqual(toLayoutPosition(frame, position));
  expect(current.graphs[0]).toEqual(doc.graphs[0]);
});

test('continuous expanded dragging holds the starting offset and frame until release', async () => {
  const doc = layerDocument(); render(<LayerEditor initial={doc} />); switchView('展開');
  const original = expandedView(doc, 'graph-1').nodes.find(n => n.id === 'graph-2-start')!;
  const item = canvasStore.getState().nodes.find(n => n.id === original.id)!;
  const frame = canvasStore.getState().nodes.find(n => n.type === 'frame')!;
  act(() => canvasStore.getState().onNodeDragStart?.(new MouseEvent('mousedown'), item, [item]));
  for (const delta of [-50, -100]) {
    const position = { x: original.position.x + delta, y: original.position.y - 20 };
    act(() => canvasStore.getState().onNodesChange?.([{ type: 'position', id: item.id, position, dragging: true }]));
    expect(current.layout['graph-2'][item.id]).toEqual(toLayoutPosition(original, position));
    expect(canvasStore.getState().nodes.find(n => n.id === item.id)?.position).toEqual(position);
    expect(canvasStore.getState().nodes.find(n => n.type === 'frame')?.position).toEqual(frame.position);
  }
  act(() => canvasStore.getState().onNodeDragStop?.(new MouseEvent('mouseup'), item, [item]));
  await waitFor(() => expect(canvasStore.getState().nodes.find(n => n.id === item.id)?.position).toEqual(expandedView(current, 'graph-1').nodes.find(n => n.id === item.id)?.position));
  expect(current.layout['graph-1']).toEqual(doc.layout['graph-1']);
});

test('creating a grandchild from expanded child selection uses its owner path and depth', () => {
  render(<LayerEditor initial={layerDocument()} />); switchView('展開'); click('鎖附'); click('建立子流程');
  expect(current.graphs[1].nodes.find(n => n.id === 'node-3')?.childGraphId).toBe('graph-3');
  expect(within(screen.getByRole('navigation', { name: '流程層級' })).getAllByRole('button').map(b => b.textContent)).toEqual(['工廠', '生產邏輯 1', '組裝的子流程', '鎖附的子流程']);
  expect((screen.getByRole('radio', { name: '單層' }) as HTMLInputElement).checked).toBe(true);
  addTool('業務節點');
  expect((screen.getByRole('button', { name: '建立子流程' }) as HTMLButtonElement).disabled).toBe(true);
});

test('broken child references are reported as status in expanded view without modifying the document', () => {
  const doc = layerDocument(); doc.graphs[0].nodes.find(n => n.id === 'node-1')!.childGraphId = 'missing';
  render(<LayerEditor initial={doc} />); switchView('展開');
  expect(screen.getByText('「組裝」的子流程不存在，已略過。').closest('[role=status]')).toBeTruthy();
  expect(current).toEqual(doc);
});

test('expanded toolbox uses the selected graph node limit and falls back to the current graph without selection', () => {
  let doc = layerDocument();
  while (doc.graphs[0].nodes.length < 100) doc = addCanvasNode(doc, 'graph-1', null);
  const { container } = render(<LayerEditor initial={doc} />); switchView('展開'); openToolGroups();
  const add = screen.getByRole('button', { name: '加入到畫布：業務節點' }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  click('鎖附'); expect(add.disabled).toBe(false); fireEvent.click(add);
  expect(current.graphs[0].nodes).toHaveLength(100);
  expect(current.graphs[1].nodes).toHaveLength(4);
  fireEvent.click(container.querySelector('.react-flow__pane')!);
  expect(add.disabled).toBe(true);
});

test('dropping inside a full child refuses the add even when the selected root has room', () => {
  let doc = layerDocument();
  while (doc.graphs[1].nodes.length < 100) doc = addCanvasNode(doc, 'graph-2', null);
  const { container } = render(<LayerEditor initial={doc} />); switchView('展開'); click('出貨');
  const frame = expandedView(doc, 'graph-1').frames[0];
  const point = canvasFlow.flowToScreenPosition({ x: frame.position.x + 20, y: frame.position.y + 20 });
  const drop = new MouseEvent('drop', { bubbles: true, clientX: point.x, clientY: point.y });
  Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'business' } });
  fireEvent(container.querySelector('.workflow-canvas')!, drop);
  expect(screen.getByRole('alert').textContent).toBe('每個流程最多 100 個節點。');
  expect(current).toEqual(doc);
});

test('parent context appears only inside a child and its predecessor and successor buttons return and select without changing the document', () => {
  let doc = addLogic(addFactory(emptyGraph, 'A 廠')!.value, 'factory-1', '')!.value;
  for (const name of ['收料', '檢驗', '出貨']) {
    doc = addCanvasNode(doc, 'graph-1', null);
    doc = patchCanvasNode(doc, doc.graphs[0].nodes.at(-1)!.id, { name });
  }
  doc = connectCanvasNodes(doc, 'graph-1', 'node-1', 'node-2', true);
  doc = connectCanvasNodes(doc, 'graph-1', 'node-2', 'node-3', true);
  doc = addChildGraph(doc, 'node-2');
  const original = structuredClone(doc);
  const { container } = render(<Editor initial={doc} />);
  click(/^開啟：生產邏輯 1/);
  expect(screen.queryByRole('navigation', { name: '上一層的前後節點' })).toBeNull();
  for (const neighbour of ['收料', '出貨']) {
    click('檢驗'); click('進入子流程');
    const nav = screen.getByRole('navigation', { name: '上一層的前後節點' });
    expect(nav.previousElementSibling?.classList.contains('canvas-toolbar')).toBe(true);
    expect(nav.nextElementSibling?.classList.contains('columns')).toBe(true);
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['收料', '出貨']);
    expect(within(nav).getByText('前置')).toBeTruthy();
    expect(within(nav).getByText('後續')).toBeTruthy();
    expect(nav.querySelector('[aria-current=true]')?.textContent).toBe('目前所在：檢驗');
    expect(within(nav).queryByRole('button', { name: /檢驗/ })).toBeNull();
    fireEvent.click(within(nav).getByRole('button', { name: neighbour }));
    expect(screen.queryByRole('navigation', { name: '上一層的前後節點' })).toBeNull();
    expect((screen.getByLabelText('名稱') as HTMLInputElement).value).toBe(neighbour);
    expect(container.querySelector('.step-list [aria-current=true]')?.textContent).toBe(neighbour);
  }
  expect(current).toEqual(original);
});

test('parent context uses empty-neighbour and unnamed-node labels', () => {
  fresh(); addTool('業務節點');
  fireEvent.change(screen.getByLabelText('名稱'), { target: { value: '' } });
  click('建立子流程');
  const nav = screen.getByRole('navigation', { name: '上一層的前後節點' });
  expect(within(nav).getAllByText('（無）')).toHaveLength(2);
  expect(nav.querySelector('[aria-current=true]')?.textContent).toBe('目前所在：（未命名節點）');
  expect(within(nav).queryAllByRole('button')).toHaveLength(0);
});

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
  for (let i = 0; i < 2; i++) { addTool('業務節點'); click('建立子流程'); }
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

// D208 (docs/canvas-layer-views.md section 4): a dataflow line says which form's data passes between two nodes of a sub-flow.
// It is not a statement about order, so the controls for order and the controls for data are kept apart.
const subLines = () => current.graphs[1].edges;
function LayerEditorAt({ initial, at }: { initial: AovGraphDocument; at: string[] }) {
  const [doc, setDoc] = useState(initial); current = doc;
  const [path, setPath] = useState(at);
  return <WorkflowCanvas value={doc} onChange={setDoc} path={path} onPathChange={setPath} toolbarExtra={<CanvasProbe />} />;
}
// layerDocument plus forms: 組裝 owns 組裝單, 鎖附 (in the sub-flow) owns 鎖附單.
function formDocument(): AovGraphDocument {
  const field = { id: 'f', name: '批號', type: 'text' as const, required: true, isKey: true };
  const doc = patchCanvasNode(patchCanvasNode(layerDocument(), 'node-1', { formId: 'form-1' }), 'node-3', { formId: 'form-2' });
  return { ...doc, forms: [{ id: 'form-1', name: '組裝單', fields: [field] }, { id: 'form-2', name: '鎖附單', fields: [field] }] };
}

test('the predecessor list manages sequence lines only: a dataflow line neither ticks it nor is removed by it', () => {
  const doc = connectCanvasNodes(layerDocument(), 'graph-2', 'graph-2-start', 'node-3', true, 'dataflow');
  render(<LayerEditorAt initial={doc} at={['graph-1', 'graph-2']} />);
  click('鎖附');
  const follows = screen.getByRole('checkbox', { name: '開始' }) as HTMLInputElement;
  expect(follows.checked).toBe(false);
  fireEvent.click(follows);
  expect(subLines()).toEqual([{ id: 'edge-2', from: 'graph-2-start', to: 'node-3', kind: 'dataflow', formId: null }, { id: 'edge-3', from: 'graph-2-start', to: 'node-3' }]);
  fireEvent.click(screen.getByRole('checkbox', { name: '開始' }));
  expect(subLines()).toEqual([{ id: 'edge-2', from: 'graph-2-start', to: 'node-3', kind: 'dataflow', formId: null }]);
});

test('the data-source list exists only in a sub-flow, creates dataflow lines and chooses their form, including "not chosen yet"', () => {
  render(<LayerEditorAt initial={formDocument()} at={['graph-1']} />);
  click('組裝');
  expect(screen.queryByRole('group', { name: '資料來自哪些節點' })).toBeNull();
  click('進入子流程'); click('鎖附');
  const group = screen.getByRole('group', { name: '資料來自哪些節點' });
  expect(within(group).getAllByRole('checkbox').map(c => (c as HTMLInputElement).checked)).toEqual([false]);
  expect(within(group).queryByRole('combobox')).toBeNull();
  fireEvent.click(within(group).getByRole('checkbox', { name: '資料來自：開始' }));
  expect(subLines()).toEqual([{ id: 'edge-2', from: 'graph-2-start', to: 'node-3', kind: 'dataflow', formId: null }]);
  // The sequence list is untouched by the data line.
  expect((screen.getByRole('checkbox', { name: '開始' }) as HTMLInputElement).checked).toBe(false);
  const select = screen.getByLabelText('「開始」傳遞的表單') as HTMLSelectElement;
  expect([...select.options].map(o => o.textContent)).toEqual(['尚未指定', '組裝單', '鎖附單']);
  expect(select.value).toBe('');
  fireEvent.change(select, { target: { value: 'form-1' } });
  expect(subLines()[0].formId).toBe('form-1');
  fireEvent.change(screen.getByLabelText('「開始」傳遞的表單'), { target: { value: '' } });
  expect(subLines()[0].formId).toBeNull();
  // Unticking removes the data line only.
  fireEvent.click(screen.getByRole('checkbox', { name: '開始' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '資料來自：開始' }));
  expect(subLines()).toEqual([{ id: 'edge-3', from: 'graph-2-start', to: 'node-3' }]);
  expect(integrityErrors(current)).toEqual([]);
});

test('the line-kind switch appears only where a sub-flow is on the canvas and decides what a drawn line is', () => {
  render(<LayerEditorAt initial={layerDocument()} at={['graph-1']} />);
  expect(screen.queryByRole('radiogroup', { name: '連線種類' })).toBeNull();
  click('組裝'); click('進入子流程');
  expect((screen.getByRole('radio', { name: '先後' }) as HTMLInputElement).checked).toBe(true);
  act(() => canvasStore.getState().onConnect?.({ source: 'graph-2-start', target: 'node-3', sourceHandle: null, targetHandle: null }));
  expect(subLines()).toEqual([{ id: 'edge-2', from: 'graph-2-start', to: 'node-3' }]);
  fireEvent.click(screen.getByRole('radio', { name: '資料流' }));
  act(() => canvasStore.getState().onConnect?.({ source: 'graph-2-start', target: 'node-3', sourceHandle: null, targetHandle: null }));
  expect(subLines()[1]).toEqual({ id: 'edge-3', from: 'graph-2-start', to: 'node-3', kind: 'dataflow', formId: null });
  // It lies on the same two nodes as the sequence line, so it is the dashed line drawn beside it.
  expect(canvasStore.getState().edges.find(e => e.id === 'edge-3')).toMatchObject({ className: 'canvas-dataflow-edge', type: 'dataflowBeside' });
  expect(canvasStore.getState().edges.find(e => e.id === 'edge-2')?.className).toBeUndefined();
});

test('in the expanded view a data line drawn in the top layer is refused with the reason and the document is unchanged', () => {
  const doc = layerDocument(); render(<LayerEditor initial={doc} />);
  switchView('展開');
  fireEvent.click(screen.getByRole('radio', { name: '資料流' }));
  act(() => canvasStore.getState().onConnect?.({ source: 'graph-1-start', target: 'node-2', sourceHandle: null, targetHandle: null }));
  expect(screen.getByRole('alert').textContent).toContain('資料流連線只能畫在子流程裡');
  expect(current).toEqual(doc);
  act(() => canvasStore.getState().onConnect?.({ source: 'graph-2-start', target: 'node-3', sourceHandle: null, targetHandle: null }));
  expect(subLines()).toEqual([{ id: 'edge-2', from: 'graph-2-start', to: 'node-3', kind: 'dataflow', formId: null }]);
});

// Transfer time is the minutes material needs along a sequence line; a data line moves nothing, so it gets no minutes field.
test('transfer time is offered for incoming sequence lines only', () => {
  let doc = connectCanvasNodes(layerDocument(), 'graph-2', 'graph-2-start', 'node-3', true, 'dataflow');
  render(<LayerEditorAt initial={doc} at={['graph-1', 'graph-2']} />);
  click('鎖附');
  expect(screen.queryByRole('group', { name: /移轉時間/ })).toBeNull();
  cleanup();
  doc = connectCanvasNodes(doc, 'graph-2', 'graph-2-start', 'node-3', true);
  render(<LayerEditorAt initial={doc} at={['graph-1', 'graph-2']} />);
  click('鎖附');
  expect(within(screen.getByRole('group', { name: /移轉時間/ })).getAllByRole('spinbutton')).toHaveLength(1);
});

test('deleting a form sets the data lines that passed it back to "not chosen yet" and keeps the lines', () => {
  let doc = connectCanvasNodes(formDocument(), 'graph-2', 'graph-2-start', 'node-3', true, 'dataflow');
  doc = connectCanvasNodes(doc, 'graph-2', 'node-3', 'graph-2-end', true, 'dataflow');
  doc = setEdgeForm(setEdgeForm(doc, 'edge-2', 'form-2'), 'edge-3', 'form-1');
  render(<LayerEditorAt initial={doc} at={['graph-1', 'graph-2']} />);
  click('鎖附'); click('刪除此表單'); click('確認刪除表單內容');
  expect(current.forms.map(f => f.id)).toEqual(['form-1']);
  expect(subLines().map(e => [e.id, e.formId])).toEqual([['edge-2', null], ['edge-3', 'form-1']]);
  expect(integrityErrors(current)).toEqual([]);
});

test.each(['展開', '疊層'])('%s shows the form gap count beside the frame title and an item-by-item list that opens outside the canvas', mode => {
  let doc = formDocument();
  // Upper layer: 組裝 follows nothing with a form and owns 組裝單, so the expected output is 組裝單 and nothing is expected as input.
  doc = connectCanvasNodes(doc, 'graph-2', 'graph-2-start', 'node-3', true, 'dataflow');
  doc = connectCanvasNodes(doc, 'graph-2', 'node-3', 'graph-2-end', true, 'dataflow');
  doc = setEdgeForm(doc, 'edge-2', 'form-2');
  const { container } = render(<LayerEditor initial={doc} />); switchView(mode);
  expect(container.querySelector('.canvas-view-gap')?.textContent).toBe('缺口 2 項，尚未指定表單 1 條');
  const list = screen.getByRole('region', { name: '表單輸入與輸出缺口' });
  const details = list.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(details.querySelector('summary')!.textContent).toBe('「組裝」的表單輸入與輸出缺口：缺口 2 項，尚未指定表單 1 條');
  expect([...details.querySelectorAll('li')].map(li => li.textContent)).toEqual([
    '輸入多出「鎖附單」：子流程的「開始」傳出這張表單，上一層的前置節點沒有。',
    '輸出缺少「組裝單」：上一層節點的這張表單沒有傳到子流程的「結束」。',
    '尚未指定表單 1 條：這些資料流連線還沒有選擇傳遞的表單。',
  ]);
  expect(list.textContent).toContain('不代表已完成計畫的輸入輸出檢查');
  // A gap is a hint: the document still passes the integrity check and stays editable.
  expect(integrityErrors(current)).toEqual([]);
});

test('without sub-flow frames or without gaps no gap list is shown', () => {
  const doc = layerDocument(); render(<LayerEditor initial={doc} />);
  expect(screen.queryByRole('region', { name: '表單輸入與輸出缺口' })).toBeNull();
  switchView('展開');
  expect(screen.queryByRole('region', { name: '表單輸入與輸出缺口' })).toBeNull();
});
