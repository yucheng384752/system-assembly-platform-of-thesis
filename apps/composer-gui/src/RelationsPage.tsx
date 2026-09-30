import { useState } from 'react';
import { fieldTypes } from './localData';
import { describeEndpoint, relationErrors, type AovDocument } from './workflow';
import { addRelation, inferCandidates, traceForm, type Candidate } from './relations';
import { Column } from './Column';
import { Icon } from './Icons';

const emptyDraft = { fromForm: '', fromField: '', toForm: '', toField: '' };
export function RelationsPage({ value, onChange }: { value: AovDocument; onChange: (value: AovDocument) => void }) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [traceId, setTraceId] = useState('');
  const candidates = inferCandidates(value);
  const errors = relationErrors(value);
  const label = (c: Candidate) => `${describeEndpoint(value, c.from)} → ${describeEndpoint(value, c.to)}`;
  // A21: a relation that introduces a new problem (type mismatch, duplicate pair, cycle) is refused and the fields are named.
  function add(candidate: Candidate, origin: 'inferred' | 'user') {
    const next = addRelation(value, candidate, origin);
    const introduced = relationErrors(next).filter(e => !errors.includes(e));
    if (introduced.length) { setError(`無法建立關聯：${introduced.join(' ')}`); setNotice(''); return false; }
    onChange(next); setError(''); setNotice(`已確認關聯：${label(candidate)}。`); return true;
  }
  const fieldsOf = (formId: string) => value.forms.find(f => f.id === formId)?.fields ?? [];
  const trace = traceForm(value, value.forms.some(f => f.id === traceId) ? traceId : value.forms[0]?.id ?? '');
  return <div className="columns">
    <Column id="candidates" title="候選關聯" lead="系統依規則推測，須由你確認才會生效。">
      <p className="muted"><small>條件：欄位名稱相同（忽略空白）、型別相同，且至少一端標為識別欄位。上游依步驟順序決定。</small></p>
      {candidates.length === 0 ? <p className="muted">目前沒有候選關聯。可回到「表單」標示識別欄位，或於中間手動新增。</p>
        : <ul className="check-list">{candidates.map(c => <li key={label(c)}><span>{label(c)}</span>
          <button onClick={() => add(c, 'inferred')}><Icon name="check" />確認<span className="visually-hidden">關聯 {label(c)}</span></button></li>)}</ul>}
    </Column>
    <Column id="relations" title="已確認的關聯" lead="只有已確認的關聯會寫入流程規格。">
      <p id="relation-error" role={error ? 'alert' : undefined}>{error}</p>
      {errors.length > 0 && <div className="note note-warning" role="alert"><Icon name="warning" /><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
      <div className="table-scroll"><table><caption className="visually-hidden">已確認的關聯</caption>
        <thead><tr><th scope="col">上游</th><th scope="col">下游</th><th scope="col">來源</th><th scope="col">操作</th></tr></thead>
        <tbody>{value.relations.length === 0 ? <tr><td colSpan={4}>尚未確認任何關聯。</td></tr> : value.relations.map(r => <tr key={r.id}>
          <td>{describeEndpoint(value, r.from)}</td><td>{describeEndpoint(value, r.to)}</td><td>{r.origin === 'inferred' ? '系統推測，已確認' : '手動建立'}</td>
          <td><button onClick={() => { onChange({ ...value, relations: value.relations.filter(x => x.id !== r.id) }); setError(''); setNotice(`已刪除關聯：${label(r)}。`); }}>
            <Icon name="trash" />刪除<span className="visually-hidden">關聯 {label(r)}</span></button></td>
        </tr>)}</tbody>
      </table></div>
      <p role="status">{notice}</p>
      <fieldset disabled={value.forms.length < 2}><legend><h3>手動新增關聯</h3></legend>
        <div className="form-grid">
          {(['from', 'to'] as const).map(side => <div key={side} style={{ display: 'contents' }}>
            <label htmlFor={`${side}-form`}>{side === 'from' ? '上游表單' : '下游表單'}</label>
            <select id={`${side}-form`} value={draft[`${side}Form`]} onChange={e => setDraft({ ...draft, [`${side}Form`]: e.target.value, [`${side}Field`]: '' })}>
              <option value="">請選擇</option>{value.forms.map(f => <option key={f.id} value={f.id}>{f.name || '（未命名）'}</option>)}
            </select>
            <label htmlFor={`${side}-field`}>{side === 'from' ? '上游欄位' : '下游欄位'}</label>
            <select id={`${side}-field`} value={draft[`${side}Field`]} onChange={e => setDraft({ ...draft, [`${side}Field`]: e.target.value })}>
              <option value="">請選擇</option>{fieldsOf(draft[`${side}Form`]).map(f => <option key={f.id} value={f.id}>{f.name}（{fieldTypes[f.type]}）</option>)}
            </select>
          </div>)}
        </div>
        <button disabled={!draft.fromField || !draft.toField} aria-describedby="relation-error" onClick={() => {
          if (add({ from: { formId: draft.fromForm, fieldId: draft.fromField }, to: { formId: draft.toForm, fieldId: draft.toField } }, 'user')) setDraft(emptyDraft);
        }}><Icon name="plus" />新增關聯</button>
      </fieldset>
    </Column>
    <Column id="trace" title="追溯檢視" lead="檢查任一表單的紀錄可追溯到哪些步驟與表單。">
      {!trace ? <p className="muted">尚未建立表單。</p> : <>
        <label htmlFor="trace-form" className="field-label">表單</label>
        <select id="trace-form" value={trace.form.id} onChange={e => setTraceId(e.target.value)}>
          {value.forms.map(f => <option key={f.id} value={f.id}>{f.name || '（未命名）'}</option>)}
        </select>
        <dl>
          <dt>填寫步驟</dt><dd>{trace.step?.name || '尚未指派'}</dd>
          <dt>負責職務</dt><dd>{trace.step?.owner || '尚未填寫'}</dd>
          {([['上游表單', trace.upstream], ['下游表單', trace.downstream]] as const).map(([title, links]) => <div key={title}>
            <dt>{title}</dt>{links.length ? links.map(l => <dd key={l.form.id}>{l.form.name}（{l.step?.name || '未指派'}・{l.step?.owner || '未填職務'}），以「{l.via}」相連</dd>) : <dd>無</dd>}
          </div>)}
        </dl>
      </>}
    </Column>
  </div>;
}
