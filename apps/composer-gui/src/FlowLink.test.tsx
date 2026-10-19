// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { addTool, openFlow, startLogic } from './testNav';
import { emptyGraph, graphPath } from './workflowGraph';
afterEach(cleanup);
// D-A3: step 02 says where its features come from and links back to the canvas.
test('空畫布時，功能選配說明要先到流程畫布，並可回到畫布', () => {
  render(<App />); openFlow();
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  expect(screen.getByText(/先到流程畫布加入節點並指定動作/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '回到流程畫布' }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('流程畫布');
});
test('畫布工具列顯示用到幾個功能，並可前往功能選配', () => {
  render(<App />); openFlow(); startLogic();
  expect(screen.getByText(/這張流程會用到 0 個功能/)).toBeTruthy();
  addTool('查詢追溯');
  expect(screen.queryByText(/這張流程會用到 0 個功能/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看功能選配' }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('功能選配');
  expect(screen.getByText(/自動帶入 \d+ 個功能/)).toBeTruthy();
});
test('點原因裡的節點名稱，回到畫布並選取該節點', () => {
  render(<App />); openFlow(); startLogic(); addTool('查詢追溯');
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  const derived = screen.getByRole('region', { name: '由流程畫布帶入' });
  fireEvent.click(within(derived).getAllByRole('button', { name: '到流程畫布查看節點：查詢追溯' })[0]);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('流程畫布');
  expect(screen.getByRole('button', { name: '查詢追溯', current: true })).toBeTruthy();
});
test('手動補選與畫布帶入分成兩塊', () => {
  render(<App />); openFlow();
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  expect(screen.getByRole('heading', { name: '手動補選' })).toBeTruthy();
});
test('graphPath 由生產邏輯往下列出子流程路徑，不可達時為空', () => {
  const doc = { ...emptyGraph, factories: [{ id: 'f', name: 'A', logicGraphIds: ['g1'] }], graphs: [
    { id: 'g1', name: 'L', nodes: [{ id: 'n1', kind: 'node' as const, name: 'x', when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: 'g2' }], edges: [] },
    { id: 'g2', name: 'C', nodes: [], edges: [] }, { id: 'g3', name: 'orphan', nodes: [], edges: [] }] };
  expect(graphPath(doc, 'g2')).toEqual(['g1', 'g2']);
  expect(graphPath(doc, 'g1')).toEqual(['g1']);
  expect(graphPath(doc, 'g3')).toEqual([]);
});
