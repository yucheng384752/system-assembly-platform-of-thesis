import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import original from '../../../docs/thesis-case/analytical-four-original.json';
import kit from '../../../kits/analytical-four-kit/workflow.aov.json';
import { compareThesisCase, originalToCanvas, renderThesisComparison, type OriginalFlow, type CaseKit } from './thesisAovCase';
import { exportAovGraphDraft, graphErrors } from './workflowGraph';
import { importAny } from './importAny';

it('round trips the three business logics without changing names, nodes or connections', () => {
  const value = originalToCanvas(original);
  expect(value.factories).toEqual([{ id: 'daily', name: original.factory, logicGraphIds: ['daily', 'complain', 'feedback'] }]);
  expect(graphErrors(value)).toEqual([]);
  expect(importAny(exportAovGraphDraft(value))).toEqual({ value, notices: [] });
  value.graphs.forEach((graph, i) => {
    const nodes = graph.nodes.filter(node => node.kind === 'node');
    expect(nodes.map(node => [node.id, node.name, node.actionId])).toEqual(original.logics[i].nodes.map(node => [node.id, node.name, null]));
    expect(nodes).toHaveLength([15, 20, 4][i]);
    expect(graph.edges.filter(edge => nodes.some(node => node.id === edge.from) && nodes.some(node => node.id === edge.to))
      .map(({ from, to }) => ({ from, to }))).toEqual(original.logics[i].edges);
    expect(graph.edges).toHaveLength([16, 21, 5][i]);
  });
});

it('matches every independent expected value from Claude batch 2', () => {
  const result = compareThesisCase(original, kit);
  expect(result.before.map(row => [row.nodes, row.edges])).toEqual([[15, 14], [20, 19], [4, 3]]);
  expect(result.totalNodes).toBe(39);
  expect(result.uniqueFunctions).toBe(24);
  expect(result.after).toEqual({ nodes: 22, edges: 23 });
  const counts = { configure: 2, 'read-data': 7, descriptive: 6, diagnostic: 10, topology: 2, rag: 2, 'ng-code': 2, compile: 1, 'search-key': 1, similarity: 1, llm: 1, 'submit-feedback': 3, 'publish-library': 1 };
  expect(Object.fromEntries(result.granularity.filter(node => node.nodeCount).map(node => [node.id, node.nodeCount]))).toEqual(counts);
  expect(Object.fromEntries(result.granularity.filter(node => node.nodeCount).map(node => [node.id, node.functionCount])))
    .toEqual({ ...Object.fromEntries(Object.keys(counts).map(id => [id, 1])), 'read-data': 4, descriptive: 3, diagnostic: 5, 'submit-feedback': 3 });
  expect(result.unmappedKit.sort()).toEqual(['accept-upload', 'approve-feedback', 'check-data', 'check-ready', 'get-templates', 'start-run', 'upload-files', 'view-results', 'view-run']);
  expect(result.unmappedOriginal).toEqual([]);
  expect(result.orderDifferences).toEqual([
    { logicId: 'daily', from: 'd-rag', to: 'd-ng-code', kitFrom: 'rag', kitTo: 'ng-code' },
    { logicId: 'complain', from: 'c-rag', to: 'c-ng-code', kitFrom: 'rag', kitTo: 'ng-code' },
  ]);
});

const node = (id: string, fn: string, kitNodes: string[]) => ({ id, name: id, function: fn, kitNodes, file: 'main.py', defLine: null });
const small: OriginalFlow = {
  factory: '測試', source: { author: '作者' }, observations: [],
  logics: [{ id: 'one', name: '一', nodes: [node('a', 'f', ['late', 'side']), node('b', 'g', ['early']), node('c', 'g', ['early']), node('d', 'h', [])],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }] },
  { id: 'two', name: '二', nodes: [node('e', 'f', ['early']), node('f', 'j', ['late']), node('g', 'j', ['side'])],
    edges: [{ from: 'e', to: 'f' }, { from: 'f', to: 'g' }] }],
};
const smallKit: CaseKit = { nodes: ['early', 'middle', 'late', 'side'].map(id => ({ id, name: id })),
  edges: [{ from: 'early', to: 'middle' }, { from: 'middle', to: 'late' }] };

it('checks hand calculated counts, many-to-many mappings, transitive reverse order, equal and disconnected nodes', () => {
  const result = compareThesisCase(small, smallKit);
  expect(result.before).toEqual([{ id: 'one', name: '一', nodes: 4, edges: 3, functions: 3 }, { id: 'two', name: '二', nodes: 3, edges: 2, functions: 2 }]);
  expect(result.totalNodes).toBe(7);
  expect(result.uniqueFunctions).toBe(4);
  expect(result.after).toEqual({ nodes: 4, edges: 2 });
  expect(result.mappings).toEqual(small.logics.flatMap(logic => logic.nodes.map(node => ({ logicId: logic.id, ...node }))));
  expect(result.granularity.map(node => [node.id, node.nodeCount, node.functionCount])).toEqual([['early', 3, 2], ['middle', 0, 0], ['late', 2, 2], ['side', 2, 2]]);
  expect(result.unmappedKit).toEqual(['middle']);
  expect(result.unmappedOriginal).toEqual(['d']);
  expect(result.orderDifferences).toEqual([{ logicId: 'one', from: 'a', to: 'b', kitFrom: 'late', kitTo: 'early' }]);
  expect(compareThesisCase(small, { ...smallKit, edges: [] }).orderDifferences).toEqual([]);
  expect(compareThesisCase(small, { ...smallKit, edges: [{ from: 'late', to: 'early' }] }).orderDifferences)
    .toEqual([{ logicId: 'two', from: 'e', to: 'f', kitFrom: 'early', kitTo: 'late' }]);
});

it('rejects missing references instead of silently dropping them', () => {
  expect(() => compareThesisCase(small, { ...smallKit, nodes: smallKit.nodes.filter(node => node.id !== 'side') })).toThrow('Kit 節點 side 不存在');
  expect(() => compareThesisCase(small, { ...smallKit, edges: [{ from: 'early', to: 'missing' }] })).toThrow('連線引用不存在');
  const broken = structuredClone(small);
  broken.logics[0].edges.push({ from: 'a', to: 'missing' });
  expect(() => compareThesisCase(broken, smallKit)).toThrow('連線引用不存在');
});

it('preserves source attribution and all four observations in the report', () => {
  const report = renderThesisComparison(original, kit);
  for (const value of Object.values(original.source)) expect(report).toContain(value);
  for (const observation of original.observations) for (const value of Object.values(observation)) expect(report).toContain(value);
  expect(renderThesisComparison({ ...small, factory: '測試', source: { author: '甲|乙' } }, smallKit)).toContain('甲\\|乙');
});

it('keeps both generated artifacts in sync (THESIS_CASE_UPDATE=1 updates them)', () => {
  // Compute and validate both before writing either artifact.
  const markdown = renderThesisComparison(original, kit);
  const json = exportAovGraphDraft(originalToCanvas(original)) + '\n';
  for (const [name, expected] of [['analytical-four-before.aov.json', json], ['analytical-four-comparison.md', markdown]]) {
    const file = path.resolve(__dirname, '../../../docs/thesis-case', name);
    if (process.env.THESIS_CASE_UPDATE === '1') writeFileSync(file, expected, 'utf8');
    expect(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), `${name} 過期；請以 THESIS_CASE_UPDATE=1 更新`).toBe(expected);
  }
});
