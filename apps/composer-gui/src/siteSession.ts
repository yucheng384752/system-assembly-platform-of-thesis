import type { Catalog } from '../../../libs/ui-runtime/recipe';
import { resolveKit } from '../../../libs/ui-runtime/resolve';
import type { SiteProfile } from '../../../libs/ui-runtime/site';
import type { Recipe } from '../../../libs/ui-runtime/types';

export interface SiteSession { text: string; site: SiteProfile; notices: string[]; sha256: string }
export function siteError(recipe: Recipe, catalog: Catalog, current?: SiteSession): string {
  if (recipe.siteRef && !current) return '系統設定檔引用的場域尚未載入，請匯入對應的場域設定，或移除場域引用。';
  if (!current) return '';
  if (recipe.siteRef && recipe.siteRef.sha256 !== current.sha256) return '系統設定檔與目前場域的校驗碼不符，請匯入對應的場域設定。';
  try {
    for (const kit of catalog.kits.filter(k => recipe.enabledKits.includes(k.id))) {
      const definition = catalog.definitions[kit.id];
      if (definition) resolveKit({ kit, definition, sources: catalog.sources, site: current.site,
        overrides: recipe.selectedSubfeatureOptions, versions: recipe.uiOverrides, selectedSubfeatures: recipe.selectedSubfeatures[kit.id] });
    }
    return '';
  } catch (error) {
    // Keep business labels and actual limits visible; technical IDs stay in the runtime diagnostic.
    return error instanceof Error ? error.message.replace(/（[^）]*）/g, '') : '場域設定與目前選項衝突。';
  }
}
