import { actionCatalog, nextId } from './workflow';
import { MAX_FACTORIES, MAX_GRAPHS, MAX_LOGICS, newGraphParts, type AovGraphDocument, type Graph, type GraphEdge, type GraphNode, type Position } from './workflowGraph';

const allEdges = (doc: AovGraphDocument) => doc.graphs.flatMap(g => g.edges);
const clip = (name: string) => name.trim().slice(0, 100);

// Adding a node wires it into the flow (D80): after `after` (the start when there is none), before the end. A direct line from
// that node to the end is replaced by the two lines through the new node, so the flow stays one connected path.
export function addCanvasNode(doc: AovGraphDocument, graphId: string, actionId: string | null, position?: Position, after?: string): AovGraphDocument {
  const graph = doc.graphs.find(g => g.id === graphId)!;
  const action = actionCatalog.actions.find(a => a.id === actionId);
  const id = nextId('node', doc.graphs.flatMap(g => g.nodes));
  const start = graph.nodes.find(n => n.kind === 'start')!; const end = graph.nodes.find(n => n.kind === 'end')!;
  const before = graph.nodes.find(n => n.id === after && n.kind !== 'end') ?? start;
  const node: GraphNode = { id, kind: 'node', name: action?.name ?? '業務節點', when: '', owner: '', actionId,
    params: Object.fromEntries(action?.parameters.filter(p => p.default !== undefined).map(p => [p.id, p.default!]) ?? []), formId: null, childGraphId: null };
  const positions = doc.layout[graphId] ?? {};
  const endAt = positions[end.id] ?? { x: 240, y: 0 };
  const placed = position ?? { x: endAt.x, y: positions[before.id]?.y ?? 0 };
  const edges: GraphEdge[] = graph.edges.filter(e => !(e.from === before.id && e.to === end.id));
  for (const [from, to] of [[before.id, id], [id, end.id]]) edges.push({ id: nextId('edge', [...allEdges(doc), ...edges]), from, to });
  return { ...doc, graphs: doc.graphs.map(g => g.id === graphId ? { ...g, nodes: [...g.nodes, node], edges } : g),
    layout: { ...doc.layout, [graphId]: { ...positions, [id]: placed, ...(position ? {} : { [end.id]: { x: endAt.x + 120, y: endAt.y } }) } } };
}

export function patchCanvasNode(doc: AovGraphDocument, nodeId: string, patch: Partial<GraphNode>): AovGraphDocument {
  return { ...doc, graphs: doc.graphs.map(g => ({ ...g, nodes: g.nodes.map(n => n.id === nodeId && n.kind === 'node' ? { ...n, ...patch } : n) })) };
}

export function connectCanvasNodes(doc: AovGraphDocument, graphId: string, from: string, to: string, connected: boolean): AovGraphDocument {
  return { ...doc, graphs: doc.graphs.map(g => g.id !== graphId ? g : { ...g,
    edges: connected ? [...g.edges, { id: nextId('edge', allEdges(doc)), from, to }] : g.edges.filter(e => e.from !== from || e.to !== to) }) };
}

// A sub-flow of a node: its own start and end are created with it (D80).
export function addChildGraph(doc: AovGraphDocument, nodeId: string): AovGraphDocument {
  const node = doc.graphs.flatMap(g => g.nodes).find(n => n.id === nodeId)!;
  const id = nextId('graph', doc.graphs);
  const parts = newGraphParts(id, clip(`${node.name}的子流程`) || '子流程');
  const patched = patchCanvasNode(doc, nodeId, { childGraphId: id });
  return { ...patched, graphs: [...patched.graphs, parts.graph], layout: { ...doc.layout, [id]: parts.layout } };
}

export function addFactory(doc: AovGraphDocument, name: string): { value: AovGraphDocument; factoryId: string } | undefined {
  if (doc.factories.length >= MAX_FACTORIES) return undefined;
  const factoryId = nextId('factory', doc.factories);
  return { value: { ...doc, factories: [...doc.factories, { id: factoryId, name: clip(name), logicGraphIds: [] }] }, factoryId };
}
export function addLogic(doc: AovGraphDocument, factoryId: string, name: string): { value: AovGraphDocument; graphId: string } | undefined {
  const factory = doc.factories.find(f => f.id === factoryId);
  if (!factory || factory.logicGraphIds.length >= MAX_LOGICS || doc.graphs.length >= MAX_GRAPHS) return undefined;
  const graphId = nextId('graph', doc.graphs);
  const parts = newGraphParts(graphId, clip(name) || `生產邏輯 ${factory.logicGraphIds.length + 1}`);
  return { graphId, value: { ...doc, graphs: [...doc.graphs, parts.graph], layout: { ...doc.layout, [graphId]: parts.layout },
    factories: doc.factories.map(f => f.id === factoryId ? { ...f, logicGraphIds: [...f.logicGraphIds, graphId] } : f) } };
}
export const renameFactory = (doc: AovGraphDocument, factoryId: string, name: string): AovGraphDocument =>
  ({ ...doc, factories: doc.factories.map(f => f.id === factoryId ? { ...f, name: name.slice(0, 100) } : f) });
export const renameGraph = (doc: AovGraphDocument, graphId: string, name: string): AovGraphDocument =>
  ({ ...doc, graphs: doc.graphs.map(g => g.id === graphId ? { ...g, name: name.slice(0, 100) } : g) });

// The graphs below some roots, the roots included.
function withDescendants(doc: AovGraphDocument, rootIds: string[]): Set<string> {
  const found = new Set<string>();
  const queue = [...rootIds];
  for (let i = 0; i < queue.length; i++) {
    if (found.has(queue[i])) continue;
    found.add(queue[i]);
    for (const node of doc.graphs.find(g => g.id === queue[i])?.nodes ?? []) if (node.childGraphId) queue.push(node.childGraphId);
  }
  return found;
}
// Preview and commit use the same projection: everything that goes with what is removed (sub-flows, their nodes, the forms
// those nodes own, the relations touching those forms, positions and the factory's list entry).
function removal(doc: AovGraphDocument, graphIds: Set<string>, nodeIds: Set<string>, factoryIds = new Set<string>()) {
  const removedNodes = doc.graphs.flatMap(g => g.nodes.filter(n => graphIds.has(g.id) || nodeIds.has(n.id)));
  const gone = new Set(removedNodes.map(n => n.id));
  const formIds = new Set(removedNodes.flatMap(n => n.formId ? [n.formId] : []));
  const relations = doc.relations.filter(r => formIds.has(r.from.formId) || formIds.has(r.to.formId));
  const value: AovGraphDocument = { ...doc,
    factories: doc.factories.filter(f => !factoryIds.has(f.id)).map(f => ({ ...f, logicGraphIds: f.logicGraphIds.filter(id => !graphIds.has(id)) })),
    graphs: doc.graphs.filter(g => !graphIds.has(g.id)).map(g => ({ ...g, nodes: g.nodes.filter(n => !gone.has(n.id)), edges: g.edges.filter(e => !gone.has(e.from) && !gone.has(e.to)) })),
    layout: Object.fromEntries(Object.entries(doc.layout).filter(([id]) => !graphIds.has(id)).map(([id, positions]) => [id, Object.fromEntries(Object.entries(positions).filter(([n]) => !gone.has(n)))])),
    forms: doc.forms.filter(f => !formIds.has(f.id)), relations: doc.relations.filter(r => !relations.includes(r)),
  };
  // Start and end nodes are bookkeeping, not something the user made, so the preview lists only real nodes.
  return { value, nodes: removedNodes.filter(n => n.kind === 'node'), graphs: doc.graphs.filter(g => graphIds.has(g.id)), forms: doc.forms.filter(f => formIds.has(f.id)), relations };
}

// Deleting a node bridges its neighbours (every line into it to every line out of it) so the path stays connected.
export function deleteCanvasNode(doc: AovGraphDocument, nodeId: string) {
  const owner = doc.graphs.find(g => g.nodes.some(n => n.id === nodeId));
  const node = owner?.nodes.find(n => n.id === nodeId);
  if (!owner || !node || node.kind !== 'node') return { value: doc, nodes: [], graphs: [], forms: [], relations: [] };
  const result = removal(doc, withDescendants(doc, node.childGraphId ? [node.childGraphId] : []), new Set([nodeId]));
  const into = owner.edges.filter(e => e.to === nodeId); const out = owner.edges.filter(e => e.from === nodeId);
  const bridged: Graph = result.value.graphs.find(g => g.id === owner.id)!;
  const edges = [...bridged.edges];
  for (const a of into) for (const b of out) {
    if (!edges.some(e => e.from === a.from && e.to === b.to)) edges.push({ id: nextId('edge', [...allEdges(result.value), ...edges]), from: a.from, to: b.to });
  }
  return { ...result, value: { ...result.value, graphs: result.value.graphs.map(g => g.id === owner.id ? { ...g, edges } : g) } };
}
export function deleteLogic(doc: AovGraphDocument, graphId: string) {
  return removal(doc, withDescendants(doc, [graphId]), new Set());
}
export function deleteFactory(doc: AovGraphDocument, factoryId: string) {
  const factory = doc.factories.find(f => f.id === factoryId);
  return removal(doc, withDescendants(doc, factory?.logicGraphIds ?? []), new Set(), new Set([factoryId]));
}
