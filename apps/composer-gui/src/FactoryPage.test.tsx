// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { WorkflowCanvas } from './WorkflowCanvas';
import { emptyGraph, integrityErrors, type AovGraphDocument } from './workflowGraph';
import { addCanvasNode, addFactory, addLogic, patchCanvasNode } from './canvasEditing';
import { startLogic } from './testNav';
afterEach(cleanup);
let current = emptyGraph;
function Editor({ initial = emptyGraph }: { initial?: AovGraphDocument }) {
  const [doc, setDoc] = useState(initial); current = doc;
  const [path, setPath] = useState<string[]>([]);
  return <WorkflowCanvas value={doc} onChange={setDoc} path={path} onPathChange={setPath} />;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const crumbs = () => within(document.querySelector('nav[aria-label="流程層級"]') as HTMLElement);

// D79: a flow starts by naming a factory; the button that follows creates its first production logic and opens it.
test('the first screen asks for a factory name, and creating a production logic opens its canvas with a start and an end', () => {
  render(<Editor />);
  expect(screen.getByText(/尚未建立工廠/)).toBeTruthy();
  const create = screen.getByRole('button', { name: '建立生產邏輯：新工廠' }) as HTMLButtonElement;
  expect(create.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('工廠名稱'), { target: { value: '   ' } });
  expect(create.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('工廠名稱'), { target: { value: ' A 廠 ' } });
  expect(create.disabled).toBe(false);
  fireEvent.click(create);
  expect(current.factories).toEqual([{ id: 'factory-1', name: 'A 廠', logicGraphIds: ['graph-1'] }]);
  expect(current.graphs[0].nodes.map(n => n.kind)).toEqual(['start', 'end']);
  expect(integrityErrors(current)).toEqual([]);
  // The canvas is open: breadcrumb shows factory, factory name and production logic.
  expect(screen.getByRole('region', { name: '工具箱' })).toBeTruthy();
  expect(crumbs().getByRole('button', { name: '工廠' })).toBeTruthy();
  expect(crumbs().getByText('A 廠')).toBeTruthy();
  expect(crumbs().getByRole('button', { name: '生產邏輯 1' }).getAttribute('aria-current')).toBe('location');
});

test('pressing Enter in the name field creates the production logic too', () => {
  render(<Editor />);
  fireEvent.change(screen.getByLabelText('工廠名稱'), { target: { value: 'B 廠' } });
  fireEvent.submit(screen.getByLabelText('工廠名稱').closest('form')!);
  expect(current.factories.map(f => f.name)).toEqual(['B 廠']);
  expect(screen.getByRole('region', { name: '工具箱' })).toBeTruthy();
});

test('a factory holds several production logics, each opened from the list', () => {
  render(<Editor />); startLogic();
  click('工廠');
  expect(screen.getByDisplayValue('A 廠')).toBeTruthy();
  click('建立生產邏輯：A 廠');
  expect(current.factories[0].logicGraphIds).toEqual(['graph-1', 'graph-2']);
  expect(crumbs().getByRole('button', { name: '生產邏輯 2' })).toBeTruthy();
  click('工廠');
  expect(screen.getAllByLabelText('生產邏輯名稱').map(i => (i as HTMLInputElement).value)).toEqual(['生產邏輯 1', '生產邏輯 2']);
  click('開啟：生產邏輯 1');
  expect(crumbs().getByRole('button', { name: '生產邏輯 1' })).toBeTruthy();
});

test('a second factory is added from the same name field and gets its own production logic', () => {
  render(<Editor />); startLogic(); click('工廠');
  expect(screen.getByLabelText('新增工廠')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('新增工廠'), { target: { value: 'B 廠' } });
  click('建立生產邏輯：新工廠');
  expect(current.factories.map(f => [f.name, f.logicGraphIds])).toEqual([['A 廠', ['graph-1']], ['B 廠', ['graph-2']]]);
  expect(crumbs().getByText('B 廠')).toBeTruthy();
});

test('factories and production logics are renamed in place', () => {
  render(<Editor />); startLogic(); click('工廠');
  fireEvent.change(screen.getByLabelText('工廠名稱'), { target: { value: '新竹廠' } });
  fireEvent.change(screen.getByLabelText('生產邏輯名稱'), { target: { value: '錫膏印刷' } });
  expect([current.factories[0].name, current.graphs[0].name]).toEqual(['新竹廠', '錫膏印刷']);
  click('開啟：錫膏印刷');
  expect(crumbs().getByText('新竹廠')).toBeTruthy();
});

function twoLogicsWithWork(): AovGraphDocument {
  let doc = addLogic(addFactory(emptyGraph, 'A 廠')!.value, 'factory-1', '收料線')!.value;
  doc = addLogic(doc, 'factory-1', '包裝線')!.value;
  doc = patchCanvasNode(addCanvasNode(doc, 'graph-1', null), 'node-1', { formId: 'form-1', name: '收料' });
  return { ...doc, forms: [{ id: 'form-1', name: '收料單', fields: [{ id: 'f', name: '批號', type: 'text', required: true, isKey: true }] }] };
}

test('deleting a production logic lists what goes with it, can be cancelled, and then removes it from the factory', () => {
  render(<Editor initial={twoLogicsWithWork()} />);
  click('刪除：收料線');
  const region = screen.getByRole('region', { name: '確認刪除' });
  expect(region.textContent).toContain('流程：收料線');
  expect(region.textContent).toContain('節點：1 個');
  expect(region.textContent).toContain('表單：收料單');
  expect(region.textContent).not.toContain('開始');
  click('取消');
  expect(screen.queryByRole('region', { name: '確認刪除' })).toBeNull();
  expect(current.graphs).toHaveLength(2);
  click('刪除：收料線'); click('確認刪除');
  expect(current.factories[0].logicGraphIds).toEqual(['graph-2']);
  expect(current.forms).toEqual([]);
  expect(integrityErrors(current)).toEqual([]);
});

test('deleting a factory removes all its production logics after a confirmation that names them', () => {
  render(<Editor initial={twoLogicsWithWork()} />);
  click('刪除工廠：A 廠');
  const text = screen.getByRole('region', { name: '確認刪除' }).textContent!;
  expect(text).toContain('工廠：A 廠'); expect(text).toContain('流程：收料線'); expect(text).toContain('流程：包裝線');
  click('確認刪除');
  expect(current.factories).toEqual([]);
  expect(current.graphs).toEqual([]);
  expect(screen.getByText(/尚未建立工廠/)).toBeTruthy();
});

// D81: forms of different factories are never offered to each other, by candidate or by hand.
test('relations are offered only between forms of the same factory', () => {
  const field = { id: 'lot', name: '批號', type: 'text' as const, required: true, isKey: true };
  let doc = addLogic(addFactory(emptyGraph, 'A 廠')!.value, 'factory-1', '收料線')!.value;
  doc = addLogic(doc, 'factory-1', '檢驗線')!.value;
  doc = addLogic(addFactory(doc, 'B 廠')!.value, 'factory-2', '包裝線')!.value;
  for (const [graphId, name, formId] of [['graph-1', '收料', 'form-1'], ['graph-2', '檢驗', 'form-2'], ['graph-3', '包裝', 'form-3']]) {
    doc = patchCanvasNode(addCanvasNode(doc, graphId, null), `node-${formId.at(-1)}`, { name, formId });
  }
  doc = { ...doc, forms: [['form-1', '收料單'], ['form-2', '檢驗單'], ['form-3', '包裝單']].map(([id, name]) => ({ id, name, fields: [field] })) };
  render(<Editor initial={doc} />);
  click('開啟：收料線'); click('收料');
  // Same factory, different production logic: allowed. The other factory's form is not a candidate.
  expect(screen.getByRole('button', { name: /確認關聯 「收料單」的「批號」 → 「檢驗單」的「批號」/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /包裝單/ })).toBeNull();
  const upstream = screen.getByLabelText('上游表單') as HTMLSelectElement;
  expect([...upstream.options].map(o => o.textContent)).toEqual(['請選擇', '收料單', '檢驗單']);
});
