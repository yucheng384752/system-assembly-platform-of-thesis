import { validateSchema } from '../../../libs/ui-runtime/schema';
import type { ActionParameter, ParamValue } from '../../../libs/ui-runtime/registry';
import { formError, type FieldValidation, type FormDraft, type FormField } from './localData';
import { actionCatalog, importAov, relationErrors, type AovDocument, type FormRelation } from './workflow';

// Graph workflow document, composer-aov-list version 5 (D70-D82): factories hold production-logic graphs, every graph has
// a start and an end node, nodes own forms and have sub-graphs, fields carry rules.
export const MAX_DEPTH = 3;
export const MAX_NODES = 100;
export const MAX_FACTORIES = 20;
export const MAX_LOGICS = 20;
export const MAX_GRAPHS = 100;
export interface Position { x: number; y: number }
export type NodeKind = 'start' | 'end' | 'node';
export interface GraphNode { id: string; kind: NodeKind; name: string; when: string; owner: string; actionId: string | null; params: Record<string, ParamValue>; formId: string | null; childGraphId: string | null }
export interface GraphEdge { id: string; from: string; to: string }
export interface Graph { id: string; name: string; nodes: GraphNode[]; edges: GraphEdge[] }
// A factory is only a container: it has no nodes or edges of its own (D78).
export interface Factory { id: string; name: string; logicGraphIds: string[] }
type Layout = Record<string, Record<string, Position>>;
export interface AovGraphDocument {
  format: 'composer-aov-list'; version: 5; factories: Factory[]; graphs: Graph[]; layout: Layout; forms: FormDraft[]; relations: FormRelation[];
}
// Version 4 had one main flow and no start or end nodes; it is only read, never written.
interface AovGraphDocumentV4 {
  format: 'composer-aov-list'; version: 4; rootGraphId: string; layout: Layout; forms: FormDraft[]; relations: FormRelation[];
  graphs: { id: string; name: string; nodes: Omit<GraphNode, 'kind'>[]; edges: GraphEdge[] }[];
}
export const emptyGraph: AovGraphDocument = { format: 'composer-aov-list', version: 5, factories: [], graphs: [], layout: {}, forms: [], relations: [] };

const nodeName = (node: GraphNode) => node.name.trim() || '（未命名節點）';
const graphLabel = (graph: Graph) => graph.name.trim() || '（未命名流程）';
const actionOf = (id: string | null) => actionCatalog.actions.find(a => a.id === id);
const allNodes = (doc: AovGraphDocument) => doc.graphs.flatMap(graph => graph.nodes.map(node => ({ graph, node })));
export const workingNodes = (graph: Graph) => graph.nodes.filter(n => n.kind === 'node');
// Distinct action ids in document order: the input of deriveKits, at any depth and in any factory (D70, D81).
export function graphActionIds(doc: AovGraphDocument): string[] {
  return [...new Set(allNodes(doc).flatMap(({ node }) => node.actionId ? [node.actionId] : []))];
}

// Production logics are the top-level graphs of the factories, in factory order (D79).
export const logicRoots = (doc: AovGraphDocument): string[] => doc.factories.flatMap(f => f.logicGraphIds);

// The factory and production logic every reachable graph belongs to. Visits each graph once, so a malformed reference loop cannot hang.
export function graphPlaces(doc: AovGraphDocument): Map<string, { factory: Factory; logic: Graph; depth: number }> {
  const places = new Map<string, { factory: Factory; logic: Graph; depth: number }>();
  for (const factory of doc.factories) for (const rootId of factory.logicGraphIds) {
    const logic = doc.graphs.find(g => g.id === rootId);
    if (!logic) continue;
    const queue: [string, number][] = [[rootId, 1]];
    for (let i = 0; i < queue.length; i++) {
      const [id, depth] = queue[i];
      if (places.has(id)) continue;
      places.set(id, { factory, logic, depth });
      for (const node of doc.graphs.find(g => g.id === id)?.nodes ?? []) if (node.childGraphId) queue.push([node.childGraphId, depth + 1]);
    }
  }
  return places;
}
// The opened-graph path (production logic first, then each sub-graph) that leads to a graph; empty when the graph is unreachable.
export function graphPath(doc: AovGraphDocument, graphId: string): string[] {
  const parent = new Map<string, string>();
  for (const graph of doc.graphs) for (const node of graph.nodes) if (node.childGraphId && !parent.has(node.childGraphId)) parent.set(node.childGraphId, graph.id);
  const path = [graphId];
  while (parent.has(path[0]) && path.length <= doc.graphs.length) path.unshift(parent.get(path[0])!);
  return logicRoots(doc).includes(path[0]) ? path : [];
}
// Depth of every reachable graph (a production logic = 1, D79).
export function graphDepths(doc: AovGraphDocument): Map<string, number> {
  return new Map([...graphPlaces(doc)].map(([id, place]) => [id, place.depth]));
}
// The factory of every form that has an owner node (D81); forms without an owner have none.
export function formFactories(doc: AovGraphDocument): Map<string, string> {
  const places = graphPlaces(doc);
  const result = new Map<string, string>();
  for (const graph of doc.graphs) for (const node of graph.nodes) {
    const factory = places.get(graph.id)?.factory.id;
    if (node.formId && factory) result.set(node.formId, factory);
  }
  return result;
}
// The node that owns a form (D72); a form belongs to exactly one node.
export function nodeOfForm(doc: AovGraphDocument, formId: string): GraphNode | undefined {
  return allNodes(doc).find(({ node }) => node.formId === formId)?.node;
}
// Which factory and production logic a node sits in, for business-language reasons (D81).
export function nodePlace(doc: AovGraphDocument, nodeId: string): { factory: Factory; logic: Graph } | undefined {
  const graph = doc.graphs.find(g => g.nodes.some(n => n.id === nodeId));
  const place = graph && graphPlaces(doc).get(graph.id);
  return place && { factory: place.factory, logic: place.logic };
}
// Workflow reading order: factories and production logics in listed order; inside a graph, edges decide (an earlier node comes
// first, ties keep the stored order); a node's sub-graph follows right after the node. Used to say which form is upstream.
export function orderedNodes(doc: AovGraphDocument): { graph: Graph; node: GraphNode; depth: number }[] {
  const result: { graph: Graph; node: GraphNode; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (graphId: string, depth: number) => {
    const graph = doc.graphs.find(g => g.id === graphId);
    if (!graph || seen.has(graphId)) return;
    seen.add(graphId);
    const waiting = new Map(graph.nodes.map(n => [n.id, graph.edges.filter(e => e.to === n.id).length]));
    const pending = [...graph.nodes];
    while (pending.length) {
      // A graph with a loop is rejected elsewhere; here the stored order is the fallback so this never stalls.
      const next = pending.find(n => waiting.get(n.id) === 0) ?? pending[0];
      pending.splice(pending.indexOf(next), 1);
      for (const edge of graph.edges) if (edge.from === next.id) waiting.set(edge.to, (waiting.get(edge.to) ?? 1) - 1);
      result.push({ graph, node: next, depth });
      if (next.childGraphId) visit(next.childGraphId, depth + 1);
    }
  };
  for (const id of logicRoots(doc)) visit(id, 1);
  return result;
}
// Fixed, program-decided hint (spec 4.2 step 4): never applied without the user, and never from a language model (Rule 5).
export function suggestActions(doc: AovGraphDocument): { actionId: string; reason: string }[] {
  const trace = actionOf('trace-records');
  if (!trace || !doc.relations.length || graphActionIds(doc).includes(trace.id)) return [];
  return [{ actionId: trace.id, reason: `已確認 ${doc.relations.length} 條表單關聯，可加入「${trace.name}」節點，以關聯欄位查詢前後步驟的紀錄。` }];
}

// A graph always has its start and end node (D80); they are never edited or removed.
function boundaryNodes(startId: string, endId: string): [GraphNode, GraphNode] {
  const bare = { when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null };
  return [{ ...bare, id: startId, kind: 'start', name: '開始' }, { ...bare, id: endId, kind: 'end', name: '結束' }];
}
export function newGraphParts(id: string, name: string): { graph: Graph; layout: Record<string, Position> } {
  const [start, end] = boundaryNodes(`${id}-start`, `${id}-end`);
  return { graph: { id, name, nodes: [start, end], edges: [] }, layout: { [start.id]: { x: 0, y: 0 }, [end.id]: { x: 240, y: 0 } } };
}

function duplicate(ids: string[]): string | undefined { return ids.find((id, i) => ids.indexOf(id) !== i); }
function paramTypeOk(parameter: ActionParameter, value: ParamValue): boolean {
  return typeof value === (parameter.type === 'text' ? 'string' : parameter.type);
}
// Nodes reachable by following the edges (forward) or against them (backward) from one node.
function reach(graph: Graph, from: string, forward: boolean): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const e of graph.edges) {
      const [a, b] = forward ? [e.from, e.to] : [e.to, e.from];
      if (a === queue[i] && !seen.has(b)) { seen.add(b); queue.push(b); }
    }
  }
  return seen;
}

// Structure the editor cannot represent: such a document is rejected on import and never opened (D71, D78 to D81).
export function integrityErrors(doc: AovGraphDocument): string[] {
  const nodes = allNodes(doc);
  const dup = (what: string, ids: string[]) => { const id = duplicate(ids); return id ? [`${what}的識別碼重複：${id}。`] : []; };
  const first = [
    ...dup('工廠', doc.factories.map(f => f.id)), ...dup('子流程', doc.graphs.map(g => g.id)), ...dup('節點', nodes.map(n => n.node.id)),
    ...dup('連線', doc.graphs.flatMap(g => g.edges.map(e => e.id))), ...dup('表單', doc.forms.map(f => f.id)),
    ...dup('關聯', doc.relations.map(r => r.id)), ...doc.forms.flatMap(f => dup('欄位', f.fields.map(x => x.id))),
    ...dup('生產邏輯', logicRoots(doc)),
  ];
  if (first.length) return first;
  for (const factory of doc.factories) {
    if (factory.logicGraphIds.some(id => !doc.graphs.some(g => g.id === id))) return [`工廠「${factory.name}」引用的生產邏輯不存在。`];
  }
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
  // D71, D79: every graph is a production logic (listed by one factory) or the sub-graph of exactly one node, at most MAX_DEPTH levels deep.
  const roots = new Set(logicRoots(doc));
  for (const id of roots) if (refs.has(id)) return ['生產邏輯不可作為其他節點的子流程。'];
  for (const [id, count] of refs) if (count > 1) return [`子流程「${doc.graphs.find(g => g.id === id)!.name}」被多個節點引用，子流程不可共用。`];
  const places = graphPlaces(doc);
  const lost = doc.graphs.find(g => !places.has(g.id));
  if (lost) return [`子流程「${lost.name}」無法從任何生產邏輯到達，可能形成循環或沒有被任何節點引用。`];
  for (const { graph, node } of nodes) {
    if (node.childGraphId && places.get(graph.id)!.depth >= MAX_DEPTH) return [`節點「${nodeName(node)}」不可再有子流程：流程最多 ${MAX_DEPTH} 層。`];
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
  // D80: exactly one start and one end per graph, and they carry nothing else.
  for (const graph of doc.graphs) {
    const starts = graph.nodes.filter(n => n.kind === 'start'); const ends = graph.nodes.filter(n => n.kind === 'end');
    if (starts.length !== 1 || ends.length !== 1) return [`子流程「${graph.name}」必須剛好有一個開始與一個結束。`];
    if (graph.edges.some(e => e.to === starts[0].id)) return [`子流程「${graph.name}」的開始不可有前置連線。`];
    if (graph.edges.some(e => e.from === ends[0].id)) return [`子流程「${graph.name}」的結束不可有後續連線。`];
    for (const node of [starts[0], ends[0]]) {
      if (node.actionId || node.formId || node.childGraphId || Object.keys(node.params).length) return [`子流程「${graph.name}」的${node.name}不可設定動作、參數、表單或子流程。`];
    }
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
  // D81: a relation links forms of one factory only.
  const factoryOf = formFactories(doc);
  for (const r of doc.relations) {
    const [a, b] = [factoryOf.get(r.from.formId), factoryOf.get(r.to.formId)];
    if (a && b && a !== b) {
      const names = [r.from.formId, r.to.formId].map(id => `「${doc.forms.find(f => f.id === id)!.name.trim() || '（未命名表單）'}」`);
      return [`關聯不可跨工廠：${names[0]}與${names[1]}屬於不同的工廠。`];
    }
  }
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

// Completeness the editor shows while the user is still working; export is blocked until it is empty (D73, D80).
export function nodeErrors(doc: AovGraphDocument, node: GraphNode): string[] {
  const errors: string[] = [];
  const name = nodeName(node);
  if (node.kind !== 'node') return errors;
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
  if (!doc.factories.length) errors.push('請先建立工廠與生產邏輯。');
  for (const factory of doc.factories) {
    if (!factory.name.trim()) errors.push('有工廠尚未命名。');
    if (!factory.logicGraphIds.length) errors.push(`工廠「${factory.name.trim() || '（未命名工廠）'}」尚未建立生產邏輯。`);
  }
  for (const graph of doc.graphs) {
    if (!graph.name.trim()) errors.push('有生產邏輯或子流程尚未命名。');
    const working = workingNodes(graph);
    if (!working.length) errors.push(`「${graphLabel(graph)}」尚未建立節點。`);
    // D80: every node lies on a path from the start to the end.
    const start = graph.nodes.find(n => n.kind === 'start'); const end = graph.nodes.find(n => n.kind === 'end');
    const fromStart = start ? reach(graph, start.id, true) : new Set<string>(); const toEnd = end ? reach(graph, end.id, false) : new Set<string>();
    for (const node of working) {
      const missing = [fromStart.has(node.id) ? '' : '開始', toEnd.has(node.id) ? '' : '結束'].filter(Boolean);
      if (missing.length) errors.push(`節點「${nodeName(node)}」尚未接到${missing.join('與')}。`);
    }
  }
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
  if (input.version !== 5) throw new Error('這不是畫布版本（version 5）的流程規格。原流程已保留。');
  const [error] = integrityErrors(input);
  if (error) throw new Error(`${error}原流程已保留。`);
  return { value: input, notices: [] };
}
// One entry for every version: older documents are converted and every loss is listed (D75, D82).
export function importWorkflow(text: string): { value: AovGraphDocument; notices: string[] } {
  let version: unknown;
  try { version = JSON.parse(text.replace(/^﻿/, '')).version; } catch { /* importAov reports the bad format */ }
  if (version === 5) return importAovGraph(text);
  if (version === 4) {
    if (text.length > 2 * 1024 * 1024) throw new Error('流程規格不可超過 2 MB。');
    let input: AovGraphDocumentV4;
    try { input = JSON.parse(text.replace(/^﻿/, '')); validateSchema('aov', input); }
    catch { throw new Error('流程規格格式不正確。請使用本系統下載的流程規格檔。原流程已保留。'); }
    const upgraded = upgradeV4(input);
    const [error] = integrityErrors(upgraded.value);
    if (error) throw new Error(`${error}原流程已保留。`);
    return upgraded;
  }
  const old = importAov(text);
  const converted = listToGraph(old.value);
  return { value: converted.value, notices: [...old.notices, ...converted.notices] };
}

// Explicit projection: only schema fields leave the browser, never rows, samples or editor state.
export function exportAovGraph(doc: AovGraphDocument): string {
  const errors = [...integrityErrors(doc), ...graphErrors(doc)];
  if (errors.length) throw new Error(`流程規格尚未完成：${errors[0]}`);
  const value: AovGraphDocument = {
    format: 'composer-aov-list', version: 5,
    factories: doc.factories.map(({ id, name, logicGraphIds }) => ({ id, name, logicGraphIds: [...logicGraphIds] })),
    graphs: doc.graphs.map(g => ({
      id: g.id, name: g.name,
      nodes: g.nodes.map(({ id, kind, name, when, owner, actionId, params, formId, childGraphId }) => ({ id, kind, name, when, owner, actionId, params: { ...params }, formId, childGraphId })),
      edges: g.edges.map(({ id, from, to }) => ({ id, from, to })),
    })),
    layout: Object.fromEntries(Object.entries(doc.layout).map(([graphId, nodes]) => [graphId, Object.fromEntries(Object.entries(nodes).map(([id, { x, y }]) => [id, { x, y }]))])),
    forms: doc.forms.map(({ id, name, fields }) => ({ id, name, fields: fields.map(({ id, name, type, required, isKey, validation }) => ({ id, name, type, required, isKey, ...(validation ? { validation: { ...validation } } : {}) })) })),
    relations: doc.relations.map(({ id, from, to, origin }) => ({ id, kind: 'shared-key', from: { ...from }, to: { ...to }, origin, confirmed: true })),
  };
  validateSchema('aov', value);
  return JSON.stringify(value, null, 2);
}

// Version 4 to 5 (D82): the main flow goes into a default factory, and every graph gets a start and an end. The start is wired
// to the nodes nothing leads to, and the nodes that lead nowhere are wired to the end, so a flow that worked keeps working.
export function upgradeV4(old: AovGraphDocumentV4): { value: AovGraphDocument; notices: string[] } {
  const used = new Set(old.graphs.flatMap(g => [...g.nodes.map(n => n.id), ...g.edges.map(e => e.id)]));
  const fresh = (base: string) => { let id = base; for (let i = 2; used.has(id); i++) id = `${base}-${i}`; used.add(id); return id; };
  const layout: Layout = structuredClone(old.layout);
  const graphs: Graph[] = old.graphs.map(g => {
    const positions = layout[g.id] = layout[g.id] ?? {};
    const nodes: GraphNode[] = g.nodes.map(n => ({ ...n, kind: 'node' as const }));
    const sources = nodes.filter(n => !g.edges.some(e => e.to === n.id)); const sinks = nodes.filter(n => !g.edges.some(e => e.from === n.id));
    const xs = nodes.map(n => positions[n.id]?.x ?? 0);
    const [start, end] = boundaryNodes(fresh(`${g.id}-start`), fresh(`${g.id}-end`));
    positions[start.id] = { x: (xs.length ? Math.min(...xs) : 0) - 120, y: positions[sources[0]?.id]?.y ?? 0 };
    positions[end.id] = { x: (xs.length ? Math.max(...xs) : 120) + 120, y: positions[sinks[0]?.id]?.y ?? 0 };
    const edges = [...g.edges, ...sources.map(n => ({ id: fresh('edge-start'), from: start.id, to: n.id })), ...sinks.map(n => ({ id: fresh('edge-end'), from: n.id, to: end.id }))];
    return { id: g.id, name: g.name, nodes: [start, ...nodes, end], edges };
  });
  const value: AovGraphDocument = {
    format: 'composer-aov-list', version: 5, factories: [{ id: 'factory-1', name: '預設工廠', logicGraphIds: [old.rootGraphId] }],
    graphs, layout, forms: structuredClone(old.forms), relations: structuredClone(old.relations),
  };
  return { value, notices: ['舊版流程已放入「預設工廠」，並為每個流程補上開始與結束節點，請確認連線。'] };
}

// Versions 1 to 3 to version 5 (D75, D82). A step becomes nodes in order; what a node cannot hold is listed, never dropped silently.
export function listToGraph(doc: AovDocument): { value: AovGraphDocument; notices: string[] } {
  const notices: string[] = [];
  const working: GraphNode[] = [];
  let shortened = false;
  const label = (text: string) => { if (text.length > 100) shortened = true; return text.slice(0, 100); };
  const add = (name: string, step: AovDocument['steps'][number], actionId: string | null, formId: string | null) => {
    working.push({ id: `node-${working.length + 1}`, kind: 'node', name: label(name), when: step.when, owner: step.owner, actionId, params: {}, formId, childGraphId: null });
  };
  for (const step of doc.steps) {
    const before = working.length;
    const taken = new Set<string>();
    for (const action of step.actions) {
      const formId = action.formIds.find(id => step.formIds.includes(id) && !taken.has(id)) ?? null;
      if (formId) taken.add(formId);
      if (action.formIds.length > 1) notices.push(`步驟「${step.name}」的動作「${actionOf(action.actionId)?.name ?? action.actionId}」原本作用於 ${action.formIds.length} 張表單，節點只能有一張表單；第一張歸此節點，其餘各成一個沒有動作的節點。`);
      add(`${step.name}：${actionOf(action.actionId)?.name ?? action.actionId}`, step, action.actionId, formId);
    }
    for (const formId of step.formIds.filter(id => !taken.has(id))) add(`${step.name}：${doc.forms.find(f => f.id === formId)?.name ?? formId}`, step, null, formId);
    if (working.length === before) add(step.name, step, null, null);
    else if (working.length - before === 1) working[before].name = label(step.name);
  }
  if (working.length + 2 > MAX_NODES) throw new Error(`轉換後有 ${working.length} 個節點，超過單一流程 ${MAX_NODES - 2} 個節點的上限。請先精簡步驟。`);
  if (shortened) notices.push('部分節點名稱超過 100 字，已截短。');
  const parts = newGraphParts('graph-root', '主流程');
  const [start, end] = parts.graph.nodes;
  const chain = working.length ? [start, ...working, end] : [];
  const value: AovGraphDocument = {
    format: 'composer-aov-list', version: 5, factories: [{ id: 'factory-1', name: '預設工廠', logicGraphIds: ['graph-root'] }],
    graphs: [{ id: 'graph-root', name: '主流程', nodes: [start, ...working, end], edges: chain.slice(1).map((node, i) => ({ id: `edge-${i + 1}`, from: chain[i].id, to: node.id })) }],
    layout: { 'graph-root': Object.fromEntries([start, ...working, end].map((node, i) => [node.id, { x: i * 160, y: 0 }])) },
    forms: structuredClone(doc.forms), relations: structuredClone(doc.relations),
  };
  return { value, notices };
}
