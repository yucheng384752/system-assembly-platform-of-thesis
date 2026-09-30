import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { exportAov, importAov, type AovDocument } from './aov';
import { formError, type FormDraft } from './localData';
import { downloadJson, readJsonFile } from './fileTransfer';

export function AovPage({ value, onChange, form }: { value: AovDocument; onChange: (value: AovDocument) => void; form: FormDraft }) {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const focus = useRef('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const formIds = form.fields.length && !formError(form) ? [form.id] : [];
  useLayoutEffect(() => { if (focus.current) { document.getElementById(focus.current)?.focus(); focus.current = ''; } }, [value]);
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
  return <>
    <p>純說明用途，不影響系統組裝。請以職務名稱描述負責人，勿輸入個資或秘密值。此頁的流程規格須獨立下載，不包含在系統設定檔。</p>
    <p>對應表單只記錄本次欄位設計的引用；重新開啟後，請先建立表單再匯入流程。</p>
    <fieldset disabled={busy}><legend>流程步驟</legend>
      <ol>{value.steps.map((step, index) => <li key={step.id}>
        <fieldset><legend>步驟 {index + 1}</legend>
          {(['name', 'when', 'owner'] as const).map((key, i) => <div key={key}>
            <label htmlFor={`${step.id}-${key}`}>步驟 {index + 1} {['名稱', '時機', '負責人'][i]}</label>
            <input id={`${step.id}-${key}`} maxLength={key === 'when' ? 300 : 100} value={step[key]} aria-describedby="aov-error" required={key === 'name'} onChange={e => update(step.id, key, e.target.value)} />
          </div>)}
          <label htmlFor={`${step.id}-form`}>步驟 {index + 1} 對應表單</label>
          <select id={`${step.id}-form`} value={step.formId} aria-describedby="aov-error" onChange={e => update(step.id, 'formId', e.target.value)}>
            <option value="">不指定表單</option>
            {formIds.includes(form.id) && <option value={form.id}>{form.name}</option>}
            {step.formId && !formIds.includes(step.formId) && <option value={step.formId}>引用失效，請重新選擇</option>}
          </select>
          <div className="actions">{([-1, 1] as const).map(direction => <button key={direction} disabled={index + direction < 0 || index + direction >= value.steps.length} onClick={() => {
            const steps = [...value.steps]; [steps[index], steps[index + direction]] = [steps[index + direction], steps[index]];
            focus.current = `${step.id}-name`; onChange({ ...value, steps }); setNotice(`步驟已移至第 ${index + direction + 1} 位。`);
          }}>{direction === -1 ? '上移' : '下移'}步驟 {index + 1}</button>)}
            <button onClick={() => { focus.current = value.steps[index + 1] ? `${value.steps[index + 1].id}-name` : value.steps[index - 1] ? `${value.steps[index - 1].id}-name` : 'add-step'; onChange({ ...value, steps: value.steps.filter(s => s.id !== step.id) }); setNotice(`已刪除步驟 ${index + 1}。`); }}>刪除步驟 {index + 1}</button>
          </div>
        </fieldset>
      </li>)}</ol>
      <button id="add-step" disabled={value.steps.length >= 100} onClick={() => {
        let count = 1; while (value.steps.some(s => s.id === `step-${count}`)) count++;
        const id = `step-${count}`; focus.current = `${id}-name`;
        onChange({ ...value, steps: [...value.steps, { id, name: `新步驟 ${value.steps.length + 1}`, when: '', owner: '', formId: '' }] }); setNotice('已新增步驟。');
      }}>新增步驟</button>
      <button onClick={() => transfer(false)}>下載流程規格</button>
    </fieldset>
    <fieldset disabled={busy}><legend>匯入流程規格（成功後替換目前流程）</legend>
      <label htmlFor="aov-file">選擇流程規格檔</label><input id="aov-file" type="file" accept=".json,application/json" aria-describedby="aov-error" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setBusy(true);
        try { const input = await readJsonFile(file); if (mounted.current) transfer(true, input); } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '檔案讀取失敗。'); } finally { if (mounted.current) setBusy(false); }
      }} />
      <details><summary>進階：貼上流程 JSON</summary><label htmlFor="aov-json">流程 JSON</label><textarea id="aov-json" value={text} aria-describedby="aov-error" onChange={e => setText(e.target.value)} /><button onClick={() => transfer(true)}>匯入流程 JSON</button></details>
    </fieldset>
    <p id="aov-error" role={error ? 'alert' : undefined}>{error}</p><p role="status">{notice}</p>
  </>;
}
