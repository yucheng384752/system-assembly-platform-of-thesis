import { useEffect, useRef, useState } from 'react';
import { importWorkflow, integrityErrors, type AovGraphDocument } from './workflowGraph';
import { readJsonFile } from './fileTransfer';

export function WorkflowTransfer({ onChange }: { onChange: (doc: AovGraphDocument) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [notices, setNotices] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function accept(input: string) {
    try {
      const result = importWorkflow(input);
      const errors = integrityErrors(result.value);
      if (errors.length) throw new Error(`${errors.join(' ')}原流程已保留。`);
      onChange(result.value);
      const legacy = JSON.parse(input.replace(/^\uFEFF/, '')).version !== 4;
      setNotices(['流程匯入成功，已替換流程、表單與關聯。', ...(legacy ? ['舊版流程已轉換為畫布，請確認節點與表單設定。'] : []), ...result.notices]); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '流程匯入失敗，原流程已保留。'); setNotices([]); }
  }
  return <><button aria-expanded={open} aria-controls="workflow-transfer" onClick={() => setOpen(!open)}>匯入流程規格</button>
    <div id="workflow-transfer" className="transfer-panel" hidden={!open}><p>匯入成功會替換目前流程、表單及關聯；失敗時保留原流程。</p>
    <fieldset disabled={busy}><legend className="visually-hidden">流程規格檔</legend>
      <input id="workflow-file" className="file-input" type="file" accept=".json,application/json" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setBusy(true);
        try { const input = await readJsonFile(file); if (mounted.current) accept(input); }
        catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '無法讀取流程規格。'); }
        finally { if (mounted.current) setBusy(false); }
      }} /><label htmlFor="workflow-file" className="file-button">選擇流程規格檔</label>
      <details><summary>進階：貼上流程 JSON</summary><label htmlFor="workflow-json">流程 JSON</label><textarea id="workflow-json" value={text} onChange={e => setText(e.target.value)} /><button onClick={() => accept(text)}>匯入流程 JSON</button></details>
    </fieldset><p role={error ? 'alert' : undefined}>{error}</p><ul role="status">{notices.map((notice, i) => <li key={i}>{notice}</li>)}</ul>
  </div></>;
}
