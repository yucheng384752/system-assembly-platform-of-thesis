import type { Catalog } from './recipe';
import { checkValue } from './resolve';
import { schemas } from './schema';
import type { Overrides, Value } from './types';

export interface SiteLimit { minimum?: number; maximum?: number; allowedValues?: Value[] }
export interface FieldSemantic { id: string; name: string; aliases: string[]; unit?: string; meaning?: string; confirmed: boolean }
export interface SiteProfile {
  format: 'composer-site-profile'; version: 1;
  siteId: string; siteVersion: string; displayName: string; domain: string;
  optionOverrides?: Overrides;
  optionLimits?: Record<string, Record<string, SiteLimit>>;
  fieldSemantics?: FieldSemantic[];
  dataSources?: { id: string; sourceRef: string; secretRef?: string }[];
}

export function describeSiteLimit(limit: SiteLimit): string {
  return [limit.minimum !== undefined ? `最小 ${limit.minimum}` : '', limit.maximum !== undefined ? `最大 ${limit.maximum}` : '',
    limit.allowedValues ? `僅允許 ${limit.allowedValues.join('、')}` : ''].filter(Boolean).join('；');
}
export function checkSiteLimit(limit: SiteLimit | undefined, value: Value, location: string, source: string): void {
  if (!limit) return;
  if ((limit.minimum !== undefined && (typeof value !== 'number' || value < limit.minimum))
    || (limit.maximum !== undefined && (typeof value !== 'number' || value > limit.maximum))
    || (limit.allowedValues && !limit.allowedValues.includes(value))) {
    throw new Error(`${location} 的${source}值不符合場域限制：${describeSiteLimit(limit)}。`);
  }
}

// Same sensitive-key policy as deliveryPackage, with exactly one reference-only exception (D59).
const sensitiveKey = /password|passwd|secret|token|credential|connection|dsn|api[_-]?key|private[_-]?key|licensee|deploymentconfig/i;
function checkSecrets(value: unknown, at = '$'): void {
  if (typeof value === 'string' && ((value.includes('://') && value.includes('@'))
    || /BEGIN (?:[A-Z]+ )*PRIVATE KEY|BEGIN CERTIFICATE|Bearer\s+|(?:password|pwd|token|api[_-]?key)\s*=/i.test(value))) {
    throw new Error(`${at} 含疑似連線字串或憑證；請改用外部引用。`);
  }
  if (Array.isArray(value)) value.forEach((item, index) => checkSecrets(item, `${at}[${index}]`));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    const path = `${at}.${key}`;
    if (sensitiveKey.test(key) && !/^\$\.dataSources\[\d+\]\.secretRef$/.test(path)) throw new Error(`${path} 為禁止的秘密值欄位。`);
    checkSecrets(item, path);
  }
}

// Detached validation: no mutation of the catalog or the current session, no I/O.
export function parseSite(text: string, catalog: Catalog): { site: SiteProfile; notices: string[] } {
  const normalized = text.replace(/^\uFEFF/, '');
  if (new TextEncoder().encode(normalized).length > 2 * 1024 * 1024) throw new Error('場域設定不可超過 2 MB。');
  let input: unknown;
  try { input = JSON.parse(normalized); } catch { throw new Error('場域設定不是有效的 JSON，請檢查檔案內容。'); }
  checkSecrets(input);
  if (!schemas.site(input)) {
    const locations = schemas.site.errors?.map(error => `${error.instancePath || '/'}${'missingProperty' in error.params ? `/${error.params.missingProperty}` : 'additionalProperty' in error.params ? `/${error.params.additionalProperty}` : ''}`);
    throw new Error(`場域設定格式不正確，請檢查位置：${locations?.join('、')}。`);
  }
  const site = input as unknown as SiteProfile;
  for (const group of ['optionOverrides', 'optionLimits'] as const) {
    for (const [key, values] of Object.entries(site[group] ?? {})) {
      const [kitId, subId] = key.split('::');
      const kit = catalog.kits.find(k => k.id === kitId);
      if (!kit) throw new Error(`${group}.${key} 引用未知功能：${kitId}。`);
      const sub = kit.subfeatures.find(s => s.id === subId);
      if (!sub) throw new Error(`${group}.${key} 引用未知子功能：${subId}。`);
      for (const [id, value] of Object.entries(values)) {
        const option = sub.options.find(o => o.id === id);
        const location = `${group}.${key}/${id}`;
        if (!option) throw new Error(`${location} 引用未知選項。`);
        if (group === 'optionOverrides') {
          try { checkValue(option, value as Value); } catch (error) { throw new Error(`${location}：${error instanceof Error ? error.message : '選項值無效'}`); }
          checkSiteLimit(site.optionLimits?.[key]?.[id], value as Value, `${kit.displayName}／${option.displayName}（${key}/${id}）`, '場域');
        } else {
          const limit = value as SiteLimit;
          if ((limit.minimum !== undefined || limit.maximum !== undefined) && option.type !== 'number') throw new Error(`${location} 只有數值選項可設定最大或最小限制。`);
          if ((limit.minimum ?? -Infinity) > (limit.maximum ?? Infinity)) throw new Error(`${location} 最小限制不可大於最大限制。`);
          for (const allowed of limit.allowedValues ?? []) {
            try { checkValue(option, allowed); } catch { throw new Error(`${location}.allowedValues 的型別或值不符合選項定義。`); }
          }
        }
      }
    }
  }
  const ids = new Set<string>();
  const aliases = new Map<string, string>();
  const notices: string[] = [];
  for (const field of site.fieldSemantics ?? []) {
    if (ids.has(field.id)) throw new Error(`fieldSemantics 的識別碼重複：${field.id}。`);
    ids.add(field.id);
    for (const alias of field.aliases) {
      const key = alias.trim().toLowerCase();
      if (!key) throw new Error(`欄位「${field.name}」的別名不可為空白。`);
      if (aliases.has(key)) throw new Error(`別名「${alias.trim()}」有歧義：欄位「${aliases.get(key)}」與「${field.name}」。`);
      aliases.set(key, field.name);
    }
    if (!field.confirmed) notices.push(`待 MIS 確認：${field.name}`);
  }
  const sources = new Set<string>();
  for (const source of site.dataSources ?? []) {
    if (sources.has(source.id)) throw new Error(`dataSources 的識別碼重複：${source.id}。`);
    sources.add(source.id);
  }
  return { site, notices };
}

export function siteLockedOptions(site?: SiteProfile): Set<string> {
  return new Set(Object.entries(site?.optionOverrides ?? {}).flatMap(([key, values]) => Object.keys(values).map(id => `${key}/${id}`)));
}
export function effectiveSemantics(site: SiteProfile): FieldSemantic[] {
  return (site.fieldSemantics ?? []).filter(field => field.confirmed);
}
