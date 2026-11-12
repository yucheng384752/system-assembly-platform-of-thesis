import type { AovGraphDocument, Graph, GraphNode, Position } from './workflowGraph';

export interface ViewNode { id: string; graphId: string; node: GraphNode; position: Position; offset: Position }
export interface ViewFrame { graphId: string; ownerNodeId: string; title: string; position: Position; offset: Position; width: number; height: number; depth: number }
export interface ViewEdge { id: string; graphId: string; from: string; to: string }
export interface CanvasView { nodes: ViewNode[]; frames: ViewFrame[]; edges: ViewEdge[]; issues: string[] }
export interface LayeredView extends CanvasView {
  bands: { depth: number; y: number; height: number }[];
  links: { fromNodeId: string; toGraphId: string }[];
}

// Circle diameter follows DESIGN.md; frames reserve room for a title and padding.
const SIZE = 64, GAP = 32, PADDING = 32, TITLE = 64;
type Rect = { position: Position; width: number; height: number };
const name = (node: GraphNode) => node.name || '（未命名節點）';
const positionOf = (doc: AovGraphDocument, graph: Graph, index: number): Position =>
  doc.layout[graph.id]?.[graph.nodes[index].id] ?? { x: index * 180, y: 0 };
const intersects = (a: Rect, b: Rect) => a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width
  && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;
const bounds = (rects: Rect[]) => {
  if (!rects.length) return { x: 0, y: 0, width: SIZE, height: SIZE };
  const x = Math.min(...rects.map(r => r.position.x)), y = Math.min(...rects.map(r => r.position.y));
  return { x, y, width: Math.max(...rects.map(r => r.position.x + r.width)) - x,
    height: Math.max(...rects.map(r => r.position.y + r.height)) - y };
};
const viewNode = (graph: Graph, node: GraphNode, original: Position, position: Position): ViewNode =>
  ({ id: node.id, graphId: graph.id, node, position, offset: { x: position.x - original.x, y: position.y - original.y } });

export function parentContext(doc: AovGraphDocument, graphId: string) {
  if (doc.factories.some(f => f.logicGraphIds.includes(graphId))) return undefined;
  for (const graph of doc.graphs) {
    const node = graph.nodes.find(n => n.childGraphId === graphId);
    if (!node) continue;
    const before = new Set(graph.edges.filter(e => e.to === node.id).map(e => e.from));
    const after = new Set(graph.edges.filter(e => e.from === node.id).map(e => e.to));
    return { parentGraphId: graph.id, node, before: graph.nodes.filter(n => before.has(n.id)), after: graph.nodes.filter(n => after.has(n.id)) };
  }
  return undefined;
}

export function toLayoutPosition(node: Pick<ViewNode, 'offset'>, displayPosition: Position): Position {
  return { x: displayPosition.x - node.offset.x, y: displayPosition.y - node.offset.y };
}

export function frameAt(view: CanvasView, position: Position): ViewFrame | undefined {
  return view.frames.filter(f => position.x >= f.position.x && position.x <= f.position.x + f.width
    && position.y >= f.position.y && position.y <= f.position.y + f.height)
    .sort((a, b) => b.depth - a.depth)[0];
}

// A graph may only be owned once. This also stops cycles before entering them.
function graphReader(doc: AovGraphDocument, issues: string[]) {
  const graphs = new Map(doc.graphs.map(g => [g.id, g])), seen = new Set<string>();
  return (id: string, owner?: GraphNode) => {
    const graph = graphs.get(id);
    if (!graph || seen.has(id)) {
      issues.push(!graph ? `${owner ? `「${name(owner)}」的子流程` : '目前流程'}不存在，已略過。`
        : `「${owner ? name(owner) : '目前流程'}」的子流程重複引用或互相引用，已略過。`);
      return undefined;
    }
    seen.add(id);
    return graph;
  };
}

export function expandedView(doc: AovGraphDocument, graphId: string): CanvasView {
  const issues: string[] = [], read = graphReader(doc, issues);
  function visit(graph: Graph, depth: number): CanvasView {
    const result: CanvasView = { nodes: [], frames: [], edges: graph.edges.map(e => ({ ...e, graphId: graph.id })), issues };
    const blocks = graph.nodes.map((node, i) => {
      const original = positionOf(doc, graph, i);
      const child = node.childGraphId ? read(node.childGraphId, node) : undefined;
      const content = child ? visit(child, depth + 1) : undefined;
      const extent = content ? bounds([...content.nodes.map(n => ({ position: n.position, width: SIZE, height: SIZE })), ...content.frames]) : undefined;
      return { node, original, position: { ...original }, child, content, extent,
        width: extent ? extent.width + 2 * PADDING : SIZE, height: extent ? extent.height + TITLE + PADDING : SIZE };
    });
    if (blocks.some(b => b.content)) {
      // Propagate each expanded footprint along both original axes, without changing stored positions.
      for (const axis of ['x', 'y'] as const) {
        const ordered = [...blocks].sort((a, b) => a.original[axis] - b.original[axis]);
        for (let i = 0; i < ordered.length; i++) for (let j = 0; j < i; j++) {
          const a = ordered[j], b = ordered[i], size = axis === 'x' ? a.width : a.height;
          if (b.original[axis] >= a.original[axis] + SIZE)
            b.position[axis] = Math.max(b.position[axis], a.position[axis] + size + b.original[axis] - a.original[axis] - SIZE);
        }
      }
      const placed: Rect[] = [];
      for (const block of [...blocks].sort((a, b) => a.position.x - b.position.x)) {
        let collision = placed.find(r => intersects(r, block));
        while (collision) {
          block.position.x = collision.position.x + collision.width + GAP;
          collision = placed.find(r => intersects(r, block));
        }
        placed.push(block);
      }
    }
    for (const block of blocks) {
      const { node, original, position, child, content, extent } = block;
      if (!child || !content || !extent) { result.nodes.push(viewNode(graph, node, original, position)); continue; }
      const dx = position.x + PADDING - extent.x, dy = position.y + TITLE - extent.y;
      result.frames.push({ graphId: child.id, ownerNodeId: node.id, title: name(node), position, offset: { x: dx, y: dy }, width: block.width, height: block.height, depth: depth + 1 });
      result.nodes.push(...content.nodes.map(n => ({ ...n, position: { x: n.position.x + dx, y: n.position.y + dy }, offset: { x: n.offset.x + dx, y: n.offset.y + dy } })));
      result.frames.push(...content.frames.map(f => ({ ...f, position: { x: f.position.x + dx, y: f.position.y + dy }, offset: { x: f.offset.x + dx, y: f.offset.y + dy } })));
      result.edges.push(...content.edges);
    }
    return result;
  }
  const graph = read(graphId);
  return graph ? visit(graph, 1) : { nodes: [], frames: [], edges: [], issues };
}

export function layeredView(doc: AovGraphDocument, graphId: string): LayeredView {
  const result: LayeredView = { nodes: [], frames: [], edges: [], issues: [], bands: [], links: [] };
  const read = graphReader(doc, result.issues), root = read(graphId);
  if (!root) return result;
  let pending: { graph: Graph; owner?: ViewNode }[] = [{ graph: root }], y = 0, depth = 1;
  while (pending.length) {
    const next: typeof pending = [];
    let right = -Infinity, height = SIZE;
    for (const { graph, owner } of pending.sort((a, b) => (a.owner?.position.x ?? 0) - (b.owner?.position.x ?? 0))) {
      const nodes = graph.nodes.map((node, i) => {
        const original = positionOf(doc, graph, i);
        return viewNode(graph, node, original, { x: original.x, y: owner ? original.y : 0 });
      });
      // Nodes sharing a horizontal position occupy separate rows within the same band.
      const placed: Rect[] = [];
      for (const node of nodes) {
        const rect = { position: node.position, width: SIZE, height: SIZE };
        let collision = placed.find(r => intersects(r, rect));
        while (collision) {
          node.position.y = collision.position.y + collision.height + GAP;
          collision = placed.find(r => intersects(r, rect));
        }
        placed.push(rect);
      }
      const extent = bounds(placed);
      let dx = 0, dy = y;
      if (owner) {
        const x = Math.max(owner.position.x, right), width = extent.width + 2 * PADDING, frameHeight = extent.height + TITLE + PADDING;
        result.frames.push({ graphId: graph.id, ownerNodeId: owner.id, title: name(owner.node), position: { x, y }, offset: { x: x + PADDING - extent.x, y: y + TITLE - extent.y }, width, height: frameHeight, depth });
        result.links.push({ fromNodeId: owner.id, toGraphId: graph.id });
        dx = x + PADDING - extent.x; dy = y + TITLE - extent.y;
        right = x + width + GAP; height = Math.max(height, frameHeight);
      } else height = Math.max(height, extent.height);
      for (const node of nodes) {
        const original = positionOf(doc, graph, graph.nodes.indexOf(node.node));
        node.position = { x: node.position.x + dx, y: node.position.y + dy };
        node.offset = { x: node.position.x - original.x, y: node.position.y - original.y };
        result.nodes.push(node);
        if (node.node.childGraphId) {
          const child = read(node.node.childGraphId, node.node);
          if (child) next.push({ graph: child, owner: node });
        }
      }
      result.edges.push(...graph.edges.map(e => ({ ...e, graphId: graph.id })));
    }
    result.bands.push({ depth, y, height });
    y += height + GAP; depth++; pending = next;
  }
  return result;
}
