import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveKit } from '../../../libs/ui-runtime/resolve';
import { Renderer } from '../../../libs/ui-runtime/Renderer';
import { kits, definitions, sources } from './fixtures';
import type { Value } from '../../../libs/ui-runtime/types';
const input = { kit: kits[0], definition: definitions['records-kit'], sources };
const versions = { 'records-kit::records': { kitVersion: '1.0.0', schema_version: '1.0.0' } };
test('pure merge tracks sources, replaces options and escapes labels in shared renderer', () => {
  const before = JSON.stringify(input);
  const resolved = resolveKit({ ...input, versions, overrides: { 'records-kit::records': { 'name-label': '<img src=x onerror=alert(1)>', 'name-width': 250, 'filter-options': 'open\npending' } } });
  expect(JSON.stringify(input)).toBe(before);
  expect(resolved.provenance['records-kit::records/name-width'].source).toContain('Recipe');
  expect(resolved.provenance['records-kit::records/status-width'].source).toContain('default');
  const html = renderToStaticMarkup(<Renderer definition={resolved.definition} sources={sources} />);
  expect(html).toContain('&lt;img'); expect(html).not.toContain('<img');
  expect(html).toContain('Mock A'); expect(html).not.toContain('Mock B');
});
test('rejects forbidden, stale, out-of-range, invalid default and removed references without mutation', () => {
  const invalid: Record<string, Value>[] = [{ source_ref: 'secret' }, { 'name-width': 1 }, { 'filter-default': 'missing' }, { 'filter-options': 'open\nopen' }, { 'name-visible': 'false' }];
  for (const values of invalid) {
    expect(() => resolveKit({ ...input, versions, overrides: { 'records-kit::records': values } })).toThrow();
  }
  expect(() => resolveKit({ ...input, versions: { 'records-kit::records': { kitVersion: '2', schema_version: '1.0.0' } } })).toThrow('失效覆寫版本');
  const definition = structuredClone(input.definition); definition.components.pop();
  expect(() => resolveKit({ ...input, definition })).toThrow('未知表格');
  const cross = JSON.stringify(input.definition).replace('"target_component_id":"records"', '"target_component_id":"other-kit::records"');
  expect(() => resolveKit({ ...input, definition: JSON.parse(cross) })).toThrow();
  expect(resolveKit({ ...input, selectedSubfeatures: [] }).definition.components).toEqual([]);
});
