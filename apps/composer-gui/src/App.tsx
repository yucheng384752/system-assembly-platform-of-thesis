import { useState } from 'react';
import { resolveKit } from '../../../libs/ui-runtime/resolve';
import { Renderer } from '../../../libs/ui-runtime/Renderer';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { definitions, kits, sources } from './fixtures';
import { SettingsEditor } from './SettingsEditor';
import './style.css';

const initialRecipe: Recipe = {
  recipeVersion: '0.3.0', name: 'mock-composer', sourceManifest: 'mock-fixtures', database: { engine: 'sqlite' },
  enabledKits: [], selectedSubfeatures: {}, selectedSubfeatureOptions: {}, uiOverrides: {},
};
export function App() {
  const [recipe, setRecipe] = useState<Recipe>(initialRecipe);
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
  return <main><h1>Composer Kit 組裝</h1>
    <fieldset><legend>選取 Kit（mock）</legend>{kits.map(kit => <label key={kit.id}>
      <input type="checkbox" checked={recipe.enabledKits.includes(kit.id)} onChange={event => {
        const checked = event.target.checked;
        setRecipe(previous => ({ ...previous,
          enabledKits: checked ? [...previous.enabledKits, kit.id] : previous.enabledKits.filter(id => id !== kit.id),
          selectedSubfeatures: { ...previous.selectedSubfeatures, [kit.id]: previous.selectedSubfeatures[kit.id] ?? kit.subfeatures.filter(s => s.defaultSelected).map(s => s.id) },
        }));
      }} />{kit.displayName}
    </label>)}</fieldset>
    {!active ? <p>尚未選取 Kit。</p> : <>
      <div role="tablist" aria-label="已選 Kit">{selected.map((kit, index) => <button key={kit.id} id={`tab-${kit.id}`} role="tab" aria-selected={active.id === kit.id} aria-controls={`panel-${kit.id}`} tabIndex={active.id === kit.id ? 0 : -1} onClick={() => setActiveId(kit.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % selected.length : event.key === 'ArrowLeft' ? (index + selected.length - 1) % selected.length : event.key === 'Home' ? 0 : event.key === 'End' ? selected.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); setActiveId(selected[next].id); document.getElementById(`tab-${selected[next].id}`)?.focus();
      }}>{kit.displayName}</button>)}</div>
      <section role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`} tabIndex={0}>
        <h2>{active.displayName}</h2><p>{active.businessCapability}</p>
        {!definition ? <p>此 Kit 無獨立操作畫面；本預覽不可編輯。</p> : <>
          <fieldset><legend>子功能</legend>{active.subfeatures.map(sub => <label key={sub.id}><input type="checkbox" checked={recipe.selectedSubfeatures[active.id]?.includes(sub.id) ?? sub.defaultSelected} onChange={event => {
            const enabled = recipe.selectedSubfeatures[active.id] ?? [];
            setRecipe({ ...recipe, selectedSubfeatures: { ...recipe.selectedSubfeatures, [active.id]: event.target.checked ? [...enabled, sub.id] : enabled.filter(id => id !== sub.id) } });
          }} />{sub.displayName}</label>)}</fieldset>
          <SettingsEditor key={active.id} kit={active} recipe={recipe} onChange={(subId, optionId, value) => {
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
          {preview}
        </>}
      </section>
    </>}
  </main>;
}
