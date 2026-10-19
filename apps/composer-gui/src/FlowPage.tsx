import { useState, type ReactNode } from 'react';
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
export function FlowPage({ recipe, onChange, requested, manual, onSelect, session, graph, derived, site, onShowCanvas, onJumpNode }: {
  onShowCanvas: () => void; onJumpNode: (nodeId: string) => void;
  recipe: Recipe; onChange: (r: Recipe) => void; requested: string[]; manual: string[];
  onSelect: (flows: string[], kits: string[]) => void; session: number; graph: AovGraphDocument; derived: Derivation; site?: SiteProfile;
}) {
  const [search, setSearch] = useState('');
  const ids = derived.kits.map(k => k.kitId);
  const selection = selectKits(catalog.kits, requested, manual, flows, ids);
  const fixed = selectKits(catalog.kits, requested, [], flows, ids).enabledKits;
  const nodes = graph.graphs.flatMap(g => g.nodes);
  const nodeCount = nodes.filter(n => n.kind === 'node').length;
  const actionCount = nodes.filter(n => n.actionId).length;
  const reasons = (kit: Derivation['kits'][number]) => {
    const items: ReactNode[] = [];
    const seen = new Set<string>();
    for (const reason of kit.reasons) {
      if (reason.kind === 'dependency') { items.push(<li key={`dep-${reason.fromKit}`}>因為使用「{kitName(reason.fromKit)}」，系統會自動加入「{kitName(kit.kitId)}」。</li>); continue; }
      const action = actionCatalog.actions.find(a => a.id === reason.actionId)?.name;
      for (const n of nodes.filter(x => x.actionId === reason.actionId)) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        const place = nodePlace(graph, n.id);
        items.push(<li key={`${reason.actionId}-${n.id}`}><button className="node-link" onClick={() => onJumpNode(n.id)} aria-label={`到流程畫布查看節點：${n.name || '（未命名節點）'}`}>{n.name || '（未命名節點）'}</button>{' → '}{action}{place && <small className="muted">（{place.factory.name}／{place.logic.name}）</small>}</li>);
      }
    }
    return items;
  };
  const kitName = (id: string) => catalog.kits.find(k => k.id === id)?.displayName ?? '尚未提供的功能';
  return <>
    <p className="visually-hidden">此處為設定與模擬預覽，尚未執行資料匯入或組裝部署。</p>
    <div className="columns">
    <Column id="flows" title="業務流程選擇" lead="選擇本次需要的功能模組。"
      aside={<small className="column-foot"><Icon name="info" />必要功能已自動加入</small>}>
    <section aria-labelledby="derived-title"><h3 id="derived-title">由流程畫布帶入</h3>
      <p className="source-summary" role="status">流程畫布共 {nodeCount} 個節點、{actionCount} 個已指定動作 → 自動帶入 {derived.kits.length} 個功能。<button onClick={onShowCanvas}>回到流程畫布</button></p>
      {!nodeCount && <p>先到流程畫布加入節點並指定動作，這裡會自動列出所需功能。</p>}
      {nodeCount > 0 && !actionCount && <p>畫布上的節點還沒有指定動作，所以沒有帶入功能。</p>}
      {derived.kits.map(kit => <div className="flow-card" key={kit.kitId}>
      <label><input type="checkbox" checked disabled />{kitName(kit.kitId)}（流程需要）</label>
      <ul>{reasons(kit)}</ul>
    </div>)}</section>
    {derived.ambiguities.map((item, i) => <fieldset key={i}><legend>待選擇的功能 {i + 1}</legend><p>此需求有多個可用功能，請選擇其中一個。</p>
      <select aria-label={`待選擇的功能 ${i + 1}`} value={item.candidates.find(c => manual.includes(c.kitId))?.kitId ?? ''} onChange={e => onSelect(requested, [...manual.filter(id => !item.candidates.some(c => c.kitId === id)), ...(e.target.value ? [e.target.value] : [])])}><option value="">請選擇</option>{[...new Set(item.candidates.map(c => c.kitId))].map(id => <option key={id} value={id}>{kitName(id)}</option>)}</select>
    </fieldset>)}
    <p role="status">{derived.gaps.length ? `有 ${derived.gaps.length} 項功能需求尚無完整驗證資料，請交由維護人員確認。` : '流程所需功能的推導沒有缺口。'}</p>
    <details><summary>尚未納入自動推導的功能</summary><p>以下功能的說明尚未齊全，目前只提供手動選配。</p><ul>{catalog.kits.filter(k => !registry.some(r => r.kitId === k.id)).map(k => <li key={k.id}>{k.displayName}</li>)}</ul></details>
    <h3>手動補選</h3><p className="muted">畫布沒有涵蓋、但仍需要的業務流程，在這裡勾選。</p>
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
          onChange={e => onSelect(requested, e.target.checked ? [...manual, kit.id] : manual.filter(id => id !== kit.id))} />{kit.displayName}
      </label>)}
      <p>必要或相依功能不能直接取消；請先取消需要它的流程或功能。</p>
    </details>
    </Column>
    <KitPreview key={session} split site={site} recipe={recipe} onChange={onChange} catalog={catalog} session={session} />
    </div>
  </>;
}
