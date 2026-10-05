import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fieldTypes, formError, inferForms, MAX_FORMS, type FieldType, type FieldValidation, type FormDraft, type FormField } from './localData';
import { describeEndpoint, nextId } from './workflow';
import { validationError, type AovGraphDocument, type GraphNode } from './workflowGraph';
import { patchCanvasNode } from './canvasEditing';
import { Icon } from './Icons';
import { Modal } from './Modal';

export function NodeForm({ value, node, onChange }: { value: AovGraphDocument; node: GraphNode; onChange: (next: AovGraphDocument) => boolean }) {
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const latest = useRef(value); latest.current = value;
  const mounted = useRef(true);
  const focus = useRef('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { if (focus.current) { const input = document.getElementById(focus.current); input?.focus(); if (input instanceof HTMLInputElement) input.select(); focus.current = ''; } }, [value]);
  const form = value.forms.find(f => f.id === node.formId);
  // Nothing left to show full screen once the last field is gone.
  useEffect(() => { if (expanded && !form?.fields.length) setExpanded(false); }, [expanded, form?.fields.length]);
  const changeForm = (next: FormDraft) => onChange({ ...value, forms: value.forms.map(f => f.id === next.id ? next : f) });
  const field = (id: string, patch: Partial<FormField>) => form && changeForm({ ...form, fields: form.fields.map(f => f.id === id ? { ...f, ...patch } : f) });
  function create(draft: Omit<FormDraft, 'id'>) {
    const doc = latest.current;
    const owner = doc.graphs.flatMap(g => g.nodes).find(n => n.id === node.id);
    if (!owner || owner.formId || doc.forms.length >= MAX_FORMS) { setError('節點已變更或表單數量已達上限，未加入樣本。'); return; }
    const id = nextId('form', doc.forms);
    onChange({ ...patchCanvasNode(doc, node.id, { formId: id }), forms: [...doc.forms, { ...draft, id }] });
  }
  const removedRelations = value.relations.filter(r => [r.from, r.to].some(at => at.formId === form?.id && (deleting === 'form' || at.fieldId === deleting)));
  const renderTable = (form: FormDraft) => <div className="field-table-wrap" role="region" aria-label="欄位設定" tabIndex={0}>
  {/* Laid out like the CSV: one column per field with its name on top, one row per setting (D87). */}
  <table className="field-table">
    <caption className="visually-hidden">每一欄是一個欄位，每一列是欄位的一項設定</caption>
    <thead><tr><th scope="col"><span className="visually-hidden">設定項目</span></th>{form.fields.map((f, index) => <th scope="col" key={f.id}>
      <span className="field-no">欄位 {index + 1}</span>
      <input id={`${f.id}-name`} aria-label={`欄位 ${index + 1} 名稱`} maxLength={100} value={f.name} onChange={e => field(f.id, { name: e.target.value })} />
    </th>)}</tr></thead>
    <tbody>
      <tr><th scope="row">型別</th>{form.fields.map((f, index) => <td key={f.id}>
        <select id={`${f.id}-type`} aria-label={`欄位 ${index + 1} 型別`} value={f.type} onChange={e => field(f.id, { type: e.target.value as FieldType, validation: undefined })}>{Object.entries(fieldTypes).map(([type, name]) => <option key={type} value={type}>{name}</option>)}</select>
      </td>)}</tr>
      <tr><th scope="row">必填</th>{form.fields.map((f, index) => <td key={f.id} className="check-cell"><input type="checkbox" aria-label={`欄位 ${index + 1} 必填`} checked={f.required} onChange={e => field(f.id, { required: e.target.checked })} /></td>)}</tr>
      <tr><th scope="row">識別欄位</th>{form.fields.map((f, index) => <td key={f.id} className="check-cell"><input type="checkbox" aria-label={`欄位 ${index + 1} 識別欄位`} checked={f.isKey} onChange={e => field(f.id, { isKey: e.target.checked })} /></td>)}</tr>
      <tr><th scope="row">驗證</th>{form.fields.map(f => <td key={f.id}><FieldRules field={f} onChange={validation => field(f.id, { validation })} /></td>)}</tr>
      <tr><th scope="row">操作</th>{form.fields.map((f, index) => <td key={f.id}><button className="danger" aria-label={`刪除欄位 ${index + 1}`} onClick={() => setDeleting(f.id)}>刪除</button></td>)}</tr>
    </tbody>
  </table>
</div>;
  const renderActions = (form: FormDraft) => <div className="actions"><button id="node-add-field" disabled={form.fields.length >= 100} onClick={() => {
  const id = nextId('field', form.fields); focus.current = `${id}-name`;
  changeForm({ ...form, fields: [...form.fields, { id, name: `新欄位 ${form.fields.length + 1}`, type: 'text', required: false, isKey: false }] });
}}>新增欄位</button><button className="danger" onClick={() => setDeleting('form')}>刪除此表單</button></div>;
  const renderConfirm = (form: FormDraft) => <section aria-label="確認刪除表單內容"><h3>確認刪除</h3><p>{deleting === 'form' ? `表單「${form.name}」與全部欄位` : `欄位「${form.fields.find(f => f.id === deleting)?.name}」`}</p>
  <ul>{removedRelations.map(r => <li key={r.id}>關聯：{describeEndpoint(value, r.from)}至{describeEndpoint(value, r.to)}</li>)}</ul>
  <button className="danger" onClick={() => {
    const next = deleting === 'form' ? { ...patchCanvasNode(value, node.id, { formId: null }), forms: value.forms.filter(f => f.id !== form.id) } : { ...value, forms: value.forms.map(f => f.id === form.id ? { ...f, fields: f.fields.filter(x => x.id !== deleting) } : f) };
    if (onChange({ ...next, relations: value.relations.filter(r => !removedRelations.includes(r)) })) { setDeleting(null); focus.current = 'node-add-field'; }
  }}>確認刪除表單內容</button><button onClick={() => setDeleting(null)}>取消刪除表單內容</button>
</section>;
  return <section aria-labelledby="node-form-title"><h3 id="node-form-title">標準表單</h3>
    <p id="sample-privacy">請使用已去識別化的樣本。表單名稱取自檔名，請確認已去識別化；原始資料列不保留、不上傳。勿輸入個資或秘密值。</p>
    {!form ? <fieldset disabled={busy || value.forms.length >= MAX_FORMS}><legend className="visually-hidden">建立標準表單</legend>
      <input id="node-sample" className="file-input" type="file" accept=".csv,text/csv" aria-describedby="sample-privacy node-sample-limits" onChange={async e => {
        const files = Array.from(e.target.files ?? []); e.target.value = ''; if (!files.length) return;
        if (files.length !== 1) { setError('每個節點只能上傳一個樣本檔。'); return; }
        setBusy(true); setError('');
        try {
          const result = await inferForms(files, latest.current.forms.length);
          if (!mounted.current) return;
          if (result.failures.length) setError(result.failures.map(f => `${f.file}：${f.message}`).join(' '));
          else if (result.forms[0]) { create(result.forms[0]); setNotice('已推測欄位，原始資料列已捨棄。'); }
        } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '無法讀取樣本。'); }
        finally { if (mounted.current) setBusy(false); }
      }} /><label htmlFor="node-sample" className="file-button">選擇標準 CSV 樣本</label>
      <p id="node-sample-limits">單檔 2 MB 以下、最多 100 欄、10000 筆；整份流程最多 50 張表單。</p>
      <button onClick={() => create({ name: `新表單 ${value.forms.length + 1}`, fields: [] })}>新增空白表單</button>
    </fieldset> : <>
      <label htmlFor="node-form-name">表單名稱</label><input id="node-form-name" maxLength={100} value={form.name} onChange={e => changeForm({ ...form, name: e.target.value })} />
      <p role="status">{!form.fields.length ? '尚未建立欄位。' : formError(form)}</p>
      {form.fields.length > 0 && <div className="actions"><button ref={openButton} aria-haspopup="dialog" aria-expanded={expanded} onClick={() => setExpanded(true)}><Icon name="expand" />展開全螢幕</button></div>}
      {!expanded && <>{renderTable(form)}{renderActions(form)}{deleting && renderConfirm(form)}</>}
      {expanded && form.fields.length > 0 && <Modal title="欄位設定" onClose={() => setExpanded(false)} returnFocusTo={openButton}>{renderTable(form)}{renderActions(form)}{deleting && renderConfirm(form)}</Modal>}
    </>}
    <p role={error ? 'alert' : undefined}>{error}</p><p role="status">{notice}</p>
  </section>;
}

function FieldRules({ field, onChange }: { field: FormField; onChange: (rules: FieldValidation) => void }) {
  const rules = field.validation ?? {};
  const [inputError, setInputError] = useState('');
  const keys: (keyof FieldValidation)[] = field.type === 'date' ? ['minimumDate', 'maximumDate'] : field.type === 'text' ? ['maxLength', 'allowedValues'] : field.type === 'boolean' ? [] : ['minimum', 'maximum'];
  const labels = { minimum: '最小值', maximum: '最大值', minimumDate: '最早日期', maximumDate: '最晚日期', maxLength: '最大長度', allowedValues: '允許值（每行一項）' };
  const update = (key: keyof FieldValidation, text: string) => {
    const next = { ...rules };
    if (!text) delete next[key];
    else if (key === 'allowedValues') {
      const values = text.split('\n');
      if (values.length > 100 || values.some(v => v.length > 100)) { setInputError('允許值最多 100 項，每項最多 100 字。'); return; }
      next.allowedValues = [...new Set(values.filter(Boolean))];
      if (!next.allowedValues.length) delete next.allowedValues;
    } else if (key === 'minimumDate' || key === 'maximumDate') next[key] = text;
    else {
      const number = Number(text);
      if (!Number.isFinite(number) || (key === 'maxLength' && (!Number.isInteger(number) || number < 1 || number > 10000))) { setInputError('最大長度須為 1 至 10000 的整數。'); return; }
      next[key] = number;
    }
    setInputError(''); onChange(next);
  };
  const count = Object.keys(rules).length; const problem = Boolean(inputError || validationError(field));
  return <details><summary>{problem ? '請檢查' : count ? `${count} 項規則` : '未設定'}</summary>{keys.length ? keys.map(key => <div key={key}>
    <label htmlFor={`${field.id}-${key}`}>{labels[key]}</label>
    {key === 'allowedValues' ? <textarea id={`${field.id}-${key}`} defaultValue={rules.allowedValues?.join('\n') ?? ''} onBlur={e => update(key, e.target.value)} />
      : <input id={`${field.id}-${key}`} type={key.endsWith('Date') ? 'text' : 'number'} placeholder={key.endsWith('Date') ? 'YYYY-MM-DD' : undefined} step={field.type === 'integer' || key === 'maxLength' ? 1 : 'any'} min={key === 'maxLength' ? 1 : undefined} max={key === 'maxLength' ? 10000 : undefined} value={rules[key] ?? ''} onChange={e => update(key, e.target.value)} />}
  </div>) : <p>是／否欄位無額外驗證規則。</p>}<p role="status">{inputError || validationError(field)}</p></details>;
}
