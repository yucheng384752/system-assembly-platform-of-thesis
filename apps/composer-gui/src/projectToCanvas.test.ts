import { expect, test } from 'vitest';
import { projectFixture } from './roundTrip.fixture';
import { projectToCanvas } from './projectToCanvas';
import { importAny } from './importAny';
import { kitWorkflowToCanvas } from './kitExamples';
import { kits } from './catalog';
import type { KitWorkflow } from './kitWorkflows';
import { compile, type ProjectFile } from '../../../libs/aov-core';

test('反推領料、填單與三種方向；不虛構功能，保留表單與連線', () => {
  const project = projectFixture();
  const r = projectToCanvas(project);
  expect(r.details.nodes).toEqual({
    n0: { kind: 'pick', material: 'tin', location: 'raw' },
    n1: { kind: 'fill', material: 'tin', form: 'slip', requires: {} },
    n2: { kind: 'sink', material: 'tin', direction: 'stock-in', location: 'stock' },
    n3: { kind: 'sink', material: 'tin', direction: 'ship-customer', location: 'customer' },
    n4: { kind: 'sink', material: 'tin', direction: 'ship-external', location: 'external' },
    n5: { kind: 'pick', material: 'tin', location: 'raw' },
    n6: { kind: 'pick', material: 'tin', location: 'raw' },
  });
  expect(r.forms.forms).toEqual(project.forms);
  expect(r.notices).toContain('專案檔不含觸發時機、負責人、功能與參數，這些已留空');
  const graph = r.value.graphs[0];
  expect(graph.nodes.filter(n => n.kind === 'node').map(n => [n.id, n.name, n.when, n.owner, n.actionId, n.params])).toEqual(project.nodes.map(n => [n.id, n.name, '', '', null, {}]));
  expect(graph.edges.slice(0, 4)).toEqual(project.flows.map(f => ({ id: f.id, from: f.from.node, to: f.to.node })));
  expect(graph.edges.filter(e => e.from === graph.nodes[0].id).map(e => e.to)).toEqual(['n0', 'n5', 'n6']);
  expect(graph.edges.filter(e => e.to === graph.nodes.at(-1)!.id).map(e => e.from)).toEqual(['n2', 'n3', 'n4']);
});

test.each<[string, (p: ProjectFile) => void, string]>([
  ['未知類別', p => { p.nodes[0].category = 'transform'; }, '領料'],
  ['缺邊界', p => { delete p.nodes[0].boundary; }, '領料'],
  ['出庫缺邊界', p => { delete p.nodes[2].boundary; }, '入庫'],
  ['不支援領料邊界', p => { p.nodes[0].boundary!.kind = 'external'; }, '領料'],
  ['不支援出庫邊界', p => { p.nodes[2].boundary!.kind = 'unknown' as never; }, '入庫'],
  ['缺表單', p => { delete p.nodes[1].form; }, '填單'],
  ['表單不存在', p => { p.nodes[1].form = 'missing'; }, '填單'],
  ['物料缺漏', p => { p.artifactTypes = []; }, '領料'],
  ['物料名稱格式', p => { p.artifactTypes[0].id = 'wrong'; }, '領料'],
  ['不支援量綱', p => { p.artifactTypes[0].quantity!.dimension = 'time'; }, '領料'],
  ['缺輸入清單', p => { delete (p.nodes[1] as Partial<typeof p.nodes[1]>).inputs; }, '填單'],
  ['連到不存在節點', p => { p.flows[0].to.node = 'missing'; }, '領料'],
])('%s 被拒並指名節點', (_label, mutate, name) => {
  const p = projectFixture(); mutate(p);
  expect(() => projectToCanvas(p)).toThrow(name);
  expect(() => importAny(JSON.stringify(p))).toThrow('原流程已保留。');
});

test('缺專案欄位被拒', () => {
  expect(() => importAny(JSON.stringify({ formatVersion: 1, nodes: [], flows: [] }))).toThrow('專案檔缺少');
});

test('核心允許但畫布不能反推的類別也拒絕，不猜成填單', () => {
  const p = projectFixture(); p.nodes[1].category = 'transform';
  expect(compile(p).ok).toBe(true);
  expect(() => projectToCanvas(p)).toThrow('填單');
});

test('專案與 Kit 的同形狀流程使用相同分層版面', () => {
  const p = projectFixture();
  const workflow: KitWorkflow = { format: 'composer-kit-workflow', version: 1, kitId: kits[0].id, kitVersion: kits[0].version, status: 'draft', scope: '測試', nodes: p.nodes.map(n => ({ id: n.id, name: n.name, capabilityIds: [] })), edges: p.flows.map(f => ({ from: f.from.node, to: f.to.node })) };
  const kit = kitWorkflowToCanvas(workflow, kits[0]).value;
  const restored = projectToCanvas(p).value;
  expect(Object.values(restored.layout![restored.graphs[0].id])).toEqual(Object.values(kit.layout![kit.graphs[0].id]));
});
