import { useState } from 'react';
import { describeError, type LotGroup, type PreviewApi, type TraceResult } from './previewApi';

// Read-only: looks up one lot number and shows its records and trace chain.
export function LiveTrace({ api }: { api: PreviewApi }) {
  const [lot, setLot] = useState('');
  const [error, setError] = useState('');
  const [groups, setGroups] = useState<LotGroup[]>();
  const [trace, setTrace] = useState<TraceResult>();
  const search = async () => {
    const value = lot.trim();
    if (!value) return;
    try { const [g, t] = await Promise.all([api.lot(value), api.trace(value)]); setGroups(g); setTrace(t); setError(''); }
    catch (e) { setGroups(undefined); setTrace(undefined); setError(describeError(e)); }
  };
  return <div>
    <form onSubmit={e => { e.preventDefault(); void search(); }}>
      <label>批號<input value={lot} onChange={e => setLot(e.target.value)} /></label>
      <button className="primary" type="submit" disabled={!lot.trim()}>查詢批號</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {groups && trace && <section aria-label="查詢結果">
      {groups.length === 0 ? <p role="status">查無此批號的資料。</p> : groups.map((g, i) => <div className="table-scroll" tabIndex={0} role="region" aria-label={`站別：${g.stationName}`} key={i}>
        <table><caption>{g.stationName}</caption><thead><tr><th scope="col">批號</th><th scope="col">內容</th></tr></thead>
          <tbody>{g.records.map(r => <tr key={r.id}><td>{r.lotNo}</td><td>{Object.entries(r.data).map(([k, v]) => `${k}：${v}`).join('；')}</td></tr>)}</tbody></table></div>)}
      <h4>追溯路徑</h4>
      {trace.nodes.length === 0 ? <p>沒有追溯路徑。</p> : <ol>{trace.nodes.map(n => <li key={n.key}>第 {n.depth + 1} 層：{n.stationName}（{n.lotNo}）</li>)}</ol>}
      <p className="column-foot">共 {trace.nodes.length} 個節點、{trace.edgeCount} 條關聯。</p>
    </section>}
  </div>;
}
