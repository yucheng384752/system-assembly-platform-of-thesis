import { useEffect, useState } from 'react';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { emptyProduction, productionErrors, sampleBatch } from '../../../libs/ui-runtime/production';
import { orderedNodes, type AovGraphDocument } from './workflowGraph';
import { simulationFieldError, emptySimulation, type SimulationSession } from './simulation';
import { productionBindings } from './ProductionPage';
export function WorkflowSimulation({ graph, recipe, session, onChange }: { graph: AovGraphDocument; recipe: Recipe; session: SimulationSession; onChange: (s: SimulationSession) => void }) {
  const [notice, setNotice] = useState('');
  const settings = recipe.productionSettings ?? emptyProduction;
  const signature = JSON.stringify([graph, settings]);
  useEffect(() => { if (session.signature !== signature) { onChange({ ...session, signature, completed: [] }); setNotice('流程或規格更新，完成狀態已重設。'); } }, [signature, session, onChange]);
  const stages = orderedNodes(graph).filter(x => x.node.kind === 'node');
  const selected = stages.find(x => x.node.id === session.active) ?? stages[0];
  if (!selected) return <p>請先在畫布建立作業節點。</p>;
  const { node, graph: current } = selected;
  const form = graph.forms.find(f => f.id === node.formId);
  const product = settings.products.find(p => p.id === session.product) ?? settings.products[0];
  const format = settings.formats.find(f => f.id === (product?.formatId ?? settings.defaultFormatId));
  const values = session.values[node.id] ?? {};
  const update = (id: string, value: string) => { const stale = new Set([node.id]); for (const id of stale) { current.edges.filter(e => e.from === id).forEach(e => stale.add(e.to)); } onChange({ ...session, values: { ...session.values, [node.id]: { ...values, [id]: value } }, completed: session.completed.filter(id => !stale.has(id)) }); setNotice('輸入已更新，此站與後續作業需重新確認。'); };
  return <section aria-label="逐站模擬" className="workflow-simulation"><h3>逐站模擬</h3><p>讀取正式流程表單與驗證規則。僅演練填寫，不執行 AoV 或寫入生產資料。</p>
    {settings.products.length > 0 && <label>模擬產品<select value={product?.id ?? ''} onChange={e => { onChange({ ...session, product: e.target.value, completed: [], values: {} }); setNotice('產品已切換，模擬資料已重設。'); }}>{settings.products.map((p, i) => <option key={i} value={p.id}>{p.name || '未命名產品'}</option>)}</select></label>}
    {format && <p>批號樣本：{sampleBatch(format.pattern, product?.id ?? 'PRODUCT')}</p>}
    <div className="simulation-tabs" aria-label="作業站">{stages.map(({ node: n, graph: g }, i) => <button key={n.id} aria-pressed={n.id === node.id} onClick={() => { onChange({ ...session, active: n.id }); setNotice(''); }}>{i + 1} {n.name}<small>{g.name} · {session.completed.includes(n.id) ? '已完成' : n.id === node.id ? '填寫中' : '待填寫'}</small></button>)}</div>
    <form noValidate onSubmit={e => {
      e.preventDefault(); const errors = [...productionErrors(settings), ...productionBindings(settings, graph), ...(form?.fields.map(f => simulationFieldError(f, values[f.id] ?? '')).filter(Boolean) ?? [])];
      const prior = current.edges.filter(edge => edge.to === node.id).map(edge => current.nodes.find(n => n.id === edge.from)).filter(n => n?.kind === 'node');
      if (prior.some(n => n && !session.completed.includes(n.id))) errors.unshift('請先完成此節點的前置作業；平行作業可各自填寫。');
      if (product && product.formId === form?.id && values[product.fieldId]?.trim()) { const n = Number(values[product.fieldId]); if (product.lower === null || product.upper === null || !Number.isFinite(n) || n < product.lower || n > product.upper) errors.push(`檢驗值超出 ${product.lower} – ${product.upper} ${product.unit}。`); }
      if (errors.length) { setNotice(errors.join(' ')); return; }
      onChange({ ...session, completed: [...new Set([...session.completed, node.id])] }); setNotice(`${node.name}已完成填寫檢查。`);
    }}><h4>{node.name}</h4>{!form ? <p>此節點尚無表單，可確認作業步驟；不模擬設備或外部服務。</p> : form.fields.map(f => <label key={f.id}>{f.name}{f.required ? '（必填）' : ''}{f.type === 'boolean' ? <select value={values[f.id] ?? ''} onChange={e => update(f.id, e.target.value)}><option value="">請選擇</option><option value="true">是</option><option value="false">否</option></select> : <input type={['integer', 'decimal'].includes(f.type) ? 'number' : f.type === 'date' ? 'date' : 'text'} step={f.type === 'integer' ? '1' : 'any'} value={values[f.id] ?? ''} onChange={e => update(f.id, e.target.value)} />}</label>)}
      <p role="status">{notice}</p><div className="actions"><button type="submit">完成此站</button><button type="button" onClick={() => { onChange({ ...emptySimulation, signature }); setNotice('模擬已重設。'); }}>重設模擬</button></div>
    </form></section>;
}
