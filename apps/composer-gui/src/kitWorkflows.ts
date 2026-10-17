import type { Kit, Recipe } from '../../../libs/ui-runtime/types';
import type { KitRegistry } from '../../../libs/ui-runtime/registry';
import { validateSchema } from '../../../libs/ui-runtime/schema';
import { registry } from './registryData';

export interface KitWorkflow {
  format: 'composer-kit-workflow'; version: 1; kitId: string; kitVersion: string;
  status: 'draft' | 'reviewed'; scope: string;
  nodes: { id: string; name: string; subfeatureId?: string; capabilityIds: string[] }[];
  edges: { from: string; to: string }[];
}
export interface WorkflowRow {
  kitId: string; kitVersion: string; name: string; path: string;
  status: 'draft' | 'reviewed' | 'missing' | 'invalid'; note: string;
  workflow?: KitWorkflow;
}
export const workflowStatus = { draft: '草稿，尚未審閱', reviewed: '已審閱（未代表執行驗證）', missing: '尚未提供', invalid: '定義有誤' };
export const KIT_WORKFLOW_SUMMARY = 'aov/kit-workflows.json';
export const KIT_WORKFLOW_TABLE = 'aov/kit-workflows.md';
const files = import.meta.glob('../../../kits/*/workflow.aov.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
export const workflowFiles = Object.fromEntries(Object.entries(files).map(([path, text]) => [path.replace('../../../', ''), text]));

export function parseKitWorkflow(text: string, kit: Kit, entries: KitRegistry[] = registry): KitWorkflow {
  const value = JSON.parse(text.replace(/^\uFEFF/, '')) as KitWorkflow;
  validateSchema('kitWorkflow', value);
  if (value.kitId !== kit.id || value.kitVersion !== kit.version) throw new Error('流程所屬功能或版本不符。');
  const nodes = new Map(value.nodes.map(node => [node.id, node]));
  if (nodes.size !== value.nodes.length) throw new Error('流程節點識別碼重複。');
  const capabilities = new Set(entries.filter(entry => entry.kitId === kit.id).flatMap(entry => entry.capabilities.map(c => c.id)));
  for (const node of value.nodes) {
    if (node.subfeatureId && !kit.subfeatures.some(sub => sub.id === node.subfeatureId)) throw new Error(`節點 ${node.id} 引用不存在的子功能。`);
    if (node.capabilityIds.some(id => !capabilities.has(id))) throw new Error(`節點 ${node.id} 引用未登錄的能力。`);
  }
  const next = new Map(value.nodes.map(node => [node.id, [] as string[]]));
  for (const edge of value.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error('流程連線引用不存在的節點。');
    next.get(edge.from)!.push(edge.to);
  }
  const visiting = new Set<string>(), done = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error('流程連線含循環。');
    if (done.has(id)) return;
    visiting.add(id); next.get(id)!.forEach(visit); visiting.delete(id); done.add(id);
  }
  nodes.forEach((_, id) => visit(id));
  return value;
}

export function summarizeKitWorkflows(recipe: Pick<Recipe, 'enabledKits' | 'selectedSubfeatures'>, kits: Kit[], sources = workflowFiles): WorkflowRow[] {
  return [...new Set(recipe.enabledKits)].map(id => {
    const kit = kits.find(k => k.id === id);
    if (!kit) throw new Error(`未登錄的功能：${id}`);
    const path = `kits/${kit.id}/workflow.aov.json`;
    const base = { kitId: kit.id, kitVersion: kit.version, name: kit.displayName, path };
    if (!Object.hasOwn(sources, path)) return { ...base, status: 'missing', note: '此功能尚未提供流程定義。' };
    try {
      const source = parseKitWorkflow(sources[path], kit);
      const selected = recipe.selectedSubfeatures[id] ?? kit.subfeatures.filter(s => s.defaultSelected).map(s => s.id);
      const nodes = source.nodes.filter(node => !node.subfeatureId || selected.includes(node.subfeatureId));
      const ids = new Set(nodes.map(node => node.id));
      // Removing a disabled step must not invent a new connection between its neighbours.
      const edges = source.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
      return { ...base, status: source.status, note: source.scope, workflow: { ...source, nodes, edges } };
    } catch (error) {
      return { ...base, status: 'invalid', note: error instanceof Error ? error.message : '流程定義無法讀取。' };
    }
  });
}

export function workflowTable(rows: WorkflowRow[]): string {
  const cell = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/[\r\n]+/g, ' ');
  return ['# 所選功能流程總表', '', '僅描述已選功能與子功能；不推測跨功能先後順序，不代表系統已啟動或通過執行驗證。', '',
    '| 功能 | 版本 | 狀態 | 步驟 | 已定義連線 | 範圍與限制 |', '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(row => {
      const graph = row.workflow;
      const name = (id: string) => graph!.nodes.find(node => node.id === id)!.name;
      return `| ${[row.name, row.kitVersion, workflowStatus[row.status], graph ? graph.nodes.map(n => n.name).join('、') || '無啟用步驟' : '—', graph ? graph.edges.map(e => `${name(e.from)} → ${name(e.to)}`).join('；') || '無連線' : '—', row.note].map(cell).join(' | ')} |`;
    }), '', '## 來源', '', ...rows.map(row => `- ${cell(row.name)}：\`${row.path}\``), ''].join('\n');
}
