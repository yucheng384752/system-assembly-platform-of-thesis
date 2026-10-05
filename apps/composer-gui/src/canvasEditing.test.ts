import { describe, expect, test } from 'vitest';
import { addCanvasNode, addChildGraph, addFactory, addLogic, connectCanvasNodes, deleteCanvasNode, deleteFactory, deleteLogic, patchCanvasNode, renameFactory, renameGraph } from './canvasEditing';
import { emptyGraph, integrityErrors, MAX_FACTORIES, MAX_GRAPHS, MAX_LOGICS, type AovGraphDocument } from './workflowGraph';

const withLogic = (name = 'A 廠'): AovGraphDocument => addLogic(addFactory(emptyGraph, name)!.value, 'factory-1', '')!.value;
const lines = (doc: AovGraphDocument, graphId = 'graph-1') => doc.graphs.find(g => g.id === graphId)!.edges.map(e => `${e.from}>${e.to}`).sort();
const at = (doc: AovGraphDocument, id: string) => doc.graphs.flatMap(g => g.nodes).find(n => n.id === id)!;

describe('D80: new nodes are wired into the flow', () => {
  test('the first node goes between the start and the end, and the end moves to make room', () => {
    const doc = addCanvasNode(withLogic(), 'graph-1', null);
    expect(lines(doc)).toEqual(['graph-1-start>node-1', 'node-1>graph-1-end']);
    expect(doc.layout['graph-1']['node-1'].x).toBe(240);
    expect(doc.layout['graph-1']['graph-1-end'].x).toBe(360);
    expect(integrityErrors(doc)).toEqual([]);
  });

  test('a node added while another is selected follows it; a direct line to the end is replaced, not duplicated', () => {
    let doc = addCanvasNode(withLogic(), 'graph-1', null);
    doc = addCanvasNode(doc, 'graph-1', null, undefined, 'node-1');
    expect(lines(doc)).toEqual(['graph-1-start>node-1', 'node-1>node-2', 'node-2>graph-1-end']);
    // Adding after the first node again branches in parallel: node-1 leads to both, both lead to the end.
    doc = addCanvasNode(doc, 'graph-1', null, undefined, 'node-1');
    expect(lines(doc)).toEqual(['graph-1-start>node-1', 'node-1>node-2', 'node-1>node-3', 'node-2>graph-1-end', 'node-3>graph-1-end']);
    expect(integrityErrors(doc)).toEqual([]);
  });

  test('a selected end or an unknown node falls back to the start', () => {
    const base = addCanvasNode(withLogic(), 'graph-1', null);
    expect(lines(addCanvasNode(base, 'graph-1', null, undefined, 'graph-1-end'))).toContain('graph-1-start>node-2');
    expect(lines(addCanvasNode(base, 'graph-1', null, undefined, 'node-99'))).toContain('graph-1-start>node-2');
  });

  test('a dropped node keeps the position the user chose and does not move the end', () => {
    const doc = addCanvasNode(withLogic(), 'graph-1', null, { x: 500, y: 90 });
    expect(doc.layout['graph-1']['node-1']).toEqual({ x: 500, y: 90 });
    expect(doc.layout['graph-1']['graph-1-end'].x).toBe(240);
    expect(lines(doc)).toEqual(['graph-1-start>node-1', 'node-1>graph-1-end']);
  });

  test('an action node starts with the action name and its default parameters', () => {
    const doc = addCanvasNode(withLogic(), 'graph-1', 'trace-records');
    expect([at(doc, 'node-1').name, at(doc, 'node-1').params]).toEqual(['查詢追溯', { flowCode: 'default' }]);
  });

  test('the start and end cannot be patched', () => {
    const doc = patchCanvasNode(withLogic(), 'graph-1-start', { name: '改名', actionId: 'define-form' });
    expect(at(doc, 'graph-1-start')).toMatchObject({ name: '開始', actionId: null });
  });
});

describe('D80: deleting a node keeps the path connected', () => {
  test('the neighbours are joined, nothing else changes', () => {
    let doc = addCanvasNode(withLogic(), 'graph-1', null);
    doc = addCanvasNode(doc, 'graph-1', null, undefined, 'node-1');
    doc = addCanvasNode(doc, 'graph-1', null, undefined, 'node-2');
    const removed = deleteCanvasNode(doc, 'node-2');
    expect(removed.nodes.map(n => n.id)).toEqual(['node-2']);
    expect(lines(removed.value)).toEqual(['graph-1-start>node-1', 'node-1>node-3', 'node-3>graph-1-end']);
    expect(integrityErrors(removed.value)).toEqual([]);
  });

  test('a node with several neighbours is bridged pair by pair without duplicate lines', () => {
    let doc = addCanvasNode(withLogic(), 'graph-1', null);
    doc = addCanvasNode(doc, 'graph-1', null, undefined, 'node-1');
    doc = addCanvasNode(doc, 'graph-1', null, undefined, 'node-1');
    doc = connectCanvasNodes(doc, 'graph-1', 'node-2', 'node-3', true);
    // node-2 led to node-3 and to the end: node-1 now leads to the end directly, and node-1>node-3 already existed so it is not added twice.
    const value = deleteCanvasNode(doc, 'node-2').value;
    expect(lines(value)).toEqual(['graph-1-start>node-1', 'node-1>graph-1-end', 'node-1>node-3', 'node-3>graph-1-end']);
    expect(integrityErrors(value)).toEqual([]);
  });

  test('the start and end are refused with an empty projection', () => {
    const doc = withLogic();
    for (const id of ['graph-1-start', 'graph-1-end']) {
      const result = deleteCanvasNode(doc, id);
      expect(result.value).toBe(doc);
      expect([result.nodes, result.graphs, result.forms, result.relations]).toEqual([[], [], [], []]);
    }
  });

  test('deleting a node removes its sub-flow, the forms those nodes own and the relations touching them; start and end are not listed', () => {
    let doc = addCanvasNode(withLogic(), 'graph-1', null);
    doc = addChildGraph(doc, 'node-1');
    doc = addCanvasNode(doc, 'graph-2', null);
    doc = patchCanvasNode(doc, 'node-2', { formId: 'form-1' });
    doc = patchCanvasNode(doc, 'node-1', { formId: 'form-2' });
    const field = { id: 'f', name: '批號', type: 'text' as const, required: true, isKey: true };
    doc = { ...doc, forms: [{ id: 'form-1', name: '子表單', fields: [field] }, { id: 'form-2', name: '母表單', fields: [field] }, { id: 'form-3', name: '別人的表單', fields: [field] }],
      relations: [{ id: 'r1', kind: 'shared-key', from: { formId: 'form-1', fieldId: 'f' }, to: { formId: 'form-3', fieldId: 'f' }, origin: 'user', confirmed: true }] };
    const removed = deleteCanvasNode(doc, 'node-1');
    expect(removed.nodes.map(n => n.id).sort()).toEqual(['node-1', 'node-2']);
    expect(removed.graphs.map(g => g.id)).toEqual(['graph-2']);
    expect(removed.forms.map(f => f.id).sort()).toEqual(['form-1', 'form-2']);
    expect(removed.relations.map(r => r.id)).toEqual(['r1']);
    expect(removed.value.forms.map(f => f.id)).toEqual(['form-3']);
    expect(removed.value.layout['graph-2']).toBeUndefined();
  });
});

describe('sub-flows, factories and production logics', () => {
  test('a sub-flow is born with its own start and end and is linked to its node', () => {
    const doc = addChildGraph(addCanvasNode(withLogic(), 'graph-1', null), 'node-1');
    expect(at(doc, 'node-1').childGraphId).toBe('graph-2');
    expect(doc.graphs[1].nodes.map(n => n.kind)).toEqual(['start', 'end']);
    expect(doc.graphs[1].name).toBe('業務節點的子流程');
    expect(integrityErrors(doc)).toEqual([]);
  });

  test('a production logic gets a default name, its start and end, and a place in the factory list', () => {
    const doc = withLogic();
    expect(doc.factories).toEqual([{ id: 'factory-1', name: 'A 廠', logicGraphIds: ['graph-1'] }]);
    expect(doc.graphs[0].name).toBe('生產邏輯 1');
    const second = addLogic(doc, 'factory-1', '  焊接  ')!;
    expect([second.graphId, second.value.graphs[1].name, second.value.factories[0].logicGraphIds]).toEqual(['graph-2', '焊接', ['graph-1', 'graph-2']]);
    expect(addLogic(doc, 'factory-9', 'x')).toBeUndefined();
  });

  test('renaming changes only the name', () => {
    const doc = renameGraph(renameFactory(withLogic(), 'factory-1', 'B 廠'), 'graph-1', '包裝');
    expect([doc.factories[0].name, doc.graphs[0].name, doc.factories[0].logicGraphIds]).toEqual(['B 廠', '包裝', ['graph-1']]);
  });

  test('the factory, production logic and graph limits are enforced', () => {
    let doc = emptyGraph;
    for (let i = 0; i < MAX_FACTORIES; i++) doc = addFactory(doc, `工廠 ${i + 1}`)!.value;
    expect(addFactory(doc, '多一個')).toBeUndefined();
    let crowded = addFactory(emptyGraph, 'A')!.value;
    for (let i = 0; i < MAX_LOGICS; i++) crowded = addLogic(crowded, 'factory-1', '')!.value;
    expect(addLogic(crowded, 'factory-1', '')).toBeUndefined();
    expect(MAX_GRAPHS).toBe(100);
  });

  test('deleting a production logic removes it from its factory with everything below it', () => {
    let doc = addCanvasNode(withLogic(), 'graph-1', null);
    doc = addChildGraph(doc, 'node-1');
    doc = addLogic(doc, 'factory-1', '保留')!.value;
    const removed = deleteLogic(doc, 'graph-1');
    expect(removed.graphs.map(g => g.id).sort()).toEqual(['graph-1', 'graph-2']);
    expect(removed.value.graphs.map(g => g.id)).toEqual(['graph-3']);
    expect(removed.value.factories[0].logicGraphIds).toEqual(['graph-3']);
    expect(removed.value.layout['graph-1']).toBeUndefined();
    expect(integrityErrors(removed.value)).toEqual([]);
  });

  test('deleting a factory removes all its logics, forms and relations but leaves other factories alone', () => {
    let doc = addLogic(addFactory(addCanvasNode(withLogic(), 'graph-1', null), 'B 廠')!.value, 'factory-2', '')!.value;
    doc = patchCanvasNode(doc, 'node-1', { formId: 'form-1' });
    doc = { ...doc, forms: [{ id: 'form-1', name: '收料單', fields: [{ id: 'f', name: '批號', type: 'text', required: true, isKey: true }] }] };
    const removed = deleteFactory(doc, 'factory-1');
    expect(removed.forms.map(f => f.id)).toEqual(['form-1']);
    expect(removed.value.factories.map(f => f.id)).toEqual(['factory-2']);
    expect(removed.value.graphs.map(g => g.id)).toEqual(['graph-2']);
    expect(removed.value.forms).toEqual([]);
    expect(integrityErrors(removed.value)).toEqual([]);
  });
});
