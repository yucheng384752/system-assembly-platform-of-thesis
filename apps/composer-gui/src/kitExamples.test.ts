import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateSchema } from '../../../libs/ui-runtime/schema';
import { kits } from './catalog';
import { actionCatalog } from './workflow';
import { parseKitWorkflow, workflowFiles, workflowStatus, type KitWorkflow } from './kitWorkflows';
import { kitWorkflowToCanvas, loadKitExamples } from './kitExamples';
import { importAny } from './importAny';
import { exportAovGraph, exportAovGraphDraft, graphErrors, integrityErrors } from './workflowGraph';

afterEach(() => vi.restoreAllMocks());
const kit = kits[0];
const make = (): KitWorkflow => ({ format: 'composer-kit-workflow', version: 1, kitId: kit.id, kitVersion: kit.version,
  status: 'draft', scope: '測試', nodes: [
    { id: 'a', name: '步驟甲', capabilityIds: ['one', 'two'] },
    { id: 'b', name: '步驟乙', capabilityIds: [] },
    { id: 'c', name: '步驟丙', capabilityIds: [] },
  ], edges: [{ from: 'a', to: 'b' }] });

test('largest intersection wins; ties keep catalog order; empty intersections stay business nodes', () => {
  const template = actionCatalog.actions[0];
  vi.spyOn(actionCatalog, 'actions', 'get').mockReturnValue([
    { ...template, id: 'small', requires: ['one'] }, { ...template, id: 'winner', requires: ['one', 'two'] },
    { ...template, id: 'tie', requires: ['two', 'one'] },
  ]);
  const result = kitWorkflowToCanvas(make(), kit);
  expect(result.value.graphs[0].nodes.filter(n => n.kind === 'node').map(n => n.actionId)).toEqual(['winner', null, null]);
  expect(result.notices).toContain('2 個步驟找不到對應功能。');
  for (const name of ['步驟乙', '步驟丙']) expect(result.notices).toContain(`步驟「${name}」找不到對應功能，載入為業務節點。`);
  expect(result.value.forms).toEqual([]);
  for (const node of result.value.graphs[0].nodes) expect([node.params, node.formId, node.when, node.owner]).toEqual([{}, null, '', '']);
});

test('boundary edges, layered positions, identifiers, names and deterministic output', () => {
  const flow = make(), before = structuredClone(flow);
  const first = kitWorkflowToCanvas(flow, kit);
  expect(kitWorkflowToCanvas(flow, kit)).toEqual(first);
  expect(flow).toEqual(before);
  const id = `kit-${kit.id}`, graph = first.value.graphs[0];
  expect(first.value.factories).toEqual([{ id, name: kit.displayName, logicGraphIds: [id] }]);
  expect([graph.id, graph.name]).toEqual([id, kit.displayName]);
  expect(graph.nodes.filter(n => n.kind === 'node').map(n => [n.id, n.name])).toEqual(flow.nodes.map(n => [n.id, n.name]));
  const start = graph.nodes[0].id, end = graph.nodes.at(-1)!.id;
  expect(graph.edges.map(e => [e.from, e.to])).toEqual([['a', 'b'], [start, 'a'], ['b', end], [start, 'c'], ['c', end]]);
  expect(first.value.layout[id]).toEqual({ [start]: { x: 0, y: 0 }, a: { x: 100, y: 0 }, b: { x: 200, y: 0 }, c: { x: 100, y: 120 }, [end]: { x: 300, y: 0 } });
  expect(integrityErrors(first.value)).toEqual([]);
});

test.each(['draft', 'reviewed'] as const)('parallel flow and %s notices report actual zero without claiming execution', status => {
  const flow = { ...make(), status, edges: [] };
  const { value, notices } = kitWorkflowToCanvas(flow, kit);
  expect(notices[0]).toBe(`${kit.displayName} ${kit.version}：${workflowStatus[status]}；不代表已通過執行驗證。`);
  expect(notices).toContain('此功能未定義步驟先後。');
  expect(graphErrors(value)).toEqual([]);
  expect(notices.at(-1)).toBe('目前檢查沒有待補項，但這不代表可執行：此範例仍是草稿，無法對應功能的步驟只是業務節點');
  const graph = value.graphs[0];
  expect(graph.edges).toHaveLength(6);
  expect(flow.nodes.map(n => value.layout[graph.id][n.id])).toEqual([{ x: 100, y: 0 }, { x: 100, y: 120 }, { x: 100, y: 240 }]);
  expect(exportAovGraphDraft(value)).toBe(exportAovGraph(value));
});

test.each(Object.entries(workflowFiles))('real file %s converts and round trips', (path, text) => {
  const sourceKit = kits.find(k => path === `kits/${k.id}/workflow.aov.json`)!;
  expect(sourceKit).toBeDefined();
  const flow = parseKitWorkflow(text, sourceKit);
  const result = kitWorkflowToCanvas(flow, sourceKit);
  expect(() => validateSchema('aov', result.value)).not.toThrow();
  expect(integrityErrors(result.value)).toEqual([]);
  expect(importAny(exportAovGraphDraft(result.value)).value).toEqual(result.value);
  expect(importAny(text)).toEqual(result);
  expect(importAny(`\uFEFF${text}`)).toEqual(result);
  const count = graphErrors(result.value).length;
  if (count) {
    expect(result.notices).toContain(`尚有 ${count} 項待補`);
    expect(() => exportAovGraph(result.value)).toThrow(`流程規格尚未完成：${graphErrors(result.value)[0]}`);
  }
});

test('draft rejects broken integrity and both exporters share one projection', () => {
  const value = kitWorkflowToCanvas(make(), kit).value;
  const extra = { ...value, rows: ['private'], graphs: value.graphs.map(g => ({ ...g, secret: 'private' })) };
  expect(exportAovGraphDraft(extra)).toBe(exportAovGraph(value));
  value.graphs[0].edges.push({ id: 'broken', from: 'missing', to: 'a' });
  expect(() => exportAovGraphDraft(value)).toThrow('連線引用了不在此子流程的節點');
  const source = readFileSync(new URL('./workflowGraph.ts', import.meta.url), 'utf8');
  expect(source.match(/factories: doc\.factories\.map/g)).toHaveLength(1);
  expect(source.match(/return projectAovGraph\(doc\);/g)).toHaveLength(2);
});

test('sources fail independently, remain visible, sort by display name, and can be empty', () => {
  const rows = loadKitExamples();
  expect(rows).toHaveLength(Object.keys(workflowFiles).length);
  expect(rows.every(row => row.result)).toBe(true);
  expect(rows.map(row => row.name)).toEqual(rows.map(row => row.name).sort((a, b) => a.localeCompare(b, 'zh-Hant')));
  const path = Object.keys(workflowFiles)[0];
  const failed = loadKitExamples({ ...workflowFiles, [path]: '{broken' });
  expect(failed.filter(row => row.error)).toHaveLength(1);
  expect(failed.filter(row => row.result)).toHaveLength(rows.length - 1);
  expect(loadKitExamples({})).toEqual([]);
  expect(loadKitExamples({ 'kits/unknown/workflow.aov.json': '{}' })[0].error).toContain('尚未登錄');
});

test('Kit import rejects unknown kits, wrong versions, and malformed content in business language', () => {
  const original = JSON.parse(Object.values(workflowFiles)[0]) as KitWorkflow;
  expect(() => importAny(JSON.stringify({ ...original, kitId: 'unknown' }))).toThrow('此流程所屬功能尚未登錄。原流程已保留。');
  expect(() => importAny(JSON.stringify({ ...original, kitVersion: '99.0.0' }))).toThrow('此流程的功能版本不符。原流程已保留。');
  expect(() => importAny(JSON.stringify({ ...original, nodes: null }))).toThrow('此功能的流程內容或連線不符合規格。原流程已保留。');
});

test('conversion rejects cycles and dangling links, and avoids collisions with boundary node ids', () => {
  const flow = make();
  expect(() => kitWorkflowToCanvas({ ...flow, edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }, kit)).toThrow('流程連線含循環');
  expect(() => kitWorkflowToCanvas({ ...flow, edges: [{ from: 'missing', to: 'a' }] }, kit)).toThrow('引用不存在的步驟');
  const collision = { ...flow, nodes: [{ id: `kit-${kit.id}-start`, name: '既有步驟', capabilityIds: [] }], edges: [] };
  const result = kitWorkflowToCanvas(collision, kit);
  expect(integrityErrors(result.value)).toEqual([]);
  expect(result.value.graphs[0].nodes.map(n => n.id)).toEqual([`kit-${kit.id}-start-2`, `kit-${kit.id}-start`, `kit-${kit.id}-end`]);
});
