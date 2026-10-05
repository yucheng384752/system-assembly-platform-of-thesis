// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { actionCatalog } from './workflow';
import { WorkflowCanvas } from './WorkflowCanvas';
import { emptyGraph, integrityErrors, listToGraph, type AovGraphDocument } from './workflowGraph';
import { addCanvasNode, connectCanvasNodes, deleteCanvasNode } from './canvasEditing';
afterEach(cleanup);
let current = emptyGraph;
function Editor({ initial = emptyGraph }: { initial?: AovGraphDocument }) {
  const [doc, setDoc] = useState(initial); current = doc;
  return <WorkflowCanvas value={doc} onChange={setDoc} />;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
test('A-C10: confirming a relation in one node updates both endpoints', () => {
  const doc = listToGraph({ format: 'composer-aov-list', version: 3, steps: ['收料', '檢驗'].map((name, i) => ({ id: `step-${i}`, name, when: '', owner: '作業員', actions: [], formIds: [`form-${i}`] })),
    forms: ['收料單', '檢驗單'].map((name, i) => ({ id: `form-${i}`, name, fields: [{ id: 'lot', name: '批號', type: 'text', required: true, isKey: true }] })), relations: [] }).value;
  render(<Editor initial={doc} />); click('收料'); click(/確認關聯/);
  expect(current.relations).toHaveLength(1);
  click('檢驗');
  expect(screen.getByRole('button', { name: /移除關聯/ })).toBeTruthy();
  expect(screen.getByText(/收料單（收料・作業員）/)).toBeTruthy();
});
test('A-C1/C2: keyboard alternatives add nodes and reject a cycle without changing the document', () => {
  render(<Editor />);
  click('加入到畫布：業務節點');
  fireEvent.change(screen.getByLabelText('名稱'), { target: { value: '收料' } });
  click('加入到畫布：業務節點');
  fireEvent.change(screen.getByLabelText('名稱'), { target: { value: '檢驗' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '收料' }));
  expect(current.graphs[0].edges).toHaveLength(1);
  click('收料');
  fireEvent.click(screen.getByRole('checkbox', { name: '檢驗' }));
  expect(screen.getByRole('alert').textContent).toContain('循環');
  expect(current.graphs[0].edges).toHaveLength(1);
  expect(integrityErrors(current)).toEqual([]);
});
test('A-C5/C7: parameter controls follow the catalog, show missing and range errors, and clear on action change', () => {
  const action = actionCatalog.actions.find(a => a.id === 'import-records')!;
  const original = action.parameters;
  action.parameters = [{ id: 'count', name: '筆數', type: 'number', required: true, minimum: 1, maximum: 10 }];
  try {
    render(<Editor />); click('加入到畫布：匯入紀錄');
    expect(screen.getByText(/「筆數」尚未填寫/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('筆數（必填）'), { target: { value: '11' } });
    expect(screen.getByText(/須介於 1 與 10/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('動作'), { target: { value: 'trace-records' } });
    expect(current.graphs[0].nodes[0].params).toEqual({ flowCode: 'default' });
    fireEvent.change(screen.getByLabelText('流程代碼（必填）'), { target: { value: '' } });
    expect(screen.getByText(/「流程代碼」尚未填寫/)).toBeTruthy();
  } finally { action.parameters = original; }
});
test('A-C6: impossible calendar date remains a visible completeness error', () => {
  render(<Editor />); click('加入到畫布：建立表單'); click('新增空白表單'); click('新增欄位');
  fireEvent.change(screen.getByLabelText('欄位 1 型別'), { target: { value: 'date' } });
  fireEvent.change(screen.getByLabelText('最早日期'), { target: { value: '2026-02-30' } });
  expect(screen.getByText(/日期必須是有效的 ISO 日期/)).toBeTruthy();
  expect(current.forms[0].fields[0].validation?.minimumDate).toBe('2026-02-30');
});
test('A-C8: upload stores only inferred fields in the selected node, never sample rows', async () => {
  render(<Editor />); click('加入到畫布：建立表單');
  const file = new File(['批號,數量\nPRIVATE_SAMPLE_SENTINEL,3'], '標準.csv');
  Object.defineProperty(file, 'text', { value: async () => '批號,數量\nPRIVATE_SAMPLE_SENTINEL,3' });
  fireEvent.change(screen.getByLabelText('選擇標準 CSV 樣本'), { target: { files: [file] } });
  await waitFor(() => expect(current.forms).toHaveLength(1));
  expect(current.forms[0].fields.map(f => f.type)).toEqual(['text', 'integer']);
  expect(current.graphs[0].nodes[0].formId).toBe(current.forms[0].id);
  expect(JSON.stringify(current)).not.toContain('PRIVATE_SAMPLE_SENTINEL');
});
test('A-C3/C4: third level disables child creation and circles contain names only', () => {
  const { container } = render(<Editor />);
  for (let i = 0; i < 2; i++) { click('加入到畫布：業務節點'); click('建立子流程'); click('進入子流程'); }
  click('加入到畫布：業務節點');
  expect((screen.getByRole('button', { name: '建立子流程' }) as HTMLButtonElement).disabled).toBe(true);
  expect(current.graphs).toHaveLength(3);
  expect(container.querySelector('.business-node')?.textContent).toBe('業務節點');
});
test('deletion needs in-page confirmation and cascades through descendants, forms, relations and layout', () => {
  let doc = addCanvasNode(emptyGraph, 'graph-root', null);
  doc = addCanvasNode(doc, 'graph-root', null);
  doc = connectCanvasNodes(doc, 'graph-root', 'node-1', 'node-2', true);
  doc.graphs[0].nodes[0].childGraphId = 'child';
  doc.graphs.push({ id: 'child', name: '子流程', edges: [], nodes: [{ ...doc.graphs[0].nodes[1], id: 'child-node', formId: 'form-1' }] });
  doc.forms = [{ id: 'form-1', name: '標準表單', fields: [] }];
  doc.graphs[0].nodes[0].name = '收料';
  render(<Editor initial={doc} />);
  click('收料'); click('刪除節點');
  expect(current.forms).toHaveLength(1);
  expect(screen.getByRole('region', { name: '確認刪除節點' }).textContent).toContain('標準表單');
  click('確認刪除');
  expect(current.forms).toEqual([]);
  expect(current.graphs[0].edges).toEqual([]);
  expect(integrityErrors(current)).toEqual([]);
  expect(deleteCanvasNode(doc, 'node-1').value.graphs).toHaveLength(1);
});
