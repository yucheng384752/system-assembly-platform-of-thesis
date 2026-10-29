// The evaluator sidecar's request handler (contract 8.1 item 16): pure A-core expression evaluation behind a JSON line protocol.
// It reads no clock, no file and no network: the caller supplies `now`, the parameters, the artifact types and the rules, so the same
// request always gives the same answer and the answer can only depend on the aov-core version it reports in `hello`.
import { art, dt, evaluate, evaluateGuard, formatValue, fromJs, map, type ArtifactView, type EvalEnv, type Value } from '../../../libs/aov-core/expr/evaluator';
import { TypeLibrary } from '../../../libs/aov-core/model/library';
import { fromBase, isUnit } from '../../../libs/aov-core/model/units';
import type { ArtifactType, GuardItem, RuleDef } from '../../../libs/aov-core/model/types';
import { compileRules, guardItems } from '../../../libs/aov-core/resolve/rules';
import version from '../../../libs/aov-core/VERSION.json';

export const PROTOCOL = 1;
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export class BadRequest extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function artifactView(raw: unknown, path: string): ArtifactView {
  if (!isRecord(raw)) throw new BadRequest('bad-value', `${path}: an artifact must be an object`);
  const { id, type, version: v, attrs, createdAt, qty, location } = raw;
  if (typeof id !== 'string' || typeof type !== 'string' || typeof v !== 'number' || !isRecord(attrs) || typeof createdAt !== 'number') {
    throw new BadRequest('bad-value', `${path}: an artifact needs string id and type, numeric version and createdAt, and an attrs object`);
  }
  if (qty !== undefined && !(isRecord(qty) && typeof qty.value === 'number' && typeof qty.unit === 'string' && isUnit(qty.unit))) {
    throw new BadRequest('bad-value', `${path}/qty: needs a numeric value and a known unit`);
  }
  if (location !== undefined && typeof location !== 'string') throw new BadRequest('bad-value', `${path}/location: must be a string`);
  return { id, type, version: v, attrs, createdAt, qty: qty as ArtifactView['qty'], location };
}

// Plain JSON is a value; `{$artifact}` and `{$datetime}` are the only markers. Any other `$` key is refused rather than guessed at.
export function decode(raw: unknown, path = ''): Value {
  if (typeof raw === 'boolean' || typeof raw === 'string') return raw;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new BadRequest('bad-value', `${path}: numbers must be finite`);
    return raw;
  }
  if (Array.isArray(raw)) return raw.map((x, i) => decode(x, `${path}/${i}`));
  if (!isRecord(raw)) throw new BadRequest('bad-value', `${path || '/'}: null and undefined are not values`);
  const keys = Object.keys(raw);
  const marker = keys.filter(k => k.startsWith('$'));
  if (marker.length) {
    if (keys.length !== 1) throw new BadRequest('bad-value', `${path}: a marker object has no other keys`);
    if (marker[0] === '$artifact') return art(artifactView(raw.$artifact, `${path}/$artifact`));
    if (marker[0] === '$datetime') {
      const ms = typeof raw.$datetime === 'string' ? Date.parse(raw.$datetime) : NaN;
      if (Number.isNaN(ms)) throw new BadRequest('bad-value', `${path}/$datetime: not an ISO date-time`);
      return dt(ms);
    }
    throw new BadRequest('bad-value', `${path}: unknown marker ${marker[0]}`);
  }
  if (typeof raw.value === 'number' && typeof raw.unit === 'string' && isUnit(raw.unit) && keys.length === 2) return fromJs(raw);
  return map(Object.fromEntries(keys.map(k => [k, decode(raw[k], `${path}/${k}`)])));
}

export function encode(v: Value): unknown {
  if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(encode);
  switch (v.k) {
    case 'qty': return { $qty: { value: fromBase(v.v, v.unit), unit: v.unit } };
    case 'dt': return { $datetime: new Date(v.ms).toISOString() };
    case 'enum': return { $enum: v.v };
    case 'art': return { $artifact: v.a.id };
    case 'map': return { $map: Object.fromEntries(Object.entries(v.m).map(([k, x]) => [k, encode(x)])) };
  }
}

interface Compiled { library: TypeLibrary; rules: EvalEnv['rules'] }
const cache = new Map<string, Compiled>();
const CACHE_LIMIT = 32;

function compiled(artifactTypes: unknown, ruleDefs: unknown): Compiled {
  if (artifactTypes !== undefined && !Array.isArray(artifactTypes)) throw new BadRequest('bad-request', 'artifactTypes must be an array');
  if (ruleDefs !== undefined && !Array.isArray(ruleDefs)) throw new BadRequest('bad-request', 'rules must be an array');
  const key = JSON.stringify([artifactTypes ?? [], ruleDefs ?? []]);
  const hit = cache.get(key);
  if (hit) return hit;
  const { rules, diagnostics } = compileRules((ruleDefs ?? []) as RuleDef[]);
  const errors = diagnostics.filter(d => d.severity === 'error');
  if (errors.length) throw new BadRequest('bad-rules', errors.map(d => d.message).join('; '));
  const value = { library: new TypeLibrary((artifactTypes ?? []) as ArtifactType[]), rules };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
  return value;
}

function environment(request: Record<string, unknown>): EvalEnv {
  const now = typeof request.now === 'string' ? Date.parse(request.now) : NaN;
  if (Number.isNaN(now)) throw new BadRequest('bad-request', 'now must be an ISO date-time supplied by the caller');
  const vars: Record<string, Value> = {};
  if (request.vars !== undefined) {
    if (!isRecord(request.vars)) throw new BadRequest('bad-request', 'vars must be an object');
    for (const [name, raw] of Object.entries(request.vars)) {
      if (name === 'params' || name === 'now') throw new BadRequest('bad-request', `${name} is set by the request, not by vars`);
      vars[name] = decode(raw, `/vars/${name}`);
    }
  }
  if (request.params !== undefined && !isRecord(request.params)) throw new BadRequest('bad-request', 'params must be an object');
  const { library, rules } = compiled(request.artifactTypes, request.rules);
  return { vars: { ...vars, params: decode(request.params ?? {}, '/params'), now: dt(now) }, library, rules, maxDepth: 10 };
}

function expression(request: Record<string, unknown>): string {
  if (typeof request.expr !== 'string' || !request.expr.trim()) throw new BadRequest('bad-request', 'expr must be a non-empty string');
  return request.expr;
}

function operate(request: Record<string, unknown>): Record<string, unknown> {
  switch (request.op) {
    case 'hello':
      return { commit: version.commit, protocol: PROTOCOL };
    case 'evaluate': {
      const env = environment(request);
      if (request.mode === 'value') {
        try {
          const value = evaluate(expression(request), env);
          return { value: encode(value), text: formatValue(value) };
        } catch (error) {
          if (error instanceof BadRequest) throw error;
          return { error: error instanceof Error ? error.message : String(error) };
        }
      }
      if (request.mode !== 'guard') throw new BadRequest('bad-request', 'mode must be "guard" or "value"');
      return { ...evaluateGuard(expression(request), env) };
    }
    case 'guards': {
      const env = environment(request);
      const given = request.guard;
      if (given !== undefined && typeof given !== 'string' && !(Array.isArray(given) && given.every(g => isRecord(g) && typeof g.label === 'string' && typeof g.when === 'string'))) {
        throw new BadRequest('bad-request', 'guard must be a string or a list of {label, when}');
      }
      return { items: guardItems(given as string | GuardItem[] | undefined).map(item => ({ label: item.label, ...evaluateGuard(item.when, env) })) };
    }
    default:
      throw new BadRequest('bad-request', `unknown op ${JSON.stringify(request.op)}`);
  }
}

export function respond(line: string): string {
  let id: unknown = null;
  try {
    const request: unknown = JSON.parse(line);
    if (!isRecord(request)) throw new BadRequest('bad-request', 'a request must be an object');
    id = request.id ?? null;
    return JSON.stringify({ id, ok: true, ...operate(request) });
  } catch (error) {
    if (error instanceof BadRequest) return JSON.stringify({ id, ok: false, error: { code: error.code, message: error.message } });
    if (error instanceof SyntaxError) return JSON.stringify({ id, ok: false, error: { code: 'bad-json', message: error.message } });
    process.stderr.write(`evaluator internal error: ${error instanceof Error ? error.stack : String(error)}\n`);
    return JSON.stringify({ id, ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } });
  }
}
