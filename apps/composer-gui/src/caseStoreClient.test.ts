// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { createCaseStoreClient, type CaseStoreClient, type FlowVersion } from './caseStoreClient';
import type { Fetcher } from './previewBackend';

const row = { case_id: 'case/一', name: '收料', created_at: '2026-11-04' };
const version: FlowVersion = { ...row, version: 1, parent_version: null, change_reason: '首次', author: '測試者', content: '{}', content_hash: 'abc', verified_report: '{}' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.useRealTimers());

test('probe rejects successful non-array bodies and malformed rows, including HTML fallbacks', async () => {
  for (const body of [{}, { cases: [] }, null, 'online', [{ name: '缺欄位' }]]) {
    const result = await createCaseStoreClient(async () => json(body)).listCases();
    expect(result).toMatchObject({ ok: false, errors: [{ code: 'E-RESPONSE' }] });
  }
  const html = await createCaseStoreClient(async () => new Response('<html>fallback</html>')).listCases();
  expect(html).toMatchObject({ ok: false, errors: [{ code: 'E-RESPONSE' }] });
  expect(await createCaseStoreClient(async () => json([])).listCases()).toEqual({ ok: true, value: [] });
  expect(await createCaseStoreClient(async () => json([row])).listCases()).toEqual({ ok: true, value: [row] });
});

const routes: { name: string; call: (c: CaseStoreClient) => Promise<unknown>; path: string; body?: unknown; value: unknown }[] = [
  { name: 'list cases', call: c => c.listCases(), path: '/cases', value: [row] },
  { name: 'create case', call: c => c.createCase('收料'), path: '/cases', body: { name: '收料' }, value: row },
  { name: 'list versions', call: c => c.listVersions(row.case_id), path: '/cases/case%2F%E4%B8%80/versions', value: [version] },
  { name: 'get version', call: c => c.getVersion(row.case_id, 1), path: '/cases/case%2F%E4%B8%80/versions/1', value: version },
  { name: 'save version', call: c => c.saveVersion(row.case_id, { expectedParent: null, content: '{}', changeReason: '首次', author: '測試者' }), path: '/cases/case%2F%E4%B8%80/versions', body: { expectedParent: null, content: '{}', changeReason: '首次', author: '測試者' }, value: version },
  { name: 'lifecycle', call: c => c.lifecycle(), path: '/lifecycle', value: { nodes: [{ node_id: 'old', state: 'merged', reason: '重複', replaced_by: 'new', at: 'today' }], combos: [{ combo: ['a', 'b'], state: 'deprecated', reason: '淘汰', at: 'today' }] } },
  ...(['deprecate', 'reactivate'] as const).map(state => ({ name: `node ${state}`, call: (c: CaseStoreClient) => c.setNode('a/b', state, '原因'), path: `/nodes/a%2Fb/${state}`, body: { reason: '原因' }, value: null })),
  { name: 'merge', call: c => c.merge('a', 'b', '差異'), path: '/nodes/merge', body: { keep: 'a', drop: 'b', reason: '差異' }, value: null },
  ...(['deprecate', 'reactivate'] as const).map(state => ({ name: `combo ${state}`, call: (c: CaseStoreClient) => c.setCombo(['b', 'a'], state, '原因'), path: `/combos/${state}`, body: { combo: ['b', 'a'], reason: '原因' }, value: null })),
  { name: 'node usage', call: c => c.usage({ nodeId: 'a' }), path: '/usage', body: { nodeId: 'a' }, value: [{ case_id: 'c', version: 2, graph: 'g' }] },
  { name: 'combo usage', call: c => c.usage({ combo: ['b', 'a'] }), path: '/usage', body: { combo: ['b', 'a'] }, value: [] },
];
test.each(routes)('$name uses the same-origin contract and returns the validated body', async ({ call, path, body, value }) => {
  const fetcher = vi.fn<Fetcher>().mockResolvedValue(json(value));
  expect(await call(createCaseStoreClient(fetcher))).toEqual({ ok: true, value });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(`/case-store-api${path}`);
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(init?.method).toBe(body === undefined ? undefined : 'POST');
  expect(init?.body).toBe(body === undefined ? undefined : JSON.stringify(body));
  if (body !== undefined) expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
});

test.each(routes)('$name converts a network exception into a visible failure', async ({ call }) => {
  const result = await call(createCaseStoreClient(async () => { throw new Error('offline'); }));
  expect(result).toMatchObject({ ok: false, errors: [{ code: 'E-CONNECTION', message: expect.stringContaining('無法連線') }] });
});

test('failure preserves every error, lifecycle detail and validation report without treating HTTP errors as success', async () => {
  const errors = [
    { code: 'E-DEPRECATED', message: '已合併', graph: 'g', nodeId: 'old', replacement: 'new' },
    { code: 'E-DEPRECATED', message: '組合已淘汰', graph: 'g', combo: ['a', 'b'] },
  ];
  const report = { passed: false, diagnostics: [{ code: 'secret', message: '秘密' }] };
  for (const status of [400, 404, 409, 415, 422, 503, 500]) {
    expect(await createCaseStoreClient(async () => json({ errors, report }, status)).listCases()).toEqual({ ok: false, errors, report });
  }
});

test('malformed success and failure bodies are rejected instead of supplying usable domain data', async () => {
  const invalid: { call: (c: CaseStoreClient) => Promise<unknown>; body: unknown }[] = [
    { call: c => c.listVersions('c'), body: [{ ...version, version: 0 }] },
    { call: c => c.getVersion('c', 1), body: { ...version, content: 9 } },
    { call: c => c.lifecycle(), body: { nodes: [{ node_id: 'n', state: 'unknown' }], combos: [] } },
    { call: c => c.lifecycle(), body: { nodes: [], combos: [{ combo: ['a'], state: 'deprecated', reason: '', at: '' }] } },
    { call: c => c.usage({ nodeId: 'n' }), body: [{ case_id: 'c', version: '1', graph: 'g' }] },
    { call: c => c.setNode('n', 'deprecate', 'r'), body: {} },
  ];
  for (const { call, body } of invalid) expect(await call(createCaseStoreClient(async () => json(body)))).toMatchObject({ ok: false, errors: [{ code: 'E-RESPONSE' }] });
  for (const body of [{ errors: [] }, { errors: [{ code: 4 }] }, { errors: [{ code: 'x', message: 'x', combo: [8] }] }]) {
    expect(await createCaseStoreClient(async () => json(body, 500)).listCases()).toMatchObject({ ok: false, errors: [{ code: 'E-RESPONSE' }] });
  }
});

test('a stalled request is aborted and becomes a connection error; completed requests clear their timer', async () => {
  vi.useFakeTimers();
  const pending = createCaseStoreClient((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })).listCases();
  await vi.advanceTimersByTimeAsync(10000);
  expect(await pending).toMatchObject({ ok: false, errors: [{ code: 'E-CONNECTION' }] });
  await createCaseStoreClient(async () => json([])).listCases();
  expect(vi.getTimerCount()).toBe(0);
});
