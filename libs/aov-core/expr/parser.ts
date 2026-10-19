/**
 * Guard 表達式語言：CEL 子集 + 領域擴充（單位字面值、lineage 函式）。
 *
 * 文法（優先序由低到高）：
 *   expr    := or ('?' expr ':' expr)?
 *   or      := and ('||' and)*
 *   and     := eq ('&&' eq)*
 *   eq      := rel (('==' | '!=') rel)*
 *   rel     := add (('<' | '<=' | '>' | '>=' | 'in') add)*
 *   add     := mul (('+' | '-') mul)*
 *   mul     := unary (('*' | '/') unary)*
 *   unary   := ('!' | '-') unary | postfix
 *   postfix := primary ('.' IDENT ('(' args ')')? | '[' expr ']')*
 *   primary := NUMBER UNIT? | STRING | true | false | IDENT ('(' args ')')? | '[' args ']' | '(' expr ')'
 *
 * 不提供：迴圈、遞迴、自訂函式、賦值。保證終止。
 */
import { isUnit } from '../model/units';

export type BinOp = '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | '+' | '-' | '*' | '/';

export type Ast =
  | { t: 'num'; v: number; unit?: string; s: number; e: number }
  | { t: 'str'; v: string; s: number; e: number }
  | { t: 'bool'; v: boolean; s: number; e: number }
  | { t: 'ident'; name: string; s: number; e: number }
  | { t: 'member'; obj: Ast; prop: string; s: number; e: number }
  | { t: 'index'; obj: Ast; index: Ast; s: number; e: number }
  | { t: 'call'; fn: string; args: Ast[]; s: number; e: number }
  | { t: 'method'; obj: Ast; fn: string; args: Ast[]; s: number; e: number }
  | { t: 'unary'; op: '!' | '-'; arg: Ast; s: number; e: number }
  | { t: 'bin'; op: BinOp; l: Ast; r: Ast; s: number; e: number }
  | { t: 'list'; items: Ast[]; s: number; e: number }
  | { t: 'cond'; c: Ast; a: Ast; b: Ast; s: number; e: number };

export class ExprSyntaxError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
  ) {
    super(message);
  }
}

type Tok =
  | { k: 'num'; v: number; unit?: string; s: number; e: number }
  | { k: 'str'; v: string; s: number; e: number }
  | { k: 'id'; v: string; s: number; e: number }
  | { k: 'op'; v: string; s: number; e: number }
  | { k: 'eof'; s: number; e: number };

const OPS = ['&&', '||', '==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '!', '(', ')', '[', ']', ',', '.', '?', ':'];

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const s = i;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        i++;
        while (i < src.length && /[0-9]/.test(src[i])) i++;
      }
      const v = Number(src.slice(s, i));
      // 單位：緊接或空白後的已知單位名稱（或 %）
      let j = i;
      while (j < src.length && src[j] === ' ') j++;
      let unit: string | undefined;
      if (src[j] === '%') {
        unit = '%';
        i = j + 1;
      } else {
        const m = /^[A-Za-z][A-Za-z0-9]*/.exec(src.slice(j));
        if (m && isUnit(m[0])) {
          unit = m[0];
          i = j + m[0].length;
        }
      }
      out.push({ k: 'num', v, unit, s, e: i });
      continue;
    }
    if (c === '"' || c === "'") {
      const s = i;
      const q = c;
      i++;
      let v = '';
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const n = src[i + 1];
          v += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          i += 2;
        } else {
          v += src[i++];
        }
      }
      if (src[i] !== q) throw new ExprSyntaxError('字串沒有結尾引號', s);
      i++;
      out.push({ k: 'str', v, s, e: i });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const s = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      out.push({ k: 'id', v: src.slice(s, i), s, e: i });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprSyntaxError(`無法辨識的字元「${c}」`, i);
    out.push({ k: 'op', v: op, s: i, e: i + op.length });
    i += op.length;
  }
  out.push({ k: 'eof', s: src.length, e: src.length });
  return out;
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === 'op' && t.v === v;
  }
  private isId(v: string): boolean {
    const t = this.peek();
    return t.k === 'id' && t.v === v;
  }
  private expectOp(v: string): Tok {
    const t = this.next();
    if (t.k !== 'op' || t.v !== v) throw new ExprSyntaxError(`預期「${v}」`, t.s);
    return t;
  }

  parse(): Ast {
    const e = this.expr();
    const t = this.peek();
    if (t.k !== 'eof') throw new ExprSyntaxError('運算式結尾有多餘內容', t.s);
    return e;
  }

  private expr(): Ast {
    const c = this.or();
    if (this.isOp('?')) {
      this.next();
      const a = this.expr();
      this.expectOp(':');
      const b = this.expr();
      return { t: 'cond', c, a, b, s: c.s, e: b.e };
    }
    return c;
  }

  private binLevel(next: () => Ast, ops: string[]): Ast {
    let l = next();
    for (;;) {
      const t = this.peek();
      const hit = (t.k === 'op' && ops.includes(t.v)) || (t.k === 'id' && t.v === 'in' && ops.includes('in'));
      if (!hit) return l;
      this.next();
      const r = next();
      l = { t: 'bin', op: (t as { v: string }).v as BinOp, l, r, s: l.s, e: r.e };
    }
  }

  private or = (): Ast => this.binLevel(this.and, ['||']);
  private and = (): Ast => this.binLevel(this.eq, ['&&']);
  private eq = (): Ast => this.binLevel(this.rel, ['==', '!=']);
  private rel = (): Ast => this.binLevel(this.add, ['<', '<=', '>', '>=', 'in']);
  private add = (): Ast => this.binLevel(this.mul, ['+', '-']);
  private mul = (): Ast => this.binLevel(this.unary, ['*', '/']);

  private unary = (): Ast => {
    if (this.isOp('!') || this.isOp('-')) {
      const t = this.next() as { v: '!' | '-'; s: number };
      const arg = this.unary();
      return { t: 'unary', op: t.v, arg, s: t.s, e: arg.e };
    }
    return this.postfix();
  };

  private args(close: string): Ast[] {
    const out: Ast[] = [];
    if (this.isOp(close)) return out;
    for (;;) {
      out.push(this.expr());
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      return out;
    }
  }

  private postfix(): Ast {
    let node = this.primary();
    for (;;) {
      if (this.isOp('.')) {
        this.next();
        const id = this.next();
        if (id.k !== 'id') throw new ExprSyntaxError('「.」後面需要名稱', id.s);
        if (this.isOp('(')) {
          this.next();
          const args = this.args(')');
          const close = this.expectOp(')');
          node = { t: 'method', obj: node, fn: id.v, args, s: node.s, e: close.e };
        } else {
          node = { t: 'member', obj: node, prop: id.v, s: node.s, e: id.e };
        }
        continue;
      }
      if (this.isOp('[')) {
        this.next();
        const index = this.expr();
        const close = this.expectOp(']');
        node = { t: 'index', obj: node, index, s: node.s, e: close.e };
        continue;
      }
      return node;
    }
  }

  private primary(): Ast {
    const t = this.next();
    switch (t.k) {
      case 'num':
        return { t: 'num', v: t.v, unit: t.unit, s: t.s, e: t.e };
      case 'str':
        return { t: 'str', v: t.v, s: t.s, e: t.e };
      case 'id': {
        if (t.v === 'true' || t.v === 'false') return { t: 'bool', v: t.v === 'true', s: t.s, e: t.e };
        if (this.isOp('(')) {
          this.next();
          const args = this.args(')');
          const close = this.expectOp(')');
          return { t: 'call', fn: t.v, args, s: t.s, e: close.e };
        }
        return { t: 'ident', name: t.v, s: t.s, e: t.e };
      }
      case 'op': {
        if (t.v === '(') {
          const e = this.expr();
          this.expectOp(')');
          return e;
        }
        if (t.v === '[') {
          const items = this.args(']');
          const close = this.expectOp(']');
          return { t: 'list', items, s: t.s, e: close.e };
        }
        throw new ExprSyntaxError(`不預期的「${t.v}」`, t.s);
      }
      case 'eof':
        throw new ExprSyntaxError('運算式不完整', t.s);
    }
  }

  // unused helper kept for readability of grammar
  isKeyword(v: string): boolean {
    return this.isId(v);
  }
}

const parseCache = new Map<string, Ast>();

export function parseExpr(src: string): Ast {
  const hit = parseCache.get(src);
  if (hit) return hit;
  const ast = new Parser(tokenize(src)).parse();
  if (parseCache.size > 2000) parseCache.clear();
  parseCache.set(src, ast);
  return ast;
}

export function sourceOf(src: string, n: Ast): string {
  return src.slice(n.s, n.e);
}

/** 巨集（第一個參數是迭代變數名稱） */
export const MACROS = new Set(['all', 'exists', 'filter', 'map', 'count']);
export const FUNCTIONS = new Set(['has', 'size', 'sum', 'min', 'max', 'abs', 'latest', 'upstream', 'describes', 'duration', 'timestamp']);
