import { useEffect, useRef, useState } from 'react';
import { exportRecipe, importRecipe, type Catalog } from '../../../libs/ui-runtime/recipe';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { downloadJson, readJsonFile } from './fileTransfer';

export function RecipeTransfer({ recipe, onImport, catalog, legacy = false }: { recipe: Recipe; onImport: (recipe: Recipe) => void; catalog: Catalog; legacy?: boolean }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function transfer(importing: boolean, input = text) {
    try {
      if (importing) {
        if (input.length > 2 * 1024 * 1024) throw new Error('設定檔不可超過 2 MB。');
        const result = importRecipe(input.replace(/^\uFEFF/, ''), catalog);
        onImport(result.recipe);
        setNotice(['匯入成功，已替換工作階段。', ...result.notices].join(' '));
      } else {
        const exported = exportRecipe(recipe, catalog);
        if (legacy) setText(exported);
        else downloadJson(exported, 'system.recipe.json');
        setNotice(legacy ? '匯出成功，可複製下方 JSON 儲存；僅含已選 Kit 與子功能設定。' : '系統設定檔已下載；包含客戶名稱與已選功能的畫面設定。');
      }
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Recipe 處理失敗');
      setNotice('');
    }
  }
  const jsonEditor = <>
    <label htmlFor="recipe-json">Recipe JSON</label>
    <textarea id="recipe-json" rows={8} value={text} aria-describedby="recipe-error" onChange={event => setText(event.target.value)} />
    {legacy && <button onClick={() => transfer(false)} disabled={!recipe.enabledKits.length}>匯出 Recipe</button>}
    <button onClick={() => transfer(true)}>匯入 Recipe</button>
  </>;
  return <fieldset disabled={busy}><legend>系統設定檔匯入／下載</legend>
    <p>匯入成功會替換功能與畫面設定；失敗則保留原設定。本次表單草稿與流程說明另行保留。請勿輸入實際資料或秘密值。</p>
    {!legacy && <>
      <button onClick={() => transfer(false)} disabled={!recipe.enabledKits.length || !recipe.clientName?.trim()}>下載系統設定檔（Recipe JSON）</button>
      <label htmlFor="recipe-file">選擇系統設定檔</label><input id="recipe-file" type="file" accept=".json,application/json" aria-describedby="recipe-error" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setBusy(true);
        try { const input = await readJsonFile(file); if (mounted.current) transfer(true, input); } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '檔案讀取失敗。'); } finally { if (mounted.current) setBusy(false); }
      }} />
    </>}
    {legacy ? jsonEditor : <details><summary>進階：貼上 Recipe JSON</summary>{jsonEditor}</details>}
    <p id="recipe-error" role={error ? 'alert' : undefined}>{error ? legacy ? error : '設定檔驗證失敗，請檢查檔案版本、所選功能與設定值。原設定已保留。' : ''}</p>
    {!legacy && error && <details><summary>進階：驗證詳情</summary><p>{error}</p></details>}
    <p role="status">{notice}</p>
  </fieldset>;
}
