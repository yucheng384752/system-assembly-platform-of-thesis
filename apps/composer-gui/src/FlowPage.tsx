import { useState } from 'react';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { flows, selectKits } from './catalog';
import { catalog } from './previewCatalog';
import { KitPreview } from './KitPreview';
import { Column } from './Column';
import { Icon } from './Icons';

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
    <p className="visually-hidden">此處為設定與模擬預覽，尚未執行資料匯入或組裝部署。</p>
    <div className="columns">
    <Column id="flows" title="業務流程選擇" lead="選擇本次需要的功能模組。"
      aside={<small className="column-foot"><Icon name="info" />必要功能已自動加入</small>}>
    <fieldset><legend className="visually-hidden">業務流程</legend><div className="flow-list">{flows.map(flow => {
      const checked = selection.selectedFlows.includes(flow.id);
      const prerequisite = flows.some(f => selection.selectedFlows.includes(f.id) && f.requiresFlows?.includes(flow.id));
      const note = flow.required ? '必要' : prerequisite ? '其他流程需要' : '';
      return <div className="flow-card" key={flow.id}><div className="flow-title"><label><input type="checkbox" checked={checked} disabled={flow.required || prerequisite}
        aria-describedby={note ? `${flow.id}-note` : undefined}
        onChange={event => onSelect(event.target.checked ? [...requested, flow.id] : requested.filter(id => id !== flow.id), manual)} /><strong>{flow.name}</strong>{flow.required && <Icon name="lock" />}</label>
        {note && <span id={`${flow.id}-note`} className="badge badge-selected">{note}</span>}</div>
        <p className="muted">{descriptions[flow.id]}</p>{flow.subflows.map(sub => <p key={sub.id} className="muted"><small>{sub.name}：{sub.description}</small></p>)}</div>;
    })}</div></fieldset>
    <section aria-labelledby="auto-title"><h3 id="auto-title" className="actions"><Icon name="link" />相依功能</h3>
      <p role="status" className="muted">目前選了 {selection.selectedFlows.length} 個流程、{recipe.enabledKits.length} 項功能。</p>
      <div className="note"><ul>{selection.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>
    </section>
    <details><summary>進階：功能目錄與搜尋</summary>
      <label htmlFor="kit-search">搜尋功能名稱或識別碼</label><input id="kit-search" type="search" value={search} onChange={e => setSearch(e.target.value)} />
      {catalog.kits.filter(k => `${k.displayName} ${k.id}`.toLowerCase().includes(search.toLowerCase())).map(kit => <label key={kit.id}>
        <input type="checkbox" checked={recipe.enabledKits.includes(kit.id)} disabled={fixed.includes(kit.id) || (!manual.includes(kit.id) && recipe.enabledKits.includes(kit.id))}
          onChange={e => onSelect(requested, e.target.checked ? [...manual, kit.id] : manual.filter(id => id !== kit.id))} />{kit.displayName}（{kit.id}）
      </label>)}
      <p>必要或相依功能不能直接取消；請先取消需要它的流程或功能。</p>
    </details>
    </Column>
    <KitPreview key={session} split recipe={recipe} onChange={onChange} catalog={catalog} session={session} />
    </div>
  </>;
}
