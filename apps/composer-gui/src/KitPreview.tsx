import { useMemo, useState, type ReactNode } from 'react';
import { resolveKit } from '../../../libs/ui-runtime/resolve';
import { Renderer } from '../../../libs/ui-runtime/Renderer';
import type { Recipe } from '../../../libs/ui-runtime/types';
import type { Catalog } from '../../../libs/ui-runtime/recipe';
import type { SiteProfile } from '../../../libs/ui-runtime/site';
import { SettingsEditor } from './SettingsEditor';
import { Column } from './Column';
import { Icon } from './Icons';
import { kitMode, usePreviewBackend, type Fetcher } from './previewBackend';
import { createPreviewApi } from './live/previewApi';
import { LiveGenericForms } from './live/LiveGenericForms';
import { LiveUpload } from './live/LiveUpload';
import { LiveTrace } from './live/LiveTrace';
import './style.css';

// split: renders the preview column and the settings column as two siblings for the configurator grid.
export function KitPreview({ recipe, onChange, catalog, session = 0, legacy = false, split = false, site, simulation, fetcher }: { recipe: Recipe; onChange: (recipe: Recipe) => void; catalog: Catalog; session?: number; legacy?: boolean; split?: boolean; site?: SiteProfile; simulation?: ReactNode; fetcher?: Fetcher }) {
  const { kits, definitions, sources } = catalog;
  const setRecipe = onChange;
  // Only the configurator layout (split) talks to the backend; the legacy fixture view stays mock data.
  const backend = usePreviewBackend(recipe, split, fetcher);
  const api = useMemo(() => createPreviewApi(fetcher ?? ((input, init) => globalThis.fetch(input, init))), [fetcher]);
  const [previewMode, setPreviewMode] = useState<'kit' | 'workflow'>('kit');
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
  const mode = kitMode(backend, active.id);
  if (mode.live) preview = active.id === 'generic-forms-kit' ? <LiveGenericForms api={api} /> : active.id === 'upload-validation-kit' ? <LiveUpload api={api} /> : <LiveTrace api={api} />;
  const dataLabel = mode.live ? '真實預覽' : '模擬資料';
  const connection = split && <div className="actions"><button onClick={backend.recheck}>重新偵測預覽後端</button><span role="status">{backend.status === 'online' ? '預覽後端：已連線' : backend.status === 'checking' ? '預覽後端：偵測中' : '預覽後端：未連線'}</span></div>;
  const tabs = <div role="tablist" aria-label="已選 Kit">{selected.map((kit, index) => <button key={kit.id} id={`tab-${kit.id}`} role="tab" aria-selected={active.id === kit.id} aria-controls={`panel-${kit.id}`} aria-label={kit.displayName} aria-describedby={`tab-status-${kit.id}`} tabIndex={active.id === kit.id ? 0 : -1} onClick={() => setActiveId(kit.id)} onKeyDown={event => {
    const next = event.key === 'ArrowRight' ? (index + 1) % selected.length : event.key === 'ArrowLeft' ? (index + selected.length - 1) % selected.length : event.key === 'Home' ? 0 : event.key === 'End' ? selected.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setActiveId(selected[next].id); document.getElementById(`tab-${selected[next].id}`)?.focus();
  }}>{kit.displayName}<span id={`tab-status-${kit.id}`} className="preview-tab-status">{kitMode(backend, kit.id).live ? '真實預覽' : '模擬資料'}</span></button>)}</div>;
  const noScreen = <p>{legacy ? '此 Kit 無獨立操作畫面；本預覽不可編輯。' : '此功能沒有可調整的畫面'}</p>;
  const previewRegion = <div className="table-scroll" tabIndex={0} role="region" aria-label={`${dataLabel}預覽`}>{preview}</div>;
  const panel = (content: ReactNode) => <section key={session} role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`} tabIndex={0}>
    <h3>{active.displayName}</h3><p>{active.businessCapability}</p>{split && <p role="status">{mode.note}</p>}{content}
  </section>;
  const settings = definition && <>
    <fieldset><legend>子功能</legend>{active.subfeatures.map(sub => <label key={sub.id}><input type="checkbox" disabled={sub.required || active.subfeatures.some(other => (recipe.selectedSubfeatures[active.id] ?? []).includes(other.id) && other.dependencies?.includes(sub.id))} checked={recipe.selectedSubfeatures[active.id]?.includes(sub.id) ?? sub.defaultSelected} onChange={event => {
      const enabled = recipe.selectedSubfeatures[active.id] ?? [];
      const next = new Set(event.target.checked ? [...enabled, sub.id] : enabled.filter(id => id !== sub.id));
      function addDependencies(id: string) { for (const dependency of active!.subfeatures.find(s => s.id === id)?.dependencies ?? []) if (!next.has(dependency)) { next.add(dependency); addDependencies(dependency); } }
      if (event.target.checked) addDependencies(sub.id);
      setRecipe({ ...recipe, selectedSubfeatures: { ...recipe.selectedSubfeatures, [active.id]: [...next] } });
    }} />{sub.displayName}</label>)}</fieldset>
    <SettingsEditor site={site} legacy={legacy} key={active.id} kit={active} recipe={recipe} onChange={(subId, optionId, value) => {
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
    }} />
  </>;
  if (!split) return <>{tabs}{panel(!definition && !mode.live ? noScreen : <>{settings}{previewRegion}</>)}</>;
  return <>
    <section className="column column-preview" role="region" aria-labelledby="preview-title" tabIndex={0}>
      <div className="column-head"><h2 id="preview-title">即時預覽</h2><span className="badge"><Icon name="file" />{previewMode === 'workflow' && simulation ? '模擬資料' : dataLabel}</span></div>
      <p className="lead">根據所選功能，預覽實際應用畫面與資料。</p>
      {connection}
      {simulation && <div className="actions"><button aria-pressed={previewMode === 'kit'} onClick={() => setPreviewMode('kit')}>功能畫面</button><button aria-pressed={previewMode === 'workflow'} onClick={() => setPreviewMode('workflow')}>逐站模擬</button></div>}
      {previewMode === 'workflow' && simulation ? simulation : <>{tabs}{panel(!definition && !mode.live ? noScreen : previewRegion)}</>}
      <p className="column-foot"><Icon name="info" />依右側設定更新，尚未執行資料匯入。</p>
    </section>
    <Column scroll id="adjust" title={`調整${active.displayName}`} lead="設定所選功能的顯示方式與順序。">
      {settings || <p>此功能沒有可調整的項目。</p>}
      <p className="column-foot"><Icon name="info" />角色提示不代表身分授權；目前尚未串接身分驗證。</p>
    </Column>
  </>;
}
