import { useLayoutEffect, useRef } from 'react';
import { fieldTypes, formError, type FieldType, type FormDraft } from './localData';
import type { AovStep } from './workflow';
import { Icon } from './Icons';

// Edits one form: name, owning step and fields. Only one editor is on screen, so field element IDs stay unique.
export function FormEditor({ form, steps, stepId, disabled, onChange, onMove, onDelete, onNotice }: {
  form: FormDraft; steps: AovStep[]; stepId: string; disabled: boolean;
  onChange: (form: FormDraft) => void; onMove: (stepId: string) => void; onDelete: () => void; onNotice: (text: string) => void;
}) {
  const sequence = useRef(0);
  const focus = useRef('');
  // A newly added row selects its placeholder name so typing replaces it instead of appending (G03).
  const selectName = useRef(false);
  useLayoutEffect(() => {
    if (!focus.current) return;
    const target = document.getElementById(focus.current); target?.focus();
    if (selectName.current && target instanceof HTMLInputElement) target.select();
    focus.current = ''; selectName.current = false;
  }, [form]);
  const validation = form.fields.length ? formError(form) : '';
  const setField = (id: string, patch: Partial<FormDraft['fields'][number]>) => onChange({ ...form, fields: form.fields.map(f => f.id === id ? { ...f, ...patch } : f) });
  return <fieldset disabled={disabled}><legend className="visually-hidden">表單「{form.name}」</legend>
    <div className="form-grid">
      <label htmlFor="form-name" className="required-label">表單名稱</label>
      <input id="form-name" maxLength={100} value={form.name} aria-describedby="form-name-note form-error" onChange={e => onChange({ ...form, name: e.target.value })} />
      <p id="form-name-note" className="muted"><small>上傳時預設為檔名；請改成不含客戶、人員或其他可識別資訊的名稱。</small></p>
      <label htmlFor="form-step">所屬步驟</label>
      <select id="form-step" value={stepId} onChange={e => onMove(e.target.value)}>
        {!stepId && <option value="">尚未指派，請選擇</option>}
        {steps.map((step, i) => <option key={step.id} value={step.id}>{String(i + 1).padStart(2, '0')} {step.name || '（未命名）'}</option>)}
      </select>
    </div>
    <p id="form-error" role={validation ? 'alert' : undefined}>{validation}</p>
    <div className="table-scroll"><table className="field-table"><caption className="visually-hidden">表單欄位</caption>
      <thead><tr><th scope="col">欄位名稱</th><th scope="col">型別</th><th scope="col">必填</th><th scope="col">識別欄位</th><th scope="col">操作</th></tr></thead>
      <tbody>{form.fields.length === 0 ? <tr><td colSpan={5}>尚未建立欄位。請選擇樣本檔，或按「新增欄位」。</td></tr> : form.fields.map((field, index) => <tr key={field.id}>
        <td><input id={`${field.id}-name`} aria-label={`欄位 ${index + 1} 名稱`} maxLength={100} value={field.name} aria-describedby="form-error" onChange={e => setField(field.id, { name: e.target.value })} /></td>
        <td><select id={`${field.id}-type`} aria-label={`欄位 ${index + 1} 型別`} value={field.type} onChange={e => setField(field.id, { type: e.target.value as FieldType })}>
          {Object.entries(fieldTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></td>
        <td><label><input type="checkbox" aria-label={`欄位 ${index + 1} 必填`} checked={field.required} onChange={e => setField(field.id, { required: e.target.checked })} /></label></td>
        <td><label><input type="checkbox" aria-label={`欄位 ${index + 1} 識別欄位`} aria-describedby="key-help" checked={field.isKey} onChange={e => setField(field.id, { isKey: e.target.checked })} /></label></td>
        <td><button onClick={() => { focus.current = 'add-field'; onChange({ ...form, fields: form.fields.filter(f => f.id !== field.id) }); onNotice(`已刪除欄位 ${index + 1}。`); }}><Icon name="trash" />刪除<span className="visually-hidden">欄位 {index + 1}</span></button></td>
      </tr>)}</tbody>
    </table></div>
    <div className="actions">
      <button id="add-field" disabled={form.fields.length >= 100} onClick={() => {
        let id: string; do { id = `manual-${++sequence.current}`; } while (form.fields.some(f => f.id === id));
        focus.current = `${id}-name`; selectName.current = true;
        onChange({ ...form, fields: [...form.fields, { id, name: `新欄位 ${form.fields.length + 1}`, type: 'text', required: false, isKey: false }] });
        onNotice('已新增欄位，請填寫名稱並選擇型別。');
      }}><Icon name="plus" />新增欄位</button>
      <button onClick={() => { onChange({ ...form, fields: [] }); onNotice('欄位設定已清除。'); }}><Icon name="trash" />清除全部欄位</button>
      <button className="danger" onClick={onDelete}><Icon name="trash" />刪除此表單</button>
    </div>
  </fieldset>;
}
