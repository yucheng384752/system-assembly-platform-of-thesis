import { useState } from 'react';
import { exportFormLibrary, FORM_LIBRARY_FILE, parseFormLibrary, type FormLibrary } from '../../../libs/aov-integration/formLibrary';
import { exportProjectDetails, parseProjectDetails, PROJECT_DETAILS_FILE, type ProjectDetails } from '../../../libs/aov-integration/projectDetails';
import { downloadJson, readJsonFile } from './fileTransfer';
import { Icon } from './Icons';

// Node settings and the form library as loose files, to load back and edit again. A file replaces the session's copy only when
// the whole of it passes; otherwise the current settings stay and every reason is listed.
export function SettingsTransfer({ details, forms, onDetailsImport, onFormsImport }: {
  details: ProjectDetails; forms: FormLibrary; onDetailsImport: (next: ProjectDetails) => void; onFormsImport: (next: FormLibrary) => void;
}) {
  const [problems, setProblems] = useState<{ file: string; errors: string[] }>();
  const [notice, setNotice] = useState('');

  async function load(file: File | undefined, kind: 'details' | 'forms') {
    if (!file) return;
    const label = kind === 'details' ? '節點細項' : '表單庫';
    try {
      const text = await readJsonFile(file);
      const result = kind === 'details' ? parseProjectDetails(text) : parseFormLibrary(text);
      if (!result.ok) { setProblems({ file: label, errors: result.errors }); setNotice(''); return; }
      if (result.ok && 'details' in result) onDetailsImport(result.details); else if (result.ok && 'library' in result) onFormsImport(result.library);
      setProblems(undefined); setNotice(`${label}已載入，取代目前的內容。`);
    } catch (failure) {
      setProblems({ file: label, errors: [failure instanceof Error ? failure.message : '檔案讀取失敗。'] }); setNotice('');
    }
  }

  return <div className="file-card"><Icon name="file" /><div>
    <strong>節點細項與表單庫</strong>
    <p className="muted">物料型別、領料、填單、入庫與出庫的設定，以及客戶表單。不含資料列或樣本內容。</p>
    <div className="actions">
      <button onClick={() => { downloadJson(exportProjectDetails(details), PROJECT_DETAILS_FILE); setNotice('節點細項已下載。'); }}><Icon name="download" />下載節點細項</button>
      <button onClick={() => { downloadJson(exportFormLibrary(forms), FORM_LIBRARY_FILE); setNotice('表單庫已下載。'); }}><Icon name="download" />下載表單庫</button>
    </div>
    <input id="details-file" className="file-input" type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void load(file, 'details'); }} />
    <label htmlFor="details-file" className="file-button"><Icon name="folder" />載入節點細項</label>
    <input id="forms-file" className="file-input" type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void load(file, 'forms'); }} />
    <label htmlFor="forms-file" className="file-button"><Icon name="folder" />載入表單庫</label>
    {problems && <div role="alert"><p><Icon name="warning" />{problems.file}沒有載入，目前的內容已保留：</p><ul>{problems.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
    <p role="status">{notice}</p>
  </div></div>;
}
