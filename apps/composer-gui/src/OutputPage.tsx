import type { Recipe } from '../../../libs/ui-runtime/types';
import { catalog } from './previewCatalog';
import { RecipeTransfer } from './RecipeTransfer';

export function OutputPage({ recipe, onChange, onImport }: { recipe: Recipe; onChange: (recipe: Recipe) => void; onImport: (recipe: Recipe) => void }) {
  return <>
    <h2>確認組裝內容</h2><p>已選擇 {recipe.enabledKits.length} 項功能。下載檔案保存功能選擇與可調整的畫面設定。</p>
    <ul>{catalog.kits.filter(k => recipe.enabledKits.includes(k.id)).map(k => <li key={k.id}>{k.displayName}</li>)}</ul>
    <label htmlFor="client-name">客戶名稱</label>
    <input id="client-name" value={recipe.clientName ?? ''} maxLength={100} required aria-describedby="client-note client-error" onChange={e => onChange({ ...recipe, clientName: e.target.value })} />
    <p id="client-note">請填寫去識別化的客戶代稱，勿包含個資或秘密值。</p>
    <p id="client-error">{!recipe.clientName?.trim() ? '請填寫客戶名稱後下載。' : ''}</p>
    <p>檔案不包含原始資料列、資料連線或密碼；表單欄位草稿與 AOV 流程說明也不在此檔案內。</p>
    <RecipeTransfer recipe={recipe} onImport={onImport} catalog={catalog} />
    <section aria-labelledby="deployment-title"><h2 id="deployment-title">部署套件</h2><p>部署套件產生功能尚未提供。目前下載的是系統設定檔，尚不能直接部署為可執行系統。</p></section>
  </>;
}
