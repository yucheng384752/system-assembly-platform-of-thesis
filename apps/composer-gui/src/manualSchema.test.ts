import { expect, it } from 'vitest';
import { validateSchema } from '../../../libs/ui-runtime/schema';

const meta = { kitId: 'example-kit', kitVersion: '1.0.0', role: 'user', status: 'draft', sources: ['kits/example-kit/manifest.json'] };

// D48: a valid fragment must be accepted before parser and packaging can share this contract.
it('accepts both declared review states and all three roles', () => {
  for (const status of ['draft', 'reviewed']) for (const role of ['user', 'mis', 'developer']) {
    expect(() => validateSchema('manual', { ...meta, status, role })).not.toThrow();
  }
});

// Missing or ambiguous provenance must not silently pass the handoff contract.
it('rejects every missing field, unknown fields, invalid states and invalid source lists', () => {
  for (const field of Object.keys(meta)) {
    const missing: Record<string, unknown> = { ...meta }; delete missing[field];
    expect(() => validateSchema('manual', missing)).toThrow();
  }
  for (const change of [{ unknown: true }, { status: 'published' }, { sources: [] },
    { sources: [meta.sources[0], meta.sources[0]] }, { sources: ['docs/example.md'] }]) {
    expect(() => validateSchema('manual', { ...meta, ...change })).toThrow();
  }
});
