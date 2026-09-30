import type { Recipe } from '../../../libs/ui-runtime/types';
import { flows } from './catalog';
import { catalog } from './previewCatalog';
import { RecipeTransfer } from './RecipeTransfer';
import { Column } from './Column';
import { Icon } from './Icons';

const included = ['客戶代稱', '已選功能', '可調整的畫面設定'];
const excluded = ['原始資料列', '連線資訊與密碼', '表單欄位草稿', 'AoV 流程說明'];
export function OutputPage({ recipe, selectedFlows, onChange, onImport }: { recipe: Recipe; selectedFlows: string[]; onChange: (recipe: Recipe) => void; onImport: (recipe: Recipe) => void }) {
  const name = (id: string) => catalog.kits.find(k => k.id === id)?.displayName ?? id;
  const groups = flows.filter(f => selectedFlows.includes(f.id)).map(f => ({ id: f.id, title: f.name, kits: f.kits.filter(id => recipe.enabledKits.includes(id)) }));
  // Required features and dependencies that no selected flow names directly.
  const others = recipe.enabledKits.filter(id => !groups.some(g => g.kits.includes(id)));
  return <div className="columns">
    <Column id="summary" title="選配摘要" lead={`已選擇 ${recipe.enabledKits.length} 項功能，依業務流程列出。`}>
      {[...groups, ...(others.length ? [{ id: 'others', title: '必要與相依功能', kits: others }] : [])].map(group => <section key={group.id} className="flow-card" aria-labelledby={`sum-${group.id}`}>
        <div className="flow-title"><h3 id={`sum-${group.id}`} className="actions"><Icon name="check" />{group.title}</h3><span className="badge badge-selected">已選擇</span></div>
        <p className="muted">包含的功能</p><ul>{group.kits.map(id => <li key={id}>{name(id)}</li>)}</ul>
      </section>)}
      <p className="column-foot"><Icon name="info" />必要功能一併保留，已包含於系統設定檔中。</p>
    </Column>
    <Column id="recipe" title="系統設定檔" lead="設定客戶代稱並下載系統設定檔。">
      <label htmlFor="client-name" className="field-label">客戶代稱</label>
      <input id="client-name" value={recipe.clientName ?? ''} maxLength={100} required aria-describedby="client-note client-error" onChange={e => onChange({ ...recipe, clientName: e.target.value })} />
      <p id="client-note" className="muted">使用去識別化代稱，勿包含個資或秘密值。</p>
      <p id="client-error">{!recipe.clientName?.trim() ? '請填寫客戶代稱後下載。' : ''}</p>
      <RecipeTransfer recipe={recipe} onImport={onImport} catalog={catalog} />
    </Column>
    <Column id="contents" title="檔案內容" lead="此設定檔包含與不包含的項目說明。">
      <ul className="check-list"><li className="list-title">包含</li>{included.map(item => <li key={item}><Icon name="check" />{item}</li>)}</ul>
      <ul className="check-list excluded"><li className="list-title">不包含</li>{excluded.map(item => <li key={item}><Icon name="minus" />{item}</li>)}</ul>
      <section aria-labelledby="deployment-title"><div className="flow-title"><h3 id="deployment-title">部署套件</h3><span className="badge badge-pending">尚未提供</span></div>
        <p className="muted">部署套件產生功能尚未提供；目前下載的設定檔不能直接部署。</p></section>
    </Column>
  </div>;
}
