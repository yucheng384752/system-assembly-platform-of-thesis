import { useState } from 'react';
import { Column } from './Column';
import { describeEndpoint } from './workflow';
import { addFactory, addLogic, deleteFactory, deleteLogic, renameFactory, renameGraph } from './canvasEditing';
import { MAX_FACTORIES, MAX_LOGICS, MAX_GRAPHS, type AovGraphDocument } from './workflowGraph';

// Where a flow starts (D78, D79): name a factory, then create its production logics. Factories are a list, not part of the canvas.
export function FactoryPage({ value, commit, onOpen }: {
  value: AovGraphDocument; commit: (next: AovGraphDocument) => boolean; onOpen: (logicGraphId: string) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'factory' | 'logic'; id: string }>();
  // Creating a production logic opens its canvas right away, which is where the work continues.
  function createLogic(factoryId: string, doc: AovGraphDocument) {
    const made = addLogic(doc, factoryId, '');
    if (!made) { setError(`每個工廠最多 ${MAX_LOGICS} 個生產邏輯，整份流程最多 ${MAX_GRAPHS} 張圖。`); return; }
    if (commit(made.value)) { setError(''); onOpen(made.graphId); }
  }
  function createFactory() {
    const made = addFactory(value, name);
    if (!made) { setError(`最多 ${MAX_FACTORIES} 個工廠。`); return; }
    setName('');
    createLogic(made.factoryId, made.value);
  }
  const removal = confirm && (confirm.kind === 'factory' ? deleteFactory(value, confirm.id) : deleteLogic(value, confirm.id));
  const summary = removal && <section role="region" aria-label="確認刪除">
    <h4>確認刪除以下內容</h4>
    <ul>
      {confirm!.kind === 'factory' && <li>工廠：{value.factories.find(f => f.id === confirm!.id)?.name}</li>}
      {removal.graphs.map(g => <li key={g.id}>流程：{g.name}</li>)}
      <li>節點：{removal.nodes.length} 個</li>
      {removal.forms.map(f => <li key={f.id}>表單：{f.name}</li>)}
      {removal.relations.map(r => <li key={r.id}>關聯：{describeEndpoint(value, r.from)}至{describeEndpoint(value, r.to)}</li>)}
    </ul>
    <div className="actions">
      <button className="danger" onClick={() => { if (commit(removal.value)) { setConfirm(undefined); setError(''); } }}>確認刪除</button>
      <button onClick={() => setConfirm(undefined)}>取消</button>
    </div>
  </section>;
  return <Column id="factory" title="工廠與生產邏輯" lead="先為工廠命名，再建立生產邏輯；每個生產邏輯是一張獨立的流程圖。" className="factory-page">
    {!value.factories.length && <p>尚未建立工廠。請先輸入工廠名稱，再按「建立生產邏輯」。</p>}
    {value.factories.map(factory => <section className="flow-card" key={factory.id} aria-label={`工廠：${factory.name || '（未命名工廠）'}`}>
      <label>工廠名稱<input value={factory.name} maxLength={100} onChange={e => commit(renameFactory(value, factory.id, e.target.value))} /></label>
      <ul className="step-list">{factory.logicGraphIds.map(id => {
        const logic = value.graphs.find(g => g.id === id);
        return logic && <li key={id}>
          <label>生產邏輯名稱<input value={logic.name} maxLength={100} onChange={e => commit(renameGraph(value, id, e.target.value))} /></label>
          <div className="actions">
            <button onClick={() => onOpen(id)}>開啟<span className="visually-hidden">：{logic.name || '（未命名）'}</span></button>
            <button className="danger" onClick={() => setConfirm({ kind: 'logic', id })}>刪除<span className="visually-hidden">：{logic.name || '（未命名）'}</span></button>
          </div>
          {confirm?.kind === 'logic' && confirm.id === id && summary}
        </li>;
      })}</ul>
      <div className="actions">
        <button disabled={factory.logicGraphIds.length >= MAX_LOGICS} onClick={() => createLogic(factory.id, value)}>建立生產邏輯<span className="visually-hidden">：{factory.name || '（未命名工廠）'}</span></button>
        <button className="danger" onClick={() => setConfirm({ kind: 'factory', id: factory.id })}>刪除工廠<span className="visually-hidden">：{factory.name || '（未命名工廠）'}</span></button>
      </div>
      {confirm?.kind === 'factory' && confirm.id === factory.id && summary}
    </section>)}
    <form className="flow-card" onSubmit={e => { e.preventDefault(); if (name.trim()) createFactory(); }}>
      <label htmlFor="new-factory-name">{value.factories.length ? '新增工廠' : '工廠名稱'}</label>
      <input id="new-factory-name" value={name} maxLength={100} onChange={e => setName(e.target.value)} />
      <button type="submit" disabled={!name.trim() || value.factories.length >= MAX_FACTORIES}>建立生產邏輯<span className="visually-hidden">：新工廠</span></button>
    </form>
    <p role={error ? 'alert' : undefined}>{error}</p>
  </Column>;
}
