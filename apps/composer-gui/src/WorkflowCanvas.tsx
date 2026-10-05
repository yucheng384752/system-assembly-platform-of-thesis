import { useLayoutEffect, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { actionCatalog, describeEndpoint, nextId } from './workflow';
import { graphDepths, integrityErrors, MAX_DEPTH, MAX_NODES, suggestActions, type AovGraphDocument } from './workflowGraph';
import { addCanvasNode, connectCanvasNodes, deleteCanvasNode, patchCanvasNode } from './canvasEditing';
import { Column } from './Column';
import { NodeDetails } from './NodeDetails';

type BusinessNode = Node<{ label: string }, 'business'>;
function CircleNode({ data }: NodeProps<BusinessNode>) {
  return <div className="business-node" title={data.label}>
    <Handle type="target" position={Position.Left} aria-label="前置連線" />
    <span>{data.label}</span>
    <Handle type="source" position={Position.Right} aria-label="後續連線" />
  </div>;
}
const nodeTypes = { business: CircleNode };

export function WorkflowCanvas(props: { value: AovGraphDocument; onChange: (value: AovGraphDocument) => void }) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
function Canvas({ value, onChange }: { value: AovGraphDocument; onChange: (value: AovGraphDocument) => void }) {
  const [path, setPath] = useState([value.rootGraphId]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const focus = useRef(false);
  const selectName = useRef(false);
  useLayoutEffect(() => {
    if (focus.current) { const input = document.getElementById('node-name'); input?.focus(); if (selectName.current && input instanceof HTMLInputElement) input.select(); focus.current = false; selectName.current = false; }
  }, [selected, value]);
  const flow = useReactFlow<BusinessNode>();
  const graph = value.graphs.find(g => g.id === path.at(-1)) ?? value.graphs.find(g => g.id === value.rootGraphId)!;
  const node = graph.nodes.find(n => n.id === selected);
  const depth = graphDepths(value).get(graph.id) ?? 1;
  function commit(next: AovGraphDocument) {
    const problems = integrityErrors(next);
    if (problems.length) { setError(problems.join(' ')); return false; }
    onChange(next); setError(''); return true;
  }
  function add(actionId: string | null, position?: { x: number; y: number }) {
    if (graph.nodes.length >= MAX_NODES) { setError('每個流程最多 100 個節點。'); return; }
    if (actionId !== null && !actionCatalog.actions.some(a => a.id === actionId)) return;
    const next = addCanvasNode(value, graph.id, actionId, position);
    if (commit(next)) { focus.current = true; selectName.current = true; setSelected(next.graphs.find(g => g.id === graph.id)!.nodes.at(-1)!.id); setDeleting(false); }
  }
  const removal = node && deleting ? deleteCanvasNode(value, node.id) : undefined;
  return <div className="columns workflow-columns">
    <Column id="canvas-tools" title="工具箱" lead="選擇動作加入畫布，也可拖放至所需位置。">
      {[...actionCatalog.actions, { id: '', name: '業務節點', description: '描述工作內容，不加入系統功能。' }].map(action => <section className="flow-card" key={action.id}
        draggable onDragStart={e => { e.dataTransfer.setData('application/x-workflow-action', action.id || 'business'); e.dataTransfer.effectAllowed = 'copy'; }}>
        <h3>{action.name}</h3><p>{action.description}</p>
        <button disabled={graph.nodes.length >= MAX_NODES} onClick={() => add(action.id || null)}>加入到畫布<span className="visually-hidden">：{action.name}</span></button>
      </section>)}
      <h3>選取節點</h3><ul className="step-list">{graph.nodes.map(n => <li key={n.id}><button aria-current={n.id === selected ? true : undefined} onClick={() => { focus.current = true; setSelected(n.id); setDeleting(false); }}>{n.name || '（未命名節點）'}</button></li>)}</ul>
    </Column>
    <Column id="canvas" title="流程畫布" lead="連線表示先後順序，多條出線表示平行作業。">
      <nav aria-label="流程層級" className="actions">{path.filter(id => value.graphs.some(g => g.id === id)).map((id, index) => <button key={id} aria-current={id === graph.id ? 'location' : undefined} onClick={() => { setPath(path.slice(0, index + 1)); setSelected(''); setDeleting(false); }}>{value.graphs.find(g => g.id === id)!.name}</button>)}</nav>
      <div className="actions"><button onClick={() => void flow.zoomIn({ duration: 0 })}>放大</button><button onClick={() => void flow.zoomOut({ duration: 0 })}>縮小</button><button onClick={() => void flow.fitView({ duration: 0 })}>適合畫面</button></div>
      <div className="workflow-canvas" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => {
        e.preventDefault(); const action = e.dataTransfer.getData('application/x-workflow-action');
        if (action) add(action === 'business' ? null : action, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}>
        <ReactFlow<BusinessNode> nodes={graph.nodes.map((n, i) => ({ id: n.id, type: 'business', data: { label: n.name || '（未命名節點）' },
          position: value.layout[graph.id]?.[n.id] ?? { x: i * 180, y: 0 }, selected: n.id === selected, ariaLabel: n.name || '（未命名節點）' }))}
          edges={graph.edges.map(e => ({ id: e.id, source: e.from, target: e.to, animated: false, focusable: false }))} nodeTypes={nodeTypes}
          deleteKeyCode={null} nodesFocusable edgesFocusable={false} autoPanOnNodeFocus={false}
          ariaLabelConfig={{ 'node.a11yDescription.default': '按 Enter 或空白鍵選取節點，方向鍵移動；先後順序與刪除請使用節點細項。', 'node.a11yDescription.keyboardDisabled': '請使用工具箱選取節點。', 'node.a11yDescription.ariaLiveMessage': ({ x, y }) => `節點已移至橫向 ${x}、縱向 ${y}。`, 'edge.a11yDescription.default': '請在節點細項調整先後順序。', 'handle.ariaLabel': '連線接點' }}
          onNodeClick={(_, n) => { setSelected(n.id); setDeleting(false); }}
          onNodesChange={changes => {
            const positions = changes.filter(c => c.type === 'position').filter(c => c.position);
            if (positions.length) commit({ ...value, layout: { ...value.layout, [graph.id]: { ...value.layout[graph.id], ...Object.fromEntries(positions.map(c => [c.id, c.position!])) } } });
            const picked = changes.find(c => c.type === 'select' && c.selected);
            if (picked?.type === 'select') { setSelected(picked.id); setDeleting(false); }
          }}
          onConnect={c => commit(connectCanvasNodes(value, graph.id, c.source, c.target, true))}
          fitView fitViewOptions={{ duration: 0 }} />
      </div>
      <p role={error ? 'alert' : undefined}>{error}</p>
      {suggestActions(value).map(s => <div key={s.actionId} className="canvas-suggestion note" role="status"><div><p>{s.reason}</p><button disabled={graph.nodes.length >= MAX_NODES} onClick={() => add(s.actionId)}>加入「{actionCatalog.actions.find(a => a.id === s.actionId)!.name}」節點</button></div></div>)}
    </Column>
    <Column id="node-details" title="節點細項" lead="選取節點後設定內容、先後順序與子流程。">
      {!node ? <p>請先加入或選取節點。</p> : <>
        <NodeDetails key={node.id} value={value} node={node} onChange={commit} />
        <fieldset><legend>節點位置</legend>{(['x', 'y'] as const).map(axis => <label key={axis}>{axis === 'x' ? '橫向位置' : '縱向位置'}<input type="number" value={value.layout[graph.id]?.[node.id]?.[axis] ?? 0} onChange={e => {
          if (e.target.value && Number.isFinite(e.target.valueAsNumber)) commit({ ...value, layout: { ...value.layout, [graph.id]: { ...value.layout[graph.id], [node.id]: { ...(value.layout[graph.id]?.[node.id] ?? { x: 0, y: 0 }), [axis]: e.target.valueAsNumber } } } });
        }} /></label>)}</fieldset>
        <fieldset><legend>接續在哪些節點之後</legend>{graph.nodes.filter(n => n.id !== node.id).map(n => <label key={n.id}><input type="checkbox" checked={graph.edges.some(e => e.from === n.id && e.to === node.id)} onChange={e => commit(connectCanvasNodes(value, graph.id, n.id, node.id, e.target.checked))} />{n.name || '（未命名節點）'}</label>)}</fieldset>
        {node.childGraphId ? <button onClick={() => { setPath([...path, node.childGraphId!]); setSelected(''); setDeleting(false); }}>進入子流程</button>
          : <><button disabled={depth >= MAX_DEPTH || value.graphs.length >= 30} aria-describedby="depth-note" onClick={() => {
            const id = nextId('graph', value.graphs);
            commit({ ...patchCanvasNode(value, node.id, { childGraphId: id }), graphs: [...patchCanvasNode(value, node.id, { childGraphId: id }).graphs, { id, name: `${node.name}的子流程`.slice(0, 100), nodes: [], edges: [] }] });
          }}>建立子流程</button><p id="depth-note">{depth >= MAX_DEPTH ? '已達第 3 層，不可再建立子流程。' : value.graphs.length >= 30 ? '整份流程最多 30 個子流程。' : '流程最多 3 層。'}</p></>}
        <button className="danger" onClick={() => setDeleting(true)}>刪除節點</button>
        {removal && <section role="region" aria-label="確認刪除節點"><h3>確認刪除以下內容</h3><ul>
          {removal.nodes.map(n => <li key={n.id}>節點：{n.name}</li>)}{removal.graphs.map(g => <li key={g.id}>子流程：{g.name}</li>)}{removal.forms.map(f => <li key={f.id}>表單：{f.name}</li>)}
          {removal.relations.map(r => <li key={r.id}>關聯：{describeEndpoint(value, r.from)}至{describeEndpoint(value, r.to)}</li>)}
        </ul><p>相關的流程連線也會移除。</p><button className="danger" onClick={() => { if (commit(removal.value)) { setSelected(''); setDeleting(false); } }}>確認刪除</button><button onClick={() => setDeleting(false)}>取消</button></section>}
      </>}
    </Column>
  </div>;
}
