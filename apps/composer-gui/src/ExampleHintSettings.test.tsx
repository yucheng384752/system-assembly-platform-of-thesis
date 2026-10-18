// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ExampleHintProvider, ExampleHintSwitch } from './ExampleHintSettings';
import { exampleHints, loadExample } from './exampleHints';
import { emptyGraph, exportAovGraph } from './workflowGraph';
import { FactoryPage } from './FactoryPage';
import { NodeDetails } from './NodeDetails';
import { WorkflowCanvas } from './WorkflowCanvas';
import { actionCatalog } from './workflow';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

test('all name hints toggle together without changing values or the exported document, and persist after remount', () => {
  const doc = loadExample(emptyGraph);
  const before = exportAovGraph(doc);
  const commit = vi.fn(() => true);
  const ui = <ExampleHintProvider><ExampleHintSwitch />
    <FactoryPage value={doc} commit={commit} onOpen={() => {}} />
    <NodeDetails value={doc} node={doc.graphs[0].nodes[1]} onChange={commit} />
  </ExampleHintProvider>;
  const view = render(ui);
  const inputs = () => Array.from(document.querySelectorAll('input:not([type=checkbox])'));
  const values = inputs().map(input => (input as HTMLInputElement).value);
  for (const key of ['factory', 'logic', 'name', 'when', 'owner', 'form', 'field'] as const) {
    expect(screen.getAllByPlaceholderText(exampleHints[key]).length).toBeGreaterThan(0);
  }
  fireEvent.click(screen.getByRole('switch', { name: '顯示填寫提示' }));
  for (const hint of Object.values(exampleHints)) expect(screen.queryAllByPlaceholderText(hint)).toEqual([]);
  expect(inputs().map(input => (input as HTMLInputElement).value)).toEqual(values);
  expect(commit).not.toHaveBeenCalled();
  expect(exportAovGraph(doc)).toBe(before);
  for (const hint of Object.values(exampleHints)) expect(before).not.toContain(hint);
  expect(before).not.toContain('composer-example-hints');
  view.unmount(); render(ui);
  expect((screen.getByRole('switch', { name: '顯示填寫提示' }) as HTMLInputElement).checked).toBe(false);
  expect(screen.queryAllByPlaceholderText(exampleHints.factory)).toEqual([]);
  fireEvent.click(screen.getByRole('switch', { name: '顯示填寫提示' }));
  expect(screen.getAllByPlaceholderText(exampleHints.field).length).toBeGreaterThan(0);
});

test('numeric action hints contain no values and are removed by the switch', () => {
  const doc = loadExample(emptyGraph);
  const action = actionCatalog.actions.find(a => a.parameters.some(p => p.type === 'number'))!;
  const node = { ...doc.graphs[0].nodes[1], actionId: action.id };
  render(<ExampleHintProvider><ExampleHintSwitch /><NodeDetails value={doc} node={node} onChange={() => true} /></ExampleHintProvider>);
  const numbers = action.parameters.filter(p => p.type === 'number');
  expect(numbers.length).toBeGreaterThan(0);
  for (const p of numbers) expect(document.getElementById(`param-${p.id}`)?.getAttribute('placeholder')).toBe('依貴廠規格填寫');
  fireEvent.click(screen.getByRole('switch', { name: '顯示填寫提示' }));
  for (const p of numbers) expect(document.getElementById(`param-${p.id}`)?.hasAttribute('placeholder')).toBe(false);
});

test('unavailable storage defaults to visible and still allows toggling without writing document data', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  const onChange = vi.fn();
  render(<WorkflowCanvas value={emptyGraph} onChange={onChange} path={[]} onPathChange={() => {}} />);
  const field = screen.getByLabelText('工廠名稱') as HTMLInputElement;
  expect(field.placeholder).toBe(exampleHints.factory);
  expect(field.value).toBe('');
  const toggle = screen.getByRole('switch', { name: '顯示填寫提示' });
  expect((toggle as HTMLInputElement).checked).toBe(true);
  fireEvent.click(toggle);
  expect(field.hasAttribute('placeholder')).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
});
