import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fieldTypes, formError, inferFields, MAX_FILE_BYTES, type FieldType, type FormDraft } from './localData';
import { Column } from './Column';
import { Icon } from './Icons';

const typeHelp: Record<FieldType, string> = {
  text: '一般文字內容，適用於名稱、編號等欄位。', integer: '僅可輸入整數值。', decimal: '可輸入小數值，支援正負數。',
  boolean: '僅可選擇「是」或「否」。', date: '選擇日期，或輸入 YYYY-MM-DD 格式。',
};

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
  const setField = (id: string, patch: Partial<FormDraft['fields'][number]>) => onChange({ ...form, fields: form.fields.map(f => f.id === id ? { ...f, ...patch } : f) });
  return <div className="columns">
    <Column id="sample" title="資料樣本" lead="選擇 CSV 或 TSV 樣本檔案，系統將自動推測欄位以建立表單。">
      <div className="drop-zone">
        <Icon name="file" />
        <input id="sample-file" className="file-input" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={busy}
          aria-describedby="sample-limits privacy-note data-error" onChange={async event => {
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
        <label htmlFor="sample-file" className="file-button"><Icon name="file" />選擇 CSV / TSV</label>
        <small id="sample-limits">CSV、TSV，2 MB 以下；最多 100 欄、10000 筆。選擇後會替換目前欄位。</small>
      </div>
      <p id="data-error" role={error ? 'alert' : undefined}>{error}</p>
      <div className={notice && !error ? 'note note-success' : undefined}>{notice && !error && <Icon name="check" />}<p role="status">{notice}</p></div>
      <div className="note" id="privacy-note"><Icon name="info" /><ul>
        <li>僅在瀏覽器解析，不上傳、不保存原始資料列。</li>
        <li>請使用已去識別化的樣本。</li>
      </ul></div>
    </Column>
    <Column id="form-design" title="表單欄位設計" lead="設定表單名稱與欄位，調整欄位名稱、型別及是否必填。">
      <fieldset disabled={busy}>
        <label htmlFor="form-name" className="field-label">表單名稱</label>
        <input id="form-name" maxLength={100} value={form.name} aria-describedby="form-error" onChange={e => onChange({ ...form, name: e.target.value })} />
        <p id="form-error" role={validation ? 'alert' : undefined}>{validation}</p>
        <div className="table-scroll"><table className="field-table"><caption className="visually-hidden">表單欄位</caption>
          <thead><tr><th scope="col">欄位名稱</th><th scope="col">型別</th><th scope="col">必填</th><th scope="col">操作</th></tr></thead>
          <tbody>{form.fields.length === 0 ? <tr><td colSpan={4}>尚未建立欄位。請選擇樣本檔，或按「新增欄位」。</td></tr> : form.fields.map((field, index) => <tr key={field.id}>
            <td><input id={`${field.id}-name`} aria-label={`欄位 ${index + 1} 名稱`} maxLength={100} value={field.name} aria-describedby="form-error" onChange={e => setField(field.id, { name: e.target.value })} /></td>
            <td><select id={`${field.id}-type`} aria-label={`欄位 ${index + 1} 型別`} value={field.type} onChange={e => setField(field.id, { type: e.target.value as FieldType })}>
              {Object.entries(fieldTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></td>
            <td><label><input type="checkbox" aria-label={`欄位 ${index + 1} 必填`} checked={field.required} onChange={e => setField(field.id, { required: e.target.checked })} /></label></td>
            <td><button onClick={() => { focus.current = 'add-field'; onChange({ ...form, fields: form.fields.filter(f => f.id !== field.id) }); setNotice(`已刪除欄位 ${index + 1}。`); }}><Icon name="trash" />刪除<span className="visually-hidden">欄位 {index + 1}</span></button></td>
          </tr>)}</tbody>
        </table></div>
        <div className="actions">
          <button id="add-field" disabled={form.fields.length >= 100} onClick={() => {
            let id: string; do { id = `manual-${++sequence.current}`; } while (form.fields.some(f => f.id === id));
            focus.current = `${id}-name`; selectName.current = true;
            onChange({ ...form, fields: [...form.fields, { id, name: `新欄位 ${form.fields.length + 1}`, type: 'text', required: false }] });
            setNotice('已新增欄位，請填寫名稱並選擇型別。');
          }}><Icon name="plus" />新增欄位</button>
          <button onClick={() => { onChange({ ...form, fields: [] }); setNotice('欄位設定已清除。'); }}><Icon name="trash" />清除全部欄位</button>
        </div>
      </fieldset>
    </Column>
    <Column id="field-check" title="欄位確認" lead="請確認推測的欄位與型別，並完成表單設計。">
      <table className="type-table"><caption>可用型別</caption><tbody>
        {Object.entries(fieldTypes).map(([value, label]) => <tr key={value}><th scope="row">{label}</th><td>{typeHelp[value as FieldType]}</td></tr>)}
      </tbody></table>
      <h3>請確認推測結果</h3><p className="muted">欄位名稱不可空白或重複。請勿在欄位名稱填入個資或秘密值。</p>
      <div className="note note-warning"><Icon name="warning" /><div><strong>本次草稿尚未納入系統設定檔</strong><p>欄位設定只供本次編輯，重新整理後會清除。</p></div></div>
    </Column>
  </div>;
}
