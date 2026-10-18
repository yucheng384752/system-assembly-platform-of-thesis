import { useState, type ReactNode } from 'react';
import { resolveKit } from '../../../libs/ui-runtime/resolve';
import { Renderer } from '../../../libs/ui-runtime/Renderer';
import type { Recipe } from '../../../libs/ui-runtime/types';
import type { Catalog } from '../../../libs/ui-runtime/recipe';
import type { SiteProfile } from '../../../libs/ui-runtime/site';
import { SettingsEditor } from './SettingsEditor';
import { Column } from './Column';
import { Icon } from './Icons';
import './style.css';

// split: renders the preview column and one adjust column as two siblings for the configurator grid.
// part (split only): 'features' shows the sub-feature switches (step 02), 'params' shows the option editor (step 03, D-A2).
export function KitPreview({ recipe, onChange, catalog, session = 0, legacy = false, split = false, site, part = 'features' }: { recipe: Recipe; onChange: (recipe: Recipe) => void; catalog: Catalog; session?: number; legacy?: boolean; split?: boolean; site?: SiteProfile; part?: 'features' | 'params' }) {
  const { kits, definitions, sources } = catalog;
  const setRecipe = onChange;
  const [activeId, setActiveId] = useState('');
  const selected = kits.filter(k => recipe.enabledKits.includes(k.id));
  const active = selected.find(k => k.id === activeId) ?? selected[0];
  const definition = active && definitions[active.id];
  let preview;
  if (active && definition) {
    try {
      const resolved = resolveKit({ kit: active, definition, sources, site, overrides: recipe.selectedSubfeatureOptions, versions: recipe.uiOverrides, selectedSubfeatures: recipe.selectedSubfeatures[active.id] });
      preview = <Renderer key={`preview-${active.id}`} definition={resolved.definition} sources={sources} />;
    } catch (error) { preview = <p role="alert">{error instanceof Error ? error.message.replace(/（[^）]*）/g, '') : '預覽驗證失敗'}</p>; }
  }
  if (!active) return <p>尚未選取 Kit。</p>;
  const tabs = <div role="tablist" aria-label="已選 Kit">{selected.map((kit, index) => <button key={kit.id} id={`tab-${kit.id}`} role="tab" aria-selected={active.id === kit.id} aria-controls={`panel-${kit.id}`} tabIndex={active.id === kit.id ? 0 : -1} onClick={() => setActiveId(kit.id)} onKeyDown={event => {
    const next = event.key === 'ArrowRight' ? (index + 1) % selected.length : event.key === 'ArrowLeft' ? (index + selected.length - 1) % selected.length : event.key === 'Home' ? 0 : event.key === 'End' ? selected.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setActiveId(selected[next].id); document.getElementById(`tab-${selected[next].id}`)?.focus();
  }}>{kit.displayName}</button>)}</div>;
  const noScreen = <p>{legacy ? '此 Kit 無獨立操作畫面；本預覽不可編輯。' : '此功能沒有可調整的畫面'}</p>;
  const previewRegion = <div className="table-scroll" tabIndex={0} role="region" aria-label="模擬資料預覽">{preview}</div>;
  const panel = (content: ReactNode) => <section key={session} role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`} tabIndex={0}>
    <h3>{active.displayName}</h3><p>{active.businessCapability}</p>{content}
  </section>;
  const subfeatureBox = definition && <fieldset><legend>子功能</legend>{active.subfeatures.map(sub => <label key={sub.id}><input type="checkbox" disabled={sub.required || active.subfeatures.some(other => (recipe.selectedSubfeatures[active.id] ?? []).includes(other.id) && other.dependencies?.includes(sub.id))} checked={recipe.selectedSubfeatures[active.id]?.includes(sub.id) ?? sub.defaultSelected} onChange={event => {
      const enabled = recipe.selectedSubfeatures[active.id] ?? [];
      const next = new Set(event.target.checked ? [...enabled, sub.id] : enabled.filter(id => id !== sub.id));
      function addDependencies(id: string) { for (const dependency of active!.subfeatures.find(s => s.id === id)?.dependencies ?? []) if (!next.has(dependency)) { next.add(dependency); addDependencies(dependency); } }
      if (event.target.checked) addDependencies(sub.id);
      setRecipe({ ...recipe, selectedSubfeatures: { ...recipe.selectedSubfeatures, [active.id]: [...next] } });
    }} />{sub.displayName}</label>)}</fieldset>;
  const optionEditor = definition && <SettingsEditor site={site} legacy={legacy} key={active.id} kit={active} recipe={recipe} onChange={(subId, optionId, value) => {
      const key = `${active.id}::${subId}`;
      const candidate: Recipe = { ...recipe,
        selectedSubfeatureOptions: { ...recipe.selectedSubfeatureOptions, [key]: { ...recipe.selectedSubfeatureOptions[key], [optionId]: value } },
        uiOverrides: { ...recipe.uiOverrides, [key]: { kitVersion: active.version, schema_version: definition.schema_version } },
      };
      try {
        resolveKit({ kit: active, definition, sources, overrides: candidate.selectedSubfeatureOptions, versions: candidate.uiOverrides, selectedSubfeatures: candidate.selectedSubfeatures[active.id] });
        setRecipe(candidate);
        // Keep valid Kit values even when the Site conflicts, so the user can repair them explicitly.
        if (site) resolveKit({ kit: active, definition, sources, site, overrides: candidate.selectedSubfeatureOptions, versions: candidate.uiOverrides, selectedSubfeatures: candidate.selectedSubfeatures[active.id] });
        return '';
      } catch (error) { return error instanceof Error ? error.message : '設定驗證失敗'; }
    }} />;
  const settings = definition && <>{subfeatureBox}{optionEditor}</>;
  if (!split) return <>{tabs}{panel(!definition ? noScreen : <>{settings}{previewRegion}</>)}</>;
  return <>
    <section className="column column-preview" role="region" aria-labelledby="preview-title" tabIndex={0}>
      <div className="column-head"><h2 id="preview-title">即時預覽</h2><span className="badge"><Icon name="file" />模擬資料</span></div>
      <p className="lead">根據所選功能，預覽實際應用畫面與資料。</p>
      {tabs}{panel(!definition ? noScreen : previewRegion)}
      <p className="column-foot"><Icon name="info" />依右側設定更新，尚未執行資料匯入。</p>
    </section>
    {part === 'params'
      ? <Column id="params" title={`參數設定：${active.displayName}`} lead="設定交付時的初始值；超出範圍的值會被擋下，場域鎖定的項目不能修改。">
        {optionEditor || <p>此功能沒有可調整的參數。</p>}
        <p className="column-foot"><Icon name="info" />這是組裝期的初始值。上線後的調整由「參數設定中心」負責，目前尚未提供。</p>
        <p className="column-foot"><Icon name="info" />角色提示不代表身分授權；目前尚未串接身分驗證。</p>
      </Column>
      : <Column id="adjust" title={`調整${active.displayName}`} lead="選擇所選功能包含的子功能。">
        {subfeatureBox || <p>此功能沒有可調整的項目。</p>}
      </Column>}
  </>;
}
