import { useEffect, useRef, useState } from 'react';
import { parseSite } from '../../../libs/ui-runtime/site';
import { catalog } from './previewCatalog';
import { readJsonFile } from './fileTransfer';
import { sha256Hex } from './workflow';
import type { SiteSession } from './siteSession';

export function SiteTransfer({ current, referenced, onChange }: { current?: SiteSession; referenced: boolean; onChange: (site?: SiteSession) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <fieldset disabled={busy}><legend>場域設定</legend>
    <p id="site-note">匯入維護人員提供的場域設定。請使用模擬或去識別化資料，不可包含秘密值。僅保留於本次工作階段。</p>
    <input id="site-file" className="file-input" type="file" accept=".json,application/json" aria-describedby="site-note site-import-error" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      setBusy(true);
      try {
        const text = await readJsonFile(file);
        const result = parseSite(text, catalog);
        const sha256 = await sha256Hex(text);
        if (mounted.current) { onChange({ text, ...result, sha256 }); setError(''); }
      } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '場域設定讀取失敗。'); }
      finally { if (mounted.current) setBusy(false); }
    }} />
    <label htmlFor="site-file" className="file-button">匯入場域設定</label>
    <p role="status">{current ? `目前場域：${current.site.displayName}，版本 ${current.site.siteVersion}` : '尚未匯入場域設定。'}</p>
    {current && current.notices.length > 0 && <ul aria-label="待確認的場域語意">{current.notices.map(note => <li key={note}>{note}</li>)}</ul>}
    {(current || referenced) && <button onClick={() => { onChange(undefined); setError(''); }}>移除場域</button>}
    <p id="site-import-error" role={error ? 'alert' : undefined}>{error ? '場域設定匯入失敗，原場域已保留。請依驗證詳情修正檔案。' : ''}</p>
    {error && <details><summary>進階：場域驗證詳情</summary><p>{error}</p></details>}
  </fieldset>;
}
