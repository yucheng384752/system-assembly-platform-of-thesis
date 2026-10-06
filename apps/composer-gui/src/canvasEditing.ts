import { actionCatalog, nextId } from './workflow';
import { type AovGraphDocument, type GraphNode, type Position } from './workflowGraph';

export function addCanvasNode(doc: AovGraphDocument, graphId: string, actionId: string | null, position?: Position): AovGraphDocument {
  const graph = doc.graphs.find(g => g.id === graphId)!;
  const action = actionCatalog.actions.find(a => a.id === actionId);
  const id = nextId('node', doc.graphs.flatMap(g => g.nodes));
  const node: GraphNode = { id, name: action?.name ?? '業務節點', when: '', owner: '', actionId,
    params: Object.fromEntries(action?.parameters.filter(p => p.default !== undefined).map(p => [p.id, p.default!]) ?? []), formId: null, childGraphId: null };
  return { ...doc, graphs: doc.graphs.map(g => g.id === graphId ? { ...g, nodes: [...g.nodes, node] } : g),
    layout: { ...doc.layout, [graphId]: { ...doc.layout[graphId], [id]: position ?? { x: (graph.nodes.length % 4) * 180, y: Math.floor(graph.nodes.length / 4) * 180 } } } };
}

export function patchCanvasNode(doc: AovGraphDocument, nodeId: string, patch: Partial<GraphNode>): AovGraphDocument {
  return { ...doc, graphs: doc.graphs.map(g => ({ ...g, nodes: g.nodes.map(n => n.id === nodeId ? { ...n, ...patch } : n) })) };
}

export function connectCanvasNodes(doc: AovGraphDocument, graphId: string, from: string, to: string, connected: boolean): AovGraphDocument {
  return { ...doc, graphs: doc.graphs.map(g => g.id !== graphId ? g : { ...g,
    edges: connected ? [...g.edges, { id: nextId('edge', doc.graphs.flatMap(x => x.edges)), from, to }] : g.edges.filter(e => e.from !== from || e.to !== to) }) };
}

// Preview and commit use the same deletion projection, including every descendant and its relations.
export function deleteCanvasNode(doc: AovGraphDocument, nodeId: string) {
  const removedNodes: GraphNode[] = [];
  const removedGraphs = new Set<string>();
  function collect(node: GraphNode) {
    removedNodes.push(node);
    if (node.childGraphId && !removedGraphs.has(node.childGraphId)) {
      removedGraphs.add(node.childGraphId);
      doc.graphs.find(g => g.id === node.childGraphId)?.nodes.forEach(collect);
    }
  }
  const node = doc.graphs.flatMap(g => g.nodes).find(n => n.id === nodeId);
  if (node) collect(node);
  const nodeIds = new Set(removedNodes.map(n => n.id));
  const formIds = new Set(removedNodes.flatMap(n => n.formId ? [n.formId] : []));
  const forms = doc.forms.filter(f => formIds.has(f.id));
  const relations = doc.relations.filter(r => formIds.has(r.from.formId) || formIds.has(r.to.formId));
  const value: AovGraphDocument = { ...doc,
    graphs: doc.graphs.filter(g => !removedGraphs.has(g.id)).map(g => ({ ...g, nodes: g.nodes.filter(n => !nodeIds.has(n.id)), edges: g.edges.filter(e => !nodeIds.has(e.from) && !nodeIds.has(e.to)) })),
    layout: Object.fromEntries(Object.entries(doc.layout).filter(([id]) => !removedGraphs.has(id)).map(([id, positions]) => [id, Object.fromEntries(Object.entries(positions).filter(([n]) => !nodeIds.has(n)))])),
    forms: doc.forms.filter(f => !formIds.has(f.id)), relations: doc.relations.filter(r => !relations.includes(r)),
  };
  return { value, nodes: removedNodes, graphs: doc.graphs.filter(g => removedGraphs.has(g.id)), forms, relations };
}
