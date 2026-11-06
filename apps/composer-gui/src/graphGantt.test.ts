import { describe, expect, it } from 'vitest';
import { branchPoints, estimateGraphGantt } from './graphGantt';
import type { Graph, GraphNode } from './workflowGraph';
import { renderGanttSvg } from '../../../libs/planning/ganttSvg';
import { setEdgeTransfer } from './canvasEditing';
import { exportAovGraph, importAovGraph, type AovGraphDocument } from './workflowGraph';

const node = (id: string, durationMin?: number, kind: GraphNode['kind'] = 'node'): GraphNode =>
  ({ id, kind, name: id, when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null, ...(durationMin !== undefined ? { durationMin } : {}) });
const edge = (id: string, from: string, to: string, transferMin?: number) => ({ id, from, to, ...(transferMin !== undefined ? { transferMin } : {}) });

// start -> a(10) -> b(20) -> end, plus a -> c(5) -> end: a branches into b and c.
const branching = (over: { b?: number; c?: number } = {}): Graph => ({
  id: 'g', name: 'g',
  nodes: [node('start', undefined, 'start'), node('a', 10), node('b', 'b' in over ? over.b : 20), node('c', 'c' in over ? over.c : 5), node('end', undefined, 'end')],
  edges: [edge('e1', 'start', 'a'), edge('e2', 'a', 'b', 3), edge('e3', 'a', 'c'), edge('e4', 'b', 'end'), edge('e5', 'c', 'end')],
});

describe('estimateGraphGantt', () => {
  // Why: lines without a chosen branch mean parallel work on the canvas, so the total is the slowest line, not the sum.
  it('runs every line in parallel when no branch is chosen and waits for the slowest', () => {
    const result = estimateGraphGantt(branching());
    expect(result.ok && result.total).toBe(33);
    expect(result.ok && result.rows.find(r => r.nodeId === 'c')).toMatchObject({ start: 10, end: 15 });
  });

  // Why: a chosen branch removes the skipped nodes from the required path, so they are neither drawn nor counted.
  it('follows only the chosen branch', () => {
    const result = estimateGraphGantt(branching(), { a: 'e3' });
    expect(result.ok && result.total).toBe(15);
    expect(result.ok && result.rows.map(r => r.nodeId)).toEqual(['start', 'a', 'c', 'end']);
  });

  // Why: the user asked for a forced number on the required path; a blank must never be read as 0 minutes.
  it('refuses to estimate while a node on the required path has no standard minutes', () => {
    const result = estimateGraphGantt(branching({ b: undefined }));
    expect(result).toMatchObject({ ok: false, errors: [{ code: 'duration-required', nodeId: 'b' }] });
  });

  it('does not ask for minutes of a node the chosen branch skips', () => {
    expect(estimateGraphGantt(branching({ b: undefined }), { a: 'e3' }).ok).toBe(true);
  });

  // Why: transfer time is optional by the user's rule, but the drawing must say it was counted as 0.
  it('counts an unfilled transfer as 0 and says so', () => {
    const result = estimateGraphGantt(branching(), { a: 'e3' });
    expect(result.ok && result.conditions).toContain('未填的移轉時間以 0 分鐘計');
    expect(result.ok && result.rows.find(r => r.nodeId === 'c')!.transferAssumedZero).toBe(true);
  });

  it('adds a filled transfer to the start of the next node', () => {
    const result = estimateGraphGantt(branching(), { a: 'e2' });
    expect(result.ok && result.rows.find(r => r.nodeId === 'b')).toMatchObject({ start: 13, transferIn: 3 });
  });

  it('reports a loop and a choice that points at a missing line', () => {
    const loop = branching(); loop.edges.push(edge('e6', 'end', 'a'));
    expect(estimateGraphGantt(loop)).toMatchObject({ ok: false, errors: [{ code: 'cycle' }] });
    expect(estimateGraphGantt(branching(), { a: 'gone' })).toMatchObject({ ok: false, errors: [{ code: 'branch-unknown', nodeId: 'a' }] });
  });

  it('feeds the shared SVG drawing', () => {
    const result = estimateGraphGantt(branching(), { a: 'e3' });
    if (!result.ok) throw new Error('expected an estimate');
    const svg = renderGanttSvg(result);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('流程預估，未計入實際資源競用');
  });
});

describe('transfer time in the drawing', () => {
  const drawn = (choices: Record<string, string>) => {
    const result = estimateGraphGantt(branching(), choices);
    if (!result.ok) throw new Error('expected an estimate');
    return renderGanttSvg(result);
  };

  // Why: the user wants transfer time told apart from work, and not by colour alone (DESIGN.md), so it is hatched and has a legend.
  it('draws a transfer as its own hatched segment with a legend', () => {
    const svg = drawn({ a: 'e2' });
    expect(svg).toContain('fill="url(#gantt-transfer)"');
    expect(svg).toContain('b：移轉 3 分鐘');
    expect(svg).toContain('作業時間');
    expect(svg).toContain('移轉時間');
  });

  // Why: with no transfer there is nothing to explain, so the drawing stays as it was and carries no legend.
  it('adds no legend when no transfer is filled in', () => {
    const svg = drawn({ a: 'e3' });
    expect(svg).not.toContain('url(#gantt-transfer)"');
    expect(svg).not.toContain('作業時間');
  });

  // Why: the segment must end exactly where the work bar starts, so a reader can add the two up to the bar's start.
  it('puts the segment right before the bar it leads to', () => {
    const result = estimateGraphGantt(branching(), { a: 'e2' });
    if (!result.ok) throw new Error('expected an estimate');
    const row = result.rows.find(r => r.nodeId === 'b')!;
    expect(row.start! - row.transferIn).toBe(10);
  });

  // Why: when two lines lead in, the segment belongs to the line that decides the start, not the one with the longest transfer.
  it('shows the transfer of the line that sets the start', () => {
    const g = branching();
    g.edges.push(edge('e6', 'c', 'b', 1));
    g.edges.find(e => e.id === 'e2')!.transferMin = 0;
    const result = estimateGraphGantt(g, {});
    if (!result.ok) throw new Error('expected an estimate');
    // a ends at 10; c ends at 15 and its transfer of 1 puts b at 16, later than a's 10 + 0.
    expect(result.rows.find(r => r.nodeId === 'b')).toMatchObject({ start: 16, transferIn: 1 });
  });
});

describe('branchPoints', () => {
  // Why: a branch the person already chose must stay listed, or the choice could never be changed or cleared.
  it('lists nodes that offer several lines, also after a choice, and skips nodes on a skipped branch', () => {
    expect(branchPoints(branching(), {}).map(p => p.nodeId)).toEqual(['a']);
    expect(branchPoints(branching(), { a: 'e3' }).map(p => p.nodeId)).toEqual(['a']);
    const nested = branching(); nested.edges.push(edge('e6', 'b', 'c'));
    expect(branchPoints(nested, { a: 'e3' }).map(p => p.nodeId)).toEqual(['a']);
    expect(branchPoints(nested, {}).map(p => p.nodeId)).toEqual(['a', 'b']);
  });
});

describe('minutes in the workflow file', () => {
  const doc = (): AovGraphDocument => ({
    format: 'composer-aov-list', version: 5, factories: [{ id: 'factory-1', name: '工廠', logicGraphIds: ['g'] }],
    graphs: [{ ...branching(), id: 'g', name: '主流程' }], layout: {}, forms: [], relations: [],
  });

  // Why: the fields are optional contract additions; they must survive export and import, and an unfilled one stays absent.
  it('round-trips filled minutes and keeps unfilled ones absent', () => {
    const back = importAovGraph(exportAovGraph(doc())).value.graphs[0];
    expect(back.nodes.find(n => n.id === 'a')!.durationMin).toBe(10);
    expect(back.edges.find(e => e.id === 'e2')!.transferMin).toBe(3);
    expect('transferMin' in back.edges.find(e => e.id === 'e3')!).toBe(false);
  });

  it('removes the key when the transfer is cleared', () => {
    const cleared = setEdgeTransfer(doc(), 'e2', undefined).graphs[0].edges.find(e => e.id === 'e2')!;
    expect('transferMin' in cleared).toBe(false);
  });

  it('rejects negative minutes in a file', () => {
    const text = exportAovGraph(doc()).replace('"durationMin": 10', '"durationMin": -1');
    expect(() => importAovGraph(text)).toThrow();
  });
});
