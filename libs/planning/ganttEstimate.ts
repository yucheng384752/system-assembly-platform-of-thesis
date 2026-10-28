import { CATEGORY_GROUP, type NodeCategory } from '../aov-core';
import { validateExecutablePlan } from '../aov-integration/executablePlan';

// Basic "process to Gantt" estimate (D135) computed from an executable plan.
// It follows flow dependencies, planned durations and transfer times only. It is not a schedule: no resource
// contention, no calendars, no rework preview. Missing data is never read as 0 (see the milestone rule below).
export const GANTT_DISCLAIMER = '流程預估，未計入實際資源競用，不是排程或交期承諾';

export interface GanttConditions {
  /** Quantity that per-unit durations multiply. Required only when an active node has a per-unit duration. */
  quantity?: number;
  /** Judge node id -> chosen output port. Required for every active judge that has several routed outputs. */
  branchChoices?: Record<string, string>;
  /** Opt in to estimating with 0 where a flow has no transfer time; the result then says so. Default: strict. */
  treatMissingTransferAsZero?: boolean;
}
export interface GanttRow {
  nodeId: string;
  name: string;
  /** Boundary or structural node without an authored duration: a point in time, not work. */
  milestone: boolean;
  /** Known only when every active predecessor and incoming transfer is known. */
  start?: number;
  /** Known only when start and the node's own duration are known. */
  end?: number;
  transferIn: number;
  /** Why start or end is unknown; empty for a complete row. */
  reasons: string[];
  transferAssumedZero: boolean;
}
export interface GanttError { code: 'plan-schema' | 'plan-order' | 'branch-required' | 'branch-unknown' | 'quantity-required' | 'quantity-unit-mixed'; message: string; nodeId?: string }
export type GanttResult =
  | { ok: false; errors: GanttError[] }
  | {
    ok: true; planId: string; unit: '分鐘'; conditions: string[]; rows: GanttRow[];
    /** Null while any active row is incomplete. */
    total: number | null;
    /** Latest end among complete rows: the total can only be this long or longer. */
    lowerBound: number;
    incomplete: string[];
    disclaimer: string;
  };

interface PlanPort { port: string; flows: string[] }
interface PlanNodeLike {
  nodeId: string; name: string; category: NodeCategory; inputs: PlanPort[]; outputs: PlanPort[];
  timing: { state: 'missing' } | { state: 'specified'; setupMin: number; perUnitMin: number; quantityUnit: string };
}
interface PlanFlowLike { id: string; from: { node: string; port: string }; to: { node: string; port: string }; transferMin?: { state: 'missing' } | { state: 'specified'; minutes: number } }
interface PlanLike { planId: string; nodes: PlanNodeLike[]; flows: PlanFlowLike[]; order: string[] }

export function estimateGantt(input: unknown, cond: GanttConditions = {}): GanttResult {
  const shape = validateExecutablePlan(input);
  if (shape.length) return { ok: false, errors: shape.map(e => ({ code: 'plan-schema' as const, message: e.message })) };
  const plan = input as PlanLike;
  const nodes = new Map(plan.nodes.map(n => [n.nodeId, n]));
  const incoming = new Map<string, PlanFlowLike[]>();
  for (const f of plan.flows) incoming.set(f.to.node, [...(incoming.get(f.to.node) ?? []), f]);
  const branchChoices = cond.branchChoices ?? {};
  const errors: GanttError[] = [];

  const routedPorts = (n: PlanNodeLike) => n.outputs.filter(p => p.flows.length > 0).map(p => p.port);
  for (const [nodeId, port] of Object.entries(branchChoices)) {
    const n = nodes.get(nodeId);
    if (!n || n.category !== 'judge' || routedPorts(n).length < 2) errors.push({ code: 'branch-unknown', message: `「${nodeId}」不是有多個分支的判定節點，無法指定分支。`, nodeId });
    else if (!routedPorts(n).includes(port)) errors.push({ code: 'branch-unknown', message: `判定節點「${n.name}」沒有輸出埠位「${port}」，可選：${routedPorts(n).join('、')}。`, nodeId });
  }

  // Activation: a node is active when it starts the plan or any incoming flow is active. Only a judge with several
  // routed outputs deactivates flows, namely those leaving through ports other than the chosen one.
  const order = plan.order;
  const position = new Map(order.map((id, i) => [id, i]));
  for (const f of plan.flows) {
    if ((position.get(f.from.node) ?? Infinity) >= (position.get(f.to.node) ?? -1)) errors.push({ code: 'plan-order', message: `連線「${f.id}」違反計畫順序（${f.from.node} 應在 ${f.to.node} 之前）。` });
  }
  if (errors.length) return { ok: false, errors };
  const active = new Set<string>();
  const activeFlows = new Set<string>();
  for (const id of order) {
    const n = nodes.get(id)!;
    const ins = incoming.get(id) ?? [];
    if (ins.length === 0 || ins.some(f => activeFlows.has(f.id))) active.add(id);
    if (!active.has(id)) continue;
    const ports = routedPorts(n);
    const exclusive = n.category === 'judge' && ports.length > 1;
    if (exclusive && !branchChoices[id]) errors.push({ code: 'branch-required', message: `判定節點「${n.name}」有多個分支，請指定一個：${ports.join('、')}。`, nodeId: id });
    for (const out of n.outputs) {
      if (exclusive && out.port !== branchChoices[id]) continue;
      for (const flowId of out.flows) activeFlows.add(flowId);
    }
  }

  // Quantity: one number must serve every active per-unit duration, so their units must agree.
  const perUnit = [...active].map(id => nodes.get(id)!).filter(n => n.timing.state === 'specified' && n.timing.perUnitMin > 0);
  const units = [...new Set(perUnit.map(n => (n.timing as { quantityUnit: string }).quantityUnit))];
  if (perUnit.length && !(cond.quantity !== undefined && cond.quantity > 0)) errors.push({ code: 'quantity-required', message: '有節點的工時隨數量增加，請提供大於 0 的數量。' });
  if (units.length > 1) errors.push({ code: 'quantity-unit-mixed', message: `節點的數量單位不一致（${units.join('、')}），無法用同一個數量估算。` });
  if (errors.length) return { ok: false, errors };

  const quantity = cond.quantity ?? 0;
  const rows = new Map<string, GanttRow>();
  for (const id of order) {
    if (!active.has(id)) continue;
    const n = nodes.get(id)!;
    const reasons: string[] = [];
    let assumedZero = false;
    let start = 0, transferIn = 0;
    for (const f of (incoming.get(id) ?? []).filter(x => activeFlows.has(x.id))) {
      const pred = rows.get(f.from.node)!;
      if (pred.end === undefined) { reasons.push(`上游「${pred.name}」的結束時間未知`); continue; }
      let transfer = 0;
      if (f.transferMin?.state === 'specified') transfer = f.transferMin.minutes;
      else if (cond.treatMissingTransferAsZero) assumedZero = true;
      else { reasons.push(`連線「${f.id}」缺移轉時間`); continue; }
      transferIn = Math.max(transferIn, transfer);
      start = Math.max(start, pred.end + transfer);
    }
    const startKnown = reasons.length === 0;
    const authored = n.timing.state === 'specified';
    const milestone = !authored && CATEGORY_GROUP[n.category] !== 'activity';
    let duration: number | undefined;
    if (n.timing.state === 'specified') duration = n.timing.setupMin + n.timing.perUnitMin * quantity;
    else if (milestone) duration = 0;
    else reasons.push('缺工時');
    rows.set(id, {
      nodeId: id, name: n.name, milestone, transferIn, transferAssumedZero: assumedZero, reasons,
      ...(startKnown && { start }),
      ...(startKnown && duration !== undefined && { end: start + duration }),
    });
  }

  const list = [...rows.values()];
  const incomplete = list.filter(r => r.end === undefined).map(r => r.nodeId);
  const lowerBound = Math.max(0, ...list.map(r => r.end ?? 0));
  const conditions = [
    perUnit.length ? `數量：${quantity}（${units[0]}）` : '工時不隨數量變動',
    ...Object.entries(branchChoices).map(([nodeId, port]) => `分支：${nodes.get(nodeId)!.name} → ${port}`),
    ...(list.some(r => r.transferAssumedZero) ? ['部分連線未提供移轉時間，以 0 估算'] : []),
    ...(list.some(r => r.milestone) ? ['未填工時的邊界與結構節點視為里程碑，不佔時間'] : []),
    '不含重工預覽',
  ];
  return { ok: true, planId: plan.planId, unit: '分鐘', conditions, rows: list, total: incomplete.length ? null : lowerBound, lowerBound, incomplete, disclaimer: GANTT_DISCLAIMER };
}
