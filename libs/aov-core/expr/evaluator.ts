/**
 * Guard 表達式評估器。
 * - 無副作用、保證終止（清單有長度上限、lineage 有深度上限）。
 * - 評估結果三值：true / false / error。
 * - false 時產生可讀的原因（失敗的子運算式與實際值）。
 */
import type { TypeLibrary } from '../model/library';
import { BUILTIN_FIELDS } from '../model/library';
import type { AttrDef } from '../model/types';
import { type Dimension, formatNumber, fromBase, isUnit, parseDuration, toBase, unitDim, BASE_UNIT } from '../model/units';
import { type Ast, ExprSyntaxError, parseExpr, sourceOf } from './parser';

// ---------------------------------------------------------------- 值

export interface ArtifactView {
  id: string;
  type: string;
  version: number;
  qty?: { value: number; unit: string };
  attrs: Record<string, unknown>;
  location?: string;
  createdAt: number;
}

export interface Qty {
  k: 'qty';
  /** base 單位的數值 */
  v: number;
  dim: Dimension;
  /** 顯示用單位 */
  unit: string;
}
export interface Dt {
  k: 'dt';
  ms: number;
}
export interface EnumV {
  k: 'enum';
  v: string;
  order: string[];
}
export interface ArtV {
  k: 'art';
  a: ArtifactView;
}
export interface MapV {
  k: 'map';
  m: Record<string, Value>;
}
export type Value = boolean | number | string | Qty | Dt | EnumV | ArtV | MapV | Value[];

export const qty = (value: number, unit: string): Qty => ({ k: 'qty', v: toBase(value, unit), dim: unitDim(unit), unit });
export const dt = (ms: number): Dt => ({ k: 'dt', ms });
export const art = (a: ArtifactView): ArtV => ({ k: 'art', a });
export const map = (m: Record<string, Value>): MapV => ({ k: 'map', m });

export class EvalError extends Error {}

export interface LineageAccess {
  get(id: string): ArtifactView | undefined;
  /** derived_from 祖先（BFS，最多 maxDepth 層），型別符合 pattern */
  upstream(id: string, pattern: string, maxDepth: number): ArtifactView[];
  /** 以 describes 關係指向 id 的資訊型 artifact，型別符合 pattern，依 createdAt 排序 */
  describes(id: string, pattern: string): ArtifactView[];
}

/** 已編譯的具名規則 */
export interface CompiledRule {
  id: string;
  label?: string;
  params: string[];
  src: string;
  ast: Ast;
}

export interface EvalEnv {
  vars: Record<string, Value>;
  library: TypeLibrary;
  lineage?: LineageAccess;
  maxDepth?: number;
  /** 具名規則（v0.2） */
  rules?: Record<string, CompiledRule>;
  /** 規則呼叫深度（防止遞迴） */
  ruleDepth?: number;
}

const MAX_RULE_DEPTH = 16;

function ruleEnv(env: EvalEnv, rule: CompiledRule, args: Value[]): EvalEnv {
  if ((env.ruleDepth ?? 0) >= MAX_RULE_DEPTH) throw new EvalError(`規則呼叫過深（${rule.id}），可能有遞迴`);
  const vars: Record<string, Value> = {};
  if ('params' in env.vars) vars.params = env.vars.params;
  if ('now' in env.vars) vars.now = env.vars.now;
  rule.params.forEach((p, i) => (vars[p] = args[i]));
  return { ...env, vars, ruleDepth: (env.ruleDepth ?? 0) + 1 };
}

const MAX_LIST = 10000;

// ---------------------------------------------------------------- 轉換

/** 一般 JS 值（參數、模擬資料）轉成表達式值 */
export function fromJs(v: unknown): Value {
  if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(fromJs);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.value === 'number' && typeof o.unit === 'string' && isUnit(o.unit)) return qty(o.value, o.unit);
    const m: Record<string, Value> = {};
    for (const [k, x] of Object.entries(o)) m[k] = fromJs(x);
    return map(m);
  }
  throw new EvalError(`無法轉換的值：${String(v)}`);
}

function toMs(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return ms;
  }
  throw new EvalError(`無效的日期時間：${String(v)}`);
}

/** 依屬性定義把原始值轉成型別化的值 */
export function typedAttr(def: AttrDef | undefined, raw: unknown): Value {
  if (!def) return fromJs(raw);
  switch (def.type) {
    case 'quantity':
    case 'number': {
      if (raw && typeof raw === 'object' && 'value' in (raw as object)) return fromJs(raw);
      if (typeof raw !== 'number') throw new EvalError(`屬性應為數值，實際為 ${JSON.stringify(raw)}`);
      return def.unit ? qty(raw, def.unit) : raw;
    }
    case 'datetime':
      return dt(toMs(raw));
    case 'enum':
      if (typeof raw !== 'string') throw new EvalError(`列舉屬性應為字串`);
      return { k: 'enum', v: raw, order: def.values ?? [] };
    case 'string[]':
      if (!Array.isArray(raw)) throw new EvalError(`屬性應為字串陣列`);
      return raw.map(String);
    case 'json':
      return fromJs(raw);
    case 'bool':
      return Boolean(raw);
    case 'string':
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

function artifactField(env: EvalEnv, a: ArtifactView, name: string): Value {
  switch (name) {
    case 'id':
      return a.id;
    case 'type':
      return a.type;
    case 'version':
      return a.version;
    case 'location':
      if (a.location === undefined) throw new EvalError(`artifact ${a.id} 沒有 location`);
      return a.location;
    case 'createdAt':
      return dt(a.createdAt);
    case 'qty':
      if (!a.qty) throw new EvalError(`artifact ${a.id} 沒有數量`);
      return qty(a.qty.value, a.qty.unit);
  }
  const def = env.library.tryResolve(a.type)?.attributes[name];
  if (!(name in a.attrs) || a.attrs[name] === undefined || a.attrs[name] === null) {
    if (!def) throw new EvalError(`型別 ${a.type} 沒有屬性「${name}」`);
    throw new EvalError(`artifact ${a.id} 缺少屬性「${name}」（選填屬性請先用 has() 檢查）`);
  }
  return typedAttr(def, a.attrs[name]);
}

function hasField(a: ArtifactView, name: string): boolean {
  if ((BUILTIN_FIELDS as readonly string[]).includes(name)) {
    if (name === 'qty') return !!a.qty;
    if (name === 'location') return a.location !== undefined;
    return true;
  }
  return a.attrs[name] !== undefined && a.attrs[name] !== null;
}

// ---------------------------------------------------------------- 格式化

export function formatValue(v: Value): string {
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const items = v.slice(0, 5).map(formatValue).join(', ');
    return `[${items}${v.length > 5 ? `, …共 ${v.length} 筆` : ''}]`;
  }
  switch (v.k) {
    case 'qty': {
      const unit = v.unit || BASE_UNIT[v.dim];
      return `${formatNumber(fromBase(v.v, unit))} ${unit === 'degC' ? '°C' : unit === 'degF' ? '°F' : unit}`;
    }
    case 'dt':
      return new Date(v.ms).toISOString().replace('.000Z', 'Z');
    case 'enum':
      return `'${v.v}'`;
    case 'art':
      return `<${v.a.type} ${v.a.id}>`;
    case 'map':
      return `{${Object.keys(v.m).join(', ')}}`;
  }
}

function typeName(v: Value): string {
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'bool';
  if (Array.isArray(v)) return 'list';
  switch (v.k) {
    case 'qty':
      return `quantity(${v.dim})`;
    case 'dt':
      return 'datetime';
    case 'enum':
      return 'enum';
    case 'art':
      return 'artifact';
    case 'map':
      return 'map';
  }
}

// ---------------------------------------------------------------- 運算

function isObj<K extends string>(v: Value, k: K): v is Extract<Value, { k: K }> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && (v as { k: string }).k === k;
}

function equals(a: Value, b: Value): boolean {
  if (isObj(a, 'enum')) a = a.v;
  if (isObj(b, 'enum')) b = b.v;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equals(x, b[i]));
  if (isObj(a, 'qty') && isObj(b, 'qty')) {
    if (a.dim !== b.dim) throw new EvalError(`無法比較 ${a.dim} 與 ${b.dim}`);
    return Math.abs(a.v - b.v) < 1e-9 * Math.max(1, Math.abs(a.v));
  }
  if (isObj(a, 'dt') && isObj(b, 'dt')) return a.ms === b.ms;
  if (isObj(a, 'art') && isObj(b, 'art')) return a.a.id === b.a.id;
  return false;
}

function compare(a: Value, b: Value): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (isObj(a, 'qty') && isObj(b, 'qty')) {
    if (a.dim !== b.dim) throw new EvalError(`無法比較 ${a.dim} 與 ${b.dim}（跨維度）`);
    return a.v - b.v;
  }
  if (isObj(a, 'dt') && isObj(b, 'dt')) return a.ms - b.ms;
  if (isObj(a, 'enum') || isObj(b, 'enum')) {
    const order = isObj(a, 'enum') ? a.order : (b as EnumV).order;
    const av = isObj(a, 'enum') ? a.v : a;
    const bv = isObj(b, 'enum') ? b.v : b;
    const ia = order.indexOf(String(av));
    const ib = order.indexOf(String(bv));
    if (ia < 0 || ib < 0) throw new EvalError(`列舉值不在定義中：${String(ia < 0 ? av : bv)}（可用：${order.join(', ')}）`);
    return ia - ib;
  }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'number' && isObj(b, 'qty')) throw new EvalError(`數值 ${a} 缺少單位，無法與 ${formatValue(b)} 比較`);
  if (isObj(a, 'qty') && typeof b === 'number') throw new EvalError(`數值 ${b} 缺少單位，無法與 ${formatValue(a)} 比較`);
  throw new EvalError(`無法比較 ${typeName(a)} 與 ${typeName(b)}`);
}

function arith(op: '+' | '-' | '*' | '/', a: Value, b: Value): Value {
  if (typeof a === 'number' && typeof b === 'number') {
    if (op === '/' && b === 0) throw new EvalError('除以零');
    return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b;
  }
  if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
  if (isObj(a, 'qty') && isObj(b, 'qty')) {
    if (a.dim !== b.dim) throw new EvalError(`無法運算 ${a.dim} ${op} ${b.dim}（跨維度）`);
    if (op === '/') {
      if (b.v === 0) throw new EvalError('除以零');
      return a.v / b.v;
    }
    if (op === '*') throw new EvalError('不支援數量相乘（v1）');
    if (a.dim === 'temperature') throw new EvalError('溫度是仿射單位，不支援加減（v1）');
    return { k: 'qty', v: op === '+' ? a.v + b.v : a.v - b.v, dim: a.dim, unit: a.unit };
  }
  if (isObj(a, 'qty') && typeof b === 'number' && (op === '*' || op === '/')) {
    if (a.dim === 'temperature') throw new EvalError('溫度是仿射單位，不支援乘除（v1）');
    if (op === '/' && b === 0) throw new EvalError('除以零');
    return { ...a, v: op === '*' ? a.v * b : a.v / b };
  }
  if (typeof a === 'number' && isObj(b, 'qty') && op === '*') {
    if (b.dim === 'temperature') throw new EvalError('溫度是仿射單位，不支援乘除（v1）');
    return { ...b, v: a * b.v };
  }
  if (isObj(a, 'dt') && isObj(b, 'qty') && b.dim === 'time' && (op === '+' || op === '-')) {
    return dt(op === '+' ? a.ms + b.v * 1000 : a.ms - b.v * 1000);
  }
  if (isObj(a, 'qty') && a.dim === 'time' && isObj(b, 'dt') && op === '+') return dt(b.ms + a.v * 1000);
  if (isObj(a, 'dt') && isObj(b, 'dt') && op === '-') return { k: 'qty', v: (a.ms - b.ms) / 1000, dim: 'time', unit: 'h' };
  throw new EvalError(`不支援的運算：${typeName(a)} ${op} ${typeName(b)}`);
}

function asBool(v: Value, what: string): boolean {
  if (typeof v !== 'boolean') throw new EvalError(`${what} 必須是 bool，實際為 ${typeName(v)}`);
  return v;
}

function asList(v: Value, what: string): Value[] {
  if (!Array.isArray(v)) throw new EvalError(`${what} 必須是清單，實際為 ${typeName(v)}`);
  if (v.length > MAX_LIST) throw new EvalError(`清單超過上限 ${MAX_LIST}`);
  return v;
}

function asArt(v: Value, what: string): ArtifactView {
  if (!isObj(v, 'art')) throw new EvalError(`${what} 必須是 artifact，實際為 ${typeName(v)}`);
  return v.a;
}

// ---------------------------------------------------------------- 評估

export function evalAst(n: Ast, env: EvalEnv): Value {
  switch (n.t) {
    case 'num':
      return n.unit ? qty(n.v, n.unit) : n.v;
    case 'str':
      return n.v;
    case 'bool':
      return n.v;
    case 'list':
      return n.items.map((x) => evalAst(x, env));
    case 'ident': {
      if (!(n.name in env.vars)) throw new EvalError(`未定義的名稱「${n.name}」`);
      return env.vars[n.name];
    }
    case 'member': {
      const o = evalAst(n.obj, env);
      if (isObj(o, 'art')) return artifactField(env, o.a, n.prop);
      if (isObj(o, 'map')) {
        if (!(n.prop in o.m)) throw new EvalError(`找不到「${n.prop}」（可用：${Object.keys(o.m).join(', ') || '無'}）`);
        return o.m[n.prop];
      }
      throw new EvalError(`無法在 ${typeName(o)} 上取「${n.prop}」`);
    }
    case 'index': {
      const o = evalAst(n.obj, env);
      const i = evalAst(n.index, env);
      if (Array.isArray(o) && typeof i === 'number') {
        if (i < 0 || i >= o.length || !Number.isInteger(i)) throw new EvalError(`索引 ${i} 超出範圍（長度 ${o.length}）`);
        return o[i];
      }
      if (isObj(o, 'map') && typeof i === 'string') {
        if (!(i in o.m)) throw new EvalError(`找不到「${i}」`);
        return o.m[i];
      }
      throw new EvalError(`無效的索引運算`);
    }
    case 'unary': {
      const v = evalAst(n.arg, env);
      if (n.op === '!') return !asBool(v, '「!」的運算元');
      if (typeof v === 'number') return -v;
      if (isObj(v, 'qty') && v.dim !== 'temperature') return { ...v, v: -v.v };
      throw new EvalError(`無法取負：${typeName(v)}`);
    }
    case 'cond': {
      return asBool(evalAst(n.c, env), '條件') ? evalAst(n.a, env) : evalAst(n.b, env);
    }
    case 'bin': {
      if (n.op === '&&') return asBool(evalAst(n.l, env), '&& 左側') ? asBool(evalAst(n.r, env), '&& 右側') : false;
      if (n.op === '||') return asBool(evalAst(n.l, env), '|| 左側') ? true : asBool(evalAst(n.r, env), '|| 右側');
      const l = evalAst(n.l, env);
      const r = evalAst(n.r, env);
      switch (n.op) {
        case '==':
          return equals(l, r);
        case '!=':
          return !equals(l, r);
        case '<':
          return compare(l, r) < 0;
        case '<=':
          return compare(l, r) <= 0;
        case '>':
          return compare(l, r) > 0;
        case '>=':
          return compare(l, r) >= 0;
        case 'in':
          return asList(r, '「in」右側').some((x) => equals(l, x));
        default:
          return arith(n.op, l, r);
      }
    }
    case 'method':
      return evalMethod(n, env);
    case 'call':
      return evalCall(n, env);
  }
}

function macroVar(n: Ast, fn: string): string {
  if (n.t !== 'ident') throw new EvalError(`${fn}() 的第一個參數必須是變數名稱`);
  return n.name;
}

function evalMethod(n: Extract<Ast, { t: 'method' }>, env: EvalEnv): Value {
  const obj = evalAst(n.obj, env);
  switch (n.fn) {
    case 'all':
    case 'exists':
    case 'filter':
    case 'map':
    case 'count': {
      if (n.args.length !== 2) throw new EvalError(`${n.fn}(變數, 運算式) 需要兩個參數`);
      const v = macroVar(n.args[0], n.fn);
      const list = asList(obj, `${n.fn}() 的對象`);
      const body = n.args[1];
      const run = (x: Value) => evalAst(body, { ...env, vars: { ...env.vars, [v]: x } });
      if (n.fn === 'all') return list.every((x) => asBool(run(x), 'all() 條件'));
      if (n.fn === 'exists') return list.some((x) => asBool(run(x), 'exists() 條件'));
      if (n.fn === 'filter') return list.filter((x) => asBool(run(x), 'filter() 條件'));
      if (n.fn === 'count') return list.filter((x) => asBool(run(x), 'count() 條件')).length;
      return list.map(run);
    }
    case 'size':
      return sizeOf(obj);
    case 'contains': {
      const arg = evalAst(n.args[0], env);
      if (typeof obj === 'string' && typeof arg === 'string') return obj.includes(arg);
      return asList(obj, 'contains() 的對象').some((x) => equals(x, arg));
    }
    case 'startsWith': {
      const arg = evalAst(n.args[0], env);
      if (typeof obj !== 'string' || typeof arg !== 'string') throw new EvalError('startsWith() 只能用於字串');
      return obj.startsWith(arg);
    }
  }
  throw new EvalError(`未知的方法「${n.fn}」`);
}

function sizeOf(v: Value): number {
  if (typeof v === 'string' || Array.isArray(v)) return v.length;
  if (isObj(v, 'map')) return Object.keys(v.m).length;
  throw new EvalError(`size() 不支援 ${typeName(v)}`);
}

function evalCall(n: Extract<Ast, { t: 'call' }>, env: EvalEnv): Value {
  const argc = (k: number) => {
    if (n.args.length !== k) throw new EvalError(`${n.fn}() 需要 ${k} 個參數`);
  };
  const rule = env.rules?.[n.fn];
  if (rule) {
    if (n.args.length !== rule.params.length) throw new EvalError(`規則 ${n.fn}() 需要 ${rule.params.length} 個參數`);
    const args = n.args.map((a) => evalAst(a, env));
    return evalAst(rule.ast, ruleEnv(env, rule, args));
  }
  switch (n.fn) {
    case 'has': {
      argc(1);
      const m = n.args[0];
      if (m.t !== 'member') throw new EvalError('has() 的參數必須是欄位存取，例如 has(self.temp)');
      const o = evalAst(m.obj, env);
      if (isObj(o, 'art')) return hasField(o.a, m.prop);
      if (isObj(o, 'map')) return m.prop in o.m;
      throw new EvalError(`has() 不支援 ${typeName(o)}`);
    }
    case 'size':
      argc(1);
      return sizeOf(evalAst(n.args[0], env));
    case 'abs': {
      argc(1);
      const v = evalAst(n.args[0], env);
      if (typeof v === 'number') return Math.abs(v);
      if (isObj(v, 'qty') && v.dim !== 'temperature') return { ...v, v: Math.abs(v.v) };
      throw new EvalError(`abs() 不支援 ${typeName(v)}`);
    }
    case 'sum':
    case 'min':
    case 'max': {
      argc(1);
      const list = asList(evalAst(n.args[0], env), `${n.fn}() 的參數`);
      if (n.fn === 'sum') {
        if (list.length === 0) return 0;
        return list.reduce((acc, x) => arith('+', acc, x));
      }
      if (list.length === 0) throw new EvalError(`${n.fn}() 的清單為空`);
      return list.reduce((acc, x) => (n.fn === 'min' ? (compare(x, acc) < 0 ? x : acc) : compare(x, acc) > 0 ? x : acc));
    }
    case 'latest': {
      argc(1);
      const list = asList(evalAst(n.args[0], env), 'latest() 的參數');
      if (list.length === 0) throw new EvalError('latest() 的清單為空：找不到對應的紀錄');
      let best = asArt(list[0], 'latest() 的元素');
      for (const x of list) {
        const a = asArt(x, 'latest() 的元素');
        if (a.createdAt >= best.createdAt) best = a;
      }
      return art(best);
    }
    case 'upstream':
    case 'describes': {
      argc(2);
      const a = asArt(evalAst(n.args[0], env), `${n.fn}() 的第一個參數`);
      const pattern = evalAst(n.args[1], env);
      if (typeof pattern !== 'string') throw new EvalError(`${n.fn}() 的第二個參數必須是型別字串`);
      if (!env.lineage) throw new EvalError(`此語境無法查詢 lineage`);
      const res =
        n.fn === 'upstream' ? env.lineage.upstream(a.id, pattern, env.maxDepth ?? 10) : env.lineage.describes(a.id, pattern);
      return res.map(art);
    }
    case 'duration': {
      argc(1);
      const s = evalAst(n.args[0], env);
      if (typeof s !== 'string') throw new EvalError('duration() 需要字串');
      return { k: 'qty', v: parseDuration(s) / 1000, dim: 'time', unit: 'h' };
    }
    case 'timestamp': {
      argc(1);
      const s = evalAst(n.args[0], env);
      return dt(toMs(s));
    }
  }
  throw new EvalError(`未知的函式「${n.fn}」`);
}

// ---------------------------------------------------------------- guard 結果

export type GuardStatus = 'true' | 'false' | 'error';

export interface GuardResult {
  status: GuardStatus;
  /** false 或 error 的原因 */
  message?: string;
}

function safeEval(n: Ast, env: EvalEnv): Value | EvalError {
  try {
    return evalAst(n, env);
  } catch (e) {
    return e instanceof EvalError ? e : new EvalError(String(e));
  }
}

const CMP = new Set(['==', '!=', '<', '<=', '>', '>=', 'in']);

/** 找出讓運算式為 false 的最小子運算式，回傳可讀說明 */
export function explainFalse(src: string, n: Ast, env: EvalEnv): string {
  const text = sourceOf(src, n);
  if (n.t === 'bin' && n.op === '&&') {
    const l = safeEval(n.l, env);
    return l === false ? explainFalse(src, n.l, env) : explainFalse(src, n.r, env);
  }
  if (n.t === 'bin' && n.op === '||') {
    return `${explainFalse(src, n.l, env)}；且 ${explainFalse(src, n.r, env)}`;
  }
  if (n.t === 'bin' && CMP.has(n.op)) {
    const l = safeEval(n.l, env);
    const r = safeEval(n.r, env);
    if (!(l instanceof EvalError) && !(r instanceof EvalError)) {
      return `「${text}」不成立：${formatValue(l)} ${n.op} ${formatValue(r)}`;
    }
  }
  if (n.t === 'method' && n.fn === 'all' && n.args.length === 2 && n.args[0].t === 'ident') {
    const list = safeEval(n.obj, env);
    if (Array.isArray(list)) {
      const v = n.args[0].name;
      for (const x of list) {
        const sub = { ...env, vars: { ...env.vars, [v]: x } };
        if (safeEval(n.args[1], sub) === false) {
          return `${formatValue(x)} 不符合：${explainFalse(src, n.args[1], sub)}`;
        }
      }
    }
  }
  if (n.t === 'method' && n.fn === 'exists') return `「${text}」不成立：沒有任何元素符合`;
  if (n.t === 'call' && env.rules?.[n.fn]) {
    const rule = env.rules[n.fn];
    try {
      const args = n.args.map((a) => evalAst(a, env));
      return `${rule.label ?? rule.id} 不成立：${explainFalse(rule.src, rule.ast, ruleEnv(env, rule, args))}`;
    } catch {
      /* 落到預設說明 */
    }
  }
  return `「${text}」為 false`;
}

/** 評估 guard / where / route 條件 */
export function evaluateGuard(src: string, env: EvalEnv): GuardResult {
  let ast: Ast;
  try {
    ast = parseExpr(src);
  } catch (e) {
    const msg = e instanceof ExprSyntaxError ? `語法錯誤（第 ${e.pos + 1} 字元）：${e.message}` : String(e);
    return { status: 'error', message: msg };
  }
  try {
    const v = evalAst(ast, env);
    if (typeof v !== 'boolean') return { status: 'error', message: `條件必須回傳 bool，實際為 ${typeName(v)}` };
    if (v) return { status: 'true' };
    return { status: 'false', message: explainFalse(src, ast, env) };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** 評估任意運算式並回傳值（用於樣本預覽） */
export function evaluate(src: string, env: EvalEnv): Value {
  return evalAst(parseExpr(src), env);
}
