import { GANTT_DISCLAIMER, type GanttResult, type GanttRow } from '../../../libs/planning/ganttEstimate';
import type { Graph } from './workflowGraph';

// Gantt estimate read straight from one canvas graph (feature/gantt-svg-export). It follows lines, node standard minutes and
// transfer minutes only; it is not a schedule. The result has the shape renderGanttSvg takes, so the drawing code is shared.
// 可改善：子流程節點只用自己的標準工時，不加總子流程；見 docs/decision-log.md 該決議的「可改善項目」。
export interface GraphGanttError { code: 'cycle' | 'branch-unknown' | 'duration-required'; message: string; nodeId?: string }
export type GraphGanttResult = { ok: false; errors: GraphGanttError[] } | Extract<GanttResult, { ok: true }>;
/** Node id -> id of the one outgoing line to follow. A branching node without a choice runs all its lines in parallel. */
export type BranchChoices = Record<string, string>;

const label = (name: string) => name.trim() || '（未命名節點）';

// Nodes in line order, or undefined when the lines form a loop.
function topological(graph: Graph): string[] | undefined {
  const indegree = new Map(graph.nodes.map(n => [n.id, 0]));
  for (const e of graph.edges) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  const queue = graph.nodes.filter(n => indegree.get(n.id) === 0).map(n => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of graph.edges) if (e.from === id) { const left = (indegree.get(e.to) ?? 0) - 1; indegree.set(e.to, left); if (left === 0) queue.push(e.to); }
  }
  return order.length === graph.nodes.length ? order : undefined;
}

/** Nodes that can be reached with the choices made so far and still offer several lines: the places a person may choose. */
export function branchPoints(graph: Graph, choices: BranchChoices): { nodeId: string; name: string; edges: { id: string; to: string; toName: string }[] }[] {
  const order = topological(graph);
  if (!order) return [];
  const active = reachable(graph, order, choices);
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  return order.filter(id => active.has(id)).flatMap(id => {
    const out = graph.edges.filter(e => e.from === id);
    return out.length < 2 ? [] : [{ nodeId: id, name: label(byId.get(id)!.name), edges: out.map(e => ({ id: e.id, to: e.to, toName: label(byId.get(e.to)?.name ?? '') })) }];
  });
}

function reachable(graph: Graph, order: string[], choices: BranchChoices): Set<string> {
  const start = graph.nodes.find(n => n.kind === 'start');
  const active = new Set<string>(start ? [start.id] : []);
  for (const id of order) {
    if (!active.has(id)) continue;
    for (const e of graph.edges) if (e.from === id && (choices[id] === undefined || choices[id] === e.id)) active.add(e.to);
  }
  return active;
}

export function estimateGraphGantt(graph: Graph, choices: BranchChoices = {}): GraphGanttResult {
  const order = topological(graph);
  if (!order) return { ok: false, errors: [{ code: 'cycle', message: '流程連線形成迴圈，無法估算時程。' }] };
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const errors: GraphGanttError[] = [];
  for (const [nodeId, edgeId] of Object.entries(choices)) {
    if (!graph.edges.some(e => e.id === edgeId && e.from === nodeId)) errors.push({ code: 'branch-unknown', message: `「${label(byId.get(nodeId)?.name ?? nodeId)}」指定的分支不存在。`, nodeId });
  }
  if (errors.length) return { ok: false, errors };

  const active = reachable(graph, order, choices);
  // The active path is the required path: a node a chosen branch skips is not asked for minutes.
  for (const id of order) {
    const node = byId.get(id)!;
    if (active.has(id) && node.kind === 'node' && node.durationMin === undefined) errors.push({ code: 'duration-required', message: `節點「${label(node.name)}」在必要路徑上，請填入標準工時（分鐘）。`, nodeId: id });
  }
  if (errors.length) return { ok: false, errors };

  const end = new Map<string, number>();
  const rows: GanttRow[] = [];
  let assumedZero = false;
  for (const id of order) {
    if (!active.has(id)) continue;
    const node = byId.get(id)!;
    let start = 0, transferIn = 0, rowZero = false;
    for (const e of graph.edges) {
      if (e.to !== id || !end.has(e.from) || (choices[e.from] !== undefined && choices[e.from] !== e.id)) continue;
      const transfer = e.transferMin ?? 0;
      if (e.transferMin === undefined) rowZero = true;
      if (end.get(e.from)! + transfer >= start) { start = end.get(e.from)! + transfer; transferIn = transfer; }
    }
    const milestone = node.kind !== 'node';
    const finish = start + (milestone ? 0 : node.durationMin!);
    end.set(id, finish);
    assumedZero ||= rowZero;
    rows.push({ nodeId: id, name: label(node.name), milestone, start, end: finish, transferIn, reasons: [], transferAssumedZero: rowZero });
  }
  const total = Math.max(0, ...end.values());
  const conditions = [
    ...Object.entries(choices).map(([nodeId, edgeId]) => {
      const edge = graph.edges.find(e => e.id === edgeId)!;
      return `「${label(byId.get(nodeId)!.name)}」只走「${label(byId.get(edge.to)?.name ?? '')}」`;
    }),
    ...(assumedZero ? ['未填的移轉時間以 0 分鐘計'] : []),
  ];
  return { ok: true, planId: '', unit: '分鐘', conditions, rows, total, lowerBound: total, incomplete: [], disclaimer: GANTT_DISCLAIMER };
}
