import { useCallback, useEffect, useState } from 'react';
import { describeError, INIT_HINT, PreviewError, type FormSummary, type PreviewApi, type RecordPage } from './previewApi';

// Reads are automatic; the one write (create a form) happens only on the explicit button.
export function LiveGenericForms({ api }: { api: PreviewApi }) {
  const [forms, setForms] = useState<FormSummary[]>();
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState<RecordPage>();
  const [pageError, setPageError] = useState('');
  const load = useCallback(() => api.listForms().then(setForms).then(() => setError(''), (e: unknown) => setError(e instanceof PreviewError && e.status === 404 ? INIT_HINT : describeError(e))), [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) { setPage(undefined); return; }
    let current = true;
    api.listRecords(selected).then(p => { if (current) { setPage(p); setPageError(''); } }, (e: unknown) => { if (current) { setPage(undefined); setPageError(describeError(e, '找不到這張表單')); } });
    return () => { current = false; };
  }, [api, selected]);
  const create = async () => {
    try { const form = await api.createForm(code.trim(), name.trim()); setNotice(`已建立表單「${form.name}」。`); setCode(''); setName(''); setError(''); await load(); setSelected(form.code); }
    catch (e) { setNotice(''); setError(describeError(e)); }
  };
  const columns = page ? [...new Set(page.records.flatMap(r => Object.keys(r.data)))] : [];
  return <div>
    {error && <p role="alert">{error}</p>}
    {forms && <table><caption>表單清單</caption><thead><tr><th scope="col">代碼</th><th scope="col">名稱</th><th scope="col">欄位數</th><th scope="col">操作</th></tr></thead>
      <tbody>{forms.map(f => <tr key={f.id}><td>{f.code}</td><td>{f.name}</td><td>{f.fieldCount}</td><td><button aria-pressed={selected === f.code} aria-label={`檢視資料列：${f.name}`} onClick={() => setSelected(selected === f.code ? '' : f.code)}>檢視資料列</button></td></tr>)}
        {forms.length === 0 && <tr><td colSpan={4}>尚未建立任何表單。</td></tr>}</tbody></table>}
    {pageError && <p role="alert">{pageError}</p>}
    {page && <div className="table-scroll" tabIndex={0} role="region" aria-label="表單資料列"><table><caption>資料列（共 {page.total} 筆）</caption>
      <thead><tr><th scope="col">批號</th>{columns.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
      <tbody>{page.records.map(r => <tr key={r.id}><td>{r.lotNo}</td>{columns.map(c => <td key={c}>{r.data[c] ?? ''}</td>)}</tr>)}
        {page.records.length === 0 && <tr><td colSpan={columns.length + 1}>這張表單還沒有資料列。</td></tr>}</tbody></table></div>}
    <fieldset><legend>建立表單</legend>
      <label>表單代碼<input value={code} onChange={e => setCode(e.target.value)} /></label>
      <label>表單名稱<input value={name} onChange={e => setName(e.target.value)} /></label>
      <p className="column-foot">按下後會寫入預覽資料庫（測試用）。</p>
      <button className="primary" disabled={!code.trim() || !name.trim()} onClick={() => void create()}>建立表單（寫入預覽資料庫，測試用）</button>
      {notice && <p role="status">{notice}</p>}
    </fieldset>
  </div>;
}
