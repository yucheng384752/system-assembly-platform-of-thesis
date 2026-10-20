import { useLayoutEffect, useRef, useState } from 'react';
import { Column } from './Column';
import { describeEndpoint } from './workflow';
import { addFactory, addLogic, deleteFactory, deleteLogic, renameFactory, renameGraph } from './canvasEditing';
import { MAX_FACTORIES, MAX_LOGICS, MAX_GRAPHS, type AovGraphDocument } from './workflowGraph';
import { clearExample, exampleHints, hasExample, loadExample } from './exampleHints';
import { useExampleHints } from './ExampleHintSettings';

// Where a flow starts (D78, D79): name a factory, then create its production logics. Factories are a list, not part of the canvas.
export function FactoryPage({ value, commit, onOpen }: {
  value: AovGraphDocument; commit: (next: AovGraphDocument) => boolean; onOpen: (logicGraphId: string) => void;
}) {
  const [showExample, setShowExample] = useState(true);
  const hints = useExampleHints();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'factory' | 'logic' | 'example'; id: string }>();
  const [notice, setNotice] = useState('');
  const focus = useRef('');
  const confirmation = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (confirm?.kind === 'example') confirmation.current?.focus(); }, [confirm]);
  useLayoutEffect(() => {
    if (focus.current) { document.getElementById(focus.current)?.focus(); focus.current = ''; }
  }, [value, confirm, notice]);
  const loaded = hasExample(value);
  function load() {
    try {
      const next = loadExample(value);
      if (next === value) return;
      if (commit(next)) {
        focus.current = `factory-name-${next.factories.at(-1)!.id}`;
        setConfirm(undefined); setError(''); setNotice('已載入範例。');
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '無法載入範例。'); }
  }
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
  const removal = confirm && (confirm.kind === 'example' ? clearExample(value) : confirm.kind === 'factory' ? deleteFactory(value, confirm.id) : deleteLogic(value, confirm.id));
  const summary = removal && <section ref={confirmation} role="region" aria-label="確認刪除" tabIndex={-1}>
    <h4>確認刪除以下內容</h4>
    {confirm!.kind === 'example' && <p>您在範例工廠內新增或修改的內容也會一併清除。</p>}
    <ul>
      {confirm!.kind === 'example' && value.factories.filter(f => f.id.startsWith('example-')).map(f => <li key={f.id}>工廠：{f.name}</li>)}
      {confirm!.kind === 'factory' && <li>工廠：{value.factories.find(f => f.id === confirm!.id)?.name}</li>}
      {removal.graphs.map(g => <li key={g.id}>流程：{g.name}</li>)}
      <li>節點：{removal.nodes.length} 個</li>
      {removal.forms.map(f => <li key={f.id}>表單：{f.name}</li>)}
      {removal.relations.map(r => <li key={r.id}>關聯：{describeEndpoint(value, r.from)}至{describeEndpoint(value, r.to)}</li>)}
    </ul>
    <div className="actions">
      <button className="danger" onClick={() => { if (commit(removal.value)) {
        if (confirm!.kind === 'example') { focus.current = 'load-example'; setNotice('已清除範例。'); }
        setConfirm(undefined); setError('');
      } }}>確認刪除</button>
      <button onClick={() => { if (confirm!.kind === 'example') focus.current = 'clear-example'; setConfirm(undefined); }}>取消</button>
    </div>
  </section>;
  return <Column id="factory" title="工廠與生產邏輯" lead="先為工廠命名，再建立生產邏輯；每個生產邏輯是一張獨立的流程圖。" className="factory-page">
    {!showExample && <button onClick={() => setShowExample(true)}>顯示流程範例</button>}
    <section hidden={!showExample} className="flow-card" aria-label="範例">
      <button aria-label="關閉流程範例" onClick={() => setShowExample(false)}>×</button>
      <div className="actions">
        <button id="load-example" disabled={loaded} aria-describedby="example-state" onClick={load}>載入範例</button>
        <button id="clear-example" className="danger" disabled={!loaded} onClick={() => setConfirm({ kind: 'example', id: '' })}>清除範例</button>
      </div>
      <p id="example-state">{loaded ? '範例已載入，不會重複新增。' : '載入範例只新增，不覆蓋既有資料。'}</p>
      <p role="status">{notice}</p>
      {confirm?.kind === 'example' && summary}
    </section>
    {!value.factories.length && <p>尚未建立工廠。請先輸入工廠名稱，再按「建立生產邏輯」。</p>}
    {value.factories.map(factory => <section className="flow-card" key={factory.id} aria-label={`工廠：${factory.name || '（未命名工廠）'}`}>
      <label>工廠名稱<input id={`factory-name-${factory.id}`} placeholder={hints ? exampleHints.factory : undefined} value={factory.name} maxLength={100} onChange={e => commit(renameFactory(value, factory.id, e.target.value))} /></label>
      <ul className="step-list">{factory.logicGraphIds.map(id => {
        const logic = value.graphs.find(g => g.id === id);
        return logic && <li key={id}>
          <label>生產邏輯名稱<input placeholder={hints ? exampleHints.logic : undefined} value={logic.name} maxLength={100} onChange={e => commit(renameGraph(value, id, e.target.value))} /></label>
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
      <input id="new-factory-name" placeholder={hints ? exampleHints.factory : undefined} value={name} maxLength={100} onChange={e => setName(e.target.value)} />
      <button type="submit" disabled={!name.trim() || value.factories.length >= MAX_FACTORIES}>建立生產邏輯<span className="visually-hidden">：新工廠</span></button>
    </form>
    <p role={error ? 'alert' : undefined}>{error}</p>
  </Column>;
}
