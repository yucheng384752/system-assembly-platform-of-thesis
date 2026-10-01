import { useState } from 'react';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { flows, selectKits, suggestFlows } from './catalog';
import { catalog } from './previewCatalog';
import { StepShell } from './StepShell';
import { FlowPage } from './FlowPage';
import { emptyAov, formErrors, relationErrors, stepErrors, workflowErrors } from './workflow';
import { AovPage } from './AovPage';
import { FormsPage } from './FormsPage';
import { RelationsPage } from './RelationsPage';
import { OutputPage } from './OutputPage';
import { siteError, type SiteSession } from './siteSession';
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
  const [aov, setAov] = useState(emptyAov);
  const [session, setSession] = useState(0);
  const [site, setSite] = useState<SiteSession>();
  const conflict = siteError(recipe, catalog, site);
  // Steps: 01 Workflow steps, 02 forms, 03 relations, 04 feature selection, 05 output (D30).
  const stepError = (step: number) => [
    stepErrors(aov)[0], formErrors(aov)[0], relationErrors(aov)[0], conflict,
    conflict || (!recipe.clientName?.trim() ? '請填寫客戶代稱。' : workflowErrors(aov).length ? `流程規格尚未完成：${workflowErrors(aov)[0]}` : ''),
  ][step] ?? '';
  return <StepShell stepError={stepError} renderStep={step => step === 0 ? <AovPage value={aov} onChange={setAov} />
    : step === 1 ? <FormsPage value={aov} onChange={setAov} />
    : step === 2 ? <RelationsPage value={aov} onChange={setAov} />
    : step === 3 ? <FlowPage site={site?.site} recipe={recipe} onChange={setRecipe} requested={requested} manual={manual} session={session} suggestions={suggestFlows(aov.relations.length)} onSelect={(nextFlows, nextKits) => {
      const selection = selectKits(catalog.kits, nextFlows, nextKits);
      setRequested(nextFlows); setManual(nextKits); setRecipe(previous => withSelection(previous, selection.enabledKits));
    }} />
      : <OutputPage site={site} siteConflict={conflict} onSiteChange={next => {
        setSite(next);
        setRecipe(previous => { const { siteRef: _siteRef, ...rest } = previous; return next ? { ...rest, siteRef: { path: 'site.profile.json', sha256: next.sha256 } } : rest; });
      }} recipe={recipe} workflow={aov} selectedFlows={selectKits(catalog.kits, requested, manual).selectedFlows} onChange={setRecipe} onImport={next => {
        // Validate required flow membership before replacing any part of the session.
        const importedFlows = flows.filter(f => f.kits.every(id => next.enabledKits.includes(id))).map(f => f.id);
        const selection = selectKits(catalog.kits, importedFlows);
        if (selection.enabledKits.some(id => !next.enabledKits.includes(id))) throw new Error('設定檔缺少必要流程的功能。');
        setRecipe(next); setRequested(importedFlows); setManual(next.enabledKits.filter(id => !selection.enabledKits.includes(id))); setSession(s => s + 1);
      }} />} />;
}
