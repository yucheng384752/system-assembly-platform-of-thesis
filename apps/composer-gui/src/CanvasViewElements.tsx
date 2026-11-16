import { BaseEdge, Handle, Position, MarkerType, type Node, type NodeProps, type Edge, type EdgeProps } from '@xyflow/react';
import { isSequence, type AovGraphDocument, type GraphEdge, type NodeKind } from './workflowGraph';
import { formGaps, type CanvasView, type FormGaps, type LayeredView, type ViewEdge } from './canvasView';
import { Icon } from './Icons';

export type ViewMode = 'single' | 'expanded' | 'layered';
// layerSource: the node owns a sub-flow frame in the layered view, so its correspondence line leaves from below it.
export type BusinessNode = Node<{ label: string; kind: NodeKind; graphId: string; layerSource?: boolean }, 'business'>;
type DecorationNode = Node<{ label: string; graphId: string; gap?: string }, 'frame' | 'band'>;
export type ViewFlowNode = BusinessNode | DecorationNode;

export function CanvasViewSwitch({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  return <fieldset className="canvas-view-switch" role="radiogroup" aria-label="檢視">
    <legend>檢視</legend>
    {([['single', '單層'], ['expanded', '展開'], ['layered', '疊層']] as const).map(([mode, label]) =>
      <label key={mode}><input type="radio" name="canvas-view" checked={value === mode} onChange={() => onChange(mode)} />{label}</label>)}
  </fieldset>;
}

// Which kind of line a drag on the canvas draws (D208). Shown only where a sub-flow is on the canvas: the top layer has sequence lines only.
export type EdgeKindChoice = 'sequence' | NonNullable<GraphEdge['kind']>;
export function CanvasEdgeKindSwitch({ value, onChange }: { value: EdgeKindChoice; onChange: (kind: EdgeKindChoice) => void }) {
  return <fieldset className="canvas-view-switch" role="radiogroup" aria-label="連線種類">
    <legend>連線種類</legend>
    {([['sequence', '先後'], ['dataflow', '資料流']] as const).map(([kind, label]) =>
      <label key={kind}><input type="radio" name="canvas-edge-kind" checked={value === kind} onChange={() => onChange(kind)} />{label}</label>)}
  </fieldset>;
}

export function FrameNode({ data }: NodeProps<DecorationNode>) {
  return <div className="canvas-view-frame"><strong title={data.label}>{data.label}</strong>
    {data.gap && <span className="canvas-view-gap" title={data.gap}><Icon name="warning" />{data.gap}</span>}
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <Handle type="source" position={Position.Right} isConnectable={false} />
    <Handle id="layer" type="target" position={Position.Top} isConnectable={false} />
  </div>;
}
export function BandNode() { return <div className="canvas-view-band" />; }

// A dataflow line between two nodes that also have a sequence line would lie exactly on it. It is still one straight segment
// decided by the two nodes, drawn a few pixels to the side so both stay visible.
const BESIDE = 6;
export function DataflowBesideEdge({ sourceX, sourceY, targetX, targetY, markerEnd }: EdgeProps) {
  const length = Math.hypot(targetX - sourceX, targetY - sourceY) || 1;
  const dx = -(targetY - sourceY) / length * BESIDE, dy = (targetX - sourceX) / length * BESIDE;
  return <BaseEdge path={`M ${sourceX + dx},${sourceY + dy} L ${targetX + dx},${targetY + dy}`} markerEnd={markerEnd} />;
}
export const edgeTypes = { dataflowBeside: DataflowBesideEdge };

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

// The short text beside a frame title; empty when the sub-flow has neither a gap nor a line without a chosen form.
export function gapSummary({ gaps, unassigned }: FormGaps): string {
  return [gaps.length ? `缺口 ${gaps.length} 項` : '', unassigned ? `尚未指定表單 ${unassigned} 條` : ''].filter(Boolean).join('，');
}
export function frameGapSummaries(doc: AovGraphDocument, view: CanvasView): Map<string, string> {
  return new Map(view.frames.flatMap(f => { const text = gapSummary(formGaps(doc, f.ownerNodeId)); return text ? [[f.graphId, text] as [string, string]] : []; }));
}

// The item-by-item list for every frame that has something to say. It sits outside the canvas so it opens from the keyboard.
export function FrameGapList({ doc, view }: { doc: AovGraphDocument; view: CanvasView }) {
  const formName = (id: string) => doc.forms.find(f => f.id === id)?.name.trim() || '（未命名表單）';
  const text = {
    input: { missing: (name: string) => `輸入缺少「${name}」：上一層的前置節點有這張表單，子流程的「開始」沒有傳出。`, extra: (name: string) => `輸入多出「${name}」：子流程的「開始」傳出這張表單，上一層的前置節點沒有。` },
    output: { missing: (name: string) => `輸出缺少「${name}」：上一層節點的這張表單沒有傳到子流程的「結束」。`, extra: (name: string) => `輸出多出「${name}」：傳到子流程「結束」的這張表單不是上一層節點的表單。` },
  };
  const items = view.frames.map(frame => ({ frame, result: formGaps(doc, frame.ownerNodeId) })).filter(x => gapSummary(x.result));
  if (!items.length) return null;
  return <section className="canvas-gaps" aria-label="表單輸入與輸出缺口">
    {items.map(({ frame, result }) => <details key={frame.graphId}>
      <summary><Icon name="warning" className="canvas-gap-icon" />「{frame.title}」的表單輸入與輸出缺口：{gapSummary(result)}</summary>
      <ul>
        {result.gaps.map(gap => <li key={`${gap.direction}-${gap.kind}-${gap.formId}`}>{text[gap.direction][gap.kind](formName(gap.formId))}</li>)}
        {result.unassigned > 0 && <li>尚未指定表單 {result.unassigned} 條：這些資料流連線還沒有選擇傳遞的表單。</li>}
      </ul>
    </details>)}
    <p>這是畫布上的提示：只比對表單是否相同，不比對欄位、型別與版本，也不代表已完成計畫的輸入輸出檢查；不影響顯示、編輯與輸出。</p>
  </section>;
}

const arrow = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#40576a' };
const pairKey = (e: ViewEdge) => `${e.graphId}:${[e.from, e.to].sort().join('>')}`;

export function flowElements(view: CanvasView | LayeredView, selected: string, gaps?: Map<string, string>): { nodes: ViewFlowNode[]; edges: Edge[] } {
  const layerOwners = new Set('bands' in view ? view.links.map(l => l.fromNodeId) : []);
  const nodes: ViewFlowNode[] = view.nodes.map(n => ({ id: n.id, type: 'business', data: { label: n.node.name || '（未命名節點）', kind: n.node.kind, graphId: n.graphId, ...(layerOwners.has(n.id) ? { layerSource: true } : {}) },
    position: n.position, selected: n.id === selected, ariaLabel: n.node.name || '（未命名節點）' }));
  nodes.unshift(...view.frames.map((f): DecorationNode => ({ id: frameId(f.graphId), type: 'frame', data: { label: f.title, graphId: f.graphId, ...(gaps?.get(f.graphId) ? { gap: gaps.get(f.graphId) } : {}) },
    position: f.position, width: f.width, height: f.height, style: { width: f.width, height: f.height },
    draggable: false, selectable: false, connectable: false, focusable: false, zIndex: -10 + f.depth })));
  const owners = new Map(view.frames.map(f => [f.ownerNodeId, frameId(f.graphId)]));
  const visible = new Set(view.nodes.map(n => n.id));
  const endpoint = (id: string) => visible.has(id) ? id : owners.get(id) ?? id;
  const sequencePairs = new Set(view.edges.filter(isSequence).map(pairKey));
  // A dataflow line is dashed (D208); both kinds are single straight segments with the same arrow.
  const edges: Edge[] = view.edges.map(e => ({ id: e.id, source: endpoint(e.from), target: endpoint(e.to),
    type: !isSequence(e) && sequencePairs.has(pairKey(e)) ? 'dataflowBeside' : 'straight', ...(isSequence(e) ? {} : { className: 'canvas-dataflow-edge' }),
    reconnectable: true, animated: false, focusable: false, markerEnd: arrow }));
  if ('bands' in view) {
    const left = Math.min(0, ...view.nodes.map(n => n.position.x), ...view.frames.map(f => f.position.x)) - 32;
    const right = Math.max(64, ...view.nodes.map(n => n.position.x + 64), ...view.frames.map(f => f.position.x + f.width)) + 32;
    nodes.unshift(...view.bands.map((b): DecorationNode => ({ id: `view-band:${b.depth}`, type: 'band', data: { label: '', graphId: '' },
      position: { x: left, y: b.y }, width: right - left, height: b.height, style: { width: right - left, height: b.height },
      draggable: false, selectable: false, connectable: false, focusable: false, zIndex: -20 })));
    // The correspondence line runs from below the upper node to the top of its sub-flow frame.
    edges.push(...view.links.map(l => ({ id: `view-link:${l.toGraphId}`, source: l.fromNodeId, sourceHandle: 'layer', target: frameId(l.toGraphId), targetHandle: 'layer',
      type: 'straight', className: 'canvas-layer-link', selectable: false, reconnectable: false, focusable: false })));
  }
  return { nodes, edges };
}
