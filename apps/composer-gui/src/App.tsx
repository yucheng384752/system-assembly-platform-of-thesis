import { useState } from 'react';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { flows, selectKits } from './catalog';
import { catalog } from './previewCatalog';
import { StepShell } from './StepShell';
import { FlowPage } from './FlowPage';
import { DataPage } from './DataPage';
import { emptyForm } from './localData';
import { emptyAov } from './aov';
import { AovPage } from './AovPage';
import { OutputPage } from './OutputPage';
import './style.css';

export function withSelection(recipe: Recipe, enabledKits: string[]): Recipe {
  return { ...recipe, enabledKits, selectedSubfeatures: { ...recipe.selectedSubfeatures,
    ...Object.fromEntries(enabledKits.map(id => [id, recipe.selectedSubfeatures[id] ?? catalog.kits.find(k => k.id === id)!.subfeatures.filter(s => s.defaultSelected).map(s => s.id)])),
  } };
}
export const initialRecipe = withSelection({
  recipeVersion: '0.3.0', name: 'my-system', sourceManifest: 'form-analysis.kit-manifest.json', database: { engine: 'sqlite' },
  enabledKits: [], selectedSubfeatures: {}, selectedSubfeatureOptions: {}, uiOverrides: {},
}, selectKits(catalog.kits, []).enabledKits);
export function App() {
  const [recipe, setRecipe] = useState<Recipe>(initialRecipe);
  const [requested, setRequested] = useState<string[]>([]);
  const [manual, setManual] = useState<string[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [aov, setAov] = useState(emptyAov);
  const [session, setSession] = useState(0);
  return <StepShell renderStep={step => step === 0
    ? <FlowPage recipe={recipe} onChange={setRecipe} requested={requested} manual={manual} session={session} onSelect={(nextFlows, nextKits) => {
      const selection = selectKits(catalog.kits, nextFlows, nextKits);
      setRequested(nextFlows); setManual(nextKits); setRecipe(previous => withSelection(previous, selection.enabledKits));
    }} /> : step === 1 ? <DataPage form={form} onChange={setForm} /> : step === 2 ? <AovPage value={aov} onChange={setAov} form={form} />
      : <OutputPage recipe={recipe} onChange={setRecipe} onImport={next => {
        // Validate required flow membership before replacing any part of the session.
        const importedFlows = flows.filter(f => f.kits.every(id => next.enabledKits.includes(id))).map(f => f.id);
        const selection = selectKits(catalog.kits, importedFlows);
        if (selection.enabledKits.some(id => !next.enabledKits.includes(id))) throw new Error('設定檔缺少必要流程的功能。');
        setRecipe(next); setRequested(importedFlows); setManual(next.enabledKits.filter(id => !selection.enabledKits.includes(id))); setSession(s => s + 1);
      }} />} />;
}
