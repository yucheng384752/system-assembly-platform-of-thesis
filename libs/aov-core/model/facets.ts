/**
 * 節點「參數化」：編輯器只呈現 4 種節點（邊界、活動、匯流、子流程），
 * 活動節點的行為由「參數」決定。引擎與驗證仍以 category 分派，
 * 所以這裡的函式負責「加／減參數時，同步推導出 category 與必要的 port」。
 * 資料格式不變：舊檔案、已發佈版本不受影響。
 */
import { defaultNode } from './factory';
import type { NodeCategory, NodeDef, PortDef, ProjectFile } from './types';

export type NodeKind = 'boundary' | 'activity' | 'join' | 'subgraph';

export const KIND_OF: Record<NodeCategory, NodeKind> = {
  source: 'boundary',
  sink: 'boundary',
  transform: 'activity',
  assemble: 'activity',
  split: 'activity',
  move: 'activity',
  hold: 'activity',
  measure: 'activity',
  judge: 'activity',
  merge: 'join',
  broadcast: 'join',
  subgraph: 'subgraph',
};

export const KIND_LABEL: Record<NodeKind, string> = { boundary: '邊界', activity: '活動', join: '匯流', subgraph: '子流程' };
export const KIND_ORDER: NodeKind[] = ['boundary', 'activity', 'join', 'subgraph'];
/** 從調色盤新增該種節點時的起始類別 */
export const KIND_CATEGORY: Record<NodeKind, NodeCategory> = { boundary: 'source', activity: 'transform', join: 'merge', subgraph: 'subgraph' };

// ---------------------------------------------------------------- 活動節點的參數

/** 作用類參數的 id 與引擎類別同名；record 是修飾參數 */
export type Facet = 'move' | 'hold' | 'assemble' | 'split' | 'judge' | 'record';

export const FACET_LABEL: Record<Facet, string> = {
  move: '位置變更',
  hold: '時間閘',
  assemble: '組合',
  split: '拆分',
  judge: '判定',
  record: '記錄輸出',
};

export const FACET_HINT: Record<Facet, string> = {
  move: '只改位置或持有者（目的位置）',
  hold: '只經過時間（最短／最長時間）',
  assemble: '多個實體合成一個新身分',
  split: '一個實體分成多份',
  judge: '依檢驗項目、決策表或運算式分流',
  record: '產出資訊（量測值、表單紀錄）',
};

export const FACET_ORDER: Facet[] = ['move', 'hold', 'assemble', 'split', 'judge', 'record'];
const EFFECTS: Facet[] = ['move', 'hold', 'assemble', 'split', 'judge'];
/** 引擎在這些類別下不處理資訊輸出，同時有記錄輸出會讓下游永遠收不到 */
const NO_RECORD = new Set<Facet>(['move', 'hold', 'split']);
/** 位置變更與時間閘共用引擎的同一段處理，可以並存（存成 hold 類別，toLocation 照樣生效） */
const isTransit = (f: Facet) => f === 'move' || f === 'hold';

export interface FacetContext {
  /** port 型別是否為資訊型 */
  isInfo: (type: string) => boolean;
  /** 新增記錄輸出用的資訊型別 */
  infoType: string;
  /** 新增 port 的預設實體型別 */
  materialType: string;
}

export interface FacetResult {
  /** 有值表示操作被拒絕，專案未被修改 */
  error?: string;
  /** 操作過程中一併移除的連線數 */
  removedFlows: number;
}

const ok = (removedFlows = 0): FacetResult => ({ removedFlows });
const fail = (error: string): FacetResult => ({ error, removedFlows: 0 });

const materialIns = (n: NodeDef, c: Pick<FacetContext, 'isInfo'>) => n.inputs.filter((p) => !c.isInfo(p.type));
const materialOuts = (n: NodeDef, c: Pick<FacetContext, 'isInfo'>) => n.outputs.filter((p) => !c.isInfo(p.type) && p.role !== 'loss');
const hasRecord = (n: NodeDef, c: Pick<FacetContext, 'isInfo'>) => !!n.form || n.outputs.some((o) => o.role === 'record' || c.isInfo(o.type));

/** 目前節點上已添加的參數 */
export function activeFacets(n: NodeDef, c: Pick<FacetContext, 'isInfo'>): Facet[] {
  if (KIND_OF[n.category] !== 'activity') return [];
  const out: Facet[] = EFFECTS.includes(n.category as Facet) ? [n.category as Facet] : [];
  if (n.category === 'hold' && n.params?.toLocation !== undefined) out.push('move');
  if (hasRecord(n, c)) out.push('record');
  return out;
}

/** 不能添加時回傳原因；可以添加回傳 undefined */
export function whyCannotAdd(n: NodeDef, f: Facet, c: Pick<FacetContext, 'isInfo'>): string | undefined {
  if (KIND_OF[n.category] !== 'activity') return '只有活動節點可以添加參數';
  const active = activeFacets(n, c);
  if (active.includes(f)) return '已添加';
  const effects = active.filter((a) => EFFECTS.includes(a));
  if (f === 'record') {
    const blocker = effects.find((e) => NO_RECORD.has(e));
    return blocker ? `「${FACET_LABEL[blocker]}」節點不輸出紀錄（目前引擎限制）` : undefined;
  }
  const clash = effects.find((e) => !(isTransit(f) && isTransit(e)));
  if (clash) return `與「${FACET_LABEL[clash]}」互斥：一個節點一次只做一種作用，請先移除它`;
  if (NO_RECORD.has(f) && active.includes('record')) return `「${FACET_LABEL[f]}」節點不輸出紀錄，請先移除「記錄輸出」`;
  if (f === 'judge' && materialIns(n, c).length !== 1) return '判定只能有一個實體輸入';
  return undefined;
}

/** 由作用與輸入輸出推導引擎類別；位置變更＋時間閘並存時為 hold（時間閘需要 hold 類別的等待處理） */
function derive(n: NodeDef, effects: Facet[], c: Pick<FacetContext, 'isInfo'>): NodeCategory {
  if (effects.includes('hold')) return 'hold';
  if (effects[0]) return effects[0] as NodeCategory;
  const ins = materialIns(n, c);
  const outs = materialOuts(n, c);
  const passthrough = ins.length > 0 && ins.every((i) => outs.some((o) => o.type === i.type));
  return hasRecord(n, c) && passthrough ? 'measure' : 'transform';
}

function uniquePortId(n: NodeDef, base: string): string {
  const taken = new Set([...n.inputs, ...n.outputs].map((p) => p.id));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}${i}`;
  return id;
}

function dropOutputs(p: ProjectFile, n: NodeDef, ids: Set<string>): number {
  n.outputs = n.outputs.filter((o) => !ids.has(o.id));
  const before = p.flows.length;
  p.flows = p.flows.filter((f) => !(f.from.node === n.id && ids.has(f.from.port)));
  for (const k of Object.keys(p.flowLayout ?? {})) if (!p.flows.some((f) => f.id === k)) delete p.flowLayout![k];
  return before - p.flows.length;
}

function dropInputs(p: ProjectFile, n: NodeDef, ids: Set<string>): number {
  n.inputs = n.inputs.filter((i) => !ids.has(i.id));
  const before = p.flows.length;
  p.flows = p.flows.filter((f) => !(f.to.node === n.id && ids.has(f.to.port)));
  for (const k of Object.keys(p.flowLayout ?? {})) if (!p.flows.some((f) => f.id === k)) delete p.flowLayout![k];
  return before - p.flows.length;
}

function renameOutput(p: ProjectFile, n: NodeDef, from: string, to: string) {
  for (const o of n.outputs) if (o.id === from) o.id = to;
  for (const f of p.flows) if (f.from.node === n.id && f.from.port === from) f.from.port = to;
  for (const r of n.route ?? []) if (r.port === from) r.port = to;
}

function nodeOf(p: ProjectFile, id: string): NodeDef | undefined {
  const n = p.nodes.find((x) => x.id === id);
  if (n) {
    n.inputs ??= [];
    n.outputs ??= [];
  }
  return n;
}

function setParams(n: NodeDef, fn: (params: Record<string, unknown>) => void) {
  const params = { ...(n.params ?? {}) } as Record<string, unknown>;
  fn(params);
  n.params = Object.keys(params).length ? (params as NodeDef['params']) : undefined;
}

/** 添加參數（直接修改 p）：同步補上必要的 port／預設值，並重新推導 category */
export function addFacet(p: ProjectFile, nodeId: string, f: Facet, c: FacetContext): FacetResult {
  const n = nodeOf(p, nodeId);
  if (!n) return fail(`找不到節點 ${nodeId}`);
  const why = whyCannotAdd(n, f, c);
  if (why) return fail(why);
  const prev = activeFacets(n, c).filter((a) => EFFECTS.includes(a));

  switch (f) {
    case 'move':
      setParams(n, (x) => void (x.toLocation ??= 'line.1'));
      break;
    case 'hold':
      setParams(n, (x) => void (x.minDuration ??= '1h'));
      break;
    case 'split':
      setParams(n, (x) => void (x.splitCount ??= 2));
      break;
    case 'assemble':
      if (materialIns(n, c).length < 2) n.inputs.push({ id: uniquePortId(n, 'b'), type: materialIns(n, c)[0]?.type ?? c.materialType });
      break;
    case 'judge': {
      const type = materialIns(n, c)[0].type;
      const outs = materialOuts(n, c);
      if (!outs.length) n.outputs.unshift({ id: uniquePortId(n, 'ok'), type });
      else if (outs[0].id === 'out' && !n.outputs.some((o) => o.id === 'ok')) renameOutput(p, n, 'out', 'ok');
      if (materialOuts(n, c).length < 2) n.outputs.push({ id: uniquePortId(n, 'ng'), type });
      const targets = materialOuts(n, c);
      const label = (o: PortDef, text: string) => void (o.label ??= text);
      label(targets[0], '合格');
      label(targets[targets.length - 1], '未過');
      if (!n.route?.length && !n.decision && !n.checks?.length) {
        n.route = [
          { when: 'true', port: targets[0].id },
          { when: 'otherwise', port: targets[targets.length - 1].id },
        ];
      }
      break;
    }
    case 'record':
      n.outputs.push({ id: uniquePortId(n, 'record'), type: c.infoType, role: 'record' });
      break;
  }

  n.category = derive(n, f === 'record' ? prev : [...prev, f], c);
  return ok();
}

/** 移除參數（直接修改 p）：清掉該參數的專屬設定與 port；連到被移除 port 的連線一併刪除 */
export function removeFacet(p: ProjectFile, nodeId: string, f: Facet, c: FacetContext): FacetResult {
  const n = nodeOf(p, nodeId);
  if (!n) return fail(`找不到節點 ${nodeId}`);
  const active = activeFacets(n, c);
  if (!active.includes(f)) return fail(`節點沒有「${FACET_LABEL[f]}」參數`);
  const prev = active.filter((a) => EFFECTS.includes(a));
  let removed = 0;

  switch (f) {
    case 'move':
      setParams(n, (x) => void delete x.toLocation);
      break;
    case 'hold':
      setParams(n, (x) => {
        delete x.minDuration;
        delete x.maxDuration;
      });
      break;
    case 'split':
      setParams(n, (x) => void delete x.splitCount);
      break;
    case 'assemble':
      break;
    case 'judge': {
      delete n.route;
      delete n.decision;
      delete n.checks;
      delete n.verdicts;
      const [keep, ...rest] = materialOuts(n, c);
      if (keep) removed = dropOutputs(p, n, new Set(rest.map((o) => o.id)));
      break;
    }
    case 'record': {
      removed = dropOutputs(p, n, new Set(n.outputs.filter((o) => o.role === 'record' || c.isInfo(o.type)).map((o) => o.id)));
      delete n.form;
      break;
    }
  }

  n.category = derive(n, f === 'record' ? prev : prev.filter((e) => e !== f), c);
  return ok(removed);
}

// ---------------------------------------------------------------- 邊界、匯流的模式

export type BoundaryDirection = 'source' | 'sink';

/** 邊界節點的方向：來源（只有輸出）／終點（只有輸入）；被移除一側的連線一併刪除 */
export function setBoundaryDirection(p: ProjectFile, nodeId: string, dir: BoundaryDirection, c: FacetContext): FacetResult {
  const n = nodeOf(p, nodeId);
  if (!n) return fail(`找不到節點 ${nodeId}`);
  if (KIND_OF[n.category] !== 'boundary') return fail('只有邊界節點可以設定方向');
  if (n.category === dir) return ok();
  const type = (dir === 'sink' ? n.outputs : n.inputs)[0]?.type ?? c.materialType;
  let removed = 0;
  if (dir === 'sink') {
    removed = dropOutputs(p, n, new Set(n.outputs.map((o) => o.id)));
    if (!n.inputs.length) n.inputs.push({ id: 'in', type, cardinality: '1..*' });
  } else {
    removed = dropInputs(p, n, new Set(n.inputs.map((i) => i.id)));
    if (!n.outputs.length) n.outputs.push({ id: 'out', type });
  }
  n.category = dir;
  return ok(removed);
}

export type JoinMode = 'merge' | 'broadcast';

/** 匯流節點的模式：互斥分支匯流（實體）／資訊廣播。port 型別會跟著改，所以有連線時要先拆掉 */
export function setJoinMode(p: ProjectFile, nodeId: string, mode: JoinMode, c: FacetContext): FacetResult {
  const n = nodeOf(p, nodeId);
  if (!n) return fail(`找不到節點 ${nodeId}`);
  if (KIND_OF[n.category] !== 'join') return fail('只有匯流節點可以設定模式');
  if (n.category === mode) return ok();
  if (p.flows.some((f) => f.from.node === n.id || f.to.node === n.id)) return fail('切換模式會改變 port 型別，請先刪除這個節點上的連線');
  const next = defaultNode(mode, n.id, c.materialType, c.infoType);
  n.inputs = next.inputs;
  n.outputs = next.outputs;
  n.category = mode;
  return ok();
}
