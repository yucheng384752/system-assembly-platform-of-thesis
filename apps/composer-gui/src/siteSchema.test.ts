import { expect, test } from 'vitest';
import { schemas } from '../../../libs/ui-runtime/schema';
import a from '../../../config/site/examples/demo-site-a.site.json';
import b from '../../../config/site/examples/demo-site-b.site.json';
import { catalog } from './previewCatalog';

// M01/A09: examples must describe actual preview options, so users can import both unchanged.
test.each([a, b])('場域示範檔符合契約且引用現有選項：$siteId', site => {
  expect(schemas.site(site)).toBe(true);
  for (const groups of [site.optionOverrides, site.optionLimits]) for (const [key, values] of Object.entries(groups)) {
    const [kitId, subId] = key.split('::');
    const sub = catalog.kits.find(k => k.id === kitId)?.subfeatures.find(s => s.id === subId);
    for (const id of Object.keys(values)) expect(sub?.options.some(o => o.id === id)).toBe(true);
  }
});

// Reject malformed external data before any session changes (D54, D59).
test.each([
  { ...a, domain: undefined }, { ...a, unknown: true },
  { ...a, siteId: 'Site A' }, { ...a, siteVersion: '1.0' },
  { ...a, optionOverrides: { invalid: { width: 200 } } },
  { ...a, optionOverrides: { 'a::b': { 'bad/id': 200 } } },
  { ...a, optionLimits: { 'a::b': { width: {} } } },
  ...['mock:secret', 'mock/secret', 'mock@secret'].map(secretRef => ({ ...a, dataSources: [{ id: 'mock', sourceRef: 'mock', secretRef }] })),
  { ...a, fieldSemantics: [{ id: 'mock', name: '模擬', aliases: ['same', 'same'], confirmed: true }] },
])('場域契約拒絕不合法輸入 %#', site => { expect(schemas.site(site)).toBe(false); });
