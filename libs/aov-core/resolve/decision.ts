/**
 * 欄位式決策表：格子 → 運算式；unique 時偵測數值區間重疊。
 * 格子語法：空白／- 不限；>= 99 %；[6.5..7.5]；in ['A','B']；'A'（等於）
 */
import { evaluate } from '../expr/evaluator';
import { TypeLibrary } from '../model/library';
import type { CheckDef, DecisionTable, RouteRule } from '../model/types';

const CMP = /^(>=|<=|==|!=|>|<)\s*(.+)$/;
const RANGE = /^\[(.+?)\.\.(.+)\]$/;
const IN = /^in\s+(.+)$/;

export function isAnyCell(cell: string | undefined): boolean {
  const c = (cell ?? '').trim();
  return c === '' || c === '-';
}

/** 單一格子轉成運算式；不限時回傳 undefined */
export function cellToExpr(input: string, cell: string | undefined): string | undefined {
  const c = (cell ?? '').trim();
  if (isAnyCell(c)) return undefined;
  const x = `(${input})`;
  let m = RANGE.exec(c);
  if (m) return `${x} >= ${m[1].trim()} && ${x} <= ${m[2].trim()}`;
  m = IN.exec(c);
  if (m) return `${x} in ${m[1].trim()}`;
  m = CMP.exec(c);
  if (m) return `${x} ${m[1]} ${m[2].trim()}`;
  return `${x} == ${c}`;
}

export function ruleExpr(table: DecisionTable, rule: DecisionTable['rules'][number]): string {
  const parts = table.inputs.map((i) => cellToExpr(i.expr, rule.when[i.id])).filter((x): x is string => !!x);
  return parts.length ? parts.map((p) => `(${p})`).join(' && ') : 'otherwise';
}

/** 決策表編譯成運算式決策表（route） */
export function decisionToRoute(table: DecisionTable): RouteRule[] {
  return table.rules.map((r, i) => ({ when: ruleExpr(table, r), port: r.port, label: r.label ?? `規則 ${i + 1}` }));
}

// ---------------------------------------------------------------- 重疊偵測

interface Interval {
  lo: number;
  loInc: boolean;
  hi: number;
  hiInc: boolean;
  dim: string;
}
type CellSet = { kind: 'any' } | { kind: 'interval'; v: Interval } | { kind: 'values'; v: string[] } | { kind: 'unknown' };

const emptyLib = new TypeLibrary([]);

function literal(src: string): { num: number; dim: string } | { str: string } | undefined {
  try {
    const v = evaluate(src, { vars: {}, library: emptyLib });
    if (typeof v === 'number') return { num: v, dim: 'number' };
    if (typeof v === 'string') return { str: v };
    if (v && typeof v === 'object' && !Array.isArray(v) && v.k === 'qty') return { num: v.v, dim: v.dim };
  } catch {
    /* 非字面值 */
  }
  return undefined;
}

function cellSet(cell: string | undefined): CellSet {
  const c = (cell ?? '').trim();
  if (isAnyCell(c)) return { kind: 'any' };
  let m = RANGE.exec(c);
  if (m) {
    const a = literal(m[1]);
    const b = literal(m[2]);
    if (a && b && 'num' in a && 'num' in b && a.dim === b.dim) return { kind: 'interval', v: { lo: a.num, loInc: true, hi: b.num, hiInc: true, dim: a.dim } };
    return { kind: 'unknown' };
  }
  m = IN.exec(c);
  if (m) {
    try {
      const v = evaluate(m[1], { vars: {}, library: emptyLib });
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return { kind: 'values', v: v as string[] };
    } catch {
      /* ignore */
    }
    return { kind: 'unknown' };
  }
  m = CMP.exec(c);
  const op = m ? m[1] : '==';
  const lit = literal(m ? m[2] : c);
  if (!lit) return { kind: 'unknown' };
  if ('str' in lit) return op === '==' ? { kind: 'values', v: [lit.str] } : { kind: 'unknown' };
  const { num, dim } = lit;
  switch (op) {
    case '>=':
      return { kind: 'interval', v: { lo: num, loInc: true, hi: Infinity, hiInc: false, dim } };
    case '>':
      return { kind: 'interval', v: { lo: num, loInc: false, hi: Infinity, hiInc: false, dim } };
    case '<=':
      return { kind: 'interval', v: { lo: -Infinity, loInc: false, hi: num, hiInc: true, dim } };
    case '<':
      return { kind: 'interval', v: { lo: -Infinity, loInc: false, hi: num, hiInc: false, dim } };
    case '==':
      return { kind: 'interval', v: { lo: num, loInc: true, hi: num, hiInc: true, dim } };
    default:
      return { kind: 'unknown' };
  }
}

/** 兩個格子是否可能同時成立；無法判斷時回傳 undefined */
function intersects(a: CellSet, b: CellSet): boolean | undefined {
  if (a.kind === 'any' || b.kind === 'any') return true;
  if (a.kind === 'unknown' || b.kind === 'unknown') return undefined;
  if (a.kind === 'values' && b.kind === 'values') return a.v.some((x) => b.v.includes(x));
  if (a.kind === 'interval' && b.kind === 'interval') {
    if (a.v.dim !== b.v.dim) return undefined;
    const lo = Math.max(a.v.lo, b.v.lo);
    const hi = Math.min(a.v.hi, b.v.hi);
    if (lo < hi) return true;
    if (lo > hi) return false;
    const loInc = a.v.lo === lo ? a.v.loInc : true;
    const loInc2 = b.v.lo === lo ? b.v.loInc : true;
    const hiInc = a.v.hi === hi ? a.v.hiInc : true;
    const hiInc2 = b.v.hi === hi ? b.v.hiInc : true;
    return loInc && loInc2 && hiInc && hiInc2;
  }
  return undefined;
}

/** 找出重疊的規則對（不含最後一條全部不限的規則） */
export function findOverlaps(table: DecisionTable): [number, number][] {
  const rules = table.rules.filter((r) => table.inputs.some((i) => !isAnyCell(r.when[i.id])));
  const sets = rules.map((r) => table.inputs.map((i) => cellSet(r.when[i.id])));
  const out: [number, number][] = [];
  for (let a = 0; a < rules.length; a++) {
    for (let b = a + 1; b < rules.length; b++) {
      const res = table.inputs.map((_, k) => intersects(sets[a][k], sets[b][k]));
      if (res.every((x) => x === true)) out.push([table.rules.indexOf(rules[a]), table.rules.indexOf(rules[b])]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 檢驗項目

/** 檢驗項目轉成要全部成立的比較式 */
export function checkConditions(c: CheckDef): string[] {
  const v = `(${c.value})`;
  const out: string[] = [];
  if (c.min?.trim()) out.push(`${v} >= (${c.min})`);
  if (c.max?.trim()) out.push(`${v} <= (${c.max})`);
  if (c.equals?.trim()) out.push(`${v} == (${c.equals})`);
  if (c.oneOf?.trim()) out.push(`${v} in (${c.oneOf})`);
  return out;
}

/** 檢驗項目可能產生的判定結果 */
export function possibleVerdicts(node: { verdicts?: { verdict: string }[] }): string[] {
  return node.verdicts?.length ? [...new Set(node.verdicts.map((v) => v.verdict))] : ['ok', 'ng'];
}
