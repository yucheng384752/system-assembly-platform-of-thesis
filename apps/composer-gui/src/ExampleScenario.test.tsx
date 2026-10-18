// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FactoryPage } from './FactoryPage';
import { WorkflowCanvas } from './WorkflowCanvas';
import { clearExample, exampleHints, loadExample } from './exampleHints';
import { addCanvasNode, addChildGraph, addLogic, patchCanvasNode } from './canvasEditing';
import { emptyGraph, exportAovGraph, importAovGraph, integrityErrors, MAX_FACTORIES, workingNodes, type AovGraphDocument } from './workflowGraph';

afterEach(() => { cleanup(); localStorage.clear(); });
let current = emptyGraph;
function Editor({ initial = emptyGraph }: { initial?: AovGraphDocument }) {
  const [doc, setDoc] = useState(initial); current = doc;
  return <FactoryPage value={doc} commit={next => { setDoc(next); return true; }} onOpen={() => {}} />;
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const userDocument = (): AovGraphDocument => JSON.parse(JSON.stringify(loadExample(emptyGraph)).replaceAll('example-', 'user-'));

test('loading appends the scenario, announces it, focuses its name and disables duplicate loading', () => {
  const original = userDocument();
  render(<Editor initial={original} />);
  click('載入範例');
  expect(current.factories).toHaveLength(2);
  expect(workingNodes(current.graphs[1])).toHaveLength(6);
  expect(current.forms).toHaveLength(10);
  expect(current.relations).toHaveLength(8);
  expect(clearExample(current).value).toEqual(original);
  expect(importAovGraph(exportAovGraph(current)).value).toEqual(current);
  expect(document.activeElement?.id).toBe(`factory-name-${current.factories[1].id}`);
  expect(screen.getByRole('status').textContent).toBe('已載入範例。');
  const loaded = current;
  expect((screen.getByRole('button', { name: '載入範例' }) as HTMLButtonElement).disabled).toBe(true);
  click('載入範例');
  expect(current).toBe(loaded);
});

test('clearing lists all contents and edits, supports cancellation and restores focus before reloading', () => {
  const original = userDocument();
  render(<Editor initial={loadExample(original)} />);
  const factory = current.factories[1];
  fireEvent.change(document.getElementById(`factory-name-${factory.id}`)!, { target: { value: '第一廠' } });
  click('清除範例');
  let region = screen.getByRole('region', { name: '確認刪除' });
  expect(document.activeElement).toBe(region);
  expect(region.textContent).toContain('您在範例工廠內新增或修改的內容也會一併清除');
  expect(region.textContent).toContain('工廠：第一廠');
  expect(region.textContent).toContain('節點：6 個');
  for (const form of current.forms.slice(5)) expect(region.textContent).toContain(`表單：${form.name}`);
  expect(within(region).getAllByText(/^關聯：/)).toHaveLength(4);
  click('取消');
  expect(document.activeElement?.id).toBe('clear-example');
  expect(current.factories).toHaveLength(2);
  click('清除範例'); click('確認刪除');
  expect(current).toEqual(original);
  expect(document.activeElement?.id).toBe('load-example');
  expect(screen.getByRole('status').textContent).toBe('已清除範例。');
  expect((screen.getByRole('button', { name: '清除範例' }) as HTMLButtonElement).disabled).toBe(true);
  click('清除範例');
  expect(current).toEqual(original);
  click('載入範例');
  expect(current.factories).toHaveLength(2);
  expect(integrityErrors(current)).toEqual([]);
});

test('clearing follows example factory ownership, including added logics and child graphs, without deleting other example-prefixed items', () => {
  const original = userDocument();
  // A reserved-looking field outside an example factory is still user data.
  original.forms[0].fields[1].id = 'example-user-field';
  let doc = loadExample(original);
  const factoryId = doc.factories[1].id;
  const logic = addLogic(doc, factoryId, '配料混合產線')!;
  doc = addCanvasNode(logic.value, logic.graphId, null);
  const nodeId = doc.graphs.at(-1)!.nodes.at(-1)!.id;
  doc = addChildGraph(doc, nodeId);
  doc = patchCanvasNode(doc, nodeId, { formId: 'form-added' });
  doc = { ...doc, forms: [...doc.forms, { id: 'form-added', name: '配料紀錄', fields: [{ id: 'field-added', name: '批號', type: 'text', required: true, isKey: true }] }] };
  expect(integrityErrors(doc)).toEqual([]);
  const before = structuredClone(doc);
  const removed = clearExample(doc);
  expect(doc).toEqual(before);
  expect(removed.graphs).toHaveLength(3);
  expect(removed.forms).toHaveLength(6);
  expect(removed.value).toEqual(original);
  expect(clearExample(removed.value).value).toBe(removed.value);
  expect(clearExample(emptyGraph).value).toBe(emptyGraph);
});

test('the page reports capacity failures and keeps the original data', () => {
  const initial = { ...emptyGraph, factories: Array.from({ length: MAX_FACTORIES }, (_, i) => ({ id: `factory-${i}`, name: '第一廠', logicGraphIds: [] })) };
  render(<Editor initial={initial} />);
  click('載入範例');
  expect(screen.getByRole('alert').textContent).toContain('工廠數量已達上限');
  expect(current).toBe(initial);
});

test('hint preference survives factory/canvas navigation and does not remount the shared import toolbar', () => {
  const doc = loadExample(emptyGraph);
  const view = render(<WorkflowCanvas value={doc} onChange={vi.fn()} path={[]} onPathChange={() => {}} toolbarExtra={<input aria-label="匯入流程規格" defaultValue="" />} />);
  const shared = screen.getByLabelText('匯入流程規格');
  fireEvent.change(shared, { target: { value: '配料混合產線' } });
  fireEvent.click(screen.getByRole('switch', { name: '顯示填寫提示' }));
  view.rerender(<WorkflowCanvas value={doc} onChange={vi.fn()} path={[doc.graphs[0].id]} onPathChange={() => {}} toolbarExtra={<input aria-label="匯入流程規格" defaultValue="" />} />);
  expect(screen.getByLabelText('匯入流程規格')).toBe(shared);
  expect((shared as HTMLInputElement).value).toBe('配料混合產線');
  expect((screen.getByRole('switch', { name: '顯示填寫提示' }) as HTMLInputElement).checked).toBe(false);
  click('開立領料單');
  expect(screen.getByLabelText('名稱').hasAttribute('placeholder')).toBe(false);
  fireEvent.click(screen.getByRole('switch', { name: '顯示填寫提示' }));
  expect(screen.getByLabelText('名稱').getAttribute('placeholder')).toBe(exampleHints.name);
});
