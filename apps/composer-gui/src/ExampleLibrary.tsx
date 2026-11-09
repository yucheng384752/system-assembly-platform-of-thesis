import { useState } from 'react';
import { loadKitExamples, type KitExample } from './kitExamples';
import { workflowStatus } from './kitWorkflows';
import { exportAovGraphDraft, type AovGraphDocument } from './workflowGraph';
import { downloadJson } from './fileTransfer';

export function ExampleLibrary({ current, onLoad, examples }: {
  current: AovGraphDocument; onLoad(doc: AovGraphDocument): void; examples?: KitExample[];
}) {
  const [defaults] = useState(loadKitExamples);
  const rows = examples ?? defaults;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string>();
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState('');
  function load(row: KitExample) {
    if (!row.result) return;
    onLoad(structuredClone(row.result.value));
    setPending(undefined); setError(''); setNotices(row.result.notices);
  }
  function download(row: KitExample) {
    if (!row.result) return;
    try {
      downloadJson(exportAovGraphDraft(row.result.value), `${row.kitId}-example.json`);
      setError(''); setNotices(['已下載範例流程規格（草稿）。', ...row.result.notices]);
    } catch { setError('範例流程規格無法下載，請確認範例內容。'); }
  }
  return <><button aria-expanded={open} aria-controls="example-library" onClick={() => setOpen(!open)}>範例庫</button>
    <div id="example-library" className="transfer-panel" hidden={!open}>
      <p>範例是各功能提供的參考流程，載入後可以修改；內容多為草稿，不代表已通過執行驗證。</p>
      {!rows.some(row => row.result) && <p role="status">目前沒有可用的範例</p>}
      <ul className="example-list">{rows.map(row => <li key={row.kitId}>
        <p>{row.name} {row.version}</p>
        {row.result ? <><p>{row.status && workflowStatus[row.status]}</p><p>{row.steps} 個步驟中 {row.mapped} 個可對應功能</p></>
          : <p>無法載入：{row.error}</p>}
        <button disabled={!row.result} onClick={() => { if (current.factories.length) setPending(row.kitId); else load(row); }}>載入到畫布<span className="visually-hidden">：{row.name}</span></button>
        <button disabled={!row.result} onClick={() => download(row)}>下載範例流程規格（草稿）<span className="visually-hidden">：{row.name}</span></button>
        {pending === row.kitId && <div role="group" aria-label={`確認載入：${row.name}`}>
          <p>載入會替換目前的流程、表單與關聯</p>
          <button onClick={() => load(row)}>確認載入</button><button onClick={() => setPending(undefined)}>取消</button>
        </div>}
      </li>)}</ul>
      {error && <p role="alert">{error}</p>}
      <ul role="status">{notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul>
    </div>
  </>;
}
