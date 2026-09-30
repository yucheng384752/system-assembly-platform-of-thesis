import previews from '../../../config/ui/previews.json';
import { kits } from './catalog';
import { resolveKit } from '../../../libs/ui-runtime/resolve';
import type { Catalog } from '../../../libs/ui-runtime/recipe';
import type { Definition, Option } from '../../../libs/ui-runtime/types';

const definitions = previews.definitions as Record<string, Definition>;
const labels = { label: '名稱', visible: '顯示', order: '順序', width: '欄寬' };
export const catalog: Catalog = {
  definitions, sources: previews.sources,
  kits: kits.map(kit => ({ ...kit, subfeatures: kit.subfeatures.map(sub => ({ ...sub,
    options: definitions[kit.id]?.components.filter(c => c.subfeature_id === sub.id).flatMap((c): Option[] => c.type === 'table'
      ? c.columns.flatMap(column => (['label', 'visible', 'order', 'width'] as const).map(property => ({
        id: `${column.field}-${property}`, displayName: `${column.label}的${labels[property]}`,
        type: property === 'visible' ? 'boolean' : property === 'label' ? 'text' : 'number',
        defaultValue: column[property], allowed_roles: ['User'], risk: 'low', change_level: 'A',
        target: { component_id: c.id, field: column.field, property },
        range: property === 'width' ? { minimum: 60, maximum: 600 } : property === 'order' ? { minimum: 0, maximum: 99 } : { maxLength: 100 },
      }))) : [
        { id: 'filter-options', displayName: '篩選選項（每行一個值）', type: 'text', defaultValue: c.options.map(o => o.value).join('\n'), allowed_roles: ['User'], risk: 'low', change_level: 'A', target: { component_id: c.id, property: 'options' }, range: { maxLength: 1000 } },
        { id: 'filter-default', displayName: '篩選預設值', type: 'text', defaultValue: c.defaultValue, allowed_roles: ['User'], risk: 'low', change_level: 'A', target: { component_id: c.id, property: 'defaultValue' }, range: { maxLength: 100 } },
      ]) ?? [],
  })) })),
};
for (const kit of catalog.kits) {
  const definition = definitions[kit.id];
  if (definition) resolveKit({ kit, definition, sources: catalog.sources });
}
