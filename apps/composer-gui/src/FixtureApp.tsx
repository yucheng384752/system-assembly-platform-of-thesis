import { useState } from 'react';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { definitions, kits, sources } from './fixtures';
import { RecipeTransfer } from './RecipeTransfer';
import { KitPreview } from './KitPreview';
const catalog = { definitions, kits, sources };
const initialRecipe: Recipe = {
  recipeVersion: '0.3.0', name: 'mock-composer', sourceManifest: 'mock-fixtures', database: { engine: 'sqlite' },
  enabledKits: [], selectedSubfeatures: {}, selectedSubfeatureOptions: {}, uiOverrides: {},
};

export function FixtureApp() {
  const [recipe, setRecipe] = useState<Recipe>(initialRecipe);
  const [session, setSession] = useState(0);
  return <main><h1>Composer Kit 組裝</h1>
    <p>Composer 尚無身分驗證；User／MIS／Developer 角色僅為設定提示，未執行身分授權檢查。</p>
    <RecipeTransfer legacy catalog={catalog} recipe={recipe} onImport={next => { setRecipe(next); setSession(s => s + 1); }} />

    <fieldset><legend>選取 Kit（mock）</legend>{kits.map(kit => <label key={kit.id}>
      <input type="checkbox" checked={recipe.enabledKits.includes(kit.id)} onChange={event => {
        const checked = event.target.checked;
        setRecipe(previous => ({ ...previous,
          enabledKits: checked ? [...previous.enabledKits, kit.id] : previous.enabledKits.filter(id => id !== kit.id),
          selectedSubfeatures: { ...previous.selectedSubfeatures, [kit.id]: previous.selectedSubfeatures[kit.id] ?? kit.subfeatures.filter(s => s.defaultSelected).map(s => s.id) },
        }));
      }} />{kit.displayName}
    </label>)}</fieldset>
    <KitPreview key={session} legacy recipe={recipe} onChange={setRecipe} catalog={catalog} />
  </main>;
}
