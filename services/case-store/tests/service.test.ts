// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import fixture from '../../../fixtures/aov-merge/bundle/v1.valid.json';
import cProject from '../../../fixtures/aov-merge/c/project.valid.json';
import { canonicalJson, contentSha256, type AovBundle } from '../../../libs/aov-integration';
import { openCaseStore } from '../../../libs/case-store';
import { createApiServer } from '../src/server';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const clean of cleanup.splice(0).reverse()) clean(); });

interface Reply { status: number; body: any }
type Call = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Reply>;

async function seal(bundle: AovBundle): Promise<string> {
  const parts: [string, unknown][] = [['platform.json', bundle.platform], ['aov.json', bundle.aov],
    ['bindings.json', bundle.bindings], ['migration-report.json', bundle.migrationReport],
    ...bundle.libraries.map((lib, i): [string, unknown] => [`libraries/${i}.json`, lib])];
  bundle.manifest = await Promise.all(parts.map(async ([path, part]) => ({ path,
    sha256: await contentSha256(part), sourceProject: 'synthetic', sourceVersion: '1' })));
  return canonicalJson(bundle);
}
async function content(actions: string[] = ['a', 'b']): Promise<string> {
  const bundle = structuredClone(fixture) as AovBundle;
  const graph = bundle.platform.graphs[0];
  const template = graph.nodes.find(n => n.kind === 'node')!;
  graph.nodes = [graph.nodes[0], ...actions.map((actionId, i) => ({ ...template, id: `node-${i}`, actionId, formId: null })), graph.nodes.at(-1)!];
  graph.edges = graph.nodes.slice(1).map((n, i) => ({ id: `edge-${i}`, from: graph.nodes[i].id, to: n.id }));
  bundle.platform.forms = []; bundle.platform.relations = []; bundle.platform.layout = {};
  bundle.bindings = { nodes: [], forms: [], actions: [] };
  // The fixture's aov is an empty shell that the core compile rightly rejects; use the real, compilable generic example.
  bundle.aov = structuredClone(cProject) as unknown as AovBundle['aov'];
  return seal(bundle);
}
// Passes the bundle contract but fails the core rules: two A nodes with the same id.
async function uncompilable(): Promise<string> {
  const bundle = JSON.parse(await content()) as AovBundle;
  bundle.aov.nodes.push(structuredClone(bundle.aov.nodes[0]));
  return seal(bundle);
}

async function start() {
  const store = openCaseStore(':memory:');
  const server = createApiServer(store);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  cleanup.push(() => { server.close(); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call: Call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { call, base };
}
async function newCase(call: Call) { return (await call('POST', '/cases', { name: '案例' })).body.case_id as string; }
const save = (call: Call, id: string, text: string, expectedParent: number | null, extra: object = {}) =>
  call('POST', `/cases/${id}/versions`, { expectedParent, content: text, changeReason: '初版', author: '測試', ...extra });
const reseal = (tables: unknown) => createHash('sha256').update(canonicalJson(tables)).digest('hex');

describe('批二服務', () => {
  it('伺服器自己產生驗證報告，忽略用戶端送來的 passed', async () => {
    const { call } = await start(); const id = await newCase(call);
    const res = await save(call, id, await content(), null, { verifiedReport: { passed: true, forged: 'x' } });
    expect(res.status).toBe(201);
    const report = JSON.parse(res.body.verified_report);
    expect(report.forged).toBeUndefined();
    expect(report.scope).toBe('bundle-contract+core-compile');
    expect(report.notRun).toContain('瀏覽器內的互動模擬');
  });

  it('核心規則不過的內容即使用戶端宣稱通過也不能存', async () => {
    const { call } = await start(); const id = await newCase(call);
    const res = await save(call, id, await uncompilable(), null, { verifiedReport: { passed: true } });
    expect(res.status).toBe(422);
    expect(res.body.report.passed).toBe(false);
    expect(res.body.report.steps).toEqual([{ name: 'bundle', ok: true }, { name: 'compile', ok: false }]);
    expect((await call('GET', `/cases/${id}/versions`)).body).toEqual([]);
  });

  it('過期的 expectedParent 得到 409，不產生重複版本', async () => {
    const { call } = await start(); const id = await newCase(call);
    expect((await save(call, id, await content(), null)).status).toBe(201);
    expect((await save(call, id, await content(), null)).status).toBe(409);
    expect((await save(call, id, await content(), 1)).status).toBe(201);
    expect((await call('GET', `/cases/${id}/versions`)).body.map((v: { version: number }) => v.version)).toEqual([1, 2]);
  });

  it('淘汰與合併經 API 生效：舊版可讀，新版被擋並指出保留方', async () => {
    const { call } = await start(); const id = await newCase(call);
    expect((await save(call, id, await content(['a', 'b']), null)).status).toBe(201);
    expect((await call('POST', '/nodes/merge', { keep: 'b', drop: 'a', reason: 'a 與 b 功能重複，a 多一個選填參數' })).status).toBe(200);
    const blocked = await save(call, id, await content(['a', 'c']), 1);
    expect(blocked.status).toBe(409);
    expect(blocked.body.errors[0].replacement).toBe('b');
    expect((await call('GET', `/cases/${id}/versions/1`)).status).toBe(200);
    expect((await call('GET', '/nodes/a')).body).toEqual({ nodeId: 'b', state: 'active' });
    expect((await call('POST', '/usage', { nodeId: 'a' })).body).toEqual([{ case_id: id, version: 1, graph: expect.any(String) }]);
  });

  it('備份往返後內容相同，且只能匯入空庫', async () => {
    const first = await start(); const id = await newCase(first.call);
    await save(first.call, id, await content(), null);
    await first.call('POST', '/combos/deprecate', { combo: ['x', 'y'], reason: '改用新流程' });
    const backup = (await first.call('GET', '/backup')).body;
    const second = await start();
    expect((await second.call('POST', '/backup', backup)).status).toBe(200);
    expect((await second.call('GET', `/cases/${id}/versions/1`)).body.content)
      .toBe((await first.call('GET', `/cases/${id}/versions/1`)).body.content);
    expect((await second.call('GET', '/backup')).body).toEqual(backup);
    expect((await second.call('POST', '/backup', backup)).status).toBe(409);
  });

  it('壞掉或被竄改的備份被拒絕，含重算雜湊後塞入未知欄位', async () => {
    const source = await start(); const id = await newCase(source.call);
    await save(source.call, id, await content(), null);
    const backup = (await source.call('GET', '/backup')).body;
    const tampered = structuredClone(backup); tampered.tables.flow_case[0].name = '被改過';
    expect((await (await start()).call('POST', '/backup', tampered)).body.errors[0].code).toBe('E-BAD-BACKUP');

    const injected = structuredClone(backup);
    injected.tables.flow_case[0]['name) VALUES (1); DROP TABLE flow_case; --'] = 'x';
    injected.sha256 = reseal(injected.tables);
    const target = await start();
    const rejected = (await target.call('POST', '/backup', injected)).body.errors[0];
    expect(rejected.code).toBe('E-BAD-BACKUP');
    // Without the whitelist SQLite would also fail, but on a syntax error after the name was already spliced into SQL.
    expect(rejected.message).toContain('未知欄位');
    expect((await target.call('GET', '/cases')).body).toEqual([]);

    const hashBroken = structuredClone(backup); hashBroken.tables.flow_version[0].content = '{}';
    hashBroken.sha256 = reseal(hashBroken.tables);
    const other = await start();
    expect((await other.call('POST', '/backup', hashBroken)).body.errors[0].code).toBe('E-CORRUPT');
    expect((await other.call('GET', '/cases')).body).toEqual([]);
  });

  it('只接受本機來源與 JSON 請求', async () => {
    const { call, base } = await start();
    expect((await call('GET', '/cases', undefined, { origin: 'https://evil.example' })).status).toBe(403);
    const form = await fetch(`${base}/cases`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"name":"x"}' });
    expect(form.status).toBe(415);
    const hostile = await new Promise<number>(done => {
      request(`${base}/cases`, { headers: { host: 'evil.example' } }, r => done(r.statusCode ?? 0)).end();
    });
    expect(hostile).toBe(403);
    expect((await call('GET', '/nope')).status).toBe(404);
  });
});
