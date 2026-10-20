import { addIndustryTemplate, industryTemplates } from './industryTemplates';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Handle, MarkerType, Position, ConnectionLineType, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { actionCatalog, describeEndpoint } from './workflow';
import { graphDepths, graphPlaces, integrityErrors, MAX_DEPTH, MAX_GRAPHS, MAX_NODES, suggestActions, type AovGraphDocument, type GraphNode, type NodeKind } from './workflowGraph';
import { addCanvasNode, addChildGraph, connectCanvasNodes, reconnectCanvasEdge, deleteCanvasNode } from './canvasEditing';
import { Column } from './Column';
import { FactoryPage } from './FactoryPage';
import { Icon } from './Icons';
import { NodeDetails } from './NodeDetails';
import { ExampleHintProvider, ExampleHintSwitch } from './ExampleHintSettings';

// Press and release within this many pixels is a click (selects, opens the details); moving further is a drag (moves the node and nothing else).
const DRAG_PX = 4;
type BusinessNode = Node<{ label: string; kind: NodeKind }, 'business'>;
function CircleNode({ data }: NodeProps<BusinessNode>) {
  return <div className={`business-node business-node-${data.kind}`} title={data.label}>
    {data.kind !== 'start' && <Handle type="target" position={Position.Left} aria-label="前置連線" />}
    <span>{data.label}</span>
    {data.kind !== 'end' && <Handle type="source" position={Position.Right} aria-label="後續連線" />}
  </div>;
}
const nodeTypes = { business: CircleNode };

// path: the opened graphs, kept by the caller so leaving the step and coming back returns to the same flow; empty means the factory list (D79).
interface CanvasProps { value: AovGraphDocument; onChange: (value: AovGraphDocument) => void; path: string[]; onPathChange: (path: string[]) => void; toolbarExtra?: ReactNode; resetKey?: number; locate?: { nodeId: string; fieldId?: string; request: number } }
export function WorkflowCanvas(props: CanvasProps) {
  return <ExampleHintProvider><ReactFlowProvider><Canvas {...props} /></ReactFlowProvider></ExampleHintProvider>;
}
// Tools grouped by the category each action declares (catalog order); the business node, which adds no function, is its own group.
const toolGroups: [string, { id: string; name: string }[]][] = (() => {
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const action of actionCatalog.actions) groups.set(action.category, [...(groups.get(action.category) ?? []), action]);
  groups.set('一般', [...(groups.get('一般') ?? []), { id: '', name: '業務節點' }]);
  return [...groups];
})();
function Canvas({ value, onChange, path, onPathChange: setPath, toolbarExtra, resetKey = 0, locate }: CanvasProps) {
  const [industry, setIndustry] = useState('');
  const [toolSearch, setToolSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  // The toolbox opens in two steps, category then tool (D85); all categories start closed.
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const focus = useRef(false);
  // True from the moment a drag really starts until just after it ends: the click the browser sends when the button is released over
  // the dragged node must not select it or open its details (D87).
  const dragged = useRef(false);
  const selectName = useRef(false);
  useLayoutEffect(() => {
    if (focus.current) { const input = document.getElementById('node-name'); input?.focus(); if (selectName.current && input instanceof HTMLInputElement) input.select(); focus.current = false; selectName.current = false; }
  }, [selected, value]);
  const flow = useReactFlow<BusinessNode>();
  // A new import replaces the document: clear the selection (the caller resets the path; the toolbar, with its import notices, stays mounted).
  useEffect(() => { setSelected(''); setDeleting(false); setError(''); }, [resetKey]);
  const graph = value.graphs.find(g => g.id === path.at(-1));
  const node = graph?.nodes.find(n => n.id === selected);
  const centerRequest = useRef(false);
  useEffect(() => { if (locate && graph?.nodes.some(n => n.id === locate.nodeId)) { setSelected(locate.nodeId); setDeleting(false); centerRequest.current = true; } }, [locate, graph?.id]);
  useEffect(() => {
    if (!graph || !selected || !centerRequest.current) return;
    let frame = 0, stopped = false, attempts = 0;
    const center = () => {
      if (stopped) return;
      const n = flow.getNode(selected);
      if ((!n?.measured?.width || !n?.measured?.height) && attempts++ < 60) { frame = requestAnimationFrame(center); return; }
      if (!n) return;
      centerRequest.current = false;
      void flow.setCenter(n.position.x + 32, n.position.y + 32, { zoom: flow.getZoom(), duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 });
      const field = locate?.fieldId && document.getElementById(`${locate.fieldId}-name`);
      (field || document.getElementById('node-name'))?.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(center); return () => { stopped = true; cancelAnimationFrame(frame); };
  }, [selected, graph?.id, locate, flow]);

  function commit(next: AovGraphDocument) {
    const problems = integrityErrors(next);
    if (problems.length) { setError(problems.join(' ')); return false; }
    onChange(next); setError(''); return true;
  }
  if (!graph) return <div className="workflow-page"><div className="canvas-toolbar">{null}<div><ExampleHintSwitch />{toolbarExtra}</div>{null}</div><FactoryPage value={value} commit={commit} onOpen={id => { setPath([id]); setSelected(''); setDeleting(false); }} /></div>;
  const place = graphPlaces(value).get(graph.id);
  const depth = place?.depth ?? 1;
  const add = (actionId: string | null, position?: { x: number; y: number }) => {
    if (graph.nodes.length >= MAX_NODES) { setError('每個流程最多 100 個節點。'); return; }
    if (actionId !== null && !actionCatalog.actions.some(a => a.id === actionId)) return;
    const next = addCanvasNode(value, graph.id, actionId, position);
    if (commit(next)) { focus.current = true; selectName.current = true; setSelected(next.graphs.find(g => g.id === graph.id)!.nodes.at(-1)!.id); setDeleting(false); }
  };
  const removal = node && deleting ? deleteCanvasNode(value, node.id) : undefined;
  // Details exist only while a node is selected, so the canvas keeps the whole width otherwise.
  const closeDetails = () => {
    setSelected(''); setDeleting(false);
    const heading = document.getElementById('canvas-title'); heading?.setAttribute('tabindex', '-1'); heading?.focus();
  };
  // Lines are edited on the node they lead to; the end cannot be a predecessor and the start has none (D80).
  const predecessors = (target: GraphNode) => <fieldset><legend>接續在哪些節點之後</legend>{graph.nodes.filter(n => n.id !== target.id && n.kind !== 'end').map(n => <label key={n.id}><input type="checkbox" checked={graph.edges.some(e => e.from === n.id && e.to === target.id)} onChange={e => commit(connectCanvasNodes(value, graph.id, n.id, target.id, e.target.checked))} />{n.name || '（未命名節點）'}</label>)}</fieldset>;
  // The toolbar sits in the same slot for the factory list and the canvas, so the import button keeps its panel and notices when the view changes.
  return <div className="workflow-page">
    <div className="canvas-toolbar"><nav aria-label="流程層級" className="actions"><button onClick={() => { setPath([]); setSelected(''); setDeleting(false); }}>工廠</button><span className="crumb">{place?.factory.name || '（未命名工廠）'}</span>{path.filter(id => value.graphs.some(g => g.id === id)).map((id, index) => <button key={id} aria-current={id === graph.id ? 'location' : undefined} onClick={() => { setPath(path.slice(0, index + 1)); setSelected(''); setDeleting(false); }}>{value.graphs.find(g => g.id === id)!.name}</button>)}</nav>
      <div><ExampleHintSwitch />{toolbarExtra}</div>
      <div className="actions canvas-zoom"><button onClick={() => void flow.zoomIn({ duration: 0 })}>放大</button><button onClick={() => void flow.zoomOut({ duration: 0 })}>縮小</button><button onClick={() => void flow.fitView({ duration: 0 })}>適合畫面</button></div></div>
    <div className={node ? 'columns workflow-columns has-details' : 'columns workflow-columns'}>
    <Column id="canvas-tools" title="工具箱" lead="選擇動作加入畫布，也可拖放至所需位置。" className="workflow-tools" scroll>
      <details><summary>產業紀錄範本（{industryTemplates.length}）</summary>
        <p>提供表單欄位起點；使用既有表單功能，不代表設備控制、庫存或簽核引擎。加入後請確認欄位型別、必填與規格。</p>
        <label>搜尋產業節點<input type="search" value={toolSearch} onChange={e => setToolSearch(e.target.value)} /></label>
        <label>產業分類<select value={industry} onChange={e => setIndustry(e.target.value)}><option value="">全部</option>{[...new Set(industryTemplates.map(t => t.industry))].map(i => <option key={i}>{i}</option>)}</select></label>
        {industryTemplates.filter(t => (!industry || t.industry === industry) && t.name.includes(toolSearch)).map(t => <div className="tool-card" key={t.id}><span>{t.name}</span><button aria-label={`加入產業節點：${t.name}`} onClick={() => { try { const next = addIndustryTemplate(value, graph.id, t.id); if (commit(next)) { setSelected(next.graphs.find(g => g.id === graph.id)!.nodes.at(-1)!.id); centerRequest.current = true; } } catch (error) { setError(error instanceof Error ? error.message : '無法新增範本'); } }}>＋</button></div>)}
      </details>
      {toolGroups.map(([group, tools], index) => {
        const open = openGroups.includes(group);
        return <section className="tool-group" key={group}>
          <h3><button aria-expanded={open} aria-controls={`tool-group-${index}`} onClick={() => setOpenGroups(open ? openGroups.filter(g => g !== group) : [...openGroups, group])}><Icon name="chevron" className="group-icon" />{group}</button></h3>
          <div id={`tool-group-${index}`} hidden={!open}>
            {tools.map(action => <section className="flow-card tool-card" key={action.id}
              draggable onDragStart={e => { e.dataTransfer.setData('application/x-workflow-action', action.id || 'business'); e.dataTransfer.effectAllowed = 'copy'; }}>
              <h4>{action.name}</h4>
              <button className="icon-button" title={`加入到畫布：${action.name}`} disabled={graph.nodes.length >= MAX_NODES} onClick={() => add(action.id || null)}><Icon name="plus" /><span className="visually-hidden">加入到畫布：{action.name}</span></button>
            </section>)}
          </div>
        </section>;
      })}
      <h3>選取節點</h3><ul className="step-list">{graph.nodes.map(n => <li key={n.id}><button aria-current={n.id === selected ? true : undefined} onClick={() => { centerRequest.current = true; focus.current = true; setSelected(n.id); setDeleting(false); }}>{n.name || '（未命名節點）'}</button></li>)}</ul>
    </Column>
    <Column id="canvas" title="流程畫布" lead="連線表示先後順序，多條出線表示平行作業。" className="workflow-canvas-column">
      <div className="workflow-canvas" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => {
        e.preventDefault(); const action = e.dataTransfer.getData('application/x-workflow-action');
        if (action) add(action === 'business' ? null : action, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}>
        <ReactFlow<BusinessNode> key={`${resetKey}:${graph.id}`} nodes={graph.nodes.map((n, i) => ({ id: n.id, type: 'business', data: { label: n.name || '（未命名節點）', kind: n.kind },
          position: value.layout[graph.id]?.[n.id] ?? { x: i * 180, y: 0 }, selected: n.id === selected, ariaLabel: n.name || '（未命名節點）' }))}
          edges={graph.edges.map(e => ({ id: e.id, source: e.from, target: e.to, type: 'straight', reconnectable: true, animated: false, focusable: false, markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#40576a' } }))} nodeTypes={nodeTypes}
          deleteKeyCode={null} selectNodesOnDrag={false} nodeDragThreshold={DRAG_PX} nodeClickDistance={DRAG_PX} nodesFocusable edgesFocusable={false} autoPanOnNodeFocus={false}
          ariaLabelConfig={{ 'node.a11yDescription.default': '按 Enter 或空白鍵選取節點，方向鍵移動；先後順序與刪除請使用節點細項。', 'node.a11yDescription.keyboardDisabled': '請使用工具箱選取節點。', 'node.a11yDescription.ariaLiveMessage': ({ x, y }) => `節點已移至橫向 ${x}、縱向 ${y}。`, 'edge.a11yDescription.default': '請在節點細項調整先後順序。', 'handle.ariaLabel': '連線接點' }}
          onNodeDragStart={() => { dragged.current = true; }}
          onNodeDragStop={() => { window.setTimeout(() => { dragged.current = false; }, 0); }}
          onNodeClick={(_, n) => { if (dragged.current) return; setSelected(n.id); setDeleting(false); }}
          onNodesChange={changes => {
            const positions = changes.filter(c => c.type === 'position').filter(c => c.position);
            if (positions.length) commit({ ...value, layout: { ...value.layout, [graph.id]: { ...value.layout[graph.id], ...Object.fromEntries(positions.map(c => [c.id, c.position!])) } } });
            const picked = changes.find(c => c.type === 'select' && c.selected);
            if (picked?.type === 'select' && !dragged.current) { setSelected(picked.id); setDeleting(false); }
          }}
          edgesReconnectable reconnectRadius={28} connectionLineType={ConnectionLineType.Straight}
          onReconnect={(edge, connection) => commit(reconnectCanvasEdge(value, graph.id, edge.id, connection.source, connection.target))}
          onConnect={c => commit(connectCanvasNodes(value, graph.id, c.source, c.target, true))}
          onPaneClick={() => { setSelected(''); setDeleting(false); }}
          fitView fitViewOptions={{ duration: 0 }} />
      </div>
      <p role={error ? 'alert' : undefined}>{error}</p>
      {suggestActions(value).map(s => <div key={s.actionId} className="canvas-suggestion note" role="status"><div><p>{s.reason}</p><button disabled={graph.nodes.length >= MAX_NODES} onClick={() => add(s.actionId)}>加入「{actionCatalog.actions.find(a => a.id === s.actionId)!.name}」節點</button></div></div>)}
    </Column>
    {node && <Column id="node-details" title="節點細項" lead="設定內容、先後順序與子流程。" className="workflow-details" scroll aside={<button onClick={closeDetails}>關閉細項</button>}>
      <>
        {node.kind !== 'node' ? <><p>「{node.name}」由系統建立，每個流程各有一個，不能修改或刪除。</p>{node.kind === 'end' && predecessors(node)}</> : <>
        <NodeDetails key={node.id} value={value} node={node} onChange={commit} />
        {predecessors(node)}
        {node.childGraphId ? <button onClick={() => { setPath([...path, node.childGraphId!]); setSelected(''); setDeleting(false); }}>進入子流程</button>
          : <><button disabled={depth >= MAX_DEPTH || value.graphs.length >= MAX_GRAPHS} aria-describedby="depth-note" onClick={() => { const next = addChildGraph(value, node.id); if (commit(next)) { const child = next.graphs.find(g => g.id === graph.id)!.nodes.find(n => n.id === node.id)!.childGraphId; if (child) { setPath([...path, child]); setSelected(''); setDeleting(false); } } }}>建立子流程</button><p id="depth-note">{depth >= MAX_DEPTH ? '已達第 3 層，不可再建立子流程。' : value.graphs.length >= MAX_GRAPHS ? `整份流程最多 ${MAX_GRAPHS} 張圖。` : '流程最多 3 層。'}</p></>}
        <button className="danger" onClick={() => setDeleting(true)}>刪除節點</button>
        {removal && <section role="region" aria-label="確認刪除節點"><h3>確認刪除以下內容</h3><ul>
          {removal.nodes.map(n => <li key={n.id}>節點：{n.name}</li>)}{removal.graphs.map(g => <li key={g.id}>子流程：{g.name}</li>)}{removal.forms.map(f => <li key={f.id}>表單：{f.name}</li>)}
          {removal.relations.map(r => <li key={r.id}>關聯：{describeEndpoint(value, r.from)}至{describeEndpoint(value, r.to)}</li>)}
        </ul><p>相關的流程連線也會移除。</p><div className="actions"><button className="danger" onClick={() => { if (commit(removal.value)) { setSelected(''); setDeleting(false); } }}>確認刪除</button><button onClick={() => setDeleting(false)}>取消</button></div></section>}
        </>}
      </>
    </Column>}
    </div>
  </div>;
}
