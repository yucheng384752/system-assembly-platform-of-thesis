/**
 * 事件驅動執行引擎（記憶體版）。
 *
 * 節點實例狀態：pending → held / ready → running → completed
 *                     ↘ skipped          ↘ faulted → （處置）
 * 輸入 port 三態：waiting / bound / dead（dead-path elimination）
 * 兩段式消耗：開工 reserved，完工 consumed。
 * 每個動作節點隱含 fault port：轉出時實體送到異常倉。
 *
 * 狀態只往前走；重試是同一實例的新 attempt，不是圖上的迴圈。
 */
import { CompileError, compile } from '../compile/compiler';
import {
  type ArtifactView,
  type CompiledRule,
  type EvalEnv,
  type LineageAccess,
  type Value,
  art,
  dt,
  evaluate,
  evaluateGuard,
  formatValue,
  fromJs,
  map,
} from '../expr/evaluator';
import { checkConditions } from '../resolve/decision';
import { compileRules, guardItems } from '../resolve/rules';
import { isLinear, isPortRequired, parseCardinality, TypeLibrary } from '../model/library';
import type { ActionLibrary, AttrDef, NodeDef, PortDef, ProjectFile } from '../model/types';
import { CATEGORY_GROUP } from '../model/types';
import { fromBase, isUnit, parseDuration, toBase, unitDim } from '../model/units';

// ---------------------------------------------------------------- 執行期型別

export type ArtifactStatus = 'available' | 'reserved' | 'consumed' | 'terminated';

export interface ArtifactRecord extends ArtifactView {
  status: ArtifactStatus;
  /** 目前歸屬的工單（在製品）；倉儲中的庫存為 undefined */
  workOrderId?: string;
  /** 被哪個節點實例保留 */
  reservedBy?: string;
  /** 由哪個節點實例產出 */
  producedBy?: string;
}

export type LineageRelation = 'derived_from' | 'describes' | 'supersedes';

export interface LineageRecord {
  child: string;
  parent: string;
  relation: LineageRelation;
  qtyUsed?: { value: number; unit: string };
}

export interface ArtifactEvent {
  artifactId: string;
  version: number;
  nodeKey?: string;
  event: string;
  at: number;
}

export type NodeState = 'pending' | 'held' | 'ready' | 'running' | 'faulted' | 'completed' | 'skipped' | 'cancelled';
export const TERMINAL_STATES: NodeState[] = ['completed', 'skipped', 'cancelled'];

export type FaultKind = 'guard' | 'where' | 'route' | 'cardinality' | 'execution' | 'timeout' | 'inventory';
export type Disposition = 'retry' | 'divert' | 'override' | 'cancel';

export interface FlowState {
  state: 'waiting' | 'delivered' | 'dead';
  artifacts: string[];
}

export interface NodeInstance {
  key: string; // `${workOrderId}:${nodeId}`
  workOrderId: string;
  nodeId: string;
  state: NodeState;
  attempt: number;
  message?: string;
  faultKind?: FaultKind;
  disposition?: Disposition;
  overridden?: boolean;
  heldSince?: number;
  readySince?: number;
  startedAt?: number;
  completedAt?: number;
  inputs: Record<string, string[]>;
  outputs: Record<string, string[]>;
  history: { at: number; from: NodeState; to: NodeState; note?: string }[];
}

export interface WorkOrder {
  id: string;
  templateId: string;
  templateVersion: number;
  /** 建立時鎖定的 template 快照：template 之後改版不影響此工單 */
  template: ProjectFile;
  status: 'open' | 'completed' | 'partial';
  priority: number;
  params: Record<string, unknown>;
  createdAt: number;
  flows: Record<string, FlowState>;
  nodes: Record<string, NodeInstance>;
  order: string[];
}

export interface EngineEvent {
  seq: number;
  at: number;
  type: string;
  workOrderId?: string;
  nodeId?: string;
  data?: Record<string, unknown>;
}

export interface CompletionInput {
  /** 指定某些輸出 port 的產出；未指定者依節點類別預設計算 */
  outputs?: Record<string, { qty?: { value: number; unit: string }; attrs?: Record<string, unknown> }[]>;
  /** 寫入產出 artifact 的 generated 屬性（覆蓋 node.sim） */
  attrs?: Record<string, unknown>;
}

export interface InventoryInput {
  id?: string;
  type: string;
  qty?: { value: number; unit: string };
  attrs?: Record<string, unknown>;
  location: string;
}

export interface CreateWorkOrderOptions {
  params?: Record<string, unknown>;
  priority?: number;
  /** 指定來源節點要取的 artifact id；未指定則自動從該倉儲撿料 */
  sources?: Record<string, string[]>;
  /** 專案引用的共用動作庫（v0.2） */
  libraries?: ActionLibrary[];
  /** 子流程引用的專案（以 id@version 查找，需為 published） */
  projects?: ProjectFile[];
}

export class EngineError extends Error {}

type SourcePlan = { picks: Record<string, ArtifactRecord[]> } | { fault: string; manual: boolean };

const STORAGE_BOUNDARIES = new Set(['warehouse', 'carrier-warehouse', 'exception']);
const AUTO_CATEGORIES = new Set(['sink', 'merge', 'broadcast']);

// ---------------------------------------------------------------- 引擎

export class Engine {
  clock: number;
  readonly artifacts = new Map<string, ArtifactRecord>();
  readonly lineage: LineageRecord[] = [];
  readonly artifactEvents: ArtifactEvent[] = [];
  readonly workOrders = new Map<string, WorkOrder>();
  readonly events: EngineEvent[] = [];
  private seq = 0;
  private artifactSeq = 0;
  private woSeq = 0;
  private readonly ruleCache = new Map<string, Record<string, CompiledRule>>();

  constructor(opts: { now?: number } = {}) {
    this.clock = opts.now ?? Date.parse('2026-01-01T08:00:00Z');
  }

  // ------------------------------------------------------------ 基礎

  private emit(type: string, data?: Omit<EngineEvent, 'seq' | 'at' | 'type'>) {
    this.events.push({ seq: ++this.seq, at: this.clock, type, ...data });
  }

  private lib(wo: WorkOrder): TypeLibrary {
    return TypeLibrary.fromProject(wo.template);
  }

  private node(wo: WorkOrder, nodeId: string): NodeDef {
    const n = wo.template.nodes.find((x) => x.id === nodeId);
    if (!n) throw new EngineError(`找不到節點 ${nodeId}`);
    return n;
  }

  getWorkOrder(id: string): WorkOrder {
    const wo = this.workOrders.get(id);
    if (!wo) throw new EngineError(`找不到工單 ${id}`);
    return wo;
  }

  instance(woId: string, nodeId: string): NodeInstance {
    const inst = this.getWorkOrder(woId).nodes[nodeId];
    if (!inst) throw new EngineError(`工單 ${woId} 沒有節點 ${nodeId}`);
    return inst;
  }

  private setState(wo: WorkOrder, inst: NodeInstance, to: NodeState, note?: string) {
    if (inst.state === to) return;
    inst.history.push({ at: this.clock, from: inst.state, to, note });
    this.emit('node.state', { workOrderId: wo.id, nodeId: inst.nodeId, data: { from: inst.state, to, note } });
    inst.state = to;
    if (to === 'held') inst.heldSince ??= this.clock;
    if (to !== 'held') inst.heldSince = undefined;
    if (to === 'ready') inst.readySince = this.clock;
  }

  private newId(): string {
    return `A${String(++this.artifactSeq).padStart(4, '0')}`;
  }

  lineageAccess(wo?: WorkOrder): LineageAccess {
    const lib = wo ? this.lib(wo) : new TypeLibrary([]);
    return {
      get: (id) => this.artifacts.get(id),
      upstream: (id, pattern, maxDepth) => {
        const out: ArtifactView[] = [];
        const seen = new Set([id]);
        let frontier = [id];
        for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
          const next: string[] = [];
          for (const cur of frontier) {
            for (const l of this.lineage) {
              if (l.relation !== 'derived_from' || l.child !== cur || seen.has(l.parent)) continue;
              seen.add(l.parent);
              next.push(l.parent);
              const a = this.artifacts.get(l.parent);
              if (a && lib.isA(a.type, pattern)) out.push(a);
            }
          }
          frontier = next;
        }
        return out;
      },
      describes: (id, pattern) =>
        this.lineage
          .filter((l) => l.relation === 'describes' && l.parent === id)
          .map((l) => this.artifacts.get(l.child))
          .filter((a): a is ArtifactRecord => !!a && lib.isA(a.type, pattern))
          .sort((a, b) => a.createdAt - b.createdAt),
    };
  }

  // ------------------------------------------------------------ 庫存

  addInventory(input: InventoryInput): ArtifactRecord {
    const id = input.id ?? this.newId();
    if (this.artifacts.has(id)) throw new EngineError(`artifact id 重複：${id}`);
    const a: ArtifactRecord = {
      id,
      type: input.type,
      version: 1,
      qty: input.qty,
      attrs: { ...(input.attrs ?? {}) },
      location: input.location,
      createdAt: this.clock,
      status: 'available',
    };
    this.artifacts.set(id, a);
    this.artifactEvents.push({ artifactId: id, version: 1, event: 'received', at: this.clock });
    this.emit('artifact.received', { data: { id, type: a.type, location: a.location } });
    return a;
  }

  // ------------------------------------------------------------ 工單

  createWorkOrder(project: ProjectFile, opts: CreateWorkOrderOptions = {}): WorkOrder {
    const c = compile(project, opts.libraries, opts.projects);
    if (!c.ok || !c.plan || !c.resolved) throw new CompileError(c.diagnostics);
    // 鎖定「展開後」的快照：動作庫之後改版也不影響此工單
    const template = structuredClone(c.resolved);
    const id = `WO-${String(++this.woSeq).padStart(4, '0')}`;
    const params: Record<string, unknown> = {};
    for (const p of template.params ?? []) if (p.default !== undefined) params[p.id] = p.default;
    Object.assign(params, opts.params ?? {});
    const wo: WorkOrder = {
      id,
      templateId: template.meta.id,
      templateVersion: template.meta.version,
      template,
      status: 'open',
      priority: opts.priority ?? 0,
      params,
      createdAt: this.clock,
      flows: Object.fromEntries(template.flows.map((f) => [f.id, { state: 'waiting', artifacts: [] } as FlowState])),
      nodes: {},
      order: c.plan.order,
    };
    for (const n of template.nodes) {
      wo.nodes[n.id] = {
        key: `${id}:${n.id}`,
        workOrderId: id,
        nodeId: n.id,
        state: 'pending',
        attempt: 1,
        inputs: {},
        outputs: {},
        history: [],
      };
    }
    // 來源節點：先規劃全部取料（不改任何狀態）。手動指定不合法時直接拒絕，不建立工單
    const sources = template.nodes.filter((x) => x.category === 'source');
    for (const key of Object.keys(opts.sources ?? {})) {
      if (!sources.some((n) => n.id === key)) throw new EngineError(`指定取料的節點「${key}」不是來源節點`);
    }
    const plans = new Map<string, SourcePlan>();
    for (const n of sources) {
      const plan = this.planSource(wo, n, opts.sources?.[n.id]);
      if ('fault' in plan && plan.manual) {
        this.ruleCache.delete(id);
        throw new EngineError(`「${n.name}」手動指定的取料不合法：${plan.fault}`);
      }
      plans.set(n.id, plan);
    }

    this.workOrders.set(id, wo);
    this.emit('workorder.created', { workOrderId: id, data: { template: `${wo.templateId}@${wo.templateVersion}`, params } });
    for (const n of sources) this.applySource(wo, n, plans.get(n.id)!);
    this.process(wo.id);
    return wo;
  }

  private env(wo: WorkOrder, vars: Record<string, Value>): EvalEnv {
    let rules = this.ruleCache.get(wo.id);
    if (!rules) {
      rules = compileRules(wo.template.rules).rules;
      this.ruleCache.set(wo.id, rules);
    }
    return {
      vars: { params: fromJs(wo.params), now: dt(this.clock), ...vars },
      library: this.lib(wo),
      lineage: this.lineageAccess(wo),
      maxDepth: wo.template.settings?.lineageMaxDepth ?? 10,
      rules,
    };
  }

  /**
   * 某個 artifact 能否被來源節點的 port 撿取；可以時回傳 undefined，否則回傳原因。
   * 自動撿料與手動指定共用這套檢查（位置、狀態、歸屬、型別、where）。
   */
  pickReason(wo: WorkOrder, n: NodeDef, port: PortDef, a: ArtifactRecord): string | undefined {
    if (a.status !== 'available') return `${a.id} 狀態為 ${a.status}`;
    if (a.workOrderId) return `${a.id} 已配置給工單 ${a.workOrderId}`;
    if (n.boundary?.location && a.location !== n.boundary.location) return `${a.id} 位於 ${a.location ?? '未知位置'}，不在 ${n.boundary.location}`;
    if (!this.lib(wo).isA(a.type, port.type)) return `${a.id} 的型別 ${a.type} 不符合 ${port.type}`;
    if (port.where) {
      const r = evaluateGuard(port.where, this.env(wo, { self: art(a) }));
      if (r.status === 'false') return `${a.id} 不符合取料條件：${r.message}`;
      if (r.status === 'error') return `${a.id} 取料條件錯誤：${r.message}`;
    }
    return undefined;
  }

  /** 列出某來源節點 port 目前可撿的庫存（已套用全部取料規則） */
  candidates(wo: WorkOrder, nodeId: string, portId: string): ArtifactRecord[] {
    const n = wo.template.nodes.find((x) => x.id === nodeId);
    const port = n?.outputs.find((p) => p.id === portId);
    if (!n || !port) return [];
    return [...this.artifacts.values()].filter((a) => !this.pickReason(wo, n, port, a));
  }

  /** 規劃來源節點所有輸出 port 的取料；全部成功才回傳 picks，不修改任何狀態 */
  private planSource(wo: WorkOrder, n: NodeDef, chosen?: string[]): SourcePlan {
    const picks: Record<string, ArtifactRecord[]> = {};
    const used = new Set<string>();
    const need = (port: PortDef) => {
      const card = parseCardinality(port.cardinality);
      return { min: Math.max(card.min, 1), max: card.max };
    };
    if (chosen) {
      const seen = new Set<string>();
      for (const id of chosen) {
        if (seen.has(id)) return { fault: `${id} 重複指定`, manual: true };
        seen.add(id);
        const a = this.artifacts.get(id);
        if (!a) return { fault: `找不到 ${id}`, manual: true };
        const reasons: string[] = [];
        const port = n.outputs.find((p) => {
          if ((picks[p.id]?.length ?? 0) >= need(p).max) return false;
          const why = this.pickReason(wo, n, p, a);
          if (why) reasons.push(why);
          return !why;
        });
        if (!port) return { fault: reasons[0] ?? `${id} 超過可取數量上限`, manual: true };
        (picks[port.id] ??= []).push(a);
      }
      for (const port of n.outputs) {
        const got = picks[port.id]?.length ?? 0;
        if (got < need(port).min) return { fault: `${port.id} 需要至少 ${need(port).min} 個 ${port.type}，只指定了 ${got} 個`, manual: true };
      }
      return { picks };
    }
    for (const port of n.outputs) {
      const { min, max } = need(port);
      const list = this.candidates(wo, n.id, port.id).filter((a) => !used.has(a.id));
      const take = list.slice(0, Number.isFinite(max) ? max : undefined);
      if (take.length < min) {
        return { fault: `庫存不足：${n.boundary?.location ?? ''} 找不到符合條件的 ${port.type}（需要 ${min}，可用 ${take.length}）`, manual: false };
      }
      take.forEach((a) => used.add(a.id));
      picks[port.id] = take;
    }
    return { picks };
  }

  /** 套用取料規劃：全部配置或全部不配置 */
  private applySource(wo: WorkOrder, n: NodeDef, plan: SourcePlan) {
    const inst = wo.nodes[n.id];
    if ('fault' in plan) {
      inst.faultKind = 'inventory';
      inst.message = plan.fault;
      this.setState(wo, inst, 'faulted', plan.fault);
      return;
    }
    for (const [portId, list] of Object.entries(plan.picks)) {
      for (const a of list) {
        a.workOrderId = wo.id;
        this.artifactEvents.push({ artifactId: a.id, version: a.version, nodeKey: inst.key, event: 'allocated', at: this.clock });
      }
      inst.outputs[portId] = list.map((a) => a.id);
    }
    this.finishNode(wo, inst, n);
  }

  // ------------------------------------------------------------ 推進

  /** 重新評估工單內所有未結束的節點，直到不再變化 */
  process(woId: string): void {
    const wo = this.getWorkOrder(woId);
    if (wo.status !== 'open') return;
    for (let guard = 0; guard < 1000; guard++) {
      let changed = false;
      for (const nodeId of wo.order) {
        const inst = wo.nodes[nodeId];
        const before = inst.state;
        const n = this.node(wo, nodeId);
        if (inst.state === 'pending' || inst.state === 'held') this.evaluate(wo, inst, n);
        if (inst.state === 'ready' && AUTO_CATEGORIES.has(n.category)) this.autoComplete(wo, inst, n);
        if (inst.state === 'ready' && n.category === 'hold') this.doStart(wo, inst);
        if (inst.state === 'running' && n.category === 'hold') this.checkHold(wo, inst, n);
        if (inst.state !== before) changed = true;
      }
      if (!changed) break;
    }
    const all = Object.values(wo.nodes);
    if (all.every((x) => TERMINAL_STATES.includes(x.state))) {
      wo.status = all.some((x) => x.state === 'cancelled') ? 'partial' : 'completed';
      this.releaseStranded(wo);
      this.emit('workorder.closed', { workOrderId: wo.id, data: { status: wo.status } });
    }
  }

  /** 工單結束時仍歸屬此工單的實體：倉儲中的解除配置；在製品送異常倉 */
  private releaseStranded(wo: WorkOrder) {
    const exception = wo.template.settings?.exceptionLocation ?? 'wh.exception';
    for (const a of this.artifacts.values()) {
      if (a.workOrderId !== wo.id || a.status === 'consumed' || a.status === 'terminated') continue;
      this.release(a, wo, undefined, exception);
    }
  }

  /** 釋放一個實體：在製品（wip:）移到異常倉，倉儲中的原地解除配置 */
  private release(a: ArtifactRecord, wo: WorkOrder, nodeKey: string | undefined, exception: string, forceMove = false) {
    const wip = a.location?.startsWith('wip:') ?? false;
    a.status = 'available';
    a.reservedBy = undefined;
    a.workOrderId = undefined;
    if (wip || forceMove) {
      a.location = exception;
      a.version++;
    }
    this.artifactEvents.push({ artifactId: a.id, version: a.version, nodeKey, event: wip || forceMove ? 'diverted' : 'released', at: this.clock });
    void wo;
  }

  private flowsInto(wo: WorkOrder, nodeId: string, portId?: string) {
    return wo.template.flows.filter((f) => f.to.node === nodeId && (portId === undefined || f.to.port === portId));
  }

  private portState(wo: WorkOrder, nodeId: string, port: PortDef): { state: 'waiting' | 'bound' | 'dead'; artifacts: string[] } {
    const fs = this.flowsInto(wo, nodeId, port.id).map((f) => wo.flows[f.id]);
    if (!fs.length) return { state: 'dead', artifacts: [] };
    if (fs.some((f) => f.state === 'waiting')) return { state: 'waiting', artifacts: [] };
    const artifacts = fs.flatMap((f) => f.artifacts);
    return { state: artifacts.length ? 'bound' : 'dead', artifacts };
  }

  private evaluate(wo: WorkOrder, inst: NodeInstance, n: NodeDef) {
    if (n.category === 'source') return;
    // held 逾時
    if (inst.state === 'held' && n.params?.maxWait && inst.heldSince !== undefined) {
      if (this.clock - inst.heldSince > parseDuration(n.params.maxWait)) {
        inst.faultKind = 'timeout';
        inst.message = `等待超過 ${n.params.maxWait}：${inst.message ?? ''}`;
        this.setState(wo, inst, 'faulted', inst.message);
        return;
      }
    }

    const bound: Record<string, string[]> = {};
    if (n.category === 'merge') {
      const fs = this.flowsInto(wo, n.id).map((f) => wo.flows[f.id]);
      const delivered = fs.filter((f) => f.state === 'delivered');
      if (delivered.length) {
        bound[n.inputs[0]?.id ?? 'in'] = delivered.flatMap((f) => f.artifacts);
      } else if (fs.every((f) => f.state === 'dead')) {
        this.skip(wo, inst, '所有匯流輸入皆為 dead');
        return;
      } else return;
    } else {
      let waiting = false;
      for (const port of n.inputs) {
        const ps = this.portState(wo, n.id, port);
        if (ps.state === 'dead' && isPortRequired(port)) {
          this.skip(wo, inst, `必要輸入 ${port.id} 為 dead`);
          return;
        }
        if (ps.state === 'waiting') waiting = true;
        if (ps.state === 'bound') bound[port.id] = ps.artifacts;
      }
      if (waiting) return; // 選填輸入也要等到確定（bound 或 dead）
    }
    inst.inputs = bound;
    this.applyConditions(wo, inst, n);
  }

  /** cardinality → where → guard；開工前也會再檢查一次（條件可能隨時間改變） */
  private applyConditions(wo: WorkOrder, inst: NodeInstance, n: NodeDef): boolean {

    // cardinality
    for (const port of n.inputs) {
      const count = inst.inputs[port.id]?.length ?? 0;
      if (!count) continue;
      const card = parseCardinality(port.cardinality);
      if (count < card.min || count > card.max) {
        inst.faultKind = 'cardinality';
        inst.message = `輸入 ${port.id} 數量 ${count} 不符合 cardinality ${port.cardinality ?? '1'}`;
        this.setState(wo, inst, 'faulted', inst.message);
        return false;
      }
    }

    if (!inst.overridden) {
      // where
      for (const port of n.inputs) {
        if (!port.where) continue;
        for (const id of inst.inputs[port.id] ?? []) {
          const a = this.artifacts.get(id)!;
          const r = evaluateGuard(port.where, this.env(wo, { self: art(a) }));
          this.emit('guard.evaluated', { workOrderId: wo.id, nodeId: n.id, data: { kind: 'where', port: port.id, artifact: id, status: r.status, now: this.clock } });
          if (r.status === 'error') {
            inst.faultKind = 'where';
            inst.message = `${port.id} 的 where 錯誤（${id}）：${r.message}`;
            this.setState(wo, inst, 'faulted', inst.message);
            return false;
          }
          if (r.status === 'false') {
            inst.message = `${port.id}（${id}）：${r.message}`;
            this.setState(wo, inst, 'held', inst.message);
            return false;
          }
        }
      }
      // guard：具名條件清單，全部成立才 ready
      const items = guardItems(n.guard);
      if (items.length) {
        const env = this.env(wo, { in: this.inVars(wo, n, inst.inputs) });
        const errors: string[] = [];
        const falses: string[] = [];
        for (const g of items) {
          const r = evaluateGuard(g.when, env);
          this.emit('guard.evaluated', { workOrderId: wo.id, nodeId: n.id, data: { kind: 'guard', label: g.label, status: r.status, message: r.message, now: this.clock } });
          if (r.status === 'error') errors.push(`${g.label}：${r.message}`);
          if (r.status === 'false') falses.push(`${g.label} ✗（${r.message}）`);
        }
        if (errors.length) {
          inst.faultKind = 'guard';
          inst.message = `條件錯誤：${errors.join('；')}`;
          this.setState(wo, inst, 'faulted', inst.message);
          return false;
        }
        if (falses.length) {
          inst.message = falses.join('；');
          this.setState(wo, inst, 'held', inst.message);
          return false;
        }
      }
    }
    inst.message = undefined;
    this.setState(wo, inst, 'ready');
    return true;
  }

  private inVars(wo: WorkOrder, n: NodeDef, bound: Record<string, string[]>): Value {
    const m: Record<string, Value> = {};
    for (const port of n.inputs) {
      const ids = bound[port.id];
      if (!ids) continue;
      const arts = ids.map((id) => art(this.artifacts.get(id)!));
      const single = parseCardinality(port.cardinality).max <= 1;
      m[port.id] = single ? arts[0] : arts;
    }
    return { k: 'map', m };
  }

  private skip(wo: WorkOrder, inst: NodeInstance, note: string) {
    inst.message = note;
    this.setState(wo, inst, 'skipped', note);
    for (const f of wo.template.flows.filter((x) => x.from.node === inst.nodeId)) {
      wo.flows[f.id] = { state: 'dead', artifacts: [] };
    }
  }

  // ------------------------------------------------------------ 操作

  /** 派工：ready → running，輸入改為 reserved */
  start(woId: string, nodeId: string): NodeInstance {
    const wo = this.getWorkOrder(woId);
    const inst = this.instance(woId, nodeId);
    this.doStart(wo, inst);
    this.process(woId);
    return inst;
  }

  private doStart(wo: WorkOrder, inst: NodeInstance) {
    const nodeId = inst.nodeId;
    if (inst.state !== 'ready') throw new EngineError(`節點 ${nodeId} 狀態為 ${inst.state}，只有 ready 可以開工`);
    // 開工前再檢查一次：ready 之後時間可能已經過去（例如期限到期）
    if (!this.applyConditions(wo, inst, this.node(wo, nodeId))) return;
    for (const ids of Object.values(inst.inputs)) {
      for (const id of ids) {
        const a = this.artifacts.get(id)!;
        if (isLinear(this.lib(wo).tryResolve(a.type)?.kind)) {
          if (a.status !== 'available' && !(a.status === 'reserved' && a.reservedBy === inst.key)) {
            throw new EngineError(`artifact ${id} 狀態為 ${a.status}，無法保留`);
          }
          a.status = 'reserved';
          a.reservedBy = inst.key;
        }
      }
    }
    inst.startedAt = this.clock;
    this.setState(wo, inst, 'running', inst.attempt > 1 ? `第 ${inst.attempt} 次嘗試` : undefined);
  }

  /** 完工：寫入產出、消耗輸入、把 artifact 交給下游 */
  complete(woId: string, nodeId: string, input: CompletionInput = {}): NodeInstance {
    const wo = this.getWorkOrder(woId);
    const inst = this.instance(woId, nodeId);
    const n = this.node(wo, nodeId);
    if (inst.state !== 'running') throw new EngineError(`節點 ${nodeId} 狀態為 ${inst.state}，只有 running 可以完工`);
    this.commitProduce(wo, inst, n, input);
    this.process(woId);
    return inst;
  }

  /**
   * 原子性完工：先在交易中計算並驗證全部產出，成功才交給下游；
   * 任何一步失敗都完整回復（不留下部分產出、lineage、事件或屬性變更），節點進入 faulted。
   */
  private commitProduce(wo: WorkOrder, inst: NodeInstance, n: NodeDef, input: CompletionInput): boolean {
    try {
      this.atomically(Object.values(inst.inputs).flat(), () => this.produce(wo, inst, n, input));
    } catch (e) {
      inst.faultKind = e instanceof RouteError ? 'route' : 'execution';
      inst.message = (e as Error).message;
      this.setState(wo, inst, 'faulted', inst.message);
      return false;
    }
    this.finishNode(wo, inst, n);
    return true;
  }

  /** 交易：fn 拋錯時回復 artifact、lineage、artifact 事件、引擎事件與序號 */
  private atomically(touched: string[], fn: () => void) {
    const seq = this.artifactSeq;
    const lineageLen = this.lineage.length;
    const artifactEventsLen = this.artifactEvents.length;
    const eventsLen = this.events.length;
    const eventSeq = this.seq;
    const existing = new Set(this.artifacts.keys());
    const backup = touched.map((id) => structuredClone(this.artifacts.get(id)!)).filter(Boolean);
    try {
      fn();
    } catch (e) {
      for (const id of [...this.artifacts.keys()]) if (!existing.has(id)) this.artifacts.delete(id);
      for (const b of backup) this.artifacts.set(b.id, b);
      this.lineage.length = lineageLen;
      this.artifactEvents.length = artifactEventsLen;
      this.events.length = eventsLen;
      this.seq = eventSeq;
      this.artifactSeq = seq;
      throw e;
    }
  }

  /** 回報異常：ready / running / held → faulted */
  fault(woId: string, nodeId: string, reason: string): NodeInstance {
    const wo = this.getWorkOrder(woId);
    const inst = this.instance(woId, nodeId);
    if (!['ready', 'running', 'held', 'pending'].includes(inst.state)) throw new EngineError(`節點 ${nodeId} 狀態為 ${inst.state}，無法回報異常`);
    inst.faultKind = 'execution';
    inst.message = reason;
    this.setState(wo, inst, 'faulted', reason);
    return inst;
  }

  /** 異常處置 */
  dispose(woId: string, nodeId: string, action: Disposition, opts: { by?: string; note?: string } = {}): NodeInstance {
    const wo = this.getWorkOrder(woId);
    const inst = this.instance(woId, nodeId);
    const n = this.node(wo, nodeId);
    const allowed = action === 'override' ? ['faulted', 'held'] : action === 'retry' ? ['faulted'] : ['faulted', 'held', 'pending', 'ready'];
    if (!allowed.includes(inst.state)) throw new EngineError(`節點 ${nodeId} 狀態為 ${inst.state}，不能執行「${action}」`);
    inst.disposition = action;
    this.emit('node.disposed', { workOrderId: wo.id, nodeId, data: { action, by: opts.by, note: opts.note } });

    switch (action) {
      case 'retry': {
        if (n.category === 'source') {
          inst.attempt++;
          const plan = this.planSource(wo, n);
          if ('fault' in plan) {
            inst.message = plan.fault; // 仍然不足：維持 faulted，不配置任何料
            break;
          }
          this.setState(wo, inst, 'pending', `重試（第 ${inst.attempt} 次）`);
          inst.faultKind = undefined;
          this.applySource(wo, n, plan);
          break;
        }
        inst.attempt++;
        inst.faultKind = undefined;
        inst.message = undefined;
        this.setState(wo, inst, 'pending', `重試（第 ${inst.attempt} 次）`);
        break;
      }
      case 'override': {
        if (!opts.by) throw new EngineError('放行必須指定授權人（by）');
        if (inst.faultKind && !['guard', 'where', 'timeout'].includes(inst.faultKind)) {
          throw new EngineError(`「${inst.faultKind}」類型的異常不能放行，請改用重試、轉出或取消`);
        }
        const subjects = Object.values(inst.inputs).flat();
        const approval = this.createArtifact(wo, inst, 'info.approval', undefined, {
          approver: opts.by,
          decision: 'override',
          note: opts.note ?? inst.message ?? '',
        });
        for (const s of subjects) this.lineage.push({ child: approval.id, parent: s, relation: 'describes' });
        inst.overridden = true;
        inst.faultKind = undefined;
        this.setState(wo, inst, 'pending', `放行：${opts.by}`);
        break;
      }
      case 'divert':
      case 'cancel': {
        const location = wo.template.settings?.exceptionLocation ?? 'wh.exception';
        // 已送達此節點的實體（含尚未開工、仍在倉儲中的配置料）
        const delivered = this.flowsInto(wo, nodeId).flatMap((f) => (wo.flows[f.id].state === 'delivered' ? wo.flows[f.id].artifacts : []));
        for (const id of new Set([...Object.values(inst.inputs).flat(), ...delivered])) {
          const a = this.artifacts.get(id)!;
          if (!isLinear(this.lib(wo).tryResolve(a.type)?.kind) || a.status === 'consumed' || a.status === 'terminated') continue;
          // 轉出：一律送異常倉；取消：在製品送異常倉，倉儲中的配置料原地釋放
          this.release(a, wo, inst.key, location, action === 'divert');
        }
        inst.message = action === 'divert' ? `轉出至 ${location}${opts.note ? `：${opts.note}` : ''}` : `取消${opts.note ? `：${opts.note}` : ''}`;
        this.setState(wo, inst, 'cancelled', inst.message);
        for (const f of wo.template.flows.filter((x) => x.from.node === nodeId)) wo.flows[f.id] = { state: 'dead', artifacts: [] };
        break;
      }
    }
    this.process(woId);
    return inst;
  }

  /** 推進模擬時鐘 */
  advanceTime(ms: number): void {
    this.clock += ms;
    this.emit('clock.advanced', { data: { ms } });
    for (const wo of this.workOrders.values()) if (wo.status === 'open') this.process(wo.id);
  }

  /** 排程：所有工單的 ready 動作節點，依優先序、ready 時間排序 */
  readyQueue(): NodeInstance[] {
    const out: { inst: NodeInstance; prio: number }[] = [];
    for (const wo of this.workOrders.values()) {
      if (wo.status !== 'open') continue;
      for (const inst of Object.values(wo.nodes)) {
        if (inst.state === 'ready' && CATEGORY_GROUP[this.node(wo, inst.nodeId).category] === 'activity') out.push({ inst, prio: wo.priority });
      }
    }
    return out.sort((a, b) => b.prio - a.prio || (a.inst.readySince ?? 0) - (b.inst.readySince ?? 0)).map((x) => x.inst);
  }

  /** 模擬一步：派工並完工佇列中第一個 ready 節點；沒有時推進到下一個保持節點完成時間 */
  step(woId?: string): { done: boolean; note: string } {
    const queue = this.readyQueue().filter((i) => !woId || i.workOrderId === woId);
    const next = queue[0];
    if (next) {
      this.start(next.workOrderId, next.nodeId);
      const inst = this.instance(next.workOrderId, next.nodeId);
      if (inst.state === 'running') this.complete(next.workOrderId, next.nodeId);
      return { done: false, note: `${next.nodeId}：${this.instance(next.workOrderId, next.nodeId).state}` };
    }
    const wake = this.nextWakeTime(woId);
    if (wake !== undefined && wake > this.clock) {
      this.advanceTime(wake - this.clock);
      return { done: false, note: `時間推進至 ${new Date(this.clock).toISOString()}` };
    }
    return { done: true, note: '沒有可執行的節點' };
  }

  /** 自動執行直到停止（完成、或卡在 held / faulted） */
  runAuto(woId?: string, maxSteps = 500): { steps: number; note: string } {
    let steps = 0;
    for (; steps < maxSteps; steps++) {
      const r = this.step(woId);
      if (r.done) return { steps, note: r.note };
    }
    return { steps, note: `達到步數上限 ${maxSteps}` };
  }

  private nextWakeTime(woId?: string): number | undefined {
    let best: number | undefined;
    for (const wo of this.workOrders.values()) {
      if (wo.status !== 'open' || (woId && wo.id !== woId)) continue;
      for (const inst of Object.values(wo.nodes)) {
        const n = this.node(wo, inst.nodeId);
        if (inst.state === 'running' && n.category === 'hold' && inst.startedAt !== undefined) {
          const t = inst.startedAt + (n.params?.minDuration ? parseDuration(n.params.minDuration) : 0);
          best = best === undefined ? t : Math.min(best, t);
        }
      }
    }
    return best;
  }

  private checkHold(wo: WorkOrder, inst: NodeInstance, n: NodeDef) {
    const min = n.params?.minDuration ? parseDuration(n.params.minDuration) : 0;
    if (inst.startedAt !== undefined && this.clock - inst.startedAt >= min) this.commitProduce(wo, inst, n, {});
  }

  private autoComplete(wo: WorkOrder, inst: NodeInstance, n: NodeDef) {
    inst.startedAt = this.clock;
    this.setState(wo, inst, 'running');
    this.commitProduce(wo, inst, n, {});
  }

  /** 依 inst.outputs 把產出交給下游，並設為 completed */
  private finishNode(wo: WorkOrder, inst: NodeInstance, n: NodeDef) {
    for (const port of n.outputs) {
      const ids = inst.outputs[port.id] ?? [];
      for (const f of wo.template.flows.filter((x) => x.from.node === n.id && x.from.port === port.id)) {
        wo.flows[f.id] = ids.length ? { state: 'delivered', artifacts: [...ids] } : { state: 'dead', artifacts: [] };
      }
    }
    inst.completedAt = this.clock;
    this.setState(wo, inst, 'completed');
  }

  // ------------------------------------------------------------ 產出

  private createArtifact(
    wo: WorkOrder,
    inst: NodeInstance,
    type: string,
    qty: { value: number; unit: string } | undefined,
    attrs: Record<string, unknown>,
  ): ArtifactRecord {
    const kind = this.lib(wo).tryResolve(type)?.kind;
    const a: ArtifactRecord = {
      id: this.newId(),
      type,
      version: 1,
      qty,
      attrs,
      location: kind === 'information' ? undefined : `wip:${wo.id}`,
      createdAt: this.clock,
      status: 'available',
      workOrderId: kind === 'information' ? undefined : wo.id,
      producedBy: inst.key,
    };
    this.artifacts.set(a.id, a);
    this.artifactEvents.push({ artifactId: a.id, version: 1, nodeKey: inst.key, event: 'produced', at: this.clock });
    this.emit('artifact.produced', { workOrderId: wo.id, nodeId: inst.nodeId, data: { id: a.id, type } });
    return a;
  }

  private versionUp(wo: WorkOrder, inst: NodeInstance, a: ArtifactRecord, change: Partial<Pick<ArtifactRecord, 'qty' | 'attrs' | 'location'>>, event: string) {
    a.version++;
    if (change.qty) a.qty = change.qty;
    if (change.attrs) a.attrs = { ...a.attrs, ...change.attrs };
    if (change.location) a.location = change.location;
    a.status = 'available';
    a.reservedBy = undefined;
    a.workOrderId = wo.id;
    this.artifactEvents.push({ artifactId: a.id, version: a.version, nodeKey: inst.key, event, at: this.clock });
  }

  private generated(wo: WorkOrder, type: string, n: NodeDef, input: CompletionInput): Record<string, unknown> {
    const src = { ...(n.sim ?? {}), ...(input.attrs ?? {}) };
    const defs = this.lib(wo).tryResolve(type)?.attributes ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (!Object.keys(defs).length || defs[k]?.source === 'generated') out[k] = v;
    }
    return out;
  }

  /** 依合併策略計算繼承屬性 */
  private inherited(wo: WorkOrder, outType: string, parents: ArtifactRecord[]): Record<string, unknown> {
    const defs = this.lib(wo).tryResolve(outType)?.attributes ?? {};
    const out: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(defs)) {
      if (def.source !== 'inherited') continue;
      const vals = parents.filter((p) => p.attrs[name] !== undefined).map((p) => ({ v: p.attrs[name], w: p.qty ? toBase(p.qty.value, p.qty.unit) : 1 }));
      if (!vals.length) continue;
      out[name] = mergeValues(name, def, vals);
    }
    return out;
  }

  /** 評估檢驗項目並決定判定結果（verdict = 輸出 port id） */
  private runChecks(wo: WorkOrder, n: NodeDef, env: EvalEnv): { verdict: string; failed: Record<string, number>; results: CheckResult[] } {
    const failed = { critical: 0, major: 0, minor: 0, total: 0 };
    const results: CheckResult[] = [];
    const checkMap: Record<string, Value> = {};
    const show = (expr: string | undefined) => {
      if (!expr?.trim()) return undefined;
      try {
        return formatValue(evaluate(expr, env));
      } catch {
        return expr;
      }
    };
    for (const c of n.checks ?? []) {
      let value: string;
      try {
        value = formatValue(evaluate(c.value, env));
      } catch (e) {
        throw new RouteError(`檢驗項目「${c.label}」無法取得實測值：${(e as Error).message}`);
      }
      let pass = true;
      for (const cond of checkConditions(c)) {
        const r = evaluateGuard(cond, env);
        if (r.status === 'error') throw new RouteError(`檢驗項目「${c.label}」錯誤：${r.message}`);
        if (r.status === 'false') pass = false;
      }
      const level = c.level ?? 'major';
      if (!pass) {
        failed[level]++;
        failed.total++;
      }
      checkMap[c.id] = pass;
      results.push({ id: c.id, label: c.label, level, value, min: show(c.min), max: show(c.max), equals: show(c.equals), oneOf: show(c.oneOf), pass });
    }
    this.emit('checks.evaluated', { workOrderId: wo.id, nodeId: n.id, data: { failed, results: results.map((r) => `${r.label}=${r.value}${r.pass ? '✓' : '✗'}`), now: this.clock } });
    let verdict: string | undefined;
    if (n.verdicts?.length) {
      const venv: EvalEnv = { ...env, vars: { ...env.vars, failed: fromJs(failed), check: map(checkMap) } };
      for (const v of n.verdicts) {
        if (v.when.trim() === 'otherwise') {
          verdict = v.verdict;
          break;
        }
        const r = evaluateGuard(v.when, venv);
        if (r.status === 'error') throw new RouteError(`判定結果規則錯誤：${r.message}`);
        if (r.status === 'true') {
          verdict = v.verdict;
          break;
        }
      }
    } else verdict = failed.total === 0 ? 'ok' : 'ng';
    if (!verdict) throw new RouteError('判定結果規則沒有任何一條成立（缺少 otherwise）');
    if (!n.outputs.some((o) => o.id === verdict)) throw new RouteError(`判定結果「${verdict}」沒有對應的輸出 port`);
    return { verdict, failed, results };
  }

  /** 驗證產出：cardinality、數量與單位、序號件、數量守恆（strict／tolerance／yield） */
  private validateOutputs(wo: WorkOrder, n: NodeDef, outputs: Record<string, string[]>, inBase: number, inst: NodeInstance) {
    const lib = this.lib(wo);
    let outBase = 0;
    let comparable = CONSERVING.has(n.category);
    let mode: 'strict' | 'tolerance' | 'yield' = 'strict';
    let tolerance = 0.005;
    let modeSet = false;
    const fresh = (id: string) => this.artifacts.get(id)!;
    for (const port of n.outputs) {
      const ids = outputs[port.id] ?? [];
      const card = parseCardinality(port.cardinality);
      if (ids.length > card.max) throw new EngineError(`輸出 ${port.id} 產出 ${ids.length} 個，超過 cardinality ${port.cardinality ?? '1'}`);
      const rt = lib.tryResolve(port.type.endsWith('.*') ? port.type.slice(0, -2) : port.type);
      const kind = lib.kindOf(port.type);
      for (const id of ids) {
        const a = fresh(id);
        const at = lib.tryResolve(a.type) ?? rt;
        if (kind === 'information') {
          if (a.qty) throw new EngineError(`資訊型產出 ${port.id} 不能有數量`);
          continue;
        }
        const qd = at?.quantity;
        if (!qd) continue;
        if (!a.qty) throw new EngineError(`輸出 ${port.id}（${a.type}）缺少數量`);
        if (!isUnit(a.qty.unit)) throw new EngineError(`輸出 ${port.id} 的單位「${a.qty.unit}」不存在`);
        if (unitDim(a.qty.unit) !== unitDim(qd.baseUnit)) {
          throw new EngineError(`輸出 ${port.id} 的單位 ${a.qty.unit} 與型別 ${a.type} 的維度 ${qd.dimension} 不符`);
        }
        if (!Number.isFinite(a.qty.value) || a.qty.value < 0) throw new EngineError(`輸出 ${port.id} 的數量 ${a.qty.value} 無效`);
        if (at?.identity === 'serial' && unitDim(a.qty.unit) === 'count' && Math.abs(toBase(a.qty.value, a.qty.unit) - 1) > 1e-9) {
          throw new EngineError(`輸出 ${port.id} 是序號件，每件數量必須為 1（實際 ${a.qty.value} ${a.qty.unit}）`);
        }
        if (comparable) {
          outBase += toBase(a.qty.value, a.qty.unit);
          if (port.role !== 'loss' && !modeSet) {
            mode = qd.conservation ?? 'strict';
            tolerance = qd.tolerance ?? 0.005;
            modeSet = true;
          }
        }
      }
    }
    if (!comparable) return;
    // 輸入沒有數量時無法比較
    const ins = Object.values(inst.inputs).flat().map((id) => this.artifacts.get(id)!).filter((a) => isLinear(lib.tryResolve(a.type)?.kind));
    if (!ins.length || ins.some((a) => !a.qty)) comparable = false;
    if (!comparable) return;
    const hasLoss = n.outputs.some((p) => p.role === 'loss');
    const eps = 1e-9 * Math.max(1, Math.abs(inBase));
    const ok =
      mode === 'tolerance'
        ? Math.abs(outBase - inBase) <= tolerance * Math.abs(inBase) + eps
        : mode === 'yield' && !hasLoss
          ? outBase <= inBase + eps
          : Math.abs(outBase - inBase) <= eps;
    if (!ok) {
      const label = { strict: '嚴格守恆', tolerance: `容許誤差 ${tolerance * 100}%`, yield: hasLoss ? '良率（含損耗）' : '良率（輸出不得多於輸入）' }[mode];
      throw new EngineError(`數量不守恆（${label}）：輸入 ${round(inBase)}，輸出合計 ${round(outBase)}（以基準單位計）`);
    }
  }

  private produce(wo: WorkOrder, inst: NodeInstance, n: NodeDef, input: CompletionInput) {
    const lib = this.lib(wo);
    const ins = Object.values(inst.inputs).flat().map((id) => this.artifacts.get(id)!);
    const mIns = ins.filter((a) => isLinear(lib.tryResolve(a.type)?.kind));
    const outputs: Record<string, string[]> = {};
    const consumed = new Set<string>();
    const passed = new Set<string>();
    const explicit = input.outputs ?? {};
    for (const portId of Object.keys(explicit)) {
      const port = n.outputs.find((p) => p.id === portId);
      if (!port) throw new EngineError(`指定的產出 port「${portId}」不存在`);
      if (PASSTHROUGH.has(n.category) && isLinear(lib.kindOf(port.type))) {
        throw new EngineError(`「${n.name}」的實體原樣穿過，不能指定 ${portId} 的產出`);
      }
    }

    const totalBase = mIns.reduce((s, a) => s + (a.qty ? toBase(a.qty.value, a.qty.unit) : 0), 0);
    const outUnit = (type: string) => lib.tryResolve(type)?.quantity?.baseUnit;
    const qtyOf = (type: string, base: number) => {
      const u = outUnit(type);
      return u ? { value: round(fromBase(base, u)), unit: u } : undefined;
    };
    const factor = n.params?.conversionFactor ?? 1;
    const mainOuts = n.outputs.filter((p) => isLinear(lib.kindOf(p.type)) && p.role !== 'loss');
    const lossOuts = n.outputs.filter((p) => p.role === 'loss');
    const infoOuts = n.outputs.filter((p) => lib.kindOf(p.type) === 'information');

    const newFromExplicit = (port: PortDef, parents: ArtifactRecord[]) => {
      const list = explicit[port.id];
      if (!list) return false;
      outputs[port.id] = list.map((x) => {
        const a = this.createArtifact(wo, inst, port.type, x.qty, {
          ...this.inherited(wo, port.type, parents),
          ...this.generated(wo, port.type, n, input),
          ...(x.attrs ?? {}),
        });
        for (const p of parents) this.lineage.push({ child: a.id, parent: p.id, relation: lib.kindOf(port.type) === 'information' ? 'describes' : 'derived_from' });
        return a.id;
      });
      parents.forEach((p) => consumed.add(p.id));
      return true;
    };

    const derive = (port: PortDef, parents: ArtifactRecord[], base: number) => {
      const a = this.createArtifact(wo, inst, port.type, qtyOf(port.type, base), {
        ...this.inherited(wo, port.type, parents),
        ...this.generated(wo, port.type, n, input),
      });
      for (const p of parents) {
        this.lineage.push({ child: a.id, parent: p.id, relation: 'derived_from', qtyUsed: p.qty ? { ...p.qty } : undefined });
        consumed.add(p.id);
      }
      return a;
    };

    const describe = (port: PortDef, subjects: ArtifactRecord[], extra: Record<string, unknown> = {}) => {
      if (newFromExplicit(port, [])) {
        for (const id of outputs[port.id]) for (const s of subjects) this.lineage.push({ child: id, parent: s.id, relation: 'describes' });
        return;
      }
      const a = this.createArtifact(wo, inst, port.type, undefined, { ...this.generated(wo, port.type, n, input), ...extra });
      for (const s of subjects) this.lineage.push({ child: a.id, parent: s.id, relation: 'describes' });
      outputs[port.id] = [a.id];
    };

    switch (n.category) {
      case 'transform':
      case 'assemble': {
        let mainRatio = 1;
        for (const [i, port] of mainOuts.entries()) {
          if (newFromExplicit(port, mIns)) continue;
          const ratio = port.ratio ?? 1;
          mainRatio = ratio;
          const rt = lib.tryResolve(port.type);
          const single = mIns.length === 1 ? mIns[0] : undefined;
          const keep =
            n.category === 'transform' &&
            i === 0 &&
            single &&
            rt &&
            (rt.transformIdentity === 'keep' || (rt.transformIdentity === 'new_on_type_change' && single.type === port.type));
          if (keep && single) {
            this.versionUp(wo, inst, single, { qty: qtyOf(port.type, totalBase * factor * ratio), attrs: this.generated(wo, port.type, n, input) }, 'transformed');
            passed.add(single.id);
            outputs[port.id] = [single.id];
          } else {
            outputs[port.id] = [derive(port, mIns, totalBase * factor * ratio).id];
          }
        }
        for (const port of lossOuts) {
          if (newFromExplicit(port, mIns)) continue;
          // 損耗 = 輸入 − 主要產出（主要產出為手動指定時也成立）
          const mainBase = mainOuts
            .flatMap((o) => outputs[o.id] ?? [])
            .map((id) => this.artifacts.get(id)!)
            .reduce((sum, x) => sum + (x.qty && isUnit(x.qty.unit) ? toBase(x.qty.value, x.qty.unit) : 0), 0);
          const lossBase = Math.max(0, totalBase * factor - mainBase);
          if (lossBase > 1e-12) {
            const a = this.createArtifact(wo, inst, port.type, qtyOf(port.type, lossBase), {});
            for (const p of mIns) this.lineage.push({ child: a.id, parent: p.id, relation: 'derived_from' });
            outputs[port.id] = [a.id];
          }
        }
        for (const port of infoOuts) describe(port, outputs[mainOuts[0]?.id]?.map((id) => this.artifacts.get(id)!) ?? mIns);
        break;
      }
      case 'split': {
        const parent = mIns[0];
        const count = Math.max(1, n.params?.splitCount ?? 2);
        for (const port of mainOuts) {
          if (newFromExplicit(port, [parent])) continue;
          const ratio = port.ratio ?? 1;
          const each = (totalBase * factor * ratio) / count;
          const kids: string[] = [];
          for (let k = 0; k < count; k++) {
            const a = this.createArtifact(wo, inst, port.type, qtyOf(port.type, each), {
              ...this.inherited(wo, port.type, [parent]),
              ...this.generated(wo, port.type, n, input),
            });
            this.lineage.push({ child: a.id, parent: parent.id, relation: 'derived_from', qtyUsed: qtyOf(parent.type, each / factor) });
            kids.push(a.id);
          }
          consumed.add(parent.id);
          outputs[port.id] = kids;
        }
        break;
      }
      case 'move':
      case 'hold': {
        const a = mIns[0];
        const port = mainOuts[0];
        const change: Record<string, unknown> = this.generated(wo, port.type, n, input);
        if (n.category === 'hold' && n.params?.maxDuration) {
          change.expiresAt = new Date(this.clock + parseDuration(n.params.maxDuration)).toISOString();
        }
        // 位置變更與時間閘可並存：有目的位置就移動；時間閘（hold 類別）的等待已在 checkHold 處理
        const toLocation = n.params?.toLocation;
        this.versionUp(wo, inst, a, { attrs: change, location: toLocation }, n.category === 'move' || toLocation ? 'moved' : 'held');
        passed.add(a.id);
        outputs[port.id] = [a.id];
        break;
      }
      case 'measure': {
        for (const a of mIns) {
          const port = mainOuts.find((p) => p.type === a.type) ?? mainOuts[0];
          a.status = 'available';
          a.reservedBy = undefined;
          passed.add(a.id);
          (outputs[port.id] ??= []).push(a.id);
        }
        for (const port of infoOuts) describe(port, mIns);
        break;
      }
      case 'judge': {
        const a = mIns[0];
        const env = this.env(wo, { in: this.inVars(wo, n, inst.inputs) });
        if (n.checks?.length) {
          const r = this.runChecks(wo, n, env);
          a.status = 'available';
          a.reservedBy = undefined;
          passed.add(a.id);
          outputs[r.verdict] = [a.id];
          for (const port of infoOuts) describe(port, [a], { verdict: r.verdict, failed: r.failed, results: r.results });
          break;
        }
        let chosen: { port: string; index: number } | undefined;
        for (const [i, r] of (n.route ?? []).entries()) {
          if (r.when.trim() === 'otherwise') {
            chosen = { port: r.port, index: i };
            break;
          }
          const res = evaluateGuard(r.when, env);
          this.emit('guard.evaluated', { workOrderId: wo.id, nodeId: n.id, data: { kind: 'route', rule: i + 1, status: res.status, message: res.message, now: this.clock } });
          if (res.status === 'error') throw new RouteError(`決策表第 ${i + 1} 條錯誤：${res.message}`);
          if (res.status === 'true') {
            chosen = { port: r.port, index: i };
            break;
          }
        }
        if (!chosen) throw new RouteError('決策表沒有任何規則成立（缺少 otherwise）');
        a.status = 'available';
        a.reservedBy = undefined;
        passed.add(a.id);
        outputs[chosen.port] = [a.id];
        for (const port of infoOuts) describe(port, [a], { verdict: chosen.port, rule: chosen.index + 1 });
        break;
      }
      case 'merge':
      case 'broadcast': {
        for (const port of n.outputs) outputs[port.id] = ins.map((a) => a.id);
        ins.forEach((a) => passed.add(a.id));
        break;
      }
      case 'sink': {
        const location = n.boundary?.location;
        const storage = n.boundary && STORAGE_BOUNDARIES.has(n.boundary.kind);
        for (const a of mIns) {
          a.version++;
          a.location = location;
          a.workOrderId = undefined;
          a.reservedBy = undefined;
          a.status = storage ? 'available' : 'terminated';
          this.artifactEvents.push({ artifactId: a.id, version: a.version, nodeKey: inst.key, event: storage ? 'stored' : 'terminated', at: this.clock });
        }
        break;
      }
      default:
        throw new EngineError(`類別 ${n.category} 尚未支援執行`);
    }

    this.validateOutputs(wo, n, outputs, totalBase * factor, inst);

    for (const id of consumed) {
      if (passed.has(id)) continue;
      const a = this.artifacts.get(id)!;
      a.status = 'consumed';
      a.reservedBy = undefined;
      this.artifactEvents.push({ artifactId: id, version: a.version, nodeKey: inst.key, event: 'consumed', at: this.clock });
    }
    inst.outputs = outputs;
  }
}

class RouteError extends EngineError {}

/** 實體原樣穿過的類別：不得指定實體產出 */
const PASSTHROUGH = new Set(['move', 'hold', 'measure', 'judge', 'merge', 'broadcast', 'sink']);
const CONSERVING = new Set(['transform', 'assemble', 'split']);

export interface CheckResult {
  id: string;
  label: string;
  level: string;
  value: string;
  min?: string;
  max?: string;
  equals?: string;
  oneOf?: string;
  pass: boolean;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function mergeValues(name: string, def: AttrDef, vals: { v: unknown; w: number }[]): unknown {
  const strategy = def.merge ?? 'must_equal';
  switch (strategy) {
    case 'drop':
      return undefined;
    case 'must_equal': {
      const first = JSON.stringify(vals[0].v);
      for (const x of vals) {
        if (JSON.stringify(x.v) !== first) throw new EngineError(`屬性「${name}」必須一致（must_equal），但輸入有不同的值：${vals.map((y) => JSON.stringify(y.v)).join(' / ')}`);
      }
      return vals[0].v;
    }
    case 'union': {
      const set = new Set<unknown>();
      for (const x of vals) (Array.isArray(x.v) ? x.v : [x.v]).forEach((y) => set.add(y));
      return [...set];
    }
    case 'min':
    case 'max': {
      const key = (v: unknown): number => {
        if (def.type === 'datetime') return Date.parse(String(v));
        if (def.type === 'enum') return (def.values ?? []).indexOf(String(v));
        return typeof v === 'number' ? v : Number((v as { value?: number })?.value ?? v);
      };
      let best = vals[0].v;
      for (const x of vals) {
        const better = strategy === 'min' ? key(x.v) < key(best) : key(x.v) > key(best);
        if (better) best = x.v;
      }
      return best;
    }
    case 'weighted_avg': {
      const total = vals.reduce((s, x) => s + x.w, 0) || 1;
      const num = (v: unknown) => (typeof v === 'number' ? v : Number((v as { value?: number })?.value));
      const avg = vals.reduce((s, x) => s + num(x.v) * x.w, 0) / total;
      const v0 = vals[0].v;
      return v0 && typeof v0 === 'object' && 'unit' in (v0 as object) ? { value: round(avg), unit: (v0 as { unit: string }).unit } : round(avg);
    }
  }
}
