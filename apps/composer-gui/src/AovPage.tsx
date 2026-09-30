import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { exportAov, importAov, type AovDocument } from './aov';
import { formError, type FormDraft } from './localData';
import { downloadJson, readJsonFile } from './fileTransfer';
import { Column } from './Column';
import { Icon } from './Icons';

export function AovPage({ value, onChange, form }: { value: AovDocument; onChange: (value: AovDocument) => void; form: FormDraft }) {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const focus = useRef('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const formIds = form.fields.length && !formError(form) ? [form.id] : [];
  // A newly added row selects its placeholder name so typing replaces it instead of appending (G03).
  const selectName = useRef(false);
  useLayoutEffect(() => {
    if (!focus.current) return;
    const target = document.getElementById(focus.current); target?.focus();
    if (selectName.current && target instanceof HTMLInputElement) target.select();
    focus.current = ''; selectName.current = false;
  }, [value, selectedId]);
  function update(id: string, key: 'name' | 'when' | 'owner' | 'formId', next: string) {
    onChange({ ...value, steps: value.steps.map(s => s.id === id ? { ...s, [key]: next } : s) });
  }
  function transfer(importing: boolean, input = text) {
    try {
      if (importing) { const next = importAov(input, formIds); focus.current = 'add-step'; onChange(next); setNotice('流程匯入成功，已替換原流程。'); }
      else { downloadJson(exportAov(value, formIds), 'workflow.aov.json'); setNotice('流程規格已下載；不包含資料列或系統組裝設定。'); }
      setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '流程規格處理失敗。'); setNotice(''); }
  }
  const index = Math.max(0, value.steps.findIndex(s => s.id === selectedId));
  const step = value.steps[index];
  const number = (i: number) => String(i + 1).padStart(2, '0');
  const select = (id: string) => { focus.current = `${id}-name`; setSelectedId(id); };
  return <div className="columns">
    <Column id="aov-steps" title="流程步驟" lead="建立並管理此流程的工作步驟。">
      <ol className="step-list">{value.steps.map((s, i) => <li key={s.id}>
        <button aria-current={s.id === step?.id ? true : undefined} onClick={() => select(s.id)}>
          <span className="step-number">{number(i)}</span>{' '}
          <span><strong>{s.name || '（未命名）'}</strong><br /><small>{[s.when, s.owner].filter(Boolean).join('・') || '尚未填寫時機與負責職務'}</small></span>
          <Icon name="chevron" />
        </button>
      </li>)}</ol>
      {value.steps.length === 0 && <p className="muted">尚未建立步驟。</p>}
      <button id="add-step" className="file-button" disabled={busy || value.steps.length >= 100} onClick={() => {
        let count = 1; while (value.steps.some(s => s.id === `step-${count}`)) count++;
        const id = `step-${count}`; focus.current = `${id}-name`; selectName.current = true; setSelectedId(id);
        onChange({ ...value, steps: [...value.steps, { id, name: `新步驟 ${value.steps.length + 1}`, when: '', owner: '', formId: '' }] }); setNotice('已新增步驟。');
      }}><Icon name="plus" />新增步驟</button>
    </Column>
    <Column id="aov-edit" title={step ? `編輯步驟 ${number(index)}` : '編輯步驟'} lead="設定此步驟的基本資訊與對應表單。">
      {!step ? <p className="muted">請先按左側「新增步驟」，或在右側匯入流程規格。</p> : <fieldset disabled={busy}><legend className="visually-hidden">步驟 {index + 1}</legend>
        <div className="form-grid">
          {(['name', 'when', 'owner'] as const).map((key, i) => <div key={key} style={{ display: 'contents' }}>
            <label htmlFor={`${step.id}-${key}`} className={key === 'name' ? 'required-label' : undefined}><span className="visually-hidden">步驟 {index + 1} </span>{['名稱', '時機', '負責職務'][i]}</label>
            <input id={`${step.id}-${key}`} maxLength={key === 'when' ? 300 : 100} value={step[key]} aria-describedby="aov-error" required={key === 'name'} onChange={e => update(step.id, key, e.target.value)} />
          </div>)}
          <label htmlFor={`${step.id}-form`}><span className="visually-hidden">步驟 {index + 1} </span>對應表單</label>
          <select id={`${step.id}-form`} value={step.formId} aria-describedby="form-hint aov-error" onChange={e => update(step.id, 'formId', e.target.value)}>
            <option value="">不指定表單</option>
            {formIds.includes(form.id) && <option value={form.id}>{form.name}</option>}
            {step.formId && !formIds.includes(step.formId) && <option value={step.formId}>引用失效，請重新選擇</option>}
          </select>
          <p id="form-hint" className="muted"><small>表單來自本次資料上傳頁的欄位設計；重新開啟後，請先建立表單再匯入流程。</small></p>
        </div>
        <div className="actions">{([-1, 1] as const).map(direction => <button key={direction} disabled={index + direction < 0 || index + direction >= value.steps.length} onClick={() => {
          const steps = [...value.steps]; [steps[index], steps[index + direction]] = [steps[index + direction], steps[index]];
          focus.current = `${step.id}-name`; onChange({ ...value, steps }); setNotice(`步驟已移至第 ${index + direction + 1} 位。`);
        }}><Icon name={direction === -1 ? 'up' : 'down'} />{direction === -1 ? '上移' : '下移'}<span className="visually-hidden">步驟 {index + 1}</span></button>)}
          <button className="danger" onClick={() => {
            const next = value.steps[index + 1] ?? value.steps[index - 1];
            focus.current = next ? `${next.id}-name` : 'add-step'; setSelectedId(next?.id ?? '');
            onChange({ ...value, steps: value.steps.filter(s => s.id !== step.id) }); setNotice(`已刪除步驟 ${index + 1}。`);
          }}><Icon name="trash" /><span>刪除<span className="visually-hidden">步驟 {index + 1}</span><span aria-hidden="true">此步驟</span></span></button>
        </div>
      </fieldset>}
      <p id="aov-error" role={error ? 'alert' : undefined}>{error}</p><p role="status">{notice}</p>
    </Column>
    <Column id="aov-file" title="流程規格檔" lead="下載或匯入此流程的規格檔（JSON 格式）。">
      <div className="file-card"><Icon name="file" /><div>
        <strong>workflow.aov.json</strong>
        <button className="primary" disabled={busy} onClick={() => transfer(false)}><Icon name="download" />下載流程規格</button>
      </div></div>
      <fieldset disabled={busy}><legend><h3>匯入流程規格</h3></legend>
        <p className="muted">選擇 JSON 檔案以匯入既有的流程設定；成功後替換目前流程。</p>
        <input id="aov-file-input" className="file-input" type="file" accept=".json,application/json" aria-describedby="aov-error" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setBusy(true);
          try { const input = await readJsonFile(file); if (mounted.current) transfer(true, input); } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '檔案讀取失敗。'); } finally { if (mounted.current) setBusy(false); }
        }} />
        <label htmlFor="aov-file-input" className="file-button"><Icon name="file" />選擇 JSON 檔案</label>
        <details><summary>進階：貼上流程 JSON</summary><label htmlFor="aov-json">流程 JSON</label><textarea id="aov-json" value={text} aria-describedby="aov-error" onChange={e => setText(e.target.value)} /><button onClick={() => transfer(true)}>匯入流程 JSON</button></details>
      </fieldset>
      <div className="note"><Icon name="info" /><ul>
        <li>流程須獨立下載，不包含在系統設定檔。</li>
        <li>純說明用途，不影響系統組裝；請以職務名稱描述負責人，勿輸入個資或秘密值。</li>
      </ul></div>
    </Column>
  </div>;
}
