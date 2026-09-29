import { useState } from 'react';
import { exportRecipe, importRecipe } from '../../../libs/ui-runtime/recipe';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { definitions, kits, sources } from './fixtures';

export function RecipeTransfer({ recipe, onImport }: { recipe: Recipe; onImport: (recipe: Recipe) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function transfer(importing: boolean) {
    try {
      const catalog = { kits, definitions, sources };
      if (importing) {
        const result = importRecipe(text, catalog);
        onImport(result.recipe);
        setNotice(['匯入成功，已替換工作階段。', ...result.notices].join(' '));
      } else {
        setText(exportRecipe(recipe, catalog));
        setNotice('匯出成功，可複製下方 JSON 儲存；僅含已選 Kit 與子功能設定。');
      }
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Recipe 處理失敗');
      setNotice('');
    }
  }
  return <fieldset><legend>Recipe 匯入／匯出</legend>
    <p>僅處理 mock Kit UI 設定。匯入成功會替換目前草稿；失敗則保留原設定。請勿輸入實際資料或秘密值。</p>
    <label htmlFor="recipe-json">Recipe JSON</label>
    <textarea id="recipe-json" rows={8} value={text} onChange={event => setText(event.target.value)} />
    <button onClick={() => transfer(false)} disabled={!recipe.enabledKits.length}>匯出 Recipe</button>
    <button onClick={() => transfer(true)}>匯入 Recipe</button>
    {error && <p role="alert">{error}</p>}
    <p role="status">{notice}</p>
  </fieldset>;
}
