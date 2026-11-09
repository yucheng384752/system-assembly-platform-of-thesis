import type { Kit } from '../../../libs/ui-runtime/types';
import { validateSchema } from '../../../libs/ui-runtime/schema';
import { kits } from './catalog';
import { parseKitWorkflow, workflowFiles, workflowStatus, type KitWorkflow } from './kitWorkflows';
import { actionCatalog } from './workflow';
import { graphErrors, integrityErrors, newGraphParts, type AovGraphDocument, type GraphNode } from './workflowGraph';

export function kitWorkflowToCanvas(workflow: KitWorkflow, kit: Kit): { value: AovGraphDocument; notices: string[] } {
  const id = `kit-${kit.id}`;
  const used = new Set(workflow.nodes.map(node => node.id));
  const fresh = (base: string) => { let result = base; for (let i = 2; used.has(result); i++) result = `${base}-${i}`; used.add(result); return result; };
  const [start, end] = newGraphParts(id, kit.displayName).graph.nodes;
  start.id = fresh(start.id); end.id = fresh(end.id);
  const working: GraphNode[] = workflow.nodes.map(node => {
    let actionId: string | null = null, best = 0;
    for (const action of actionCatalog.actions) {
      const overlap = new Set(action.requires.filter(capability => node.capabilityIds.includes(capability))).size;
      if (overlap > best) { best = overlap; actionId = action.id; }
    }
    return { id: node.id, name: node.name, kind: 'node', when: '', owner: '', actionId, params: {}, formId: null, childGraphId: null };
  });
  const edges = workflow.edges.map(edge => ({ ...edge, id: fresh('edge') }));
  for (const node of working) {
    if (!workflow.edges.some(edge => edge.to === node.id)) edges.push({ id: fresh('edge-start'), from: start.id, to: node.id });
    if (!workflow.edges.some(edge => edge.from === node.id)) edges.push({ id: fresh('edge-end'), from: node.id, to: end.id });
  }
  const nodes = [start, ...working, end];
  const depths = new Map<string, number>();
  const pending = [...nodes];
  while (pending.length) {
    const index = pending.findIndex(node => edges.filter(edge => edge.to === node.id).every(edge => depths.has(edge.from)));
    if (index < 0) throw new Error('流程連線含循環或引用不存在的步驟。');
    const [node] = pending.splice(index, 1);
    depths.set(node.id, Math.max(0, ...edges.filter(edge => edge.to === node.id).map(edge => depths.get(edge.from)! + 1)));
  }
  const rows = new Map<number, number>();
  const positions = Object.fromEntries(nodes.map(node => {
    const depth = depths.get(node.id)!, row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    // Match the editor's 100px horizontal and 120px vertical node spacing.
    return [node.id, { x: depth * 100, y: row * 120 }];
  }));
  const value: AovGraphDocument = {
    format: 'composer-aov-list', version: 5,
    factories: [{ id, name: kit.displayName, logicGraphIds: [id] }],
    graphs: [{ id, name: kit.displayName, nodes, edges }], layout: { [id]: positions }, forms: [], relations: [],
  };
  validateSchema('aov', value);
  const errors = integrityErrors(value);
  if (errors.length) throw new Error(errors.join(' '));
  const unmapped = working.filter(node => node.actionId === null);
  const count = graphErrors(value).length;
  const notices = [
    `${kit.displayName} ${kit.version}：${workflowStatus[workflow.status]}；不代表已通過執行驗證。`,
    `${unmapped.length} 個步驟找不到對應功能。`,
    ...unmapped.map(node => `步驟「${node.name}」找不到對應功能，載入為業務節點。`),
    ...(!workflow.edges.length ? ['此功能未定義步驟先後。'] : []),
    count > 0 ? `尚有 ${count} 項待補` : '目前檢查沒有待補項，但這不代表可執行：此範例仍是草稿，無法對應功能的步驟只是業務節點',
  ];
  return { value, notices };
}

export interface KitExample {
  kitId: string; name: string; version: string;
  result?: { value: AovGraphDocument; notices: string[] };
  status?: KitWorkflow['status']; steps?: number; mapped?: number; error?: string;
}

export function loadKitExamples(sources = workflowFiles): KitExample[] {
  return Object.entries(sources).map(([path, text]): KitExample => {
    const kitId = path.split('/')[1];
    const kit = kits.find(item => item.id === kitId);
    const base = { kitId, name: kit?.displayName ?? '未登錄的功能', version: kit?.version ?? '' };
    if (!kit) return { ...base, error: '此範例所屬功能尚未登錄。' };
    try {
      const workflow = parseKitWorkflow(text, kit);
      const result = kitWorkflowToCanvas(workflow, kit);
      return { ...base, result, status: workflow.status, steps: workflow.nodes.length,
        mapped: result.value.graphs[0].nodes.filter(node => node.actionId !== null).length };
    } catch { return { ...base, error: '此功能的範例內容、版本或連線不符合流程規格，無法載入。' }; }
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}
