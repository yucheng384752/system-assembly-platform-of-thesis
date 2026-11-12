import { Handle, Position, MarkerType, type Node, type NodeProps, type Edge } from '@xyflow/react';
import type { NodeKind } from './workflowGraph';
import type { CanvasView, LayeredView } from './canvasView';

export type ViewMode = 'single' | 'expanded' | 'layered';
export type BusinessNode = Node<{ label: string; kind: NodeKind; graphId: string }, 'business'>;
type DecorationNode = Node<{ label: string; graphId: string }, 'frame' | 'band'>;
export type ViewFlowNode = BusinessNode | DecorationNode;

export function CanvasViewSwitch({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  return <fieldset className="canvas-view-switch" role="radiogroup" aria-label="檢視">
    <legend>檢視</legend>
    {([['single', '單層'], ['expanded', '展開'], ['layered', '疊層']] as const).map(([mode, label]) =>
      <label key={mode}><input type="radio" name="canvas-view" checked={value === mode} onChange={() => onChange(mode)} />{label}</label>)}
  </fieldset>;
}

export function FrameNode({ data }: NodeProps<DecorationNode>) {
  return <div className="canvas-view-frame"><strong title={data.label}>{data.label}</strong>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <Handle type="source" position={Position.Right} isConnectable={false} />
    <Handle id="layer" type="target" position={Position.Top} isConnectable={false} />
  </div>;
}
export function BandNode() { return <div className="canvas-view-band" />; }

const frameId = (id: string) => `view-frame:${id}`;

// A fixed end of a reconnected line may be an expanded frame, representing its owner node.
export function viewConnection(view: CanvasView, from: string, to: string, edgeId?: string) {
  const edge = edgeId ? view.edges.find(e => e.id === edgeId) : undefined;
  const endpoint = (id: string, original?: string) => {
    const node = view.nodes.find(n => n.id === id);
    if (node) return { id, graphId: node.graphId };
    const frame = view.frames.find(f => frameId(f.graphId) === id && f.ownerNodeId === original);
    return frame && edge ? { id: frame.ownerNodeId, graphId: edge.graphId } : undefined;
  };
  const source = endpoint(from, edge?.from), target = endpoint(to, edge?.to);
  if (!source || !target || source.graphId !== target.graphId || (edgeId && edge?.graphId !== source.graphId)) return undefined;
  return { graphId: source.graphId, from: source.id, to: target.id };
}

export function flowElements(view: CanvasView | LayeredView, selected: string): { nodes: ViewFlowNode[]; edges: Edge[] } {
  const nodes: ViewFlowNode[] = view.nodes.map(n => ({ id: n.id, type: 'business', data: { label: n.node.name || '（未命名節點）', kind: n.node.kind, graphId: n.graphId },
    position: n.position, selected: n.id === selected, ariaLabel: n.node.name || '（未命名節點）' }));
  nodes.unshift(...view.frames.map((f): DecorationNode => ({ id: frameId(f.graphId), type: 'frame', data: { label: f.title, graphId: f.graphId },
    position: f.position, width: f.width, height: f.height, style: { width: f.width, height: f.height },
    draggable: false, selectable: false, connectable: false, focusable: false, zIndex: -10 + f.depth })));
  const owners = new Map(view.frames.map(f => [f.ownerNodeId, frameId(f.graphId)]));
  const visible = new Set(view.nodes.map(n => n.id));
  const endpoint = (id: string) => visible.has(id) ? id : owners.get(id) ?? id;
  const edges: Edge[] = view.edges.map(e => ({ id: e.id, source: endpoint(e.from), target: endpoint(e.to), type: 'straight',
    reconnectable: true, animated: false, focusable: false, markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#40576a' } }));
  if ('bands' in view) {
    const left = Math.min(0, ...view.nodes.map(n => n.position.x), ...view.frames.map(f => f.position.x)) - 32;
    const right = Math.max(64, ...view.nodes.map(n => n.position.x + 64), ...view.frames.map(f => f.position.x + f.width)) + 32;
    nodes.unshift(...view.bands.map((b): DecorationNode => ({ id: `view-band:${b.depth}`, type: 'band', data: { label: '', graphId: '' },
      position: { x: left, y: b.y }, width: right - left, height: b.height, style: { width: right - left, height: b.height },
      draggable: false, selectable: false, connectable: false, focusable: false, zIndex: -20 })));
    edges.push(...view.links.map(l => ({ id: `view-link:${l.toGraphId}`, source: l.fromNodeId, target: frameId(l.toGraphId), targetHandle: 'layer',
      type: 'straight', className: 'canvas-layer-link', selectable: false, reconnectable: false, focusable: false })));
  }
  return { nodes, edges };
}
