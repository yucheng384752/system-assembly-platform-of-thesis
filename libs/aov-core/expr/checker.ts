/**
 * 設計時型別檢查：在畫布上就能檢查屬性名稱、型別與單位維度。
 * 推論不到的地方以 any 放行（寬鬆），確定錯誤才報錯。
 */
import type { TypeLibrary } from '../model/library';
import { parseCardinality } from '../model/library';
import type { AttrDef, NodeDef, ParamDef } from '../model/types';
import { type Dimension, unitDim } from '../model/units';
import type { CompiledRule } from './evaluator';
import { type Ast, ExprSyntaxError, FUNCTIONS, MACROS, parseExpr, sourceOf } from './parser';

export type Ty =
  | { k: 'any' }
  | { k: 'bool' }
  | { k: 'num' }
  | { k: 'str' }
  | { k: 'dt' }
  | { k: 'qty'; dim: Dimension }
  | { k: 'enum'; order: string[] }
  | { k: 'art'; type?: string }
  | { k: 'list'; of: Ty }
  | { k: 'map'; fields?: Record<string, Ty> };

export interface CheckDiag {
  severity: 'error' | 'warning';
  message: string;
  pos?: number;
}

const ANY: Ty = { k: 'any' };
const BOOL: Ty = { k: 'bool' };
const NUM: Ty = { k: 'num' };
const STR: Ty = { k: 'str' };
const DT: Ty = { k: 'dt' };

function tyName(t: Ty): string {
  switch (t.k) {
    case 'qty':
      return `quantity(${t.dim})`;
    case 'art':
      return t.type ? `artifact(${t.type})` : 'artifact';
    case 'list':
      return `list<${tyName(t.of)}>`;
    default:
      return t.k;
  }
}

export function attrTy(def: AttrDef): Ty {
  switch (def.type) {
    case 'quantity':
      return def.unit ? { k: 'qty', dim: unitDim(def.unit) } : ANY;
    case 'number':
      return def.unit ? { k: 'qty', dim: unitDim(def.unit) } : NUM;
    case 'datetime':
      return DT;
    case 'enum':
      return { k: 'enum', order: def.values ?? [] };
    case 'string[]':
      return { k: 'list', of: STR };
    case 'bool':
      return BOOL;
    case 'json':
      return ANY;
    default:
      return STR;
  }
}

class Checker {
  readonly diags: CheckDiag[] = [];
  private depth = 0;
  constructor(
    private readonly src: string,
    private readonly lib: TypeLibrary,
    private readonly rules: Record<string, CompiledRule> = {},
  ) {}

  err(n: Ast, message: string) {
    this.diags.push({ severity: 'error', message, pos: n.s });
  }
  warn(n: Ast, message: string) {
    this.diags.push({ severity: 'warning', message, pos: n.s });
  }

  private artTypeQty(type?: string): Ty {
    if (!type) return ANY;
    const bare = type.endsWith('.*') ? type.slice(0, -2) : type;
    const r = this.lib.tryResolve(bare);
    return r?.quantity ? { k: 'qty', dim: unitDim(r.quantity.baseUnit) } : ANY;
  }

  private member(obj: Ty, prop: string, n: Ast): Ty {
    if (obj.k === 'any') return ANY;
    if (obj.k === 'art') {
      switch (prop) {
        case 'id':
        case 'type':
        case 'location':
          return STR;
        case 'version':
          return NUM;
        case 'createdAt':
          return DT;
        case 'qty':
          return this.artTypeQty(obj.type);
      }
      if (!obj.type) return ANY;
      const bare = obj.type.endsWith('.*') ? obj.type.slice(0, -2) : obj.type;
      const r = this.lib.tryResolve(bare);
      if (!r) return ANY;
      const def = r.attributes[prop];
      if (!def) {
        if (obj.type.endsWith('.*')) {
          this.warn(n, `型別 ${bare} 沒有屬性「${prop}」（glob 子型別可能有）`);
          return ANY;
        }
        const avail = Object.keys(r.attributes);
        this.err(n, `型別 ${obj.type} 沒有屬性「${prop}」${avail.length ? `（可用：${avail.join(', ')}）` : ''}`);
        return ANY;
      }
      try {
        return attrTy(def);
      } catch {
        return ANY;
      }
    }
    if (obj.k === 'map') {
      if (!obj.fields) return ANY;
      if (!(prop in obj.fields)) {
        this.err(n, `找不到「${prop}」（可用：${Object.keys(obj.fields).join(', ') || '無'}）`);
        return ANY;
      }
      return obj.fields[prop];
    }
    this.err(n, `無法在 ${tyName(obj)} 上取「${prop}」`);
    return ANY;
  }

  private cmp(l: Ty, r: Ty, n: Ast) {
    if (l.k === 'any' || r.k === 'any') return;
    if (l.k === 'qty' && r.k === 'qty' && l.dim !== r.dim) this.err(n, `無法比較 ${l.dim} 與 ${r.dim}（跨維度）`);
    else if ((l.k === 'qty' && r.k === 'num') || (l.k === 'num' && r.k === 'qty')) this.err(n, '數值缺少單位，無法與數量比較');
    else if (l.k === 'enum' && r.k === 'str' && n.t === 'bin') {
      const lit = n.r.t === 'str' ? n.r.v : undefined;
      if (lit !== undefined && l.order.length && !l.order.includes(lit)) this.err(n, `列舉值「${lit}」不在定義中（可用：${l.order.join(', ')}）`);
    } else if (l.k !== r.k && !(l.k === 'enum' && r.k === 'str') && !(l.k === 'str' && r.k === 'enum')) {
      this.err(n, `無法比較 ${tyName(l)} 與 ${tyName(r)}`);
    }
  }

  check(n: Ast, scope: Record<string, Ty>): Ty {
    switch (n.t) {
      case 'num':
        return n.unit ? { k: 'qty', dim: unitDim(n.unit) } : NUM;
      case 'str':
        return STR;
      case 'bool':
        return BOOL;
      case 'list': {
        const items = n.items.map((x) => this.check(x, scope));
        return { k: 'list', of: items[0] ?? ANY };
      }
      case 'ident':
        if (!(n.name in scope)) {
          this.err(n, `未定義的名稱「${n.name}」（可用：${Object.keys(scope).join(', ')}）`);
          return ANY;
        }
        return scope[n.name];
      case 'member':
        return this.member(this.check(n.obj, scope), n.prop, n);
      case 'index': {
        const o = this.check(n.obj, scope);
        this.check(n.index, scope);
        return o.k === 'list' ? o.of : ANY;
      }
      case 'unary': {
        const t = this.check(n.arg, scope);
        if (n.op === '!') {
          if (t.k !== 'bool' && t.k !== 'any') this.err(n, `「!」需要 bool，實際為 ${tyName(t)}`);
          return BOOL;
        }
        return t;
      }
      case 'cond': {
        this.check(n.c, scope);
        const a = this.check(n.a, scope);
        this.check(n.b, scope);
        return a;
      }
      case 'bin': {
        const l = this.check(n.l, scope);
        const r = this.check(n.r, scope);
        switch (n.op) {
          case '&&':
          case '||':
            for (const [t, side] of [
              [l, n.l],
              [r, n.r],
            ] as const) {
              if (t.k !== 'bool' && t.k !== 'any') this.err(side, `「${n.op}」需要 bool，實際為 ${tyName(t)}`);
            }
            return BOOL;
          case '==':
          case '!=':
            return BOOL;
          case '<':
          case '<=':
          case '>':
          case '>=':
            this.cmp(l, r, n);
            return BOOL;
          case 'in':
            if (r.k !== 'list' && r.k !== 'any') this.err(n, `「in」右側必須是清單，實際為 ${tyName(r)}`);
            return BOOL;
          default:
            if (l.k === 'qty' && r.k === 'qty' && l.dim !== r.dim && (n.op === '+' || n.op === '-')) {
              this.err(n, `無法運算 ${l.dim} ${n.op} ${r.dim}（跨維度）`);
            }
            if (l.k === 'dt' && r.k === 'qty') return DT;
            if (l.k === 'dt' && r.k === 'dt') return { k: 'qty', dim: 'time' };
            if (l.k === 'qty' && r.k === 'qty' && n.op === '/') return NUM;
            if (l.k === 'qty') return l;
            if (r.k === 'qty') return r;
            return l.k === 'any' ? r : l;
        }
      }
      case 'method': {
        const o = this.check(n.obj, scope);
        if (MACROS.has(n.fn)) {
          if (n.args.length !== 2 || n.args[0].t !== 'ident') {
            this.err(n, `${n.fn}(變數, 運算式) 需要變數名稱與運算式`);
            return ANY;
          }
          if (o.k !== 'list' && o.k !== 'any') this.err(n, `${n.fn}() 只能用於清單，實際為 ${tyName(o)}`);
          const elem = o.k === 'list' ? o.of : ANY;
          const body = this.check(n.args[1], { ...scope, [n.args[0].name]: elem });
          if (n.fn === 'map') return { k: 'list', of: body };
          if (n.fn === 'filter') return o.k === 'list' ? o : { k: 'list', of: ANY };
          if (n.fn === 'count') return NUM;
          if (body.k !== 'bool' && body.k !== 'any') this.err(n.args[1], `${n.fn}() 的條件必須是 bool`);
          return BOOL;
        }
        for (const a of n.args) this.check(a, scope);
        if (n.fn === 'size') return NUM;
        if (n.fn === 'contains' || n.fn === 'startsWith') return BOOL;
        this.err(n, `未知的方法「${n.fn}」`);
        return ANY;
      }
      case 'call': {
        const rule = this.rules[n.fn];
        if (rule) {
          const args = n.args.map((a) => this.check(a, scope));
          if (args.length !== rule.params.length) {
            this.err(n, `規則 ${n.fn}() 需要 ${rule.params.length} 個參數，實際 ${args.length} 個`);
            return BOOL;
          }
          if (this.depth >= 8) return ANY;
          const inner: Record<string, Ty> = { now: DT };
          if (scope.params) inner.params = scope.params;
          rule.params.forEach((p, i) => (inner[p] = args[i]));
          const before = this.diags.length;
          this.depth++;
          const t = this.check(rule.ast, inner);
          this.depth--;
          for (const d of this.diags.slice(before)) d.message = `規則 ${rule.label ?? rule.id}：${d.message}`;
          return t;
        }
        if (!FUNCTIONS.has(n.fn)) {
          this.err(n, `未知的函式「${n.fn}」`);
          for (const a of n.args) this.check(a, scope);
          return ANY;
        }
        if (n.fn === 'has') {
          if (n.args.length !== 1 || n.args[0].t !== 'member') {
            this.err(n, 'has() 的參數必須是欄位存取，例如 has(self.temp)');
            return BOOL;
          }
          this.check(n.args[0].obj, scope);
          return BOOL;
        }
        const args = n.args.map((a) => this.check(a, scope));
        switch (n.fn) {
          case 'size':
            return NUM;
          case 'abs':
            return args[0] ?? ANY;
          case 'sum':
          case 'min':
          case 'max':
            return args[0]?.k === 'list' ? args[0].of : ANY;
          case 'latest':
            return args[0]?.k === 'list' ? args[0].of : { k: 'art' };
          case 'upstream':
          case 'describes': {
            if (n.args.length !== 2) {
              this.err(n, `${n.fn}(artifact, "型別") 需要兩個參數`);
              return { k: 'list', of: { k: 'art' } };
            }
            const t = args[0];
            if (t.k !== 'art' && t.k !== 'any') this.err(n.args[0], `${n.fn}() 的第一個參數必須是 artifact，實際為 ${tyName(t)}`);
            const p = n.args[1];
            if (p.t === 'str') {
              const known = this.lib.ids().some((id) => this.lib.isA(id, p.v));
              if (!known) this.warn(p, `沒有任何型別符合「${p.v}」`);
              const bare = p.v.endsWith('.*') ? p.v.slice(0, -2) : p.v;
              return { k: 'list', of: { k: 'art', type: this.lib.has(bare) ? p.v : undefined } };
            }
            return { k: 'list', of: { k: 'art' } };
          }
          case 'duration':
            return { k: 'qty', dim: 'time' };
          case 'timestamp':
            return DT;
        }
        return ANY;
      }
    }
  }
}

/** 檢查一個運算式；expectBool 時頂層必須是 bool */
export function checkExpression(
  src: string,
  scope: Record<string, Ty>,
  lib: TypeLibrary,
  expectBool = true,
  rules: Record<string, CompiledRule> = {},
): CheckDiag[] {
  let ast: Ast;
  try {
    ast = parseExpr(src);
  } catch (e) {
    if (e instanceof ExprSyntaxError) return [{ severity: 'error', message: `語法錯誤：${e.message}`, pos: e.pos }];
    return [{ severity: 'error', message: String(e) }];
  }
  const c = new Checker(src, lib, rules);
  let t: Ty = ANY;
  try {
    t = c.check(ast, scope);
  } catch (e) {
    c.diags.push({ severity: 'error', message: e instanceof Error ? e.message : String(e) });
  }
  if (expectBool && t.k !== 'bool' && t.k !== 'any') {
    c.diags.push({ severity: 'error', message: `條件必須回傳 bool，實際為 ${tyName(t)}（${sourceOf(src, ast)}）` });
  }
  return c.diags;
}

// ---------------------------------------------------------------- 語境

function paramTy(p: ParamDef): Ty {
  switch (p.type) {
    case 'number':
      return NUM;
    case 'string':
      return STR;
    case 'bool':
      return BOOL;
    case 'string[]':
      return { k: 'list', of: STR };
    case 'quantity':
      return p.unit ? { k: 'qty', dim: unitDim(p.unit) } : ANY;
  }
}

export function paramsTy(params: ParamDef[] | undefined): Ty {
  const fields: Record<string, Ty> = {};
  for (const p of params ?? []) fields[p.id] = paramTy(p);
  return { k: 'map', fields };
}

/** port.where 的語境：self（單一 artifact） */
export function scopeForWhere(portType: string, params?: ParamDef[]): Record<string, Ty> {
  return { self: { k: 'art', type: portType }, params: paramsTy(params), now: DT };
}

/** node.guard 與 judge.route 的語境：in.<port>、params、now */
export function scopeForNode(node: NodeDef, params?: ParamDef[]): Record<string, Ty> {
  const fields: Record<string, Ty> = {};
  for (const p of node.inputs) {
    const single = (() => {
      try {
        return parseCardinality(p.cardinality).max <= 1;
      } catch {
        return true;
      }
    })();
    const a: Ty = { k: 'art', type: p.type };
    fields[p.id] = single ? a : { k: 'list', of: a };
  }
  return { in: { k: 'map', fields }, params: paramsTy(params), now: DT };
}
