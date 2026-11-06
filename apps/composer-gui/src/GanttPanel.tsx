import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { downloadBlob } from './fileTransfer';
import { branchPoints, estimateGraphGantt, type BranchChoices } from './graphGantt';
import { renderGanttSvg } from '../../../libs/planning/ganttSvg';
import type { Graph } from './workflowGraph';

// Gantt estimate of the open graph. The picture is shown as an image from a data URI, never injected as HTML, and is only
// downloaded: it is not written into the delivery package. 可改善項目見 docs/decision-log.md。
export function GanttPanel({ graph, onLocate, onClose }: { graph: Graph; onLocate: (nodeId: string) => void; onClose: () => void }) {
  const [choices, setChoices] = useState<BranchChoices>({});
  // A choice whose line was deleted since is dropped here, so the estimate never fails on a stale choice.
  const valid = useMemo(() => Object.fromEntries(Object.entries(choices).filter(([nodeId, edgeId]) => graph.edges.some(e => e.id === edgeId && e.from === nodeId))), [choices, graph.edges]);
  const result = useMemo(() => estimateGraphGantt(graph, valid), [graph, valid]);
  const points = useMemo(() => branchPoints(graph, valid), [graph, valid]);
  const svg = result.ok ? renderGanttSvg(result) : '';
  const choose = (nodeId: string, edgeId: string) => setChoices(edgeId === '' ? Object.fromEntries(Object.entries(valid).filter(([id]) => id !== nodeId)) : { ...valid, [nodeId]: edgeId });
  return <Modal title={`甘特圖：${graph.name.trim() || '流程'}`} onClose={onClose}>
    <p>依節點的標準工時與連線的移轉時間估算，只供參考，不是排程。多條出線預設視為平行；可在下方指定只走其中一條。</p>
    {points.length > 0 && <fieldset><legend>分支選擇</legend>{points.map(p => <div key={p.nodeId}>
      <label htmlFor={`branch-${p.nodeId}`}>「{p.name}」之後</label>
      <select id={`branch-${p.nodeId}`} value={valid[p.nodeId] ?? ''} onChange={e => choose(p.nodeId, e.target.value)}>
        <option value="">全部平行進行</option>
        {p.edges.map(e => <option key={e.id} value={e.id}>只走「{e.toName}」</option>)}
      </select>
    </div>)}</fieldset>}
    {!result.ok && <section role="alert" aria-label="尚無法產生甘特圖"><h4>尚無法產生甘特圖</h4><ul>{result.errors.map((e, i) => <li key={i}>{e.message}
      {e.nodeId && <> <button onClick={() => { onLocate(e.nodeId!); onClose(); }}>前往填寫</button></>}</li>)}</ul></section>}
    {result.ok && <>
      <img alt={`甘特圖，總時長 ${result.total ?? '未知'} 分鐘，共 ${result.rows.length} 個項目`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} style={{ maxWidth: '100%' }} />
      <div className="actions"><button className="primary" onClick={() => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `gantt-${graph.id}.svg`)}>下載 SVG</button></div>
    </>}
  </Modal>;
}
