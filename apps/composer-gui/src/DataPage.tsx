import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fieldTypes, formError, inferFields, MAX_FILE_BYTES, type FieldType, type FormDraft } from './localData';

export function DataPage({ form, onChange }: { form: FormDraft; onChange: (form: FormDraft) => void }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const focus = useRef('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // A newly added row selects its placeholder name so typing replaces it instead of appending (G03).
  const selectName = useRef(false);
  useLayoutEffect(() => {
    if (!focus.current) return;
    const target = document.getElementById(focus.current); target?.focus();
    if (selectName.current && target instanceof HTMLInputElement) target.select();
    focus.current = ''; selectName.current = false;
  }, [form]);
  const validation = formError(form);
  return <>
    <p id="privacy-note">請只上傳已去識別化的 CSV 或 TSV 樣本（2 MB 以下、最多 100 欄與 10000 筆）。檔案只在瀏覽器記憶體解析，不上傳、不保存原始資料列。</p>
    <p>只保留推測的欄位名稱、型別與必填設定供本次編輯。這些欄位設定不會包含在系統設定檔中，重新整理會清除。請勿在欄位名稱填入個資或秘密值。</p>
    <label htmlFor="sample-file">選擇資料樣本（會替換目前欄位）</label>
    <input id="sample-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={busy}
      aria-describedby="privacy-note data-error" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setBusy(true); setError(''); setNotice('正在推測欄位。');
        try {
          if (!/\.(csv|tsv)$/i.test(file.name)) throw new Error('請選擇 CSV 或 TSV 檔案。');
          if (file.size > MAX_FILE_BYTES) throw new Error('檔案不可超過 2 MB。');
          const fields = inferFields(await file.text(), /\.tsv$/i.test(file.name) ? '\t' : ',');
          if (!mounted.current) return;
          onChange({ ...form, fields }); setNotice(`已推測 ${fields.length} 個欄位，請確認型別與必填設定。原始資料列已捨棄。`);
        } catch (failure) { if (mounted.current) { setError(failure instanceof Error ? failure.message : '無法讀取檔案。'); setNotice('原欄位設定已保留。'); } }
        finally { if (mounted.current) setBusy(false); }
      }} />
    <p id="data-error" role={error ? 'alert' : undefined}>{error}</p><p role="status">{notice}</p>
    <fieldset disabled={busy}><legend>表單欄位設計</legend>
      <label htmlFor="form-name">表單名稱</label><input id="form-name" maxLength={100} value={form.name} aria-describedby="form-error" onChange={e => onChange({ ...form, name: e.target.value })} />
      <p id="form-error" role={validation ? 'alert' : undefined}>{validation}</p>
      {form.fields.map((field, index) => <fieldset key={field.id}><legend>欄位 {index + 1}</legend>
        <label htmlFor={`${field.id}-name`}>欄位 {index + 1} 名稱</label>
        <input id={`${field.id}-name`} maxLength={100} value={field.name} aria-describedby="form-error" onChange={e => onChange({ ...form, fields: form.fields.map(f => f.id === field.id ? { ...f, name: e.target.value } : f) })} />
        <label htmlFor={`${field.id}-type`}>欄位 {index + 1} 型別</label>
        <select id={`${field.id}-type`} value={field.type} onChange={e => onChange({ ...form, fields: form.fields.map(f => f.id === field.id ? { ...f, type: e.target.value as FieldType } : f) })}>
          {Object.entries(fieldTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label><input type="checkbox" checked={field.required} onChange={e => onChange({ ...form, fields: form.fields.map(f => f.id === field.id ? { ...f, required: e.target.checked } : f) })} />欄位 {index + 1} 必填</label>
        <button onClick={() => { focus.current = 'add-field'; onChange({ ...form, fields: form.fields.filter(f => f.id !== field.id) }); setNotice(`已刪除欄位 ${index + 1}。`); }}>刪除欄位 {index + 1}</button>
      </fieldset>)}
      <button id="add-field" disabled={form.fields.length >= 100} onClick={() => {
        let id: string; do { id = `manual-${++sequence.current}`; } while (form.fields.some(f => f.id === id));
        focus.current = `${id}-name`; selectName.current = true;
        onChange({ ...form, fields: [...form.fields, { id, name: `新欄位 ${form.fields.length + 1}`, type: 'text', required: false }] });
        setNotice('已新增欄位，請填寫名稱並選擇型別。');
      }}>新增欄位</button>
      <button onClick={() => { onChange({ ...form, fields: [] }); setNotice('欄位設定已清除。'); }}>清除全部欄位</button>
    </fieldset>
  </>;
}
