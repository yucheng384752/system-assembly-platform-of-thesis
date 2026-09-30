import { useState } from 'react';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { flows, selectKits } from './catalog';
import { catalog } from './previewCatalog';
import { KitPreview } from './KitPreview';

const descriptions: Record<string, string> = {
  'data-import': '選擇上傳、檢查與匯入資料所需的功能。',
  'query-trace': '依批號或產品編號查詢資料，追溯各站點紀錄。',
  analytics: '整理資料摘要，查看趨勢與分析結果。',
  'generic-forms': '自訂表單欄位，管理不同種類的紀錄。',
  governance: '管理站點、修正紀錄，查看操作歷程。',
};
export function FlowPage({ recipe, onChange, requested, manual, onSelect, session }: {
  recipe: Recipe; onChange: (r: Recipe) => void; requested: string[]; manual: string[];
  onSelect: (flows: string[], kits: string[]) => void; session: number;
}) {
  const [search, setSearch] = useState('');
  const selection = selectKits(catalog.kits, requested, manual);
  const fixed = selectKits(catalog.kits, requested).enabledKits;
  return <>
    <p>選擇工作需要的流程，系統會加入必要功能。此處為設定與模擬預覽，尚未執行資料匯入或組裝部署。</p>
    <fieldset><legend>業務流程</legend><div className="flow-grid">{flows.map(flow => {
      const checked = selection.selectedFlows.includes(flow.id);
      const prerequisite = flows.some(f => selection.selectedFlows.includes(f.id) && f.requiresFlows?.includes(flow.id));
      return <div className="panel" key={flow.id}><label><input type="checkbox" checked={checked} disabled={flow.required || prerequisite}
        onChange={event => onSelect(event.target.checked ? [...requested, flow.id] : requested.filter(id => id !== flow.id), manual)} />{flow.name}{flow.required ? '（必要流程）' : prerequisite ? '（其他流程需要）' : ''}</label>
        <p>{descriptions[flow.id]}</p>{flow.subflows.map(sub => <p key={sub.id}>{sub.name}：{sub.description}</p>)}</div>;
    })}</div></fieldset>
    <section aria-labelledby="auto-title"><h2 id="auto-title">自動加入的功能</h2>
      <p role="status">目前選了 {selection.selectedFlows.length} 個流程、{recipe.enabledKits.length} 項功能。</p>
      <ul>{selection.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    </section>
    <details><summary>進階：功能目錄與搜尋</summary>
      <label htmlFor="kit-search">搜尋功能名稱或識別碼</label><input id="kit-search" type="search" value={search} onChange={e => setSearch(e.target.value)} />
      {catalog.kits.filter(k => `${k.displayName} ${k.id}`.toLowerCase().includes(search.toLowerCase())).map(kit => <label key={kit.id}>
        <input type="checkbox" checked={recipe.enabledKits.includes(kit.id)} disabled={fixed.includes(kit.id) || (!manual.includes(kit.id) && recipe.enabledKits.includes(kit.id))}
          onChange={e => onSelect(requested, e.target.checked ? [...manual, kit.id] : manual.filter(id => id !== kit.id))} />{kit.displayName}（{kit.id}）
      </label>)}
      <p>必要或相依功能不能直接取消；請先取消需要它的流程或功能。</p>
    </details>
    <h2>畫面預覽與調整</h2><p>下方只使用模擬資料。設定提示不代表身分授權；目前尚未串接身分驗證。</p>
    <KitPreview key={session} recipe={recipe} onChange={onChange} catalog={catalog} session={session} />
  </>;
}
