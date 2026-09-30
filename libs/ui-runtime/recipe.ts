import { validateSchema } from './schema';
import { resolveKit } from './resolve';
import type { Definition, Kit, Recipe, Sources } from './types';

export interface Catalog { kits: Kit[]; definitions: Record<string, Definition>; sources: Sources }

// Import into a detached candidate; callers replace session state only after this returns.
export function importRecipe(text: string, catalog: Catalog): { recipe: Recipe; notices: string[] } {
  const input: Recipe = JSON.parse(text);
  validateSchema('recipe', input);
  if (!['0.2.0', '0.3.0'].includes(input.recipeVersion)) throw new Error('不支援的 Recipe 版本');
  const recipe: Recipe = {
    ...(input.clientName !== undefined ? { clientName: input.clientName } : {}),
    recipeVersion: '0.3.0', name: input.name, sourceManifest: input.sourceManifest,
    database: { engine: input.database.engine }, enabledKits: input.enabledKits,
    selectedSubfeatures: input.selectedSubfeatures ?? {},
    selectedSubfeatureOptions: input.selectedSubfeatureOptions ?? {}, uiOverrides: input.uiOverrides ?? {},
    ...(input.workflowRef ? { workflowRef: { path: input.workflowRef.path, sha256: input.workflowRef.sha256 } } : {}),
  };
  const notices: string[] = [];
  const omitted = Object.keys(input).filter(key => !Object.hasOwn(recipe, key));
  if (omitted.length || Object.keys(input.database).some(key => key !== 'engine')) {
    notices.push('僅載入 Kit UI 設定；其他 Recipe 欄位與資料庫連線設定不保留。');
  }
  const findKit = (id: string) => {
    const kit = catalog.kits.find(k => k.id === id);
    if (!kit) throw new Error(`未知 Kit：${id}`);
    return kit;
  };
  for (const id of recipe.enabledKits) {
    const kit = findKit(id);
    recipe.selectedSubfeatures[id] ??= kit.subfeatures.filter(s => s.defaultSelected).map(s => s.id);
  }
  for (const kit of catalog.kits) {
    if (kit.required && !recipe.enabledKits.includes(kit.id)) throw new Error(`缺少必要功能：${kit.displayName}`);
    if (recipe.enabledKits.includes(kit.id)) {
      for (const dependency of kit.dependencies) if (!recipe.enabledKits.includes(dependency)) throw new Error(`「${kit.displayName}」缺少相依功能，請回到流程頁重新選擇。`);
    }
  }
  for (const [id, selected] of Object.entries(recipe.selectedSubfeatures)) {
    const kit = findKit(id);
    for (const sub of selected) if (!kit.subfeatures.some(s => s.id === sub)) throw new Error(`未知 subfeature：${id}::${sub}`);
    for (const sub of kit.subfeatures) {
      if (sub.required && !selected.includes(sub.id)) throw new Error(`缺少必要子功能：${sub.displayName}`);
      if (selected.includes(sub.id) && sub.dependencies?.some(dep => !selected.includes(dep))) throw new Error(`「${sub.displayName}」缺少相依子功能。`);
    }
  }
  for (const key of new Set([...Object.keys(recipe.selectedSubfeatureOptions), ...Object.keys(recipe.uiOverrides)])) {
    const [id, subId, extra] = key.split('::');
    const kit = findKit(id);
    if (extra !== undefined || !kit.subfeatures.some(s => s.id === subId)) throw new Error(`失效覆寫：${key}`);
    const definition = catalog.definitions[id];
    if (!definition) throw new Error(`無 UI 定義：${key}`);
    if (input.recipeVersion === '0.2.0') {
      recipe.uiOverrides[key] = { kitVersion: kit.version, schema_version: definition.schema_version };
      notices.push(`舊版遷移：${key} 的版本取自目前 Kit ${kit.version}／UI ${definition.schema_version}；已重新驗證，非原始版本證明。`);
    }
  }
  const referenced = new Set([...recipe.enabledKits, ...Object.keys(recipe.selectedSubfeatures),
    ...Object.keys(recipe.selectedSubfeatureOptions).map(key => key.split('::')[0]),
    ...Object.keys(recipe.uiOverrides).map(key => key.split('::')[0])]);
  for (const id of referenced) {
    const kit = findKit(id);
    const definition = catalog.definitions[id];
    if (definition) resolveKit({ kit, definition, sources: catalog.sources,
      overrides: recipe.selectedSubfeatureOptions, versions: recipe.uiOverrides,
      selectedSubfeatures: recipe.selectedSubfeatures[id] });
  }
  validateSchema('recipe', recipe);
  return { recipe, notices };
}

export function exportRecipe(recipe: Recipe, catalog: Catalog): string {
  // Explicit projection prevents runtime rows, credentials and arbitrary extra fields escaping.
  const selectedSubfeatures = Object.fromEntries(recipe.enabledKits.map(id => [id,
    recipe.selectedSubfeatures[id] ?? catalog.kits.find(k => k.id === id)?.subfeatures.filter(s => s.defaultSelected).map(s => s.id) ?? []]));
  const keys = new Set(Object.entries(selectedSubfeatures).flatMap(([id, subs]) => subs.map(sub => `${id}::${sub}`)));
  const candidate: Recipe = {
    ...(recipe.clientName !== undefined ? { clientName: recipe.clientName } : {}),
    recipeVersion: recipe.recipeVersion, name: recipe.name, sourceManifest: recipe.sourceManifest,
    database: { engine: recipe.database.engine }, enabledKits: [...recipe.enabledKits], selectedSubfeatures,
    selectedSubfeatureOptions: Object.fromEntries(Object.entries(recipe.selectedSubfeatureOptions).filter(([key]) => keys.has(key))),
    uiOverrides: Object.fromEntries(Object.entries(recipe.uiOverrides).filter(([key]) => keys.has(key))),
    ...(recipe.workflowRef ? { workflowRef: { path: recipe.workflowRef.path, sha256: recipe.workflowRef.sha256 } } : {}),
  };
  return JSON.stringify(importRecipe(JSON.stringify(candidate), catalog).recipe, null, 2);
}
