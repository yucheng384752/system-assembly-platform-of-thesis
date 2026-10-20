/**
 * 設計時驗證。畫布存檔、編譯前都會執行。
 * 規則代碼：
 *   S*  結構（id、連線、無環）
 *   R1  實體線性        R2 實體終結      R3 載具回收     R4 型別相容
 *   R5  維度一致        R6 合併完整      R7 資訊有主     R8 守恆可驗
 *   C-* 節點類別規則
 *   E*  表達式檢查
 *   G*  可達性
 */
import { checkProjectShape } from '../model/shape';
import { flattenSubgraphs, subgraphInterface } from '../compile/subgraph';
import { type Ty, checkExpression, scopeForNode, scopeForWhere } from '../expr/checker';
import type { CompiledRule } from '../expr/evaluator';
import { checkConditions, findOverlaps, isAnyCell, possibleVerdicts, cellToExpr } from '../resolve/decision';
import { resolveProject } from '../resolve/resolve';
import { compileRules, guardItems } from '../resolve/rules';
import { isLinear, isPortRequired, parseCardinality, TypeLibrary } from '../model/library';
import type { ActionLibrary, Diagnostic, Flow, NodeDef, PortDef, ProjectFile } from '../model/types';
import { CATEGORY_LABEL } from '../model/types';
import { parseDuration } from '../model/units';

export interface ValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  /** 展開後的原語專案檔 */
  resolved: ProjectFile;
}

export interface ValidateOptions {
  libraries?: ActionLibrary[];
  /** 可被子流程引用的專案（以 id@version 查找） */
  projects?: ProjectFile[];
}

type Out = (d: Diagnostic) => void;

export function findPort(node: NodeDef, portId: string, dir: 'in' | 'out'): PortDef | undefined {
  return (dir === 'in' ? node.inputs : node.outputs).find((p) => p.id === portId);
}

function bareType(t: string): string {
  return t.endsWith('.*') ? t.slice(0, -2) : t;
}

/** 依 flows 做拓撲排序；有環時回傳 undefined 與環上節點 */
export function topoSort(nodes: NodeDef[], flows: Flow[]): { order?: string[]; cycle?: string[] } {
  const ids = nodes.map((n) => n.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const f of flows) {
    if (!adj.has(f.from.node) || !indeg.has(f.to.node)) continue;
    const set = adj.get(f.from.node)!;
    if (!set.has(f.to.node)) {
      set.add(f.to.node);
      indeg.set(f.to.node, indeg.get(f.to.node)! + 1);
    }
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const nx of adj.get(id)!) {
      indeg.set(nx, indeg.get(nx)! - 1);
      if (indeg.get(nx) === 0) queue.push(nx);
    }
  }
  if (order.length === ids.length) return { order };
  return { cycle: ids.filter((id) => !order.includes(id)) };
}

/** 依拓撲層級分組，可並行的階段 */
export function stagesOf(nodes: NodeDef[], flows: Flow[]): string[][] | undefined {
  const { order } = topoSort(nodes, flows);
  if (!order) return undefined;
  const level = new Map<string, number>();
  for (const id of order) {
    const preds = flows.filter((f) => f.to.node === id).map((f) => level.get(f.from.node) ?? 0);
    level.set(id, preds.length ? Math.max(...preds) + 1 : 0);
  }
  const stages: string[][] = [];
  for (const id of order) {
    const l = level.get(id)!;
    (stages[l] ??= []).push(id);
  }
  return stages;
}

function materialPorts(lib: TypeLibrary, ports: PortDef[]): PortDef[] {
  return ports.filter((p) => isLinear(lib.kindOf(p.type)));
}
function infoPorts(lib: TypeLibrary, ports: PortDef[]): PortDef[] {
  return ports.filter((p) => lib.kindOf(p.type) === 'information');
}

function checkTypes(p: ProjectFile, lib: TypeLibrary, out: Out) {
  const seen = new Set<string>();
  for (const t of p.artifactTypes ?? []) {
    if (seen.has(t.id)) out({ severity: 'error', code: 'S6-type', message: `型別 id 重複：${t.id}` });
    seen.add(t.id);
    try {
      const r = lib.resolve(t.id);
      if (r.kind === 'information' && r.identity !== 'record') {
        out({ severity: 'error', code: 'S6-type', message: `資訊型別 ${t.id} 的識別粒度必須是 record` });
      }
      if (r.kind !== 'information' && r.identity === 'record') {
        out({ severity: 'error', code: 'S6-type', message: `實體／載具型別 ${t.id} 不能使用 record 粒度` });
      }
      if (r.kind !== 'information' && !r.quantity) {
        out({ severity: 'warning', code: 'S6-type', message: `實體型別 ${t.id} 沒有定義數量（quantity）` });
      }
      for (const [name, a] of Object.entries(r.attributes)) {
        if (a.type === 'enum' && !(a.values && a.values.length)) {
          out({ severity: 'error', code: 'S6-type', message: `型別 ${t.id} 的列舉屬性 ${name} 沒有 values` });
        }
      }
    } catch (e) {
      out({ severity: 'error', code: 'S6-type', message: (e as Error).message });
    }
  }
}

function checkCategory(n: NodeDef, p: ProjectFile, lib: TypeLibrary, out: Out) {
  const label = `${CATEGORY_LABEL[n.category]}「${n.name}」`;
  const e = (code: string, message: string, portId?: string) =>
    out({ severity: 'error', code: `C-${code}`, message: `${label}：${message}`, nodeId: n.id, portId });
  const w = (code: string, message: string) => out({ severity: 'warning', code: `C-${code}`, message: `${label}：${message}`, nodeId: n.id });

  const mIn = materialPorts(lib, n.inputs);
  const mOut = materialPorts(lib, n.outputs).filter((o) => o.role !== 'loss');
  const iOut = infoPorts(lib, n.outputs);

  switch (n.category) {
    case 'source':
      if (n.inputs.length) e('source', '來源節點不能有輸入');
      if (!n.outputs.length) e('source', '來源節點至少要有一個輸出');
      if (!n.boundary) e('source', '必須設定邊界（倉儲／外部系統）');
      break;
    case 'sink':
      if (n.outputs.length) e('sink', '終點節點不能有輸出');
      if (!n.inputs.length) e('sink', '終點節點至少要有一個輸入');
      if (!n.boundary) e('sink', '必須設定邊界（倉儲／報廢／客戶）');
      break;
    case 'transform':
      if (!mIn.length) e('transform', '至少要有一個實體輸入');
      if (!mOut.length) e('transform', '至少要有一個實體輸出');
      break;
    case 'assemble': {
      const total = mIn.reduce((s, x) => {
        try {
          return s + parseCardinality(x.cardinality).max;
        } catch {
          return s + 1;
        }
      }, 0);
      if (total < 2) e('assemble', '組合需要多個實體輸入（多個 port，或 cardinality 上限 ≥ 2）');
      if (mOut.length !== 1) e('assemble', '組合必須恰好有一個主要實體輸出');
      break;
    }
    case 'split':
      if (mIn.length !== 1) e('split', '拆分必須恰好有一個實體輸入');
      if (!mOut.length) e('split', '拆分至少要有一個實體輸出');
      break;
    case 'move':
    case 'hold':
      if (mIn.length !== 1 || mOut.length !== 1) e(n.category, '必須恰好一個實體輸入與一個實體輸出');
      else if (mIn[0].type !== mOut[0].type) e(n.category, `輸入與輸出型別必須相同（${mIn[0].type} ≠ ${mOut[0].type}）`);
      if (n.category === 'move' && !n.params?.toLocation) w('move', '建議設定目的位置 toLocation');
      if (n.category === 'hold' && !n.params?.minDuration) w('hold', '建議設定最短時間 minDuration');
      break;
    case 'measure':
      if (!mIn.length) e('measure', '量測需要實體輸入（被量測的對象）');
      if (!iOut.length) e('measure', '量測至少要有一個資訊輸出');
      for (const m of mIn) {
        if (!mOut.some((o) => o.type === m.type)) e('measure', `實體 ${m.type} 必須原樣穿過（需要同型別的輸出 port）`);
      }
      break;
    case 'judge': {
      if (mIn.length !== 1) e('judge', '判定必須恰好有一個實體輸入');
      const route = n.route ?? [];
      if (n.checks?.length) {
        for (const v of possibleVerdicts(n)) {
          const port = n.outputs.find((o) => o.id === v);
          if (!port) e('judge', `判定結果「${v}」沒有對應的輸出 port（判定結果即 port id）`);
          else if (mIn[0] && port.type !== mIn[0].type) e('judge', `分流 port「${v}」型別必須與輸入相同`, v);
        }
        for (const o of mOut) {
          if (!possibleVerdicts(n).includes(o.id)) w('judge', `實體輸出 port「${o.id}」不是任何判定結果，永遠不會產出`);
        }
        if (n.verdicts?.length && n.verdicts[n.verdicts.length - 1].when.trim() !== 'otherwise') e('judge', '判定結果規則最後一條必須是 otherwise');
        break;
      }
      if (!route.length) e('judge', '必須設定檢驗項目、決策表或運算式其中之一');
      const others = route.filter((r) => r.when.trim() === 'otherwise');
      if (route.length && (others.length !== 1 || route[route.length - 1].when.trim() !== 'otherwise')) {
        e('judge', '決策表最後一條必須是 otherwise，且只能有一條');
      }
      for (const r of route) {
        const port = n.outputs.find((o) => o.id === r.port);
        if (!port) e('judge', `決策表引用不存在的輸出 port「${r.port}」`);
        else if (!isLinear(lib.kindOf(port.type))) e('judge', `決策表的目標 port「${r.port}」必須是實體 port`, r.port);
        else if (mIn[0] && port.type !== mIn[0].type) e('judge', `分流 port「${r.port}」型別必須與輸入相同`, r.port);
      }
      for (const o of mOut) {
        if (!route.some((r) => r.port === o.id)) w('judge', `實體輸出 port「${o.id}」沒有被決策表引用，永遠不會產出`);
      }
      break;
    }
    case 'merge': {
      if (n.outputs.length !== 1) e('merge', '匯流必須恰好一個輸出');
      const incoming = p.flows.filter((f) => f.to.node === n.id).length;
      if (incoming < 2) w('merge', '匯流通常需要兩條以上的輸入');
      break;
    }
    case 'broadcast':
      if (n.inputs.length !== 1) e('broadcast', '廣播必須恰好一個輸入');
      for (const port of [...n.inputs, ...n.outputs]) {
        if (lib.kindOf(port.type) !== 'information') e('broadcast', `廣播只允許資訊型（${port.id}: ${port.type}）`, port.id);
      }
      break;
    case 'subgraph':
      // 子流程在 validateProject 的展開階段處理（C-subgraph）；展開失敗時診斷已回報
      break;
  }

  for (const key of ['minDuration', 'maxDuration', 'maxWait'] as const) {
    const v = n.params?.[key];
    if (v) {
      try {
        parseDuration(v);
      } catch (err) {
        e('params', `${key}：${(err as Error).message}`);
      }
    }
  }
  if (n.category !== 'source' && n.category !== 'sink' && n.boundary) w('boundary', '只有來源／終點節點需要邊界設定');
}

export function validateProject(raw: ProjectFile, opts: ValidateOptions = {}): ValidationResult {
  // 外部輸入先過結構檢查；形狀不對時不進入解析，避免丟出例外。
  const shape = checkProjectShape(raw);
  if (shape.some((d) => d.severity === 'error')) return { ok: false, diagnostics: shape, resolved: raw };
  const diagnostics: Diagnostic[] = [];
  const out: Out = (d) => diagnostics.push(d);
  const res = resolveProject(raw, opts.libraries);
  diagnostics.push(...res.diagnostics);
  const flat = flattenSubgraphs(res.project, { libraries: opts.libraries, projects: opts.projects });
  diagnostics.push(...flat.diagnostics);
  const p = flat.project;
  const lib = TypeLibrary.fromProject(p);
  const compiled = compileRules(p.rules);
  diagnostics.push(...compiled.diagnostics);
  const rules = compiled.rules;

  if (p.formatVersion !== 1) out({ severity: 'error', code: 'S0-format', message: `不支援的 formatVersion：${String(p.formatVersion)}` });
  checkTypes(p, lib, out);

  // ---- 節點 id、port id
  const nodes = new Map<string, NodeDef>();
  for (const n of p.nodes) {
    if (nodes.has(n.id)) out({ severity: 'error', code: 'S1-id', message: `節點 id 重複：${n.id}`, nodeId: n.id });
    nodes.set(n.id, n);
    for (const dir of ['inputs', 'outputs'] as const) {
      const ids = new Set<string>();
      for (const port of n[dir]) {
        if (ids.has(port.id)) out({ severity: 'error', code: 'S1-id', message: `「${n.name}」的 port id 重複：${port.id}`, nodeId: n.id });
        ids.add(port.id);
        const bare = bareType(port.type);
        if (!lib.has(bare) && !lib.ids().some((id) => lib.isA(id, port.type))) {
          out({ severity: 'error', code: 'S5-type', message: `「${n.name}」的 port ${port.id} 使用未知型別 ${port.type}`, nodeId: n.id, portId: port.id });
        }
        try {
          parseCardinality(port.cardinality);
        } catch (err) {
          out({ severity: 'error', code: 'S5-card', message: `「${n.name}」port ${port.id}：${(err as Error).message}`, nodeId: n.id, portId: port.id });
        }
        if (dir === 'outputs' && port.ratio !== undefined && (port.ratio < 0 || port.ratio > 1)) {
          out({ severity: 'error', code: 'R8-yield', message: `「${n.name}」port ${port.id} 的 ratio 必須介於 0 與 1`, nodeId: n.id, portId: port.id });
        }
      }
    }
    checkCategory(n, p, lib, out);
  }

  // ---- 連線
  const flowIds = new Set<string>();
  const validFlows: Flow[] = [];
  for (const f of p.flows) {
    if (flowIds.has(f.id)) out({ severity: 'error', code: 'S1-id', message: `連線 id 重複：${f.id}`, flowId: f.id });
    flowIds.add(f.id);
    const a = nodes.get(f.from.node);
    const b = nodes.get(f.to.node);
    const pa = a && findPort(a, f.from.port, 'out');
    const pb = b && findPort(b, f.to.port, 'in');
    if (!a || !b || !pa || !pb) {
      out({ severity: 'error', code: 'S2-flow', message: `連線 ${f.id} 指向不存在的節點或 port（${f.from.node}.${f.from.port} → ${f.to.node}.${f.to.port}）`, flowId: f.id });
      continue;
    }
    if (a.id === b.id) out({ severity: 'error', code: 'S4-cycle', message: `「${a.name}」不能連回自己`, flowId: f.id, nodeId: a.id });
    if (!lib.compatible(pa.type, pb.type)) {
      out({ severity: 'error', code: 'R4-compat', message: `型別不相容：${a.name}.${pa.id}（${pa.type}）→ ${b.name}.${pb.id}（${pb.type}）`, flowId: f.id, nodeId: b.id });
    }
    validFlows.push(f);
  }

  // ---- 無環
  const topo = topoSort(p.nodes, validFlows);
  if (topo.cycle) {
    out({ severity: 'error', code: 'S4-cycle', message: `圖中有迴圈：${topo.cycle.map((id) => nodes.get(id)?.name ?? id).join('、')}。重工請經由倉儲邊界（新工單）斷開。` });
  }

  // ---- port 層級規則
  for (const n of p.nodes) {
    for (const port of n.outputs) {
      const kind = lib.kindOf(port.type);
      const fs = validFlows.filter((f) => f.from.node === n.id && f.from.port === port.id);
      if (isLinear(kind) && fs.length > 1) {
        out({ severity: 'error', code: 'R1-linearity', message: `「${n.name}」的實體輸出 ${port.id} 只能連到一個下游（目前 ${fs.length} 條）`, nodeId: n.id, portId: port.id });
      }
      if (isLinear(kind) && fs.length === 0) {
        out({ severity: 'error', code: 'R2-terminate', message: `「${n.name}」的實體輸出 ${port.id} 懸空：每條實體路徑都必須到達終點`, nodeId: n.id, portId: port.id });
      }
      if (kind === 'information' && fs.length === 0) {
        out({ severity: 'info', code: 'R2-terminate', message: `「${n.name}」的資訊輸出 ${port.id} 未被使用（只記錄）`, nodeId: n.id, portId: port.id });
      }
      if (kind === 'carrier') {
        for (const f of fs) {
          const t = nodes.get(f.to.node);
          if (t?.category === 'sink' && t.boundary?.kind !== 'carrier-warehouse') {
            out({ severity: 'warning', code: 'R3-carrier', message: `載具 ${port.type} 應回到載具倉（carrier-warehouse）才能再次使用`, nodeId: t.id });
          }
        }
      }
      if (kind === 'information') {
        const r = lib.tryResolve(bareType(port.type));
        if (n.category !== 'source' && r) {
          if (!r.subject) {
            out({ severity: 'warning', code: 'R7-subject', message: `資訊型別 ${port.type} 沒有定義 subject（描述對象）`, nodeId: n.id, portId: port.id });
          } else if (!n.inputs.some((i) => r.subject!.types.some((s) => lib.compatible(i.type, s) || lib.isA(bareType(i.type), s)))) {
            out({ severity: 'error', code: 'R7-subject', message: `「${n.name}」輸出的 ${port.type} 找不到描述對象（需要 ${r.subject.types.join(' 或 ')} 的輸入）`, nodeId: n.id, portId: port.id });
          }
        }
      }
    }
    for (const port of n.inputs) {
      const fs = validFlows.filter((f) => f.to.node === n.id && f.to.port === port.id);
      if (isPortRequired(port) && fs.length === 0) {
        out({ severity: 'error', code: 'S3-required', message: `「${n.name}」的必要輸入 ${port.id} 沒有連線`, nodeId: n.id, portId: port.id });
      }
      if (port.where) {
        for (const d of checkExpression(port.where, scopeForWhere(port.type, p.params), lib, true, rules)) {
          out({ severity: d.severity, code: 'E2-where', message: `「${n.name}」port ${port.id} 的 where：${d.message}`, nodeId: n.id, portId: port.id });
        }
      }
    }

    // R5 維度、R6 合併、R8 守恆
    if (['transform', 'assemble', 'split'].includes(n.category)) {
      const ins = materialPorts(lib, n.inputs);
      const outs = materialPorts(lib, n.outputs);
      const dimOf = (t: string) => lib.tryResolve(bareType(t))?.quantity?.dimension;
      const inDims = new Set(ins.map((x) => dimOf(x.type)).filter(Boolean));
      for (const o of outs) {
        const d = dimOf(o.type);
        if (d && inDims.size && !inDims.has(d) && !n.params?.conversionFactor) {
          out({ severity: 'error', code: 'R5-dimension', message: `「${n.name}」輸出 ${o.id} 的維度 ${d} 與輸入（${[...inDims].join(', ')}）不同，需宣告 conversionFactor`, nodeId: n.id, portId: o.id });
        }
        const r = lib.tryResolve(bareType(o.type));
        if (o.role !== 'loss' && (r?.quantity?.conservation ?? 'strict') === 'strict' && (o.ratio ?? 1) < 1 && !outs.some((x) => x.role === 'loss')) {
          out({ severity: 'error', code: 'R8-yield', message: `「${n.name}」輸出 ${o.id} 的型別 ${o.type} 為嚴格守恆，比例 ${o.ratio} < 1 時必須有 loss port 承接損耗`, nodeId: n.id, portId: o.id });
        }
        if (o.role !== 'loss' && r?.quantity?.conservation === 'yield' && (o.ratio ?? 1) < 1 && !outs.some((x) => x.role === 'loss')) {
          out({ severity: 'warning', code: 'R8-yield', message: `「${n.name}」良率 ${o.ratio}，損耗應流到明確的 loss port`, nodeId: n.id, portId: o.id });
        }
        if (n.category === 'assemble' && o.role !== 'loss' && r) {
          for (const [name, a] of Object.entries(r.attributes)) {
            if (a.source === 'inherited' && !a.merge) {
              out({ severity: 'info', code: 'R6-merge', message: `「${n.name}」：${o.type}.${name} 未宣告合併策略，預設 must_equal`, nodeId: n.id });
            }
          }
        }
      }
    }

    // E1 guard、E3 route、E5 檢驗項目、E6 決策表
    const scope = scopeForNode(n, p.params);
    for (const g of guardItems(n.guard)) {
      for (const d of checkExpression(g.when, scope, lib, true, rules)) {
        out({ severity: d.severity, code: 'E1-guard', message: `「${n.name}」條件「${g.label}」：${d.message}`, nodeId: n.id });
      }
    }
    if (n.decision) checkDecision(n, scope, lib, rules, out);
    else {
      for (const [i, r] of (n.route ?? []).entries()) {
        if (r.when.trim() === 'otherwise') continue;
        for (const d of checkExpression(r.when, scope, lib, true, rules)) {
          out({ severity: d.severity, code: 'E3-route', message: `「${n.name}」決策表第 ${i + 1} 條：${d.message}`, nodeId: n.id });
        }
      }
    }
    if (n.checks?.length) checkChecks(n, scope, lib, rules, out);
  }

  // ---- 可達性
  if (!topo.cycle) {
    const reach = (start: string[], forward: boolean) => {
      const seen = new Set(start);
      const stack = [...start];
      while (stack.length) {
        const id = stack.pop()!;
        for (const f of validFlows) {
          const [a, b] = forward ? [f.from.node, f.to.node] : [f.to.node, f.from.node];
          if (a === id && !seen.has(b)) {
            seen.add(b);
            stack.push(b);
          }
        }
      }
      return seen;
    };
    // 子流程專案：對外介面的入口／出口視同來源／終點（上層接進來、接出去）
    const entries = new Set<string>();
    const exits = new Set<string>();
    if (raw.meta.kind === 'subgraph') {
      const iface = subgraphInterface(p);
      const nodeOf = (portId: string) => portId.slice(0, portId.lastIndexOf('.'));
      for (const x of iface.inputs) entries.add(nodeOf(x.id));
      for (const x of iface.outputs) exits.add(nodeOf(x.id));
    }
    const fromSrc = reach(p.nodes.filter((n) => n.category === 'source' || entries.has(n.id)).map((n) => n.id), true);
    const toSink = reach(p.nodes.filter((n) => n.category === 'sink' || exits.has(n.id)).map((n) => n.id), false);
    for (const n of p.nodes) {
      if (!fromSrc.has(n.id)) out({ severity: 'warning', code: 'G1-reach', message: `「${n.name}」無法從任何來源到達`, nodeId: n.id });
      if (!toSink.has(n.id) && materialPorts(lib, n.outputs).length) {
        out({ severity: 'warning', code: 'G1-reach', message: `「${n.name}」無法到達任何終點`, nodeId: n.id });
      }
    }
  }

  if (!p.settings?.exceptionLocation) {
    out({ severity: 'info', code: 'X1-exception', message: '未設定異常倉（settings.exceptionLocation），轉出時將使用 "wh.exception"' });
  }

  // 子流程專案：未連線的 port 就是對外介面，不算錯誤
  if (raw.meta.kind === 'subgraph') {
    for (const d of diagnostics) {
      if (d.severity === 'error' && (d.code === 'S3-required' || d.code === 'R2-terminate')) d.severity = 'info';
    }
  }
  return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics, resolved: p };
}

function checkDecision(n: NodeDef, scope: Record<string, Ty>, lib: TypeLibrary, rules: Record<string, CompiledRule>, out: Out) {
  const t = n.decision!;
  const e = (message: string, severity: 'error' | 'warning' = 'error', code = 'E6-decision') => out({ severity, code, message: `「${n.name}」決策表：${message}`, nodeId: n.id });
  if (!t.inputs.length) e('至少要有一個欄位');
  if (!t.rules.length) e('至少要有一條規則');
  for (const i of t.inputs) {
    for (const d of checkExpression(i.expr, scope, lib, false, rules)) e(`欄位「${i.label ?? i.id}」：${d.message}`, d.severity);
  }
  t.rules.forEach((r, ri) => {
    if (!n.outputs.some((o) => o.id === r.port)) e(`第 ${ri + 1} 條的出口「${r.port}」不存在`);
    for (const i of t.inputs) {
      const cell = r.when[i.id];
      const expr = cellToExpr(i.expr, cell);
      if (!expr) continue;
      for (const d of checkExpression(expr, scope, lib, true, rules)) e(`第 ${ri + 1} 條「${i.label ?? i.id}」格子「${cell}」：${d.message}`, d.severity);
    }
    for (const k of Object.keys(r.when)) if (!t.inputs.some((i) => i.id === k)) e(`第 ${ri + 1} 條引用不存在的欄位「${k}」`);
  });
  const last = t.rules[t.rules.length - 1];
  if (last && t.inputs.some((i) => !isAnyCell(last.when[i.id]))) e('最後一條必須全部不限（相當於 otherwise），確保每種情況都有出口');
  if (t.hitPolicy === 'unique') {
    for (const [a, b] of findOverlaps(t)) e(`第 ${a + 1} 條與第 ${b + 1} 條可能同時成立（hit policy 為 unique）`, 'warning', 'W1-overlap');
  }
}

function checkChecks(n: NodeDef, scope: Record<string, Ty>, lib: TypeLibrary, rules: Record<string, CompiledRule>, out: Out) {
  const e = (message: string, severity: 'error' | 'warning' = 'error') => out({ severity, code: 'E5-check', message: `「${n.name}」檢驗項目：${message}`, nodeId: n.id });
  const ids = new Set<string>();
  for (const c of n.checks ?? []) {
    if (ids.has(c.id)) e(`項目 id 重複：${c.id}`);
    ids.add(c.id);
    const conds = checkConditions(c);
    if (!conds.length) e(`「${c.label}」至少要設定上限、下限、等於或清單其中之一`);
    const before = new Set<string>();
    for (const d of checkExpression(c.value, scope, lib, false, rules)) {
      before.add(d.message);
      e(`「${c.label}」實測值：${d.message}`, d.severity);
    }
    if (before.size) continue;
    for (const expr of conds) for (const d of checkExpression(expr, scope, lib, true, rules)) e(`「${c.label}」：${d.message}`, d.severity);
  }
  if (n.verdicts?.length) {
    const levels = { k: 'map', fields: { critical: { k: 'num' }, major: { k: 'num' }, minor: { k: 'num' }, total: { k: 'num' } } } as Ty;
    const checkMap = { k: 'map', fields: Object.fromEntries((n.checks ?? []).map((c) => [c.id, { k: 'bool' }])) } as Ty;
    for (const [i, v] of n.verdicts.entries()) {
      if (v.when.trim() === 'otherwise') continue;
      for (const d of checkExpression(v.when, { ...scope, failed: levels, check: checkMap }, lib, true, rules)) e(`判定結果規則第 ${i + 1} 條：${d.message}`, d.severity);
    }
  }
}

/** 畫布連線前的即時檢查 */
export function canConnect(
  raw: ProjectFile,
  from: { node: string; port: string },
  to: { node: string; port: string },
  libraries: ActionLibrary[] = [],
): { ok: boolean; reason?: string } {
  const p = resolveProject(raw, libraries).project;
  const lib = TypeLibrary.fromProject(p);
  const a = p.nodes.find((n) => n.id === from.node);
  const b = p.nodes.find((n) => n.id === to.node);
  if (!a || !b) return { ok: false, reason: '找不到節點' };
  if (a.id === b.id) return { ok: false, reason: '不能連回自己' };
  const pa = findPort(a, from.port, 'out');
  const pb = findPort(b, to.port, 'in');
  if (!pa || !pb) return { ok: false, reason: '必須從輸出 port 連到輸入 port' };
  if (!lib.compatible(pa.type, pb.type)) return { ok: false, reason: `型別不相容：${pa.type} → ${pb.type}` };
  if (isLinear(lib.kindOf(pa.type)) && p.flows.some((f) => f.from.node === a.id && f.from.port === pa.id)) {
    return { ok: false, reason: `實體只能被消耗一次：${a.name}.${pa.id} 已經連線` };
  }
  if (p.flows.some((f) => f.from.node === a.id && f.from.port === pa.id && f.to.node === b.id && f.to.port === pb.id)) {
    return { ok: false, reason: '連線已存在' };
  }
  const trial = [...p.flows, { id: '__trial', from, to }];
  if (topoSort(p.nodes, trial).cycle) return { ok: false, reason: '會形成迴圈；重工請經由倉儲邊界斷開' };
  return { ok: true };
}
