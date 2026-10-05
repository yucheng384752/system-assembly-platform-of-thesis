import { useState } from 'react';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { flows, selectKits } from './catalog';
import { catalog } from './previewCatalog';
import { StepShell } from './StepShell';
import { FlowPage } from './FlowPage';
import { actionCatalog } from './workflow';
import { OutputPage } from './OutputPage';
import { siteError, type SiteSession } from './siteSession';
import { AppShell, HomePage, PlaceholderPage, type PageId } from './AppShell';
import './style.css';
import { WorkflowCanvas } from './WorkflowCanvas';
import { emptyGraph, graphActionIds, graphErrors, integrityErrors } from './workflowGraph';
import { deriveKits } from '../../../libs/ui-runtime/actions';
import { registry } from './registryData';
import { WorkflowTransfer } from './WorkflowTransfer';

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
  const [storedRecipe, setRecipe] = useState<Recipe>(initialRecipe);
  const [requested, setRequested] = useState<string[]>([]);
  const [manual, setManual] = useState<string[]>([]);
  const [graph, setGraph] = useState(emptyGraph);
  const [graphSession, setGraphSession] = useState(0);
  const [session, setSession] = useState(0);
  const [site, setSite] = useState<SiteSession>();
  const [page, setPage] = useState<PageId>('home');
  const derived = deriveKits(graphActionIds(graph), actionCatalog, registry);
  const derivedIds = derived.kits.map(k => k.kitId);
  const selection = selectKits(catalog.kits, requested, manual, flows, derivedIds);
  const recipe = withSelection(storedRecipe, selection.enabledKits);
  const conflict = siteError(recipe, catalog, site);
  const workflowProblems = [...integrityErrors(graph), ...graphErrors(graph)];
  const stepError = (step: number) => [
    workflowProblems[0], conflict,
    conflict || (!recipe.clientName?.trim() ? '請填寫客戶代稱。' : workflowProblems.length ? `流程規格尚未完成：${workflowProblems[0]}` : ''),
  ][step] ?? '';
  // The step flow stays mounted (only hidden) so switching pages never loses the confirmed steps.
  const steps = <StepShell stepError={stepError} renderStep={step => step === 0 ? <><WorkflowTransfer onChange={next => { setGraph(next); setGraphSession(s => s + 1); }} /><WorkflowCanvas key={graphSession} value={graph} onChange={setGraph} /></>
    : step === 1 ? <FlowPage graph={graph} derived={derived} site={site?.site} recipe={recipe} onChange={setRecipe} requested={requested} manual={manual} session={session} onSelect={(nextFlows, nextKits) => {
      setRequested(nextFlows); setManual(nextKits);
    }} />
      : <OutputPage site={site} siteConflict={conflict} onSiteChange={next => {
        setSite(next);
        setRecipe(previous => { const { siteRef: _siteRef, ...rest } = previous; return next ? { ...rest, siteRef: { path: 'site.profile.json', sha256: next.sha256 } } : rest; });
      }} recipe={recipe} workflow={graph} selectedFlows={selection.selectedFlows} onChange={setRecipe} onImport={next => {
        // Validate required flow membership before replacing any part of the session.
        const importedFlows = flows.filter(f => f.kits.every(id => next.enabledKits.includes(id))).map(f => f.id);
        const selection = selectKits(catalog.kits, importedFlows, [], flows, derivedIds);
        if (selection.enabledKits.some(id => !next.enabledKits.includes(id))) throw new Error('設定檔缺少必要流程的功能。');
        setRecipe(next); setRequested(importedFlows); setManual(next.enabledKits.filter(id => !selection.enabledKits.includes(id))); setSession(s => s + 1);
      }} />} />;
  return <AppShell page={page} onNavigate={setPage} project={recipe.name} siteName={site?.site.displayName}>
    {page === 'home' && <HomePage aov={graph} enabledKits={recipe.enabledKits.length} onNavigate={setPage} />}
    <div hidden={page !== 'flow'}>{steps}</div>
    {page === 'datasets' && <PlaceholderPage title="資料集" lead="集中管理設定用與執行用資料集。" items={['資料集列表與版本', 'CSV 匯入與欄位對應', '引用此資料集的系統清單']} />}
    {page === 'runs' && <PlaceholderPage title="執行記錄" lead="目前只做設定期（D16），尚無執行期；此頁日後顯示驗證紀錄。" items={['驗證紀錄列表', '節點時間線與錯誤位置']} />}
    {page === 'settings' && <PlaceholderPage title="系統設定" lead="場域、相容性與資料遷移。" items={['Migration 變更分析', 'Migration 計畫與演練', '相容性檢查']} />}
  </AppShell>;
}
