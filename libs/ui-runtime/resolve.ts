import { validateSchema } from './schema';
import type { Definition, Kit, Option, Overrides, Sources, Value, Versions } from './types';

export function checkReferences(kit: Kit, definition: Definition, sources: Sources): void {
  validateSchema('ui', definition);
  if (definition.kitId !== kit.id) throw new Error(`跨 Kit 定義：${definition.kitId}`);
  const ids = definition.components.map(c => c.id);
  if (new Set(ids).size !== ids.length) throw new Error('元件 ID 重複');
  for (const c of definition.components) {
    if (!kit.subfeatures.some(s => s.id === c.subfeature_id)) throw new Error(`未知 subfeature：${c.subfeature_id}`);
    if (c.type === 'table') {
      const source = sources[c.source_ref];
      if (!source) throw new Error(`未知來源：${c.source_ref}`);
      if (new Set(c.columns.map(col => col.field)).size !== c.columns.length) throw new Error(`重複欄位：${c.id}`);
      for (const col of c.columns) if (!source.fields.includes(col.field)) throw new Error(`未知欄位：${c.id}.${col.field}`);
    } else {
      if (new Set(c.options.map(o => o.value)).size !== c.options.length) throw new Error(`選項值重複：${c.id}`);
      if (!c.options.some(o => o.value === c.defaultValue)) throw new Error(`預設值不在選項內：${c.id}`);
      const target = definition.components.find(t => t.id === c.action.target_component_id);
      if (!target || target.type !== 'table') throw new Error(`跨 Kit 或未知表格引用：${c.action.target_component_id}`);
      if (target.subfeature_id !== c.subfeature_id) throw new Error(`篩選與表格須屬同一 subfeature：${c.id}`);
      if (!target.columns.some(col => col.field === c.action.field)) throw new Error(`未知篩選欄位：${c.action.field}`);
    }
  }
}

function checkValue(option: Option, value: Value): void {
  const type = option.type === 'text' || option.type === 'select' ? 'string' : option.type;
  if (typeof value !== type) throw new Error(`${option.id} 型別錯誤`);
  const range = option.range;
  if (typeof value === 'number' && (!Number.isFinite(value) || !Number.isInteger(value)
    || value < (range?.minimum ?? -Infinity) || value > (range?.maximum ?? Infinity))) throw new Error(`${option.id} 超出範圍`);
  if (typeof value === 'string' && value.length > (range?.maxLength ?? 1000)) throw new Error(`${option.id} 文字過長`);
  if (option.type === 'select' && !option.choices?.some(c => c.value === value)) throw new Error(`${option.id} 未知選項`);
}

function applyValue(definition: Definition, option: Option, value: Value, subfeatureId: string): void {
  checkValue(option, value);
  const { component_id, property, field } = option.target;
  const component = definition.components.find(c => c.id === component_id);
  if (!component || component.subfeature_id !== subfeatureId) throw new Error(`失效覆寫 ${option.id}：未知元件 ${component_id}`);
  if (component.type === 'table') {
    const column = component.columns.find(c => c.field === field);
    if (!column) throw new Error(`失效覆寫 ${option.id}：未知欄位 ${field}`);
    if (property === 'label' && typeof value === 'string') column.label = value;
    else if (property === 'visible' && typeof value === 'boolean') column.visible = value;
    else if ((property === 'width' || property === 'order') && typeof value === 'number') column[property] = value;
    else throw new Error(`禁止覆寫：${option.id}.${property}`);
  } else if (property === 'defaultValue' && typeof value === 'string') component.defaultValue = value;
  else if (property === 'options' && typeof value === 'string') {
    component.options = value.split('\n').map(v => ({ value: v.trim(), displayName: v.trim() }));
    if (component.options.some(o => !o.value)) throw new Error(`${option.id} 選項不得空白`);
  } else throw new Error(`禁止覆寫：${option.id}.${property}`);
}

export interface ResolveInput {
  kit: Kit; definition: Definition; sources: Sources; overrides?: Overrides;
  versions?: Versions; selectedSubfeatures?: string[];
}
export function resolveKit({ kit, definition, sources, overrides = {}, versions = {}, selectedSubfeatures }: ResolveInput) {
  validateSchema('kit', { manifestVersion: '0.1.0', name: 'runtime', kits: [kit] });
  checkReferences(kit, definition, sources);
  const effective = structuredClone(definition);
  const provenance: Record<string, { value: Value; source: string }> = {};
  const selected = selectedSubfeatures ?? kit.subfeatures.filter(s => s.defaultSelected).map(s => s.id);
  for (const id of selected) if (!kit.subfeatures.some(s => s.id === id)) throw new Error(`未知 subfeature：${id}`);
  for (const key of new Set([...Object.keys(overrides), ...Object.keys(versions)])) {
    if (!key.startsWith(`${kit.id}::`)) continue;
    const sub = kit.subfeatures.find(s => key === `${kit.id}::${s.id}`);
    if (!sub) throw new Error(`失效覆寫：${key}`);
    const version = versions[key];
    if (!version || version.kitVersion !== kit.version || version.schema_version !== definition.schema_version) throw new Error(`失效覆寫版本：${key}`);
    const unknown = Object.keys(overrides[key] ?? {}).filter(id => !sub.options.some(o => o.id === id));
    if (unknown.length) throw new Error(`失效／禁止覆寫：${key} / ${unknown.join(', ')}`);
  }
  for (const sub of kit.subfeatures) {
    if (new Set(sub.options.map(o => o.id)).size !== sub.options.length) throw new Error(`重複 option：${sub.id}`);
    const key = `${kit.id}::${sub.id}`;
    for (const option of sub.options) {
      const overridden = Object.hasOwn(overrides[key] ?? {}, option.id);
      const value = overridden ? overrides[key][option.id] : option.defaultValue;
      applyValue(effective, option, value, sub.id);
      provenance[`${key}/${option.id}`] = { value, source: overridden ? `Recipe.selectedSubfeatureOptions.${key}` : `Kit ${kit.id}@${kit.version} default` };
    }
  }
  checkReferences(kit, effective, sources);
  effective.components = effective.components.filter(c => selected.includes(c.subfeature_id));
  for (const component of effective.components) if (component.type === 'table') component.columns.sort((a, b) => a.order - b.order);
  return { definition: effective, provenance };
}
