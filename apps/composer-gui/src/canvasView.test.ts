import { expect, test } from 'vitest';
import { expandedView, layeredView, parentContext, toLayoutPosition, type CanvasView } from './canvasView';
import { emptyGraph, type AovGraphDocument, type Graph, type GraphNode, type Position } from './workflowGraph';

const node = (id: string, childGraphId: string | null = null): GraphNode =>
  ({ id, name: id, kind: 'node', childGraphId, when: '', owner: '', actionId: null, params: {}, formId: null });
const graph = (id: string, nodes: GraphNode[]): Graph => ({ id, name: id, nodes, edges: [] });
function threeLayers(): AovGraphDocument {
  const graphs = [graph('root', [node('before'), node('owner', 'child'), node('right'), node('below'), node('other', 'sibling')]),
    graph('child', [node('child-before'), node('nested', 'grandchild'), node('child-after')]),
    graph('grandchild', [node('deep-one'), node('deep-two')]), graph('sibling', [node('sibling-one'), node('sibling-two')])];
  graphs[0].edges = [{ id: 'in', from: 'before', to: 'owner' }, { id: 'out', from: 'owner', to: 'right' }];
  graphs[1].edges = [{ id: 'child-in', from: 'child-before', to: 'nested' }];
  return { ...emptyGraph, factories: [{ id: 'factory', name: '工廠', logicGraphIds: ['root'] }], graphs,
    layout: { root: { before: { x: -180, y: 0 }, owner: { x: 0, y: 0 }, right: { x: 180, y: 0 }, below: { x: 0, y: 180 }, other: { x: 360, y: 0 } },
      child: { 'child-before': { x: -100, y: -80 }, nested: { x: 80, y: -80 }, 'child-after': { x: 260, y: -80 } },
      grandchild: { 'deep-one': { x: -250, y: -150 }, 'deep-two': { x: 300, y: 100 } },
      sibling: { 'sibling-one': { x: 0, y: 0 }, 'sibling-two': { x: 240, y: 180 } } } };
}
type Rectangle = { position: Position; width: number; height: number };
const intersects = (a: Rectangle, b: Rectangle) => a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width
  && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;
const contains = (a: Rectangle, b: Rectangle) => a.position.x <= b.position.x && a.position.y <= b.position.y
  && a.position.x + a.width >= b.position.x + b.width && a.position.y + a.height >= b.position.y + b.height;
function checkRectangles(doc: AovGraphDocument, view: CanvasView, expanded: boolean) {
  const rectangles = [...view.nodes.map(n => ({ ...n, width: 64, height: 64, frame: false })),
    ...view.frames.map(f => ({ ...f, frame: true }))];
  const inside = (childId: string, parentId: string): boolean => {
    if (childId === parentId) return true;
    if (!expanded) return false;
    const parent = parentContext(doc, childId);
    return Boolean(parent && inside(parent.parentGraphId, parentId));
  };
  for (let i = 0; i < rectangles.length; i++) for (const b of rectangles.slice(i + 1)) {
    const a = rectangles[i];
    // A frame must contain its descendants; all unrelated rectangles must be disjoint.
    if (a.frame && inside(b.graphId, a.graphId)) expect(contains(a, b)).toBe(true);
    else if (b.frame && inside(a.graphId, b.graphId)) expect(contains(b, a)).toBe(true);
    else expect(intersects(a, b), `${a.graphId} and ${b.graphId}`).toBe(false);
  }
}

test.each([expandedView, layeredView])('%s: three levels retain ownership, round-trip positions and avoid collisions without changing the document', build => {
  const doc = threeLayers(), original = structuredClone(doc), view = build(doc, 'root');
  expect(view.issues).toEqual([]);
  expect(view.frames.map(f => f.graphId).sort()).toEqual(['child', 'grandchild', 'sibling']);
  checkRectangles(doc, view, build === expandedView);
  for (const n of view.nodes) {
    expect(doc.graphs.find(g => g.nodes.includes(n.node))?.id).toBe(n.graphId);
    expect(toLayoutPosition(n, n.position)).toEqual(doc.layout[n.graphId][n.id]);
    expect(toLayoutPosition(n, { x: n.position.x + 12, y: n.position.y - 27 })).toEqual({ x: doc.layout[n.graphId][n.id].x + 12, y: doc.layout[n.graphId][n.id].y - 27 });
  }
  expect(doc).toEqual(original);
  expect(view.edges.map(e => [e.id, e.graphId, e.from, e.to])).toEqual(expect.arrayContaining([
    ['in', 'root', 'before', 'owner'], ['out', 'root', 'owner', 'right'], ['child-in', 'child', 'child-before', 'nested'],
  ]));
});

test('expanded frames replace their owners, move right and lower siblings, and enclose nested frames', () => {
  const doc = threeLayers(), view = expandedView(doc, 'root');
  for (const id of ['owner', 'nested', 'other']) expect(view.nodes.find(n => n.id === id)).toBeUndefined();
  const frame = view.frames.find(f => f.ownerNodeId === 'owner')!;
  expect(frame.position).toEqual(doc.layout.root.owner);
  expect(view.nodes.find(n => n.id === 'right')!.position.x).toBeGreaterThanOrEqual(frame.position.x + frame.width);
  expect(view.nodes.find(n => n.id === 'below')!.position.y).toBeGreaterThanOrEqual(frame.position.y + frame.height);
  expect(view.frames.find(f => f.graphId === 'grandchild')!.depth).toBe(3);
});

test('layered bands retain root horizontal positions and expose a link for each child frame', () => {
  const doc = threeLayers(), view = layeredView(doc, 'root');
  expect(view.bands.map(b => b.depth)).toEqual([1, 2, 3]);
  expect(view.nodes).toHaveLength(doc.graphs.reduce((total, g) => total + g.nodes.length, 0));
  for (const n of view.nodes.filter(n => n.graphId === 'root')) expect(n.position.x).toBe(doc.layout.root[n.id].x);
  for (const frame of view.frames) {
    const band = view.bands.find(b => b.depth === frame.depth)!;
    expect(frame.position.y).toBe(band.y);
    expect(frame.height).toBeLessThanOrEqual(band.height);
    expect(view.links).toContainEqual({ fromNodeId: frame.ownerNodeId, toGraphId: frame.graphId });
  }
  for (let i = 1; i < view.bands.length; i++) expect(view.bands[i].y).toBeGreaterThan(view.bands[i - 1].y + view.bands[i - 1].height);
  expect(view.frames.find(f => f.graphId === 'child')!.position.x).toBe(view.nodes.find(n => n.id === 'owner')!.position.x);
});

test('a graph without children keeps its layout exactly, including negative coordinates and missing positions', () => {
  const doc = threeLayers();
  delete doc.layout.grandchild['deep-two'];
  const view = expandedView(doc, 'grandchild');
  expect(view.frames).toEqual([]);
  expect(view.nodes.map(n => n.position)).toEqual([{ x: -250, y: -150 }, { x: 180, y: 0 }]);
  expect(view.nodes.map(n => toLayoutPosition(n, n.position))).toEqual(view.nodes.map(n => n.position));
});

test.each([expandedView, layeredView])('%s: missing children and cyclic or shared references are skipped with business-language issues', build => {
  const doc = threeLayers();
  doc.graphs[0].nodes[2].childGraphId = 'missing';
  doc.graphs[2].nodes[0].childGraphId = 'root';
  doc.graphs[2].nodes[1].childGraphId = 'child';
  const view = build(doc, 'root');
  expect(view.issues).toHaveLength(3);
  expect(view.issues.join(' ')).toContain('不存在');
  expect(view.issues.join(' ')).toContain('互相引用');
  expect(view.nodes.some(n => n.id === 'right')).toBe(true);
  expect(new Set(view.frames.map(f => f.graphId)).size).toBe(view.frames.length);
  const missing = build(doc, 'missing');
  expect(missing.nodes).toEqual([]);
  expect(missing.issues).toEqual(['目前流程不存在，已略過。']);
});

test('parent context returns only direct neighbours in node order without duplicate edges; roots and unowned graphs have none', () => {
  const doc = threeLayers();
  expect(parentContext(doc, 'sibling')?.before).toEqual([]);
  expect(parentContext(doc, 'sibling')?.after).toEqual([]);
  doc.graphs[0].edges.push({ id: 'in2', from: 'below', to: 'owner' }, { id: 'duplicate', from: 'before', to: 'owner' },
    { id: 'indirect', from: 'other', to: 'before' }, { id: 'out2', from: 'owner', to: 'other' });
  const context = parentContext(doc, 'child')!;
  expect(context.parentGraphId).toBe('root');
  expect(context.node.id).toBe('owner');
  expect(context.before.map(n => n.id)).toEqual(['before', 'below']);
  expect(context.after.map(n => n.id)).toEqual(['right', 'other']);
  expect(parentContext(doc, 'root')).toBeUndefined();
  expect(parentContext(doc, 'unknown')).toBeUndefined();
});

test.each([expandedView, layeredView])('%s: empty child flows have a visible frame and no fabricated nodes', build => {
  const doc: AovGraphDocument = { ...emptyGraph, graphs: [graph('root', [node('owner', 'child')]), graph('child', [])] };
  const view = build(doc, 'root');
  expect(view.issues).toEqual([]);
  expect(view.frames).toHaveLength(1);
  expect(view.frames[0].width).toBeGreaterThan(0);
  expect(view.frames[0].height).toBeGreaterThan(0);
  expect(view.nodes.filter(n => n.graphId === 'child')).toEqual([]);
});

test.each([expandedView, layeredView])('%s: frame bounds depend on content size, not distance from the layout origin', build => {
  const doc: AovGraphDocument = { ...emptyGraph, graphs: [graph('root', [node('owner', 'child')]), graph('child', [node('leaf')])],
    layout: { child: { leaf: { x: 1000, y: 2000 } } } };
  const view = build(doc, 'root'), frame = view.frames[0], leaf = view.nodes.find(n => n.id === 'leaf')!;
  expect(frame.width).toBe(64 + 32 * 2);
  expect(frame.height).toBe(64 + 64 + 32);
  expect(toLayoutPosition(leaf, leaf.position)).toEqual({ x: 1000, y: 2000 });
  checkRectangles(doc, view, build === expandedView);
});
