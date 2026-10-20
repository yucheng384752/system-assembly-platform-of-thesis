/**
 * v0.2 展開器：業務動作、表單、具名條件、決策表 → v0.1 原語專案檔。
 * 驗證、編譯、執行都在展開後的專案檔上進行。
 */
import type {
  ActionDef,
  ActionLibrary,
  ArtifactType,
  AttrDef,
  Diagnostic,
  FormDef,
  NodeDef,
  PortDef,
  ProjectFile,
  RuleDef,
} from '../model/types';
import { decisionToRoute } from './decision';
import { guardItems } from './rules';

export interface ResolveResult {
  project: ProjectFile;
  diagnostics: Diagnostic[];
  /** 每個節點所屬的動作（顯示用） */
  actions: Record<string, ActionDef | undefined>;
  /** 可用的動作（共用＋本地），面板顯示用 */
  availableActions: { action: ActionDef; source: string }[];
  /** 可用的表單 */
  forms: FormDef[];
}

export function formTypeId(formId: string): string {
  return `form.${formId}`;
}

export function formToType(f: FormDef): ArtifactType {
  const attributes: Record<string, AttrDef> = {};
  for (const [k, field] of Object.entries(f.fields)) {
    attributes[k] = { type: field.type, unit: field.unit, values: field.values, source: 'generated', description: field.label };
  }
  return { id: formTypeId(f.id), name: f.name, extends: f.extends ?? 'info.document', subject: { types: f.subject }, attributes };
}

function mergePorts(base: PortDef[] | undefined, own: PortDef[] | undefined): PortDef[] {
  const out = (base ?? []).map((p) => ({ ...p }));
  for (const p of own ?? []) {
    const i = out.findIndex((x) => x.id === p.id);
    if (i >= 0) out[i] = { ...out[i], ...p };
    else out.push({ ...p });
  }
  return out;
}

export function libraryKey(ref: { id: string; version: number }): string {
  return `${ref.id}@${ref.version}`;
}

export function resolveProject(p: ProjectFile, libraries: ActionLibrary[] = []): ResolveResult {
  const diagnostics: Diagnostic[] = [];
  const err = (code: string, message: string, nodeId?: string) => diagnostics.push({ severity: 'error', code, message, nodeId });

  // ---- 引用的動作庫
  const libs: ActionLibrary[] = [];
  for (const ref of p.libraries ?? []) {
    const lib = libraries.find((l) => l.meta.id === ref.id && l.meta.version === ref.version);
    if (!lib) {
      const other = libraries.filter((l) => l.meta.id === ref.id).map((l) => `v${l.meta.version}`);
      err('L1-library', `找不到動作庫 ${libraryKey(ref)}${other.length ? `（可用版本：${other.join('、')}）` : ''}`);
      continue;
    }
    libs.push(lib);
  }

  // ---- 型別、表單、規則、動作（共用 → 本地，本地優先）
  const typeMap = new Map<string, ArtifactType>();
  const formMap = new Map<string, FormDef>();
  const ruleMap = new Map<string, RuleDef>();
  const actionMap = new Map<string, { action: ActionDef; source: string }>();
  const owner = new Map<string, string>();
  const shared = <T extends { id: string }>(kind: string, map: Map<string, T>, items: T[] | undefined, libName: string) => {
    for (const it of items ?? []) {
      const key = `${kind}:${it.id}`;
      if (map.has(it.id) && owner.get(key) !== libName) {
        err('L4-duplicate', `動作庫 ${owner.get(key)} 與 ${libName} 都定義了${kind}「${it.id}」`);
        continue;
      }
      map.set(it.id, it);
      owner.set(key, libName);
    }
  };
  for (const lib of libs) {
    const name = lib.meta.name || lib.meta.id;
    shared('型別', typeMap, lib.artifactTypes, name);
    shared('表單', formMap, lib.forms, name);
    shared('規則', ruleMap, lib.rules, name);
    for (const a of lib.actions) {
      const key = `動作:${a.id}`;
      if (actionMap.has(a.id)) {
        err('L4-duplicate', `動作庫 ${owner.get(key)} 與 ${name} 都定義了動作「${a.id}」`);
        continue;
      }
      actionMap.set(a.id, { action: a, source: name });
      owner.set(key, name);
    }
  }
  for (const f of p.forms ?? []) formMap.set(f.id, f);
  for (const r of p.rules ?? []) ruleMap.set(r.id, r);
  for (const a of p.actions ?? []) actionMap.set(a.id, { action: a, source: '本專案' });
  for (const f of formMap.values()) typeMap.set(formTypeId(f.id), formToType(f));
  for (const t of p.artifactTypes ?? []) typeMap.set(t.id, t);

  // ---- 節點
  const actions: Record<string, ActionDef | undefined> = {};
  const nodes: NodeDef[] = (p.nodes ?? []).map((raw) => {
    const n: NodeDef = { ...raw, inputs: [...(raw.inputs ?? [])], outputs: [...(raw.outputs ?? [])] };
    let action: ActionDef | undefined;
    if (raw.action) {
      action = actionMap.get(raw.action)?.action;
      if (!action) err('L2-action', `「${raw.name}」引用不存在的動作「${raw.action}」`, raw.id);
    }
    actions[raw.id] = action;
    if (action) {
      n.category = action.behavior;
      n.inputs = mergePorts(action.inputs, raw.inputs);
      n.outputs = mergePorts(action.outputs, raw.outputs);
      const g = [...guardItems(action.guard), ...guardItems(raw.guard)];
      n.guard = g.length ? g : undefined;
      n.executor = raw.executor ?? action.executor;
      n.boundary = raw.boundary ?? action.boundary;
      n.params = action.params || raw.params ? { ...(action.params ?? {}), ...(raw.params ?? {}) } : undefined;
      const hasOwnLogic = raw.route || raw.decision || raw.checks;
      n.route = hasOwnLogic ? raw.route : action.route;
      n.decision = hasOwnLogic ? raw.decision : action.decision;
      n.checks = hasOwnLogic ? raw.checks : action.checks;
      n.verdicts = raw.verdicts ?? action.verdicts;
      if (action.usesForm && !raw.form) err('L3-form', `「${raw.name}」的動作「${action.name}」需要選擇表單`, raw.id);
    }
    if (raw.form) {
      const f = formMap.get(raw.form);
      if (!f) err('L3-form', `「${raw.name}」引用不存在的表單「${raw.form}」`, raw.id);
      else {
        if (!n.outputs.some((o) => o.id === 'record')) n.outputs.push({ id: 'record', type: formTypeId(f.id), role: 'record', label: f.name });
        const defaults: Record<string, unknown> = {};
        for (const [k, field] of Object.entries(f.fields)) if (field.default !== undefined) defaults[k] = field.default;
        n.sim = { ...defaults, ...(raw.sim ?? {}) };
      }
    }
    const modes = [n.route?.length ? '運算式' : '', n.decision ? '決策表' : '', n.checks?.length ? '檢驗項目' : ''].filter(Boolean);
    if (modes.length > 1) err('C-judge', `「${raw.name}」同時設定了${modes.join('、')}，只能擇一`, raw.id);
    if (n.decision && !n.route?.length) n.route = decisionToRoute(n.decision);
    return n;
  });

  const resolved: ProjectFile = {
    formatVersion: p.formatVersion,
    meta: p.meta,
    artifactTypes: [...typeMap.values()],
    params: p.params,
    rules: [...ruleMap.values()],
    nodes,
    flows: p.flows ?? [],
    layout: p.layout,
    flowLayout: p.flowLayout,
    settings: p.settings,
    libraries: p.libraries,
  };

  return {
    project: resolved,
    diagnostics,
    actions,
    availableActions: [...actionMap.values()],
    forms: [...formMap.values()],
  };
}
