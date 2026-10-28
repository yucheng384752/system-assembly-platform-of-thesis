import Ajv from 'ajv/dist/2020';
import {
  compile, resolveProject, TypeLibrary, parseSubgraphRef,
  CATEGORY_GROUP, type ActionLibrary, type Diagnostic, type Executor, type FormDef, type NodeCategory, type ProjectFile,
} from '../aov-core';
import version from '../aov-core/VERSION.json';
import planSchema from '../../schemas/executable-plan.schema.json';
import { contentSha256 } from './index';

// Builds the immutable executable plan of docs/executable-plan-contract.md from A's compile output.
// Nothing is guessed: a node that cannot be mapped is kept but marked not executable with a reason (contract 2.5).
export interface CapabilityMap {
  format: 'composer-action-capability-map';
  version: number;
  entries: { actionId: string; capability: string; kitId: string }[];
  /**
   * Used only by nodes that reference no action. A node whose action is missing from `entries`
   * does not fall back to these, so a forgotten action mapping stays visible.
   * `executor` fills in for nodes that have none.
   */
  categoryDefaults?: { category: NodeCategory; capability: string; kitId: string; executor?: Executor }[];
}
export type PlanTransfer = { state: 'missing' } | { state: 'specified'; minutes: number };
export type PlanTiming = { state: 'missing' } | { state: 'specified'; setupMin: number; perUnitMin: number; quantityUnit: string };
export interface PlanBuildInput {
  project: ProjectFile;
  libraries?: ActionLibrary[];
  /** Published sub-AoV projects that the project (transitively) references. */
  subgraphs?: ProjectFile[];
  mapping: CapabilityMap;
  scope: { factoryId: string; graphId: string };
  /** Per flattened node id; absent means missing, never 0. */
  timings?: Record<string, PlanTiming>;
  resources?: Record<string, { capability?: string; operatorSkill?: string }>;
  /** Per flow id; absent means missing, never 0. */
  transfers?: Record<string, PlanTransfer>;
  /** Parameters the factory may change. A's ParamDef has no such flag yet. */
  tuning?: Record<string, { range?: { min: number; max: number } }>;
}
export interface PlanBuildError { code: string; message: string; nodeId?: string }
export type ExecutablePlan = Record<string, unknown> & { planId: string };
export type PlanBuildResult = { ok: true; plan: ExecutablePlan } | { ok: false; errors: PlanBuildError[] };

const validatePlan = new Ajv({ allErrors: true, strict: false }).compile(planSchema);

// Structure only; the receiver also recomputes planId (verifyPlanId) and checks contract section 6.
export function validateExecutablePlan(plan: unknown): PlanBuildError[] {
  if (validatePlan(plan)) return [];
  return (validatePlan.errors ?? []).map(e => ({ code: 'plan-schema', message: `${e.instancePath || '/'} ${e.message ?? ''}`.trim() }));
}

// planId covers the whole plan except the planId field itself (contract section 5).
export async function computePlanId(plan: Record<string, unknown>): Promise<string> {
  const { planId: _omitted, ...rest } = plan;
  return contentSha256(rest);
}
export async function verifyPlanId(plan: ExecutablePlan): Promise<boolean> {
  return plan.planId === await computePlanId(plan);
}

export function checkCapabilityMap(map: unknown): PlanBuildError[] {
  const errors: PlanBuildError[] = [];
  const fail = (message: string) => errors.push({ code: 'mapping', message });
  const m = map as Partial<CapabilityMap> | null;
  if (!m || typeof m !== 'object') return [{ code: 'mapping', message: '對應表必須是物件。' }];
  if (m.format !== 'composer-action-capability-map') fail('對應表 format 不是 composer-action-capability-map。');
  if (!Number.isInteger(m.version) || (m.version as number) < 1) fail('對應表 version 必須是正整數。');
  if (!Array.isArray(m.entries)) { fail('對應表 entries 必須是陣列。'); return errors; }
  const seen = new Set<string>();
  m.entries.forEach((entry, i) => {
    for (const key of ['actionId', 'capability', 'kitId'] as const) {
      if (typeof entry?.[key] !== 'string' || !entry[key]) fail(`entries[${i}].${key} 必須是非空字串。`);
    }
    if (seen.has(entry?.actionId)) fail(`動作「${entry.actionId}」在對應表中重複，無法決定使用哪一筆。`);
    seen.add(entry?.actionId);
  });
  if (m.categoryDefaults !== undefined && !Array.isArray(m.categoryDefaults)) { fail('對應表 categoryDefaults 必須是陣列。'); return errors; }
  const seenCategory = new Set<string>();
  (m.categoryDefaults ?? []).forEach((d, i) => {
    if (!d || !(d.category in CATEGORY_GROUP)) fail(`categoryDefaults[${i}].category 不是有效的節點類別。`);
    for (const key of ['capability', 'kitId'] as const) {
      if (typeof d?.[key] !== 'string' || !d[key]) fail(`categoryDefaults[${i}].${key} 必須是非空字串。`);
    }
    if (d?.executor !== undefined && !['manual', 'auto', 'system'].includes(d.executor)) fail(`categoryDefaults[${i}].executor 不是有效的執行者。`);
    if (seenCategory.has(d?.category)) fail(`類別「${d.category}」的預設對應重複，無法決定使用哪一筆。`);
    seenCategory.add(d?.category);
  });
  return errors;
}

const fromDiagnostic = (d: Diagnostic): PlanBuildError => ({ code: `compile:${d.code}`, message: d.message, nodeId: d.nodeId });
const jsonOnly = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T; // drops undefined so canonical hashing accepts it

export async function buildExecutablePlan(input: PlanBuildInput): Promise<PlanBuildResult> {
  const { project, mapping, scope } = input;
  const libraries = input.libraries ?? [];
  const subprojects = input.subgraphs ?? [];

  const mapErrors = checkCapabilityMap(mapping);
  if (mapErrors.length) return { ok: false, errors: mapErrors };
  if (project.meta.status !== 'published') {
    return { ok: false, errors: [{ code: 'not-published', message: `只有已發佈的版本可編譯成計畫，目前 ${project.meta.id}@${project.meta.version} 是 ${project.meta.status}。` }] };
  }
  const compiled = compile(project, libraries, subprojects);
  if (!compiled.ok || !compiled.plan || !compiled.resolved) {
    return { ok: false, errors: compiled.diagnostics.filter(d => d.severity === 'error').map(fromDiagnostic) };
  }
  const { plan: aPlan, resolved } = compiled;
  const errors: PlanBuildError[] = [];
  const mappingByAction = new Map(mapping.entries.map(e => [e.actionId, e]));
  const mappingByCategory = new Map((mapping.categoryDefaults ?? []).map(d => [d.category, d]));

  // Everything the flattened nodes may reference lives in the project, its libraries or a sub-AoV.
  const sources = [project, ...subgraphClosure(project, subprojects)];
  const forms = new Map<string, FormDef>();
  for (const source of sources) for (const form of resolveProject(source, libraries).forms) forms.set(form.id, form);
  const formHash = new Map<string, string>();
  for (const [id, def] of forms) formHash.set(id, await contentSha256(def));
  const types = TypeLibrary.fromProject(resolved);
  const nodeById = new Map(resolved.nodes.map(n => [n.id, n]));
  const subgraphRefs = new Map(project.nodes.filter(n => n.category === 'subgraph').map(n => [n.id, parseSubgraphRef(n.ref)]));

  const nodes = aPlan.nodes.map(planNode => {
    const n = nodeById.get(planNode.nodeId)!;
    const ports = (dir: 'inputs' | 'outputs') => planNode[dir].map(p => ({ port: p.port, type: n[dir].find(x => x.id === p.port)!.type, flows: p.flows }));
    const reasons: string[] = [];
    // An action is mapped by its own entry only; the category default is for nodes without an action.
    const categoryDefault = n.action ? undefined : mappingByCategory.get(n.category);
    const entry = n.action ? mappingByAction.get(n.action) : categoryDefault;
    if (!n.action && !categoryDefault) reasons.push('節點沒有引用業務動作，對應表也沒有此類別的預設對應');
    else if (n.action && !entry) reasons.push(`找不到動作「${n.action}」的能力對應`);
    const executor = n.executor ?? categoryDefault?.executor;
    if (!executor) reasons.push('沒有設定執行者，動作庫與對應表也沒有預設值');
    const executable = reasons.length === 0;

    const formSha = n.form ? formHash.get(n.form) : undefined;
    if (n.form && !formSha) errors.push({ code: 'form-missing', message: `節點「${n.name}」引用的表單「${n.form}」找不到內容。`, nodeId: n.id });
    const form = n.form && formSha ? { formId: n.form, contentSha256: formSha } : undefined;
    const outer = planNode.nodeId.includes('/') ? planNode.nodeId.split('/')[0] : undefined;
    const ref = outer ? subgraphRefs.get(outer) : undefined;
    return {
      nodeId: planNode.nodeId, name: planNode.name, category: planNode.category, stage: planNode.stage,
      inputs: ports('inputs'), outputs: ports('outputs'),
      executor, role: n.role, actionId: n.action,
      executable, reason: executable ? undefined : reasons.join('；'),
      binding: executable ? { capability: entry!.capability, kitId: entry!.kitId } : undefined,
      guard: n.guard, route: n.route, decision: n.decision, checks: n.checks, verdicts: n.verdicts,
      boundary: n.boundary, nodeParams: n.params,
      form, timing: input.timings?.[planNode.nodeId] ?? { state: 'missing' as const },
      resource: input.resources?.[planNode.nodeId],
      expandedFrom: outer && ref ? `${outer}@${ref.id}@${ref.version}` : undefined,
    };
  });

  // Inputs keyed by an id the plan does not have would otherwise be ignored without a trace.
  const planNodeIds = new Set(nodes.map(n => n.nodeId));
  for (const label of ['timings', 'resources'] as const) {
    for (const key of Object.keys(input[label] ?? {})) {
      if (!planNodeIds.has(key)) errors.push({ code: 'unknown-node', message: `${label} 指定的節點「${key}」不在計畫內。`, nodeId: key });
    }
  }
  const flowIds = new Set(resolved.flows.map(f => f.id));
  for (const key of Object.keys(input.transfers ?? {})) {
    if (!flowIds.has(key)) errors.push({ code: 'unknown-flow', message: `transfers 指定的連線「${key}」不在計畫內。` });
  }
  const paramIds = new Set((resolved.params ?? []).map(p => p.id));
  for (const key of Object.keys(input.tuning ?? {})) {
    if (!paramIds.has(key)) errors.push({ code: 'unknown-param', message: `tuning 指定的參數「${key}」不在計畫內。` });
  }

  const portTypeOf = (node: string, port: string, dir: 'inputs' | 'outputs') => nodeById.get(node)?.[dir].find(p => p.id === port)?.type;
  const flows = resolved.flows.map(f => {
    const type = portTypeOf(f.from.node, f.from.port, 'outputs');
    const kind = type ? types.kindOf(type) : undefined;
    if (!type || !kind) errors.push({ code: 'flow-type', message: `連線「${f.id}」無法判定 artifact 型別或種類。` });
    return { id: f.id, from: f.from, to: f.to, artifactType: type, kind: kind === 'information' ? 'data' : 'material', transferMin: input.transfers?.[f.id] ?? { state: 'missing' as const } };
  });
  if (errors.length) return { ok: false, errors };

  const libRefs = new Map<string, { id: string; version: number }>();
  for (const source of sources) for (const ref of source.libraries ?? []) libRefs.set(`${ref.id}@${ref.version}`, ref);
  const sha = async (id: string, v: number, list: { meta: { id: string; version: number } }[]) => ({ id, version: v, sha256: await contentSha256(list.find(x => x.meta.id === id && x.meta.version === v)) });
  const plan = jsonOnly({
    format: 'composer-executable-plan', formatVersion: 1, planId: '',
    source: {
      templateId: aPlan.templateId, templateVersion: aPlan.templateVersion,
      projectSha256: await contentSha256(project), aovCoreCommit: version.commit,
      libraries: await Promise.all([...libRefs.values()].sort(byIdVersion).map(r => sha(r.id, r.version, libraries))),
      subgraphs: await Promise.all(subgraphClosure(project, subprojects).sort((a, b) => byIdVersion({ id: a.meta.id, version: a.meta.version }, { id: b.meta.id, version: b.meta.version }))
        .map(s => sha(s.meta.id, s.meta.version, subprojects))),
      mapping: { version: mapping.version, sha256: await contentSha256(jsonOnly(mapping)) },
    },
    scope, nodes, flows, businessOnly: [],
    artifactTypes: resolved.artifactTypes,
    params: (resolved.params ?? []).map(p => ({ ...p, tunable: p.id in (input.tuning ?? {}), range: input.tuning?.[p.id]?.range })),
    paramTables: [], alarmRules: [],
    rules: resolved.rules ?? [],
    stages: aPlan.stages, order: aPlan.order,
  }) as ExecutablePlan;
  plan.planId = await computePlanId(plan);
  const shapeErrors = validateExecutablePlan(plan);
  return shapeErrors.length ? { ok: false, errors: shapeErrors } : { ok: true, plan };
}

const byIdVersion = (a: { id: string; version: number }, b: { id: string; version: number }) => a.id.localeCompare(b.id) || a.version - b.version;

// Sub-AoV projects reachable from the project, each once.
function subgraphClosure(project: ProjectFile, pool: ProjectFile[]): ProjectFile[] {
  const found = new Map<string, ProjectFile>();
  const visit = (p: ProjectFile) => {
    for (const n of p.nodes) {
      const ref = n.category === 'subgraph' ? parseSubgraphRef(n.ref) : undefined;
      const sub = ref && pool.find(x => x.meta.id === ref.id && x.meta.version === ref.version);
      if (sub && !found.has(`${ref.id}@${ref.version}`)) { found.set(`${ref.id}@${ref.version}`, sub); visit(sub); }
    }
  };
  visit(project);
  return [...found.values()];
}
