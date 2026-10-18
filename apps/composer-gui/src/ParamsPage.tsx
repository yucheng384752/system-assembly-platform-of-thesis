import type { Recipe } from '../../../libs/ui-runtime/types';
import type { SiteProfile } from '../../../libs/ui-runtime/site';
import { catalog } from './previewCatalog';
import { KitPreview } from './KitPreview';

// Step 03 (D-A2): initial parameter values per selected feature. The preview beside the editor shows the effect.
export function ParamsPage({ recipe, onChange, session, site }: { recipe: Recipe; onChange: (recipe: Recipe) => void; session: number; site?: SiteProfile }) {
  return <>
    <p className="visually-hidden">此處為設定與模擬預覽，尚未執行資料匯入或組裝部署。</p>
    <div className="columns"><KitPreview split part="params" key={session} site={site} recipe={recipe} onChange={onChange} catalog={catalog} session={session} /></div>
  </>;
}
