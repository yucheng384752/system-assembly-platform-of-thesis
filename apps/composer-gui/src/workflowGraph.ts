import { validateSchema } from '../../../libs/ui-runtime/schema';
import type { ActionParameter, ParamValue } from '../../../libs/ui-runtime/registry';
import { formError, type FieldValidation, type FormDraft, type FormField } from './localData';
import { actionCatalog, importAov, relationErrors, type AovDocument, type FormRelation } from './workflow';

// Graph workflow document, composer-aov-list version 4 (D70-D75): nodes with sub-graphs, node-owned forms, field rules.
export const MAX_DEPTH = 3;
export const MAX_NODES = 100;
export interface Position { x: number; y: number }
export interface GraphNode { id: string; name: string; when: string; owner: string; actionId: string | null; params: Record<string, ParamValue>; formId: string | null; childGraphId: string | null }
export interface GraphEdge { id: string; from: string; to: string }
export interface Graph { id: string; name: string; nodes: GraphNode[]; edges: GraphEdge[] }
export interface AovGraphDocument {
  format: 'composer-aov-list'; version: 4; rootGraphId: string; graphs: Graph[];
  layout: Record<string, Record<string, Position>>; forms: FormDraft[]; relations: FormRelation[];
}
export const emptyGraph: AovGraphDocument = {
  format: 'composer-aov-list', version: 4, rootGraphId: 'graph-root',
  graphs: [{ id: 'graph-root', name: '主流程', nodes: [], edges: [] }], layout: {}, forms: [], relations: [],
};

const nodeName = (node: GraphNode) => node.name.trim() || '（未命名節點）';
const actionOf = (id: string | null) => actionCatalog.actions.find(a => a.id === id);
const allNodes = (doc: AovGraphDocument) => doc.graphs.flatMap(graph => graph.nodes.map(node => ({ graph, node })));
// Distinct action ids in document order: the input of deriveKits, at any depth (D70).
export function graphActionIds(doc: AovGraphDocument): string[] {
  return [...new Set(allNodes(doc).flatMap(({ node }) => node.actionId ? [node.actionId] : []))];
}

// Depth of every graph reachable from the root (root = 1). Visits each graph once, so a malformed reference loop cannot hang.
export function graphDepths(doc: AovGraphDocument): Map<string, number> {
  const depths = new Map<string, number>();
  const queue: [string, number][] = [[doc.rootGraphId, 1]];
  for (let i = 0; i < queue.length; i++) {
    const [id, depth] = queue[i];
    if (depths.has(id)) continue;
    depths.set(id, depth);
    for (const node of doc.graphs.find(g => g.id === id)?.nodes ?? []) if (node.childGraphId) queue.push([node.childGraphId, depth + 1]);
  }
  return depths;
}

function duplicate(ids: string[]): string | undefined { return ids.find((id, i) => ids.indexOf(id) !== i); }
function paramTypeOk(parameter: ActionParameter, value: ParamValue): boolean {
  return typeof value === (parameter.type === 'text' ? 'string' : parameter.type);
}

// Structure the editor cannot represent: such a document is rejected on import and never opened (D71).
export function integrityErrors(doc: AovGraphDocument): string[] {
  const nodes = allNodes(doc);
  const dup = (what: string, ids: string[]) => { const id = duplicate(ids); return id ? [`${what}的識別碼重複：${id}。`] : []; };
  const first = [
    ...dup('子流程', doc.graphs.map(g => g.id)), ...dup('節點', nodes.map(n => n.node.id)),
    ...dup('連線', doc.graphs.flatMap(g => g.edges.map(e => e.id))), ...dup('表單', doc.forms.map(f => f.id)),
    ...dup('關聯', doc.relations.map(r => r.id)), ...doc.forms.flatMap(f => dup('欄位', f.fields.map(x => x.id))),
  ];
  if (first.length) return first;
  if (!doc.graphs.some(g => g.id === doc.rootGraphId)) return ['找不到主流程。'];
  const refs = new Map<string, number>();
  for (const { node } of nodes) {
    if (node.childGraphId && !doc.graphs.some(g => g.id === node.childGraphId)) return [`節點「${nodeName(node)}」引用的子流程不存在。`];
    if (node.childGraphId) refs.set(node.childGraphId, (refs.get(node.childGraphId) ?? 0) + 1);
    if (node.formId && !doc.forms.some(f => f.id === node.formId)) return [`節點「${nodeName(node)}」引用的表單不存在。`];
    if (node.actionId && !actionOf(node.actionId)) return [`節點「${nodeName(node)}」引用了不存在的動作「${node.actionId}」。`];
  }
  for (const graph of doc.graphs) {
    const ids = new Set(graph.nodes.map(n => n.id));
    if (graph.edges.some(e => !ids.has(e.from) || !ids.has(e.to))) return [`子流程「${graph.name}」的連線引用了不在此子流程的節點。`];
    const positions = doc.layout[graph.id];
    if (positions && Object.keys(positions).some(id => !ids.has(id))) return [`子流程「${graph.name}」的版面含有不存在的節點。`];
  }
  if (Object.keys(doc.layout).some(id => !doc.graphs.some(g => g.id === id))) return ['版面含有不存在的子流程。'];
  // D71: the graphs form a tree rooted at the main flow, at most MAX_DEPTH levels deep.
  if (refs.has(doc.rootGraphId)) return ['主流程不可作為其他節點的子流程。'];
  for (const [id, count] of refs) if (count > 1) return [`子流程「${doc.graphs.find(g => g.id === id)!.name}」被多個節點引用，子流程不可共用。`];
  const depths = graphDepths(doc);
  const lost = doc.graphs.find(g => !depths.has(g.id));
  if (lost) return [`子流程「${lost.name}」無法從主流程到達，可能形成循環或沒有被任何節點引用。`];
  for (const { graph, node } of nodes) {
    if (node.childGraphId && depths.get(graph.id)! >= MAX_DEPTH) return [`節點「${nodeName(node)}」不可再有子流程：流程最多 ${MAX_DEPTH} 層。`];
  }
  // Edges only mean "before", so a loop in one graph has no meaning (D18, D70).
  for (const graph of doc.graphs) {
    const pairs = graph.edges.map(e => `${e.from}>${e.to}`);
    if (graph.edges.some(e => e.from === e.to)) return [`子流程「${graph.name}」有節點連到自己。`];
    if (duplicate(pairs)) return [`子流程「${graph.name}」有重複的連線。`];
    const next = new Map<string, string[]>();
    for (const e of graph.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
    const state = new Map<string, 1 | 2>();
    const loops = (id: string): boolean => {
      if (state.get(id) === 2) return false;
      if (state.get(id) === 1) return true;
      state.set(id, 1);
      const found = (next.get(id) ?? []).some(loops);
      state.set(id, 2);
      return found;
    };
    if (graph.nodes.some(n => loops(n.id))) return [`子流程「${graph.name}」的連線形成循環。`];
  }
  const owners = new Map<string, number>();
  for (const { node } of nodes) if (node.formId) owners.set(node.formId, (owners.get(node.formId) ?? 0) + 1);
  if ([...owners.values()].some(count => count > 1)) return ['同一張表單不可屬於多個節點。'];
  for (const { node } of nodes) {
    const action = actionOf(node.actionId);
    if (!action && Object.keys(node.params).length) return [`節點「${nodeName(node)}」沒有動作，不可設定參數。`];
    for (const [key, value] of Object.entries(node.params)) {
      const parameter = action?.parameters.find(p => p.id === key);
      if (!parameter) return [`節點「${nodeName(node)}」設定了動作沒有的參數「${key}」。`];
      if (!paramTypeOk(parameter, value)) return [`節點「${nodeName(node)}」的「${parameter.name}」型別不正確。`];
    }
  }
  if (doc.relations.some(r => ![r.from, r.to].every(at => doc.forms.find(f => f.id === at.formId)?.fields.some(f => f.id === at.fieldId)))) return ['表單關聯引用的表單或欄位不存在。'];
  return [];
}

// ISO 8601 calendar date YYYY-MM-DD; rejects impossible dates such as 2026-02-30.
export function isIsoDate(text: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
const rulesFor: Record<FormField['type'], (keyof FieldValidation)[]> = {
  text: ['maxLength', 'allowedValues'], integer: ['minimum', 'maximum'], decimal: ['minimum', 'maximum'], date: ['minimumDate', 'maximumDate'], boolean: [],
};
// First problem with a field's rules, or an empty string (D72).
export function validationError(field: FormField): string {
  const rules = field.validation;
  if (!rules) return '';
  const at = `欄位「${field.name.trim() || '（未命名欄位）'}」`;
  const stray = (Object.keys(rules) as (keyof FieldValidation)[]).find(key => rules[key] !== undefined && !rulesFor[field.type].includes(key));
  if (stray) return `${at}的型別不支援這項驗證規則。`;
  if (field.type === 'integer' && [rules.minimum, rules.maximum].some(v => v !== undefined && !Number.isInteger(v))) return `${at}是整數，最小值與最大值必須是整數。`;
  if (rules.minimum !== undefined && rules.maximum !== undefined && rules.minimum > rules.maximum) return `${at}的最小值不可大於最大值。`;
  for (const date of [rules.minimumDate, rules.maximumDate]) if (date !== undefined && !isIsoDate(date)) return `${at}的日期必須是有效的 ISO 日期（YYYY-MM-DD）。`;
  if (rules.minimumDate && rules.maximumDate && rules.minimumDate > rules.maximumDate) return `${at}的最早日期不可晚於最晚日期。`;
  return '';
}

// Completeness the editor shows while the user is still working; export is blocked until it is empty (D73).
export function nodeErrors(doc: AovGraphDocument, node: GraphNode): string[] {
  const errors: string[] = [];
  const name = nodeName(node);
  if (!node.name.trim()) errors.push('有節點尚未命名。');
  const action = actionOf(node.actionId);
  if (!action) return errors;
  for (const parameter of action.parameters) {
    const value = node.params[parameter.id] ?? parameter.default;
    if (value === undefined || (typeof value === 'string' && !value.trim())) {
      if (parameter.required) errors.push(`節點「${name}」的「${parameter.name}」尚未填寫。`);
    } else if (typeof value === 'number' && ((parameter.minimum !== undefined && value < parameter.minimum) || (parameter.maximum !== undefined && value > parameter.maximum))) {
      errors.push(`節點「${name}」的「${parameter.name}」須介於 ${parameter.minimum ?? '不限'} 與 ${parameter.maximum ?? '不限'}。`);
    }
  }
  const form = doc.forms.find(f => f.id === node.formId);
  if (action.needs.includes('form') && !form?.fields.length) errors.push(`節點「${name}」的動作「${action.name}」需要一張已建立欄位的標準表單。`);
  if (action.needs.includes('relation') && form && !doc.relations.some(r => r.from.formId === form.id || r.to.formId === form.id)) {
    errors.push(`節點「${name}」的動作「${action.name}」需要表單至少有一條已確認的關聯。`);
  }
  return errors;
}
export function graphErrors(doc: AovGraphDocument): string[] {
  const errors: string[] = [];
  if (!doc.graphs.find(g => g.id === doc.rootGraphId)?.nodes.length) errors.push('請至少建立一個節點。');
  for (const { node } of allNodes(doc)) errors.push(...nodeErrors(doc, node));
  for (const form of doc.forms) {
    const owner = allNodes(doc).find(({ node }) => node.formId === form.id)?.node;
    const label = `${owner ? `節點「${nodeName(owner)}」的` : ''}表單「${form.name.trim() || '（未命名表單）'}」`;
    if (!owner) errors.push(`${label}尚未指派給任何節點。`);
    const problem = !form.fields.length ? '尚未建立欄位。' : formError(form);
    if (problem) errors.push(`${label}尚未完成：${problem}`);
    for (const field of form.fields) { const message = validationError(field); if (message) errors.push(`${label}的${message}`); }
  }
  return [...errors, ...relationErrors(doc)];
}

// Imports into a detached candidate; callers replace the session only after this returns.
export function importAovGraph(text: string): { value: AovGraphDocument; notices: string[] } {
  if (text.length > 2 * 1024 * 1024) throw new Error('流程規格不可超過 2 MB。');
  let input: AovGraphDocument;
  try { input = JSON.parse(text.replace(/^﻿/, '')); validateSchema('aov', input); }
  catch { throw new Error('流程規格格式不正確。請使用本系統下載的流程規格檔。原流程已保留。'); }
  if (input.version !== 4) throw new Error('這不是畫布版本（version 4）的流程規格。原流程已保留。');
  const [error] = integrityErrors(input);
  if (error) throw new Error(`${error}原流程已保留。`);
  return { value: input, notices: [] };
}
// One entry for every version: older documents are converted and every loss is listed (D75).
export function importWorkflow(text: string): { value: AovGraphDocument; notices: string[] } {
  let version: unknown;
  try { version = JSON.parse(text.replace(/^﻿/, '')).version; } catch { /* importAov reports the bad format */ }
  if (version === 4) return importAovGraph(text);
  const old = importAov(text);
  const converted = listToGraph(old.value);
  return { value: converted.value, notices: [...old.notices, ...converted.notices] };
}

// Explicit projection: only schema fields leave the browser, never rows, samples or editor state.
export function exportAovGraph(doc: AovGraphDocument): string {
  const errors = [...integrityErrors(doc), ...graphErrors(doc)];
  if (errors.length) throw new Error(`流程規格尚未完成：${errors[0]}`);
  const value: AovGraphDocument = {
    format: 'composer-aov-list', version: 4, rootGraphId: doc.rootGraphId,
    graphs: doc.graphs.map(g => ({
      id: g.id, name: g.name,
      nodes: g.nodes.map(({ id, name, when, owner, actionId, params, formId, childGraphId }) => ({ id, name, when, owner, actionId, params: { ...params }, formId, childGraphId })),
      edges: g.edges.map(({ id, from, to }) => ({ id, from, to })),
    })),
    layout: Object.fromEntries(Object.entries(doc.layout).map(([graphId, nodes]) => [graphId, Object.fromEntries(Object.entries(nodes).map(([id, { x, y }]) => [id, { x, y }]))])),
    forms: doc.forms.map(({ id, name, fields }) => ({ id, name, fields: fields.map(({ id, name, type, required, isKey, validation }) => ({ id, name, type, required, isKey, ...(validation ? { validation: { ...validation } } : {}) })) })),
    relations: doc.relations.map(({ id, from, to, origin }) => ({ id, kind: 'shared-key', from: { ...from }, to: { ...to }, origin, confirmed: true })),
  };
  validateSchema('aov', value);
  return JSON.stringify(value, null, 2);
}

// Versions 1 to 3 to version 4 (D75). A step becomes nodes in order; what a node cannot hold is listed, never dropped silently.
export function listToGraph(doc: AovDocument): { value: AovGraphDocument; notices: string[] } {
  const notices: string[] = [];
  const nodes: GraphNode[] = [];
  let shortened = false;
  const label = (text: string) => { if (text.length > 100) shortened = true; return text.slice(0, 100); };
  const add = (name: string, step: AovDocument['steps'][number], actionId: string | null, formId: string | null) => {
    nodes.push({ id: `node-${nodes.length + 1}`, name: label(name), when: step.when, owner: step.owner, actionId, params: {}, formId, childGraphId: null });
  };
  for (const step of doc.steps) {
    const before = nodes.length;
    const taken = new Set<string>();
    for (const action of step.actions) {
      const formId = action.formIds.find(id => step.formIds.includes(id) && !taken.has(id)) ?? null;
      if (formId) taken.add(formId);
      if (action.formIds.length > 1) notices.push(`步驟「${step.name}」的動作「${actionOf(action.actionId)?.name ?? action.actionId}」原本作用於 ${action.formIds.length} 張表單，節點只能有一張表單；第一張歸此節點，其餘各成一個沒有動作的節點。`);
      add(`${step.name}：${actionOf(action.actionId)?.name ?? action.actionId}`, step, action.actionId, formId);
    }
    for (const formId of step.formIds.filter(id => !taken.has(id))) add(`${step.name}：${doc.forms.find(f => f.id === formId)?.name ?? formId}`, step, null, formId);
    if (nodes.length === before) add(step.name, step, null, null);
    else if (nodes.length - before === 1) nodes[before].name = label(step.name);
  }
  if (nodes.length > MAX_NODES) throw new Error(`轉換後有 ${nodes.length} 個節點，超過單一流程 ${MAX_NODES} 個節點的上限。請先精簡步驟。`);
  if (shortened) notices.push('部分節點名稱超過 100 字，已截短。');
  const value: AovGraphDocument = {
    format: 'composer-aov-list', version: 4, rootGraphId: 'graph-root',
    graphs: [{ id: 'graph-root', name: '主流程', nodes, edges: nodes.slice(1).map((node, i) => ({ id: `edge-${i + 1}`, from: nodes[i].id, to: node.id })) }],
    layout: { 'graph-root': Object.fromEntries(nodes.map((node, i) => [node.id, { x: i * 160, y: 0 }])) },
    forms: structuredClone(doc.forms), relations: structuredClone(doc.relations),
  };
  return { value, notices };
}
