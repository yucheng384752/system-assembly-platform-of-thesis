import { useState } from 'react';
import { describeError, INIT_HINT, PreviewError, type PreviewApi, type UploadResult, type UploadStatus } from './previewApi';

// Upload creates a validation job in the preview database, so it only runs on the explicit button.
export function LiveUpload({ api }: { api: PreviewApi }) {
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<UploadResult>();
  const [status, setStatus] = useState<UploadStatus>();
  const run = async () => {
    if (!file) return;
    setBusy(true); setError(''); setResult(undefined); setStatus(undefined);
    try {
      const uploaded = await api.upload(file);
      setResult(uploaded);
      setStatus(await api.uploadStatus(uploaded.processId));
    } catch (e) { setError(e instanceof PreviewError && e.status === 404 ? INIT_HINT : describeError(e)); }
    finally { setBusy(false); }
  };
  return <div>
    <label className="file-button">選擇要檢查的檔案<input type="file" accept=".csv,.xlsx,.xls" onChange={e => { setFile(e.target.files?.[0]); setResult(undefined); setStatus(undefined); setError(''); }} /></label>
    <p>{file ? `已選擇：${file.name}` : '尚未選擇檔案。'}</p>
    <p className="column-foot">按下後會寫入預覽資料庫（測試用）。</p>
    <button className="primary" disabled={!file || busy} onClick={() => void run()}>上傳並檢查（寫入預覽資料庫，測試用）</button>
    {error && <p role="alert">{error}</p>}
    {result && <section aria-label="檢查結果"><p role="status">共 {result.totalRows} 列，通過 {result.validRows} 列，有問題 {result.invalidRows} 列{status ? `；處理狀態：${status.status}` : ''}。</p>
      {result.errors.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label="驗證錯誤"><table><caption>驗證錯誤範例</caption><thead><tr><th scope="col">資料列</th><th scope="col">欄位</th><th scope="col">說明</th></tr></thead>
        <tbody>{result.errors.map((e, i) => <tr key={i}><td>第 {e.rowIndex + 1} 列</td><td>{e.field}</td><td>{e.message}</td></tr>)}</tbody></table></div>}
    </section>}
  </div>;
}
