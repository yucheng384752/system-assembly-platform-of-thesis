import { useState } from 'react';
import { resolveKit } from '../../../libs/ui-runtime/resolve';
import { Renderer } from '../../../libs/ui-runtime/Renderer';
import type { Recipe } from '../../../libs/ui-runtime/types';
import type { Catalog } from '../../../libs/ui-runtime/recipe';
import { SettingsEditor } from './SettingsEditor';
import './style.css';

export function KitPreview({ recipe, onChange, catalog, session = 0, legacy = false }: { recipe: Recipe; onChange: (recipe: Recipe) => void; catalog: Catalog; session?: number; legacy?: boolean }) {
  const { kits, definitions, sources } = catalog;
  const setRecipe = onChange;
  const [activeId, setActiveId] = useState('');
  const selected = kits.filter(k => recipe.enabledKits.includes(k.id));
  const active = selected.find(k => k.id === activeId) ?? selected[0];
  const definition = active && definitions[active.id];
  let preview;
  if (active && definition) {
    try {
      const resolved = resolveKit({ kit: active, definition, sources, overrides: recipe.selectedSubfeatureOptions, versions: recipe.uiOverrides, selectedSubfeatures: recipe.selectedSubfeatures[active.id] });
      preview = <Renderer key={`preview-${active.id}`} definition={resolved.definition} sources={sources} />;
    } catch (error) { preview = <p role="alert">{error instanceof Error ? error.message : '預覽驗證失敗'}</p>; }
  }
  return <>
    {!active ? <p>尚未選取 Kit。</p> : <>
      <div role="tablist" aria-label="已選 Kit">{selected.map((kit, index) => <button key={kit.id} id={`tab-${kit.id}`} role="tab" aria-selected={active.id === kit.id} aria-controls={`panel-${kit.id}`} tabIndex={active.id === kit.id ? 0 : -1} onClick={() => setActiveId(kit.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % selected.length : event.key === 'ArrowLeft' ? (index + selected.length - 1) % selected.length : event.key === 'Home' ? 0 : event.key === 'End' ? selected.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); setActiveId(selected[next].id); document.getElementById(`tab-${selected[next].id}`)?.focus();
      }}>{kit.displayName}</button>)}</div>
      <section key={session} role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`} tabIndex={0}>
        <h3>{active.displayName}</h3><p>{active.businessCapability}</p>
        {!definition ? <p>{legacy ? '此 Kit 無獨立操作畫面；本預覽不可編輯。' : '此功能沒有可調整的畫面'}</p> : <>
          <fieldset><legend>子功能</legend>{active.subfeatures.map(sub => <label key={sub.id}><input type="checkbox" disabled={sub.required || active.subfeatures.some(other => (recipe.selectedSubfeatures[active.id] ?? []).includes(other.id) && other.dependencies?.includes(sub.id))} checked={recipe.selectedSubfeatures[active.id]?.includes(sub.id) ?? sub.defaultSelected} onChange={event => {
            const enabled = recipe.selectedSubfeatures[active.id] ?? [];
            const next = new Set(event.target.checked ? [...enabled, sub.id] : enabled.filter(id => id !== sub.id));
            function addDependencies(id: string) { for (const dependency of active!.subfeatures.find(s => s.id === id)?.dependencies ?? []) if (!next.has(dependency)) { next.add(dependency); addDependencies(dependency); } }
            if (event.target.checked) addDependencies(sub.id);
            setRecipe({ ...recipe, selectedSubfeatures: { ...recipe.selectedSubfeatures, [active.id]: [...next] } });
          }} />{sub.displayName}</label>)}</fieldset>
          <SettingsEditor legacy={legacy} key={active.id} kit={active} recipe={recipe} onChange={(subId, optionId, value) => {
            const key = `${active.id}::${subId}`;
            const candidate: Recipe = { ...recipe,
              selectedSubfeatureOptions: { ...recipe.selectedSubfeatureOptions, [key]: { ...recipe.selectedSubfeatureOptions[key], [optionId]: value } },
              uiOverrides: { ...recipe.uiOverrides, [key]: { kitVersion: active.version, schema_version: definition.schema_version } },
            };
            try {
              resolveKit({ kit: active, definition, sources, overrides: candidate.selectedSubfeatureOptions, versions: candidate.uiOverrides, selectedSubfeatures: candidate.selectedSubfeatures[active.id] });
              setRecipe(candidate); return '';
            } catch (error) { return error instanceof Error ? error.message : '設定驗證失敗'; }
          }} />
          <div className="table-scroll" tabIndex={0} role="region" aria-label="模擬資料預覽">{preview}</div>
        </>}
      </section>
    </>}
  </>;
}
