import { useEffect, useMemo, useState } from 'react';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { flows } from './catalog';
import { catalog } from './previewCatalog';
import { RecipeTransfer } from './RecipeTransfer';
import { exportRecipe } from '../../../libs/ui-runtime/recipe';
import { downloadBlob, downloadJson } from './fileTransfer';
import { buildDeliveryPackage } from './deliveryPackage';
import { exportAov, sha256Hex, WORKFLOW_FILE, type AovDocument } from './workflow';
import { Column } from './Column';
import { Icon } from './Icons';

const included = ['客戶代稱', '已選功能', '可調整的畫面設定', '流程規格的檔名與校驗碼'];
const workflowIncluded = ['流程步驟、時機與負責職務', '各步驟的表單欄位定義', '已確認的表單關聯'];
const excluded = ['原始資料列與樣本內容', '連線資訊與密碼', '未確認的推測關聯'];
export function OutputPage({ recipe, workflow, selectedFlows, onChange, onImport }: { recipe: Recipe; workflow: AovDocument; selectedFlows: string[]; onChange: (recipe: Recipe) => void; onImport: (recipe: Recipe) => void }) {
  const name = (id: string) => catalog.kits.find(k => k.id === id)?.displayName ?? id;
  const groups = flows.filter(f => selectedFlows.includes(f.id)).map(f => ({ id: f.id, title: f.name, kits: f.kits.filter(id => recipe.enabledKits.includes(id)) }));
  // Required features and dependencies that no selected flow names directly.
  const others = recipe.enabledKits.filter(id => !groups.some(g => g.kits.includes(id)));
  // The downloaded text is the checksum input, so both files always describe the same Workflow (A22).
  const exported = useMemo(() => { try { return { text: exportAov(workflow), error: '' }; } catch (failure) { return { text: '', error: failure instanceof Error ? failure.message : '流程規格無法輸出。' }; } }, [workflow]);
  const [digest, setDigest] = useState({ text: '', sha256: '' });
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let current = true;
    if (exported.text) sha256Hex(exported.text).then(sha256 => { if (current) setDigest({ text: exported.text, sha256 }); });
    return () => { current = false; };
  }, [exported.text]);
  const sha256 = exported.text && digest.text === exported.text ? digest.sha256 : '';
  const linked: Recipe = sha256 ? { ...recipe, workflowRef: { path: WORKFLOW_FILE, sha256 } } : recipe;
  const [packing, setPacking] = useState(false);
  const [packageError, setPackageError] = useState('');
  const [packageNotice, setPackageNotice] = useState('');
  // Packs the same bytes as the separate downloads, so the package and the loose files never disagree (D36).
  async function downloadPackage() {
    setPacking(true);
    try {
      const built = await buildDeliveryPackage(exportRecipe(linked, catalog), exported.text, catalog);
      downloadBlob(new Blob([built.bytes], { type: 'application/zip' }), built.fileName);
      setPackageError(''); setPackageNotice(`已下載 ${built.fileName}；不含資料列、樣本內容或秘密值。`);
    } catch (failure) {
      setPackageNotice(''); setPackageError(failure instanceof Error ? failure.message : '設定交付包未產生。');
    } finally { setPacking(false); }
  }
  return <div className="columns">
    <Column id="summary" title="選配摘要" lead={`已選擇 ${recipe.enabledKits.length} 項功能，依業務流程列出。`}>
      {[...groups, ...(others.length ? [{ id: 'others', title: '必要與相依功能', kits: others }] : [])].map(group => <section key={group.id} className="flow-card" aria-labelledby={`sum-${group.id}`}>
        <div className="flow-title"><h3 id={`sum-${group.id}`} className="actions"><Icon name="check" />{group.title}</h3><span className="badge badge-selected">已選擇</span></div>
        <p className="muted">包含的功能</p><ul>{group.kits.map(id => <li key={id}>{name(id)}</li>)}</ul>
      </section>)}
      <p className="column-foot"><Icon name="info" />必要功能一併保留，已包含於系統設定檔中。</p>
    </Column>
    <Column id="recipe" title="流程規格與系統設定檔" lead="兩個檔案一起保存；設定檔以校驗碼對應流程規格。">
      <div className="file-card"><Icon name="file" /><div>
        <strong>{WORKFLOW_FILE}</strong><p className="muted">流程步驟、表單定義與已確認的關聯。</p>
        <p id="workflow-error" role={exported.error ? 'alert' : undefined}>{exported.error}</p>
        <button className="primary" disabled={!exported.text} aria-describedby="workflow-error" onClick={() => { downloadJson(exported.text, WORKFLOW_FILE); setNotice('流程規格已下載；不含資料列或樣本內容。'); }}><Icon name="download" />下載流程規格</button>
        <p role="status">{notice}</p>
      </div></div>
      <label htmlFor="client-name" className="field-label">客戶代稱</label>
      <input id="client-name" value={recipe.clientName ?? ''} maxLength={100} required aria-describedby="client-note client-error" onChange={e => onChange({ ...recipe, clientName: e.target.value })} />
      <p id="client-note" className="muted">使用去識別化代稱，勿包含個資或秘密值。</p>
      <p id="client-error">{!recipe.clientName?.trim() ? '請填寫客戶代稱後下載。' : ''}</p>
      <RecipeTransfer recipe={linked} catalog={catalog} blocked={!sha256} onImport={next => {
        onImport(next);
        setNotice(next.workflowRef && next.workflowRef.sha256 !== sha256 ? '注意：載入的設定檔記錄的流程規格與目前流程不同。請在「流程步驟」匯入對應的流程規格，或重新下載兩個檔案。' : '');
      }} />
    </Column>
    <Column id="contents" title="檔案內容" lead="兩個檔案包含與不包含的項目。">
      <ul className="check-list"><li className="list-title">系統設定檔包含</li>{included.map(item => <li key={item}><Icon name="check" />{item}</li>)}</ul>
      <ul className="check-list"><li className="list-title">流程規格包含</li>{workflowIncluded.map(item => <li key={item}><Icon name="check" />{item}</li>)}</ul>
      <ul className="check-list excluded"><li className="list-title">皆不包含</li>{excluded.map(item => <li key={item}><Icon name="minus" />{item}</li>)}</ul>
      <section aria-labelledby="deployment-title"><h3 id="deployment-title">設定交付包</h3>
        <p className="muted">將上述兩個檔案、檢查報告與檔案清單打包成單一壓縮檔。內容是設定，不能直接安裝或部署。</p>
        <button className="primary" disabled={packing || !sha256 || !recipe.clientName?.trim()} aria-describedby="package-error" onClick={downloadPackage}><Icon name="download" />下載設定交付包</button>
        <p id="package-error" role={packageError ? 'alert' : undefined}>{packageError}</p>
        <p role="status">{packageNotice}</p></section>
    </Column>
  </div>;
}
