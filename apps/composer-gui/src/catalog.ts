import rawManifest from '../../../kits/form-analysis.kit-manifest.json?raw';
import overlay from '../../../config/kits/overlay.json';
import flowData from '../../../config/flows.json';
import { validateSchema } from '../../../libs/ui-runtime/schema';
import type { Kit } from '../../../libs/ui-runtime/types';

interface ManifestKit extends Omit<Kit, 'version' | 'subfeatures'> {
  version?: string; required?: boolean;
  subfeatures?: (Omit<Kit['subfeatures'][number], 'options'> & { options?: Kit['subfeatures'][number]['options'] })[];
}
export interface Flow { id: string; name: string; description: string; kits: string[]; required?: boolean; requiresFlows?: string[]; subflows: { id: string; name: string; description: string }[]; pages: string[] }
export const flows: Flow[] = flowData;
export function parseManifest(text: string): { kits: ManifestKit[] } {
  const value = JSON.parse(text.replace(/^\uFEFF/, ''));
  validateSchema('kit', value);
  return value;
}
export function loadKits(text: string): Kit[] {
  const manifest = parseManifest(text);
  const replacements: Record<string, string> = overlay.replacements;
  const presentation: Record<string, { displayName: string; businessCapability: string }> = overlay.presentation;
  const result = [...manifest.kits.filter(k => !Object.hasOwn(replacements, k.id)), ...overlay.add].map(k => ({
    ...k, ...presentation[k.id], version: k.version ?? overlay.version,
    dependencies: k.dependencies.map(id => replacements[id] ?? id),
    subfeatures: (k.subfeatures ?? []).map(s => ({ ...s, defaultSelected: s.defaultSelected ?? false,
      // Baseline business options without UI targets remain in the readonly manifest.
      options: (s.options ?? []).filter(o => o.target),
    })),
  }));
  validateSchema('kit', { manifestVersion: '0.1.0', name: 'composer', kits: result });
  expand(result, result.map(k => k.id), k => k.dependencies);
  return result;
}

function expand<T extends { id: string; required?: boolean }>(items: T[], requested: string[], dependencies: (item: T) => string[]): string[] {
  const byId = new Map(items.map(item => [item.id, item]));
  if (byId.size !== items.length) throw new Error('定義含重複識別碼');
  const done = new Set<string>();
  function visit(id: string, path: string[]) {
    if (path.includes(id)) throw new Error(`相依循環：${[...path, id].join(' → ')}`);
    if (done.has(id)) return;
    const item = byId.get(id);
    if (!item) throw new Error(`缺少相依：${[...path, id].join(' → ')}`);
    dependencies(item).forEach(next => visit(next, [...path, id]));
    done.add(id);
  }
  [...items.filter(i => i.required).map(i => i.id), ...requested].forEach(id => visit(id, []));
  return [...done];
}
export function selectKits(kits: Kit[], requestedFlows: string[], manual: string[] = [], availableFlows: Flow[] = flows) {
  const selectedFlows = expand(availableFlows, requestedFlows, f => f.requiresFlows ?? []);
  const roots = [...manual, ...selectedFlows.flatMap(id => availableFlows.find(f => f.id === id)!.kits)];
  const enabledKits = expand(kits, roots, k => k.dependencies);
  const reasons = enabledKits.map(id => {
    const kit = kits.find(k => k.id === id)!;
    const flow = availableFlows.find(f => selectedFlows.includes(f.id) && f.kits.includes(id));
    const parent = kits.find(k => enabledKits.includes(k.id) && k.dependencies.includes(id));
    // Same-name flow and feature would read 「因為選了『資料匯入』，系統會自動加入『資料匯入』」 (G04).
    return flow ? flow.name === kit.displayName ? `「${flow.name}」流程需要同名功能，系統會自動加入。` : `因為選了「${flow.name}」，系統會自動加入「${kit.displayName}」。`
      : parent ? `因為使用「${parent.displayName}」，系統會自動加入「${kit.displayName}」。`
        : kit.required ? `「${kit.displayName}」是必要功能，會自動保留。` : `已自行選取「${kit.displayName}」。`;
  });
  return { enabledKits, selectedFlows, reasons };
}
export const kits = loadKits(rawManifest);
