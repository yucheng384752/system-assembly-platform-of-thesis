/** 具名規則：編譯、檢查遞迴與命名衝突 */
import type { CompiledRule } from '../expr/evaluator';
import { type Ast, ExprSyntaxError, FUNCTIONS, MACROS, parseExpr } from '../expr/parser';
import type { Diagnostic, Guard, GuardItem, RuleDef } from '../model/types';

const RESERVED = new Set([...FUNCTIONS, ...MACROS, 'in', 'params', 'now', 'self', 'true', 'false', 'otherwise']);

function callsIn(ast: Ast, out: Set<string>) {
  switch (ast.t) {
    case 'call':
      out.add(ast.fn);
      ast.args.forEach((a) => callsIn(a, out));
      break;
    case 'method':
      callsIn(ast.obj, out);
      ast.args.forEach((a) => callsIn(a, out));
      break;
    case 'member':
      callsIn(ast.obj, out);
      break;
    case 'index':
      callsIn(ast.obj, out);
      callsIn(ast.index, out);
      break;
    case 'unary':
      callsIn(ast.arg, out);
      break;
    case 'bin':
      callsIn(ast.l, out);
      callsIn(ast.r, out);
      break;
    case 'list':
      ast.items.forEach((a) => callsIn(a, out));
      break;
    case 'cond':
      callsIn(ast.c, out);
      callsIn(ast.a, out);
      callsIn(ast.b, out);
      break;
    default:
      break;
  }
}

/** 編譯規則；回傳可用的規則與診斷（語法、命名、遞迴） */
export function compileRules(defs: RuleDef[] | undefined): { rules: Record<string, CompiledRule>; diagnostics: Diagnostic[] } {
  const rules: Record<string, CompiledRule> = {};
  const diagnostics: Diagnostic[] = [];
  const err = (message: string) => diagnostics.push({ severity: 'error', code: 'E4-rule', message });
  for (const d of defs ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(d.id)) {
      err(`規則名稱「${d.id}」只能用英文字母、數字與底線，且不能以數字開頭`);
      continue;
    }
    if (RESERVED.has(d.id)) {
      err(`規則名稱「${d.id}」與內建名稱衝突`);
      continue;
    }
    if (new Set(d.params).size !== d.params.length) err(`規則 ${d.id} 的參數名稱重複`);
    try {
      rules[d.id] = { id: d.id, label: d.label, params: d.params, src: d.expr, ast: parseExpr(d.expr) };
    } catch (e) {
      err(`規則 ${d.id} 語法錯誤：${e instanceof ExprSyntaxError ? e.message : String(e)}`);
    }
  }
  // 遞迴檢查（規則之間的引用必須無環）
  const graph = new Map<string, string[]>();
  for (const r of Object.values(rules)) {
    const calls = new Set<string>();
    callsIn(r.ast, calls);
    graph.set(
      r.id,
      [...calls].filter((c) => c in rules),
    );
  }
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, path: string[]): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) {
      err(`規則遞迴：${[...path, id].join(' → ')}（規則之間不可循環引用）`);
      return true;
    }
    state.set(id, 1);
    for (const nx of graph.get(id) ?? []) if (visit(nx, [...path, id])) return true;
    state.set(id, 2);
    return false;
  };
  for (const id of graph.keys()) if (visit(id, [])) break;
  if (diagnostics.some((d) => d.message.startsWith('規則遞迴'))) {
    return { rules: {}, diagnostics };
  }
  return { rules, diagnostics };
}

/** guard 正規化成具名條件清單 */
export function guardItems(g: Guard | undefined): GuardItem[] {
  if (!g) return [];
  if (typeof g === 'string') return g.trim() ? [{ label: '條件', when: g }] : [];
  return g.filter((x) => x.when.trim());
}
