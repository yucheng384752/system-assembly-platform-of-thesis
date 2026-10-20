import { WorkflowSimulation } from './WorkflowSimulation';
import type { SimulationSession } from './simulation';
import { useState } from 'react';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { flows, selectKits } from './catalog';
import { catalog } from './previewCatalog';
import { KitPreview } from './KitPreview';
import { Column } from './Column';
import { Icon } from './Icons';
import type { SiteProfile } from '../../../libs/ui-runtime/site';
import type { Derivation } from '../../../libs/ui-runtime/actions';
import { nodePlace, type AovGraphDocument } from './workflowGraph';
import { actionCatalog } from './workflow';
import { registry } from './registryData';

const descriptions: Record<string, string> = {
  'data-import': '選擇上傳、檢查與匯入資料所需的功能。',
  'query-trace': '依批號或產品編號查詢資料，追溯各站點紀錄。',
  analytics: '整理資料摘要，查看趨勢與分析結果。',
  'generic-forms': '自訂表單欄位，管理不同種類的紀錄。',
  governance: '管理站點、修正紀錄，查看操作歷程。',
};
export function FlowPage({ recipe, onChange, requested, manual, onSelect, session, graph, derived, site, simulation, onSimulationChange }: {
  simulation: SimulationSession; onSimulationChange: (s: SimulationSession) => void; recipe: Recipe; onChange: (r: Recipe) => void; requested: string[]; manual: string[];
  onSelect: (flows: string[], kits: string[]) => void; session: number; graph: AovGraphDocument; derived: Derivation; site?: SiteProfile;
}) {
  const [pendingKit, setPendingKit] = useState('');
  const [search, setSearch] = useState('');
  const ids = derived.kits.map(k => k.kitId);
  const selection = selectKits(catalog.kits, requested, manual, flows, ids);
  const fixed = selectKits(catalog.kits, requested, [], flows, ids).enabledKits;
  const kitName = (id: string) => catalog.kits.find(k => k.id === id)?.displayName ?? '尚未提供的功能';
  return <>
    <p className="visually-hidden">此處為設定與模擬預覽，尚未執行資料匯入或組裝部署。</p>
    <div className="columns integrated-columns">
    <Column scroll id="flows" title="業務流程選擇" lead="選擇本次需要的功能模組。"
      aside={<small className="column-foot"><Icon name="info" />必要功能已自動加入</small>}>
    <section aria-labelledby="derived-title"><h3 id="derived-title">流程所需功能</h3>{derived.kits.length ? derived.kits.map(kit => <div className="flow-card" key={kit.kitId}>
      <label><input type="checkbox" checked disabled />{kitName(kit.kitId)}（流程需要）</label>
      <ul>{[...new Set(kit.reasons.flatMap(reason => reason.kind === 'dependency' ? [`因為使用「${kitName(reason.fromKit)}」，系統會自動加入「${kitName(kit.kitId)}」。`] : graph.graphs.flatMap(g => g.nodes).filter(n => n.actionId === reason.actionId).map(n => { const place = nodePlace(graph, n.id); return `因為${place ? `「${place.factory.name}」的「${place.logic.name}」中，` : ''}「${n.name}」要做「${actionCatalog.actions.find(a => a.id === reason.actionId)?.name}」，需要「${kitName(kit.kitId)}」。`; })))].map(reason => <li key={reason}>{reason}</li>)}</ul>
    </div>) : <p>目前沒有動作需要額外功能。</p>}</section>
    {derived.ambiguities.map((item, i) => <fieldset key={i}><legend>待選擇的功能 {i + 1}</legend><p>此需求有多個可用功能，請選擇其中一個。</p>
      <select aria-label={`待選擇的功能 ${i + 1}`} value={item.candidates.find(c => manual.includes(c.kitId))?.kitId ?? ''} onChange={e => onSelect(requested, [...manual.filter(id => !item.candidates.some(c => c.kitId === id)), ...(e.target.value ? [e.target.value] : [])])}><option value="">請選擇</option>{[...new Set(item.candidates.map(c => c.kitId))].map(id => <option key={id} value={id}>{kitName(id)}</option>)}</select>
    </fieldset>)}
    <p role="status">{derived.gaps.length ? `有 ${derived.gaps.length} 項功能需求尚無完整驗證資料，請交由維護人員確認。` : '流程所需功能的推導沒有缺口。'}</p>
    <details><summary>尚未納入自動推導的功能</summary><p>以下功能的說明尚未齊全，目前只提供手動選配。</p><ul>{catalog.kits.filter(k => !registry.some(r => r.kitId === k.id)).map(k => <li key={k.id}>{k.displayName}</li>)}</ul></details>
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
    <details><summary>進階：功能目錄與搜尋</summary>
      <label htmlFor="kit-search">搜尋功能名稱</label><input id="kit-search" type="search" value={search} onChange={e => setSearch(e.target.value)} />
      {catalog.kits.filter(k => k.displayName.toLowerCase().includes(search.toLowerCase())).map(kit => <label key={kit.id}>
        <input type="checkbox" aria-label={`選配功能：${kit.displayName}`} checked={recipe.enabledKits.includes(kit.id)} disabled={fixed.includes(kit.id) || (!manual.includes(kit.id) && recipe.enabledKits.includes(kit.id))}
          onChange={e => e.target.checked ? setPendingKit(kit.id) : onSelect(requested, manual.filter(id => id !== kit.id))} />{kit.displayName}
      </label>)}
      {pendingKit && <div className="kit-confirm" role="group" aria-label="確認加入功能"><p>是否加入「{kitName(pendingKit)}」？</p><button aria-label="確認加入" onClick={() => { onSelect(requested, [...new Set([...manual, pendingKit])]); setPendingKit(''); }}>✓ 加入</button><button aria-label="取消加入" onClick={() => setPendingKit('')}>× 取消</button></div>}
      <p>必要或相依功能不能直接取消；請先取消需要它的流程或功能。</p>
    </details>
    </Column>
    <KitPreview simulation={<WorkflowSimulation graph={graph} recipe={recipe} session={simulation} onChange={onSimulationChange} />} key={session} split site={site} recipe={recipe} onChange={onChange} catalog={catalog} session={session} />
    </div>
  </>;
}
