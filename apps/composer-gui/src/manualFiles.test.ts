import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { kits } from './catalog';
import { checkManuals, fragmentPath, loadFragments, manualRoles, parseFragment } from './manual';

const batches = [
  ['platform-core-kit', 'entry-permission-kit', 'station-data-link-kit'],
  ['upload-validation-kit', 'import-pipeline-kit', 'query-traceability-kit'],
  ['analytics-kit', 'generic-forms-kit', 'station-admin-kit'],
  ['audit-edit-kit', 'logs-ops-kit', 'mod-subscription-kit'],
];
const raw = import.meta.glob<string>('../../../manuals/kits/*/*/*.md', { query: '?raw', import: 'default', eager: true });
const fragments = loadFragments(raw);

// D49: each authored batch must match the real catalog and point only to files that exist.
test.each(batches.map((ids, i) => [i + 1, ids] as const))('manual batch %i has nine valid draft fragments with existing sources', (_batch, ids) => {
  expect(checkManuals({ kits, enabledKits: [...ids], fragments, mode: 'package' })).toEqual([]);
  for (const id of ids) for (const role of manualRoles) {
    const kit = kits.find(k => k.id === id)!;
    const fragment = fragments[fragmentPath(kit, role)];
    expect(fragment).toBeDefined();
    if ('error' in fragment) throw new Error(fragment.error);
    expect(fragment.meta).toMatchObject({ kitId: id, kitVersion: kit.version, role, status: 'draft' });
    for (const source of fragment.meta.sources) expect(existsSync(resolve(import.meta.dirname, '../../..', source)), source).toBe(true);
  }
});

// WP5/D48: inspect every actual file, including extras that expected-path checks alone could miss.
test('all 36 files parse and match their paths, draft status and existing source files', () => {
  expect(Object.keys(raw)).toHaveLength(36);
  for (const [path, text] of Object.entries(raw)) {
    const { meta } = parseFragment(text);
    const kit = kits.find(k => k.id === meta.kitId);
    expect(kit, path).toBeDefined();
    expect(path).toBe(`../../../${fragmentPath(kit!, meta.role)}`);
    expect(meta.kitVersion).toBe(kit!.version);
    expect(meta.status).toBe('draft');
    for (const source of meta.sources) expect(existsSync(resolve(import.meta.dirname, '../../..', source)), source).toBe(true);
  }
});

// WP5/D50: draft coverage permits delivery but never silently becomes reviewed release content.
test('all 12 kits pass package checks and yield 36 unreviewed release issues', () => {
  expect(kits).toHaveLength(12);
  expect(Object.keys(fragments)).toHaveLength(36);
  const enabledKits = kits.map(k => k.id);
  expect(checkManuals({ kits, enabledKits, fragments, mode: 'package' })).toEqual([]);
  const release = checkManuals({ kits, enabledKits, fragments, mode: 'release' });
  expect(release).toHaveLength(36);
  expect(release.every(issue => issue.reason.includes('尚未審閱'))).toBe(true);
});
