import { useRef, useState } from 'react';
import { UNITS } from '../../../libs/aov-core';
import { draftFormsFromCsv } from '../../../libs/aov-integration/formCsvImport';
import { blankField, blankForm, editIssues, FIELD_TYPE_LABEL, fromDraft, fromFormDef, toFormDef, type EditField, type EditForm } from '../../../libs/aov-integration/formEdit';
import { FORM_ID_PATTERN, type FormLibrary } from '../../../libs/aov-integration/formLibrary';
import { materialTypeId, type MaterialType } from '../../../libs/aov-integration/projectDetails';
import type { AttrValueType } from '../../../libs/aov-core';
import { Icon } from './Icons';

const TYPES = Object.keys(FIELD_TYPE_LABEL) as AttrValueType[];
const UNIT_NAMES = Object.keys(UNITS);

// The form library as the engineer sees it: customer forms come in as CSV or are typed in, then keys, units and subject are set by hand.
export function FormLibraryPanel({ forms, materials, usedFormIds, onChange }: {
  forms: FormLibrary; materials: MaterialType[]; usedFormIds: Set<string>; onChange: (next: FormLibrary) => void;
}) {
  const [editing, setEditing] = useState<{ existing: boolean; form: EditForm }>();
  const [queue, setQueue] = useState<EditForm[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  const next = (rest: EditForm[]) => { setEditing(rest.length ? { existing: false, form: rest[0] } : undefined); setQueue(rest.slice(1)); };
  const setForm = (patch: Partial<EditForm>) => editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });
  const setField = (index: number, patch: Partial<EditField>) => editing && setForm({ fields: editing.form.fields.map((f, i) => i === index ? { ...f, ...patch } : f) });

  async function upload(file: File | undefined) {
    if (!file) return;
    const result = draftFormsFromCsv(await file.text());
    if (picker.current) picker.current.value = '';
    if (!result.ok) { setProblems(result.errors.map(e => `${file.name}：${e}`)); return; }
    setProblems([]);
    next(result.drafts.map(fromDraft));
  }

  const formIssues = editing ? editIssues(editing.form) : [];
  const duplicate = editing && !editing.existing && editing.form.id && forms.forms.some(f => f.id === editing.form.id);
  const issues = [...formIssues, ...(duplicate ? [`表單識別碼「${editing!.form.id}」已經在表單庫裡。`] : [])];

  function save() {
    if (!editing || issues.length) return;
    const def = toFormDef(editing.form);
    onChange({ ...forms, forms: editing.existing ? forms.forms.map(f => f.id === def.id ? def : f) : [...forms.forms, def] });
    next(queue);
  }

  return <section aria-labelledby="form-library-title">
    <h3 id="form-library-title">表單庫</h3>
    <p>客戶提供的表單：上傳 CSV 或手動新增，再補上識別碼、單位與描述的對象。</p>
    {forms.forms.map(form => {
      const inUse = usedFormIds.has(form.id);
      return <fieldset key={form.id}><legend>{form.name}</legend>
        <p>{Object.keys(form.fields).length} 個欄位{inUse ? '，已有節點使用' : ''}</p>
        <button disabled={Boolean(editing)} onClick={() => setEditing({ existing: true, form: fromFormDef(form) })}>編輯表單</button>
        <button disabled={inUse} aria-describedby={inUse ? `form-${form.id}-in-use` : undefined} onClick={() => onChange({ ...forms, forms: forms.forms.filter(f => f.id !== form.id) })}>移除表單</button>
        {inUse && <p id={`form-${form.id}-in-use`}>已有節點使用，請先改掉節點的選擇再移除。</p>}
      </fieldset>;
    })}
    {!editing && <div className="actions">
      <label className="file-button">上傳 CSV<input ref={picker} className="visually-hidden" type="file" accept=".csv,text/csv" aria-label="上傳客戶表單 CSV" onChange={e => void upload(e.target.files?.[0])} /></label>
      <button onClick={() => { setProblems([]); next([blankForm()]); }}>新增空白表單</button>
    </div>}
    {problems.length > 0 && <div role="alert"><p><Icon name="warning" />無法讀取這個檔案：</p><ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}

    {editing && <fieldset><legend>{editing.existing ? `編輯表單：${editing.form.name || editing.form.id}` : '新增表單'}</legend>
      {queue.length > 0 && <p>這個檔案還有 {queue.length} 張表單等待設定。</p>}
      <label>表單名稱<input maxLength={80} value={editing.form.name} onChange={e => setForm({ name: e.target.value })} /></label>
      <label>識別碼（英文字母開頭，可含數字、底線與連字號）<input maxLength={60} value={editing.form.id} readOnly={editing.existing} onChange={e => setForm({ id: e.target.value })}
        aria-invalid={editing.form.id !== '' && !FORM_ID_PATTERN.test(editing.form.id)} /></label>
      <fieldset><legend>描述的對象</legend>
        {!materials.length && <p>請先在上方新增物料型別，表單才能指定它描述哪一種物料。</p>}
        {materials.map(m => { const id = materialTypeId(m.key); return <label key={m.key} className="check-row"><input type="checkbox" checked={editing.form.subject.includes(id)}
          onChange={e => setForm({ subject: e.target.checked ? [...editing.form.subject, id] : editing.form.subject.filter(s => s !== id) })} />{m.name.trim() || m.key}</label>; })}
        {editing.form.subject.filter(s => !materials.some(m => materialTypeId(m.key) === s)).map(s => <p key={s}>其他對象：{s}</p>)}
      </fieldset>
      {editing.form.fields.map((f, i) => <fieldset key={i}><legend>欄位 {i + 1}{f.label.trim() ? `：${f.label.trim()}` : ''}</legend>
        {f.note && <p><Icon name="info" />{f.note}</p>}
        <label>標籤（顯示給使用者看的名稱）<input maxLength={80} value={f.label} onChange={e => setField(i, { label: e.target.value })} /></label>
        <label>識別碼（英文，建立後不要更改）<input maxLength={60} value={f.key} onChange={e => setField(i, { key: e.target.value })} /></label>
        <label>型別<select value={f.type} onChange={e => setField(i, { type: e.target.value as AttrValueType })}>{TYPES.map(t => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}</select></label>
        {(f.type === 'quantity' || f.type === 'number') && <label>單位<select value={f.unit} onChange={e => setField(i, { unit: e.target.value })}>
          <option value="">{f.type === 'quantity' ? '請選擇' : '不設單位'}</option>{UNIT_NAMES.map(u => <option key={u} value={u}>{u}</option>)}</select></label>}
        {f.type === 'enum' && <label>選項（一行一個）<textarea rows={3} value={f.values} onChange={e => setField(i, { values: e.target.value })} /></label>}
        <label className="check-row"><input type="checkbox" checked={f.required} onChange={e => setField(i, { required: e.target.checked })} />必填</label>
        <button disabled={editing.form.fields.length === 1} onClick={() => setForm({ fields: editing.form.fields.filter((_, j) => j !== i) })}>刪除欄位</button>
      </fieldset>)}
      <button onClick={() => setForm({ fields: [...editing.form.fields, blankField()] })}>新增欄位</button>
      <div role="status">{issues.length > 0 ? <><p><Icon name="warning" />還不能儲存：</p><ul>{issues.map((m, i) => <li key={i}>{m}</li>)}</ul></> : <p><Icon name="check" />可以儲存。</p>}</div>
      <div className="actions"><button className="primary" disabled={issues.length > 0} onClick={save}>儲存表單</button><button onClick={() => next(queue)}>取消</button></div>
    </fieldset>}
  </section>;
}
