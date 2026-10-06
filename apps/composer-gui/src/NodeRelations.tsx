import { useState } from 'react';
import { describeEndpoint, relationErrors } from './workflow';
import { addRelation, inferCandidates, explainMissedCandidates, traceForm, type Candidate } from './relations';
import { formFactories, type AovGraphDocument } from './workflowGraph';
import { fieldTypes } from './localData';

export function NodeRelations({ value, formId, onChange }: { value: AovGraphDocument; formId: string; onChange: (next: AovGraphDocument) => boolean }) {
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [removing, setRemoving] = useState('');
  const [draft, setDraft] = useState({ fromForm: formId, fromField: '', toForm: '', toField: '' });
  const involved = (r: Candidate) => r.from.formId === formId || r.to.formId === formId;
  const candidates = inferCandidates(value).filter(involved);
  const missed = explainMissedCandidates(value);
  const errors = relationErrors(value);
  const trace = traceForm(value, formId);
  // D81: a relation links forms of one factory only, so only those are offered by hand.
  const factoryOf = formFactories(value);
  const sameFactory = value.forms.filter(f => factoryOf.get(f.id) === factoryOf.get(formId));
  const label = (r: Candidate) => `${describeEndpoint(value, r.from)} → ${describeEndpoint(value, r.to)}`;
  function add(candidate: Candidate, origin: 'inferred' | 'user') {
    if (!involved(candidate)) { setError('請選擇此節點的表單作為關聯其中一端。'); return; }
    const next = addRelation(value, candidate, origin);
    const introduced = relationErrors(next).filter(e => !errors.includes(e));
    if (introduced.length) { setError(`無法建立關聯：${introduced.join(' ')}`); return; }
    if (onChange(next)) { setError(''); setNotice(`已確認關聯：${label(candidate)}。`); }
  }
  return <section aria-labelledby="node-relations-title"><h3 id="node-relations-title">關聯</h3>
    <p>候選需經確認才會生效。名稱忽略空白後須相同、型別相同，且至少一端是識別欄位。上游依流程連線順序判定。</p>
    {candidates.length ? <ul>{candidates.map(c => <li key={label(c)}>{label(c)}<button onClick={() => add(c, 'inferred')}>確認關聯 {label(c)}</button></li>)}</ul> : <p>目前沒有候選關聯。</p>}
    {missed.length > 0 && <section aria-labelledby="missed-title"><h4 id="missed-title">未成為候選的原因</h4><ul>{missed.slice(0, 10).map(reason => <li key={reason}>{reason.replaceAll('請到「表單」', '請到對應節點的「標準表單」')}</li>)}</ul>{missed.length > 10 && <p>另有 {missed.length - 10} 項，請先處理上列項目。</p>}</section>}
    <h4>已確認的關聯</h4>{value.relations.filter(involved).length ? <ul>{value.relations.filter(involved).map(r => <li key={r.id}>{label(r)}（{r.origin === 'inferred' ? '系統推測，已確認' : '手動建立'}）
      <button onClick={() => setRemoving(r.id)}>移除關聯 {label(r)}</button>
      {removing === r.id && <div><p>確認移除關聯：{label(r)}？</p><button onClick={() => { if (onChange({ ...value, relations: value.relations.filter(x => x.id !== r.id) })) { setRemoving(''); setNotice('已移除關聯。'); } }}>確認移除關聯</button><button onClick={() => setRemoving('')}>取消移除關聯</button></div>}
    </li>)}</ul> : <p>尚未確認任何關聯。</p>}
    <fieldset><legend>手動新增關聯</legend>{(['from', 'to'] as const).map(side => <div key={side}>
      <label htmlFor={`${side}-form`}>{side === 'from' ? '上游表單' : '下游表單'}</label><select id={`${side}-form`} value={draft[`${side}Form`]} onChange={e => setDraft({ ...draft, [`${side}Form`]: e.target.value, [`${side}Field`]: '' })}><option value="">請選擇</option>{sameFactory.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select>
      <label htmlFor={`${side}-field`}>{side === 'from' ? '上游欄位' : '下游欄位'}</label><select id={`${side}-field`} value={draft[`${side}Field`]} onChange={e => setDraft({ ...draft, [`${side}Field`]: e.target.value })}><option value="">請選擇</option>{value.forms.find(f => f.id === draft[`${side}Form`])?.fields.map(f => <option value={f.id} key={f.id}>{f.name}（{fieldTypes[f.type]}）</option>)}</select>
    </div>)}<button disabled={!draft.fromField || !draft.toField} onClick={() => add({ from: { formId: draft.fromForm, fieldId: draft.fromField }, to: { formId: draft.toForm, fieldId: draft.toField } }, 'user')}>新增關聯</button></fieldset>
    <p role={error ? 'alert' : undefined}>{error}</p>{errors.length > 0 && <ul role="alert">{errors.map(e => <li key={e}>{e}</li>)}</ul>}<p role="status">{notice}</p>
    {trace && <><h4>追溯檢視</h4><dl><dt>填寫節點</dt><dd>{trace.node?.name || '尚未指派'}</dd><dt>負責職務</dt><dd>{trace.node?.owner || '尚未填寫'}</dd>
      {([['上游表單', trace.upstream], ['下游表單', trace.downstream]] as const).map(([title, links]) => <div key={title}><dt>{title}</dt>{links.length ? links.map(l => <dd key={l.form.id}>{l.form.name}（{l.node?.name || '未指派'}・{l.node?.owner || '未填職務'}），以「{l.via}」相連</dd>) : <dd>無</dd>}</div>)}
    </dl></>}
  </section>;
}
