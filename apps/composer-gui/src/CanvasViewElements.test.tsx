import { expect, test } from 'vitest';
import { flowElements, viewConnection } from './CanvasViewElements';
import { expandedView, layeredView } from './canvasView';
import { emptyGraph } from './workflowGraph';
import { addCanvasNode, addChildGraph, addFactory, addLogic, connectCanvasNodes, reconnectCanvasEdge } from './canvasEditing';

function document() {
  let doc = addLogic(addFactory(emptyGraph, '工廠')!.value, 'factory-1', '')!.value;
  doc = addCanvasNode(doc, 'graph-1', null);
  doc = addChildGraph(doc, 'node-1');
  doc = addCanvasNode(doc, 'graph-2', null);
  doc = connectCanvasNodes(doc, 'graph-1', 'node-1', 'graph-1-end', true);
  return connectCanvasNodes(doc, 'graph-2', 'graph-2-start', 'node-2', true);
}

test('expanded arrows terminate at non-editable frames while business nodes retain their graph', () => {
  const view = expandedView(document(), 'graph-1'), { nodes, edges } = flowElements(view, 'node-2');
  expect(nodes.find(n => n.id === 'node-1')).toBeUndefined();
  expect(nodes.find(n => n.type === 'frame')).toMatchObject({ draggable: false, selectable: false, connectable: false, focusable: false });
  expect(nodes.find(n => n.id === 'node-2')).toMatchObject({ selected: true, data: { graphId: 'graph-2' } });
  expect(edges[0]).toMatchObject({ source: 'view-frame:graph-2', target: 'graph-1-end', type: 'straight', reconnectable: true, markerEnd: { type: 'arrowclosed' } });
});

test.each([expandedView, layeredView])('%s: reconnect keeps the edge in its original graph and rejects cross-graph endpoints', build => {
  const doc = document(), view = build(doc, 'graph-1');
  expect(viewConnection(view, 'graph-2-start', 'graph-1-end', 'edge-2')).toBeUndefined();
  expect(viewConnection(view, 'graph-1-start', 'graph-1-end', 'edge-2')).toBeUndefined();
  expect(viewConnection(view, 'missing', 'node-2')).toBeUndefined();
  expect(viewConnection(view, 'graph-2-start', 'graph-2-end', 'missing')).toBeUndefined();
  const connection = viewConnection(view, 'graph-2-start', 'graph-2-end', 'edge-2')!;
  const next = reconnectCanvasEdge(doc, connection.graphId, 'edge-2', connection.from, connection.to);
  expect(next.graphs[0]).toEqual(doc.graphs[0]);
  expect(next.graphs[1].edges).toEqual([{ id: 'edge-2', from: 'graph-2-start', to: 'graph-2-end' }]);
});

test('reconnect resolves a fixed expanded frame to its owner without allowing new frame connections', () => {
  const view = expandedView(document(), 'graph-1');
  expect(viewConnection(view, 'view-frame:graph-2', 'graph-1-end', 'edge-1')).toEqual({ graphId: 'graph-1', from: 'node-1', to: 'graph-1-end' });
  expect(viewConnection(view, 'view-frame:graph-2', 'graph-2-end', 'edge-1')).toBeUndefined();
  expect(viewConnection(view, 'view-frame:graph-2', 'graph-1-end')).toBeUndefined();
  expect(viewConnection(view, 'graph-1-start', 'view-frame:graph-2', 'edge-1')).toBeUndefined();
});
