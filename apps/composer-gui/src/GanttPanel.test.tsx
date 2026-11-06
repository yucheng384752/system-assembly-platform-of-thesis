// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GanttPanel } from './GanttPanel';
import type { Graph, GraphNode } from './workflowGraph';
afterEach(cleanup);

const node = (id: string, durationMin?: number, kind: GraphNode['kind'] = 'node'): GraphNode =>
  ({ id, kind, name: id, when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null, ...(durationMin !== undefined ? { durationMin } : {}) });
const graph = (b?: number): Graph => ({
  id: 'g', name: '主流程',
  nodes: [node('start', undefined, 'start'), node('a', 10), node('b', b), node('c', 5), node('end', undefined, 'end')],
  edges: [{ id: 'e1', from: 'start', to: 'a' }, { id: 'e2', from: 'a', to: 'b' }, { id: 'e3', from: 'a', to: 'c' }, { id: 'e4', from: 'b', to: 'end' }, { id: 'e5', from: 'c', to: 'end' }],
});

// Why: the user wants a forced number on the required path, and a way back to the node that lacks it.
test('blocks the picture and points to the node while a required node has no minutes', () => {
  const onLocate = vi.fn(), onClose = vi.fn();
  render(<GanttPanel graph={graph()} onLocate={onLocate} onClose={onClose} />);
  expect(screen.getByRole('alert').textContent).toContain('節點「b」在必要路徑上');
  expect(screen.queryByRole('img', { name: /甘特圖，總時長/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '前往填寫' }));
  expect(onLocate).toHaveBeenCalledWith('b');
  expect(onClose).toHaveBeenCalled();
});

// Why: choosing a branch removes the skipped node from the required path, so its missing minutes stop blocking.
test('choosing a branch lifts the block and shows the picture with a download button', () => {
  render(<GanttPanel graph={graph()} onLocate={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('「a」之後'), { target: { value: 'e3' } });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('img', { name: /總時長 15 分鐘/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: '下載 SVG' })).toBeTruthy();
});
