import { useEffect, useRef, useState } from 'react';
import { fieldTypes, inferForms, MAX_FORMS, type FieldType, type FormDraft } from './localData';
import { nextId, stepOfForm, type AovDocument } from './workflow';
import { FormEditor } from './FormEditor';
import { Column } from './Column';
import { Icon } from './Icons';

const typeHelp: Record<FieldType, string> = {
  text: '一般文字內容，適用於名稱、編號等欄位。', integer: '僅可輸入整數值。', decimal: '可輸入小數值，支援正負數。',
  boolean: '僅可選擇「是」或「否」。', date: '選擇日期，或輸入 YYYY-MM-DD 格式。',
};
// Adds forms to one step; each form belongs to exactly one step (D23).
function assign(doc: AovDocument, formId: string, stepId: string): AovDocument {
  return { ...doc, steps: doc.steps.map(s => ({ ...s, formIds: s.id === stepId ? [...s.formIds.filter(id => id !== formId), formId] : s.formIds.filter(id => id !== formId) })) };
}

export function FormsPage({ value, onChange }: { value: AovDocument; onChange: (value: AovDocument) => void }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [failures, setFailures] = useState<{ file: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(value.forms[0]?.id ?? '');
  const [targetStep, setTargetStep] = useState(value.steps[0]?.id ?? '');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const target = value.steps.some(s => s.id === targetStep) ? targetStep : value.steps[0]?.id ?? '';
  const form = value.forms.find(f => f.id === selectedId) ?? value.forms[0];
  const unassigned = value.forms.filter(f => !stepOfForm(value, f.id));
  function addForms(drafts: Omit<FormDraft, 'id'>[]) {
    let next = value; const ids: string[] = [];
    for (const draft of drafts) {
      const id = nextId('form', next.forms); ids.push(id);
      next = assign({ ...next, forms: [...next.forms, { id, ...draft }] }, id, target);
    }
    onChange(next); if (ids[0]) setSelectedId(ids[0]);
  }
  const formButton = (f: FormDraft) => <li key={f.id}><button aria-current={f.id === form?.id ? true : undefined} onClick={() => setSelectedId(f.id)}>
    <Icon name="file" /><span><strong>{f.name || '（未命名）'}</strong><br /><small>{f.fields.length} 個欄位{f.fields.some(x => x.isKey) ? '・含識別欄位' : ''}</small></span>
  </button></li>;
  return <div className="columns">
    <Column id="forms" title="各步驟的表單" lead="選擇步驟後上傳樣本，每個檔案建立一張表單。">
      {!value.steps.length ? <div className="note note-warning"><Icon name="warning" /><p>請先在「流程步驟」建立步驟，再為步驟建立表單。</p></div> : <>
        <label htmlFor="upload-step" className="field-label">上傳到步驟</label>
        <select id="upload-step" value={target} disabled={busy} onChange={e => setTargetStep(e.target.value)}>
          {value.steps.map((s, i) => <option key={s.id} value={s.id}>{String(i + 1).padStart(2, '0')} {s.name || '（未命名）'}</option>)}
        </select>
        <div className="drop-zone">
          <Icon name="file" />
          <input id="sample-file" className="file-input" type="file" multiple accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={busy || value.forms.length >= MAX_FORMS}
            aria-describedby="sample-limits privacy-note data-error" onChange={async event => {
              const files = [...event.target.files ?? []]; event.target.value = ''; if (!files.length) return;
              setBusy(true); setError(''); setFailures([]); setNotice('正在推測欄位。');
              try {
                const result = await inferForms(files, value.forms.length);
                if (!mounted.current) return;
                addForms(result.forms); setFailures(result.failures);
                setNotice(`已建立 ${result.forms.length} 張表單${result.failures.length ? `，${result.failures.length} 個檔案失敗` : ''}。表單名稱取自檔名，請確認已去識別化；原始資料列已捨棄。`);
              } catch (failure) { if (mounted.current) { setError(failure instanceof Error ? failure.message : '無法讀取檔案。'); setNotice('原表單已保留。'); } }
              finally { if (mounted.current) setBusy(false); }
            }} />
          <label htmlFor="sample-file" className="file-button"><Icon name="file" />選擇 CSV / TSV（可多選）</label>
          <small id="sample-limits">一次最多 10 個檔案、合計 20 MB；每檔 2 MB 以下、最多 100 欄、10000 筆。流程最多 {MAX_FORMS} 張表單。</small>
        </div>
        <button id="add-form" disabled={busy || value.forms.length >= MAX_FORMS} onClick={() => { addForms([{ name: `新表單 ${value.forms.length + 1}`, fields: [] }]); setNotice('已新增空白表單，請設定名稱與欄位。'); }}><Icon name="plus" />新增空白表單</button>
      </>}
      <p id="data-error" role={error ? 'alert' : undefined}>{error}</p>
      {failures.length > 0 && <div role="alert"><p>以下檔案未建立表單：</p><ul>{failures.map(f => <li key={f.file}>{f.file}：{f.message}</li>)}</ul></div>}
      <div className={notice && !error ? 'note note-success' : undefined}>{notice && !error && <Icon name="check" />}<p role="status">{notice}</p></div>
      {value.steps.map((s, i) => <section key={s.id} aria-labelledby={`group-${s.id}`}>
        <h3 id={`group-${s.id}`}>{String(i + 1).padStart(2, '0')} {s.name || '（未命名）'}{s.owner && <small>（{s.owner}）</small>}</h3>
        {s.formIds.length ? <ul className="step-list">{value.forms.filter(f => s.formIds.includes(f.id)).map(formButton)}</ul> : <p className="muted">此步驟尚無表單。</p>}
      </section>)}
      {unassigned.length > 0 && <section aria-labelledby="group-unassigned"><h3 id="group-unassigned">尚未指派步驟</h3><ul className="step-list">{unassigned.map(formButton)}</ul></section>}
    </Column>
    <Column id="form-design" title="表單欄位設計" lead="調整欄位名稱、型別、必填，並標示可串聯其他表單的識別欄位。">
      {!form ? <p className="muted">尚未建立表單。請於左側上傳樣本，或按「新增空白表單」。</p> : <FormEditor key={form.id} form={form} steps={value.steps} stepId={stepOfForm(value, form.id)?.id ?? ''} disabled={busy} onNotice={setNotice}
        onChange={next => onChange({ ...value, forms: value.forms.map(f => f.id === next.id ? next : f) })}
        onMove={stepId => { onChange(assign(value, form.id, stepId)); setNotice('已變更表單所屬步驟。'); }}
        onDelete={() => {
          const removed = value.relations.filter(r => r.from.formId === form.id || r.to.formId === form.id).length;
          const rest = value.forms.filter(f => f.id !== form.id);
          onChange({ ...value, forms: rest, steps: value.steps.map(s => ({ ...s, formIds: s.formIds.filter(id => id !== form.id) })),
            relations: value.relations.filter(r => r.from.formId !== form.id && r.to.formId !== form.id) });
          setSelectedId(rest[0]?.id ?? ''); setNotice(`已刪除表單「${form.name}」${removed ? `及其 ${removed} 條關聯` : ''}。`);
        }} />}
    </Column>
    <Column id="field-check" title="欄位確認" lead="請確認推測的欄位與型別。">
      <table className="type-table"><caption>可用型別</caption><tbody>
        {Object.entries(fieldTypes).map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{typeHelp[key as FieldType]}</td></tr>)}
      </tbody></table>
      <h3>識別欄位</h3><p id="key-help" className="muted">可在不同表單間辨識同一批物品的欄位，例如批號。系統依識別欄位推測表單關聯。</p>
      <div className="note note-warning"><Icon name="warning" /><div><strong>請去識別化</strong><p>表單名稱預設為檔名，欄位名稱取自樣本標題；請確認不含客戶、人員或其他可識別資訊，也勿填入秘密值。</p></div></div>
      <div className="note" id="privacy-note"><Icon name="info" /><ul>
        <li>僅在瀏覽器解析，不上傳、不保存原始資料列。</li>
        <li>請使用已去識別化的樣本。</li>
      </ul></div>
    </Column>
  </div>;
}
