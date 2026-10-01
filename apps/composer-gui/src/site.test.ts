import { expect, test } from 'vitest';
import { parseSite, effectiveSemantics, siteLockedOptions } from '../../../libs/ui-runtime/site';
import { resolveKit } from '../../../libs/ui-runtime/resolve';
import a from '../../../config/site/examples/demo-site-a.site.json';
import b from '../../../config/site/examples/demo-site-b.site.json';
import { catalog } from './previewCatalog';

const key = 'upload-validation-kit::csv-excel-error-summary';
const kit = catalog.kits.find(k => k.id === 'upload-validation-kit')!;
const input = { kit, definition: catalog.definitions[kit.id], sources: catalog.sources,
  overrides: { [key]: { 'row-width': 200, 'message-width': 220 } },
  versions: { [key]: { kitVersion: kit.version, schema_version: '1.0.0' } } };
const parse = (value: unknown) => parseSite(JSON.stringify(value), catalog);

// A09/D56: one recipe, two sites, no Kit edits; only declared option values may differ.
test('兩個場域只改變宣告的設定，移除場域還原使用者與預設值', () => {
  const before = JSON.stringify(catalog);
  const first = resolveKit({ ...input, site: parse(a).site });
  const second = resolveKit({ ...input, site: parse(b).site });
  expect(first.provenance[`${key}/row-width`]).toEqual({ value: 240, source: `site: demo-site-a@1.0.0.${key}` });
  expect(second.provenance[`${key}/row-width`].value).toBe(280);
  expect(first.definition).not.toEqual(second.definition);
  const changed = Object.keys(first.provenance).filter(id => first.provenance[id].value !== second.provenance[id].value);
  expect(changed.sort()).toEqual([`${key}/row-label`, `${key}/row-width`]);
  const removed = resolveKit(input);
  expect(removed.provenance[`${key}/row-width`]).toEqual({ value: 200, source: `system: Recipe.selectedSubfeatureOptions.${key}` });
  expect(removed.provenance[`${key}/row-label`].source).toMatch(/^kit-default:/);
  expect(JSON.stringify(catalog)).toBe(before);
  expect([...siteLockedOptions(parse(a).site)].sort()).toEqual([`${key}/row-label`, `${key}/row-width`]);
  expect(siteLockedOptions().size).toBe(0);
});

// A03: every layer is checked, including lower values concealed by a Site override.
test('限制攔截使用者、預設與場域值，不以覆寫掩蓋越界', () => {
  expect(() => resolveKit({ ...input, overrides: { [key]: { 'row-width': 350 } }, site: parse(a).site })).toThrow(/row-width.*system.*最大 300/);
  const narrow = { ...a, optionOverrides: {}, optionLimits: { [key]: { 'row-width': { maximum: 170 } } } };
  expect(() => resolveKit({ ...input, site: parse(narrow).site })).toThrow(/row-width.*kit-default.*最大 170/);
  expect(() => parse({ ...a, optionOverrides: { [key]: { 'row-width': 301 } } })).toThrow(/row-width.*場域限制.*300/);
  expect(() => parse({ ...a, optionLimits: { [key]: { 'row-width': { allowedValues: [180, 200] } } } })).toThrow(/僅允許/);
  expect(() => parse({ ...a, optionOverrides: { [key]: { 'row-width': '240' } } })).toThrow(/型別/);
});

// Schema cannot know the catalog or compare limits; validate these before replacing the session.
test.each([
  { optionOverrides: { 'missing::sub': { width: 200 } } },
  { optionLimits: { 'upload-validation-kit::missing': { width: { maximum: 300 } } } },
  { optionOverrides: { [key]: { missing: 200 } } },
  { optionLimits: { [key]: { missing: { maximum: 300 } } } },
  { optionLimits: { [key]: { 'row-width': { minimum: 300, maximum: 200 } } } },
  { optionLimits: { [key]: { 'row-width': { allowedValues: ['240'] } } } },
  { optionLimits: { [key]: { 'row-label': { minimum: 1 } } } },
  { optionOverrides: { [key]: { 'row-width': 601 } } },
])('拒絕不存在的引用或不一致的限制 %#', change => { expect(() => parse({ ...a, ...change })).toThrow(); });

// D58: aliases are global even for unconfirmed fields; only explicitly confirmed semantics are effective.
test('拒絕全域別名歧義及重複識別碼，未確認語意只列通知', () => {
  const { site, notices } = parse(a);
  expect(effectiveSemantics(site).map(f => f.id)).toEqual(['mock-row']);
  expect(notices).toEqual(['待 MIS 確認：模擬說明']);
  const fields = [a.fieldSemantics[0], { ...a.fieldSemantics[1], aliases: [' MOCK-ROW-NUMBER '] }];
  expect(() => parse({ ...a, fieldSemantics: fields })).toThrow(/mock-row-number.*模擬列號.*模擬說明/i);
  expect(() => parse({ ...a, fieldSemantics: [a.fieldSemantics[0], a.fieldSemantics[0]] })).toThrow(/識別碼重複/);
  expect(() => parse({ ...a, dataSources: [a.dataSources[0], a.dataSources[0]] })).toThrow(/識別碼重複/);
  expect(() => parse({ ...a, fieldSemantics: [{ ...a.fieldSemantics[0], aliases: ['  '] }] })).toThrow(/空白/);
});

// D59: legal references remain usable, but keys and credential-like strings are independently rejected.
test('秘密值雙重檢查只放行資料來源的引用名稱', () => {
  expect(parse(a).site.dataSources?.[0].secretRef).toBe('mock-secret-reference');
  for (const id of ['password', 'token', 'secretRef']) {
    const custom = structuredClone(catalog);
    custom.kits.find(k => k.id === kit.id)!.subfeatures.find(s => key.endsWith(`::${s.id}`))!.options.push({ ...kit.subfeatures.find(s => key.endsWith(`::${s.id}`))!.options[0], id });
    // This key would otherwise pass both schema and catalog checks, isolating the secret-key guard.
    expect(() => parseSite(JSON.stringify({ ...a, optionOverrides: { [key]: { [id]: 'mock' } } }), custom)).toThrow(/秘密值欄位/);
  }
  for (const value of ['postgres://mock:mock@invalid', '-----BEGIN PRIVATE KEY-----', 'Bearer mock-value', 'Server=mock;Password=mock']) {
    expect(() => parse({ ...a, displayName: value })).toThrow(/憑證/);
  }
});

// Byte limit, not JS string length, is the boundary for UTF-8 files (D60).
test('接受 BOM，拒絕損壞 JSON 與超過 2 MB 的 UTF-8 文字', () => {
  expect(parseSite(`\uFEFF${JSON.stringify(a)}`, catalog).site.siteId).toBe(a.siteId);
  expect(() => parseSite('{', catalog)).toThrow(/JSON/);
  expect(() => parseSite('模'.repeat(700000), catalog)).toThrow(/2 MB/);
  expect(() => parse({ ...a, domain: undefined })).toThrow(/domain/);
});
