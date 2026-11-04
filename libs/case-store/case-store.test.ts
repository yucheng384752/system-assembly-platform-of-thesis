// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import fixture from '../../fixtures/aov-merge/bundle/v1.valid.json';
import { canonicalJson, contentSha256, validateAovBundle, type AovBundle } from '../aov-integration';
import { openCaseStore, type CaseStore, type Result, type FlowVersion, type SaveVersionInput } from './index';
import { migrate, migrations } from './migrations';

const directory = dirname(fileURLToPath(import.meta.url));
const cleanup: (() => void)[] = [];
afterEach(() => { for (const clean of cleanup.splice(0).reverse()) clean(); });
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}
function code<T>(result: Result<T>, expected: string) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('預期拒絕');
  expect(result.errors.map(e => e.code)).toContain(expected);
  return result.errors;
}
function databaseFile() {
  const dir = mkdtempSync(join(directory, '.test-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'cases.sqlite');
}
function open(path = ':memory:') {
  const store = openCaseStore(path); cleanup.push(() => store.close()); return store;
}
function raw(path: string) {
  const db = new DatabaseSync(path); cleanup.push(() => db.close()); return db;
}
async function seal(bundle: AovBundle): Promise<string> {
  const parts: [string, unknown][] = [['platform.json', bundle.platform], ['aov.json', bundle.aov],
    ['bindings.json', bundle.bindings], ['migration-report.json', bundle.migrationReport],
    ...bundle.libraries.map((lib, i): [string, unknown] => [`libraries/${i}.json`, lib])];
  bundle.manifest = await Promise.all(parts.map(async ([path, part]) => ({ path,
    sha256: await contentSha256(part), sourceProject: 'synthetic', sourceVersion: '1' })));
  return canonicalJson(bundle);
}
async function content(actions: (string | null)[] = ['a', 'b']): Promise<string> {
  const bundle = structuredClone(fixture) as AovBundle;
  const graph = bundle.platform.graphs[0];
  const template = graph.nodes.find(n => n.kind === 'node')!;
  graph.nodes = [graph.nodes[0], ...actions.map((actionId, i) => ({ ...template, id: `node-${i}`, actionId, formId: null })), graph.nodes.at(-1)!];
  graph.edges = graph.nodes.slice(1).map((n, i) => ({ id: `edge-${i}`, from: graph.nodes[i].id, to: n.id }));
  bundle.platform.forms = []; bundle.platform.relations = []; bundle.platform.layout = {};
  bundle.bindings = { nodes: [], forms: [], actions: [] };
  return seal(bundle);
}
function input(caseId: string, text: string, expectedParent: number | null = null): SaveVersionInput {
  return { caseId, expectedParent, content: text, verifiedReport: { passed: true, checks: ['synthetic'] }, changeReason: '初版', author: '測試作者' };
}
async function saved(store: CaseStore, text: string) {
  const flow = value(store.createCase('測試案例'));
  return value(await store.saveVersion(input(flow.case_id, text)));
}

describe('批一資料契約', () => {
  it('建立案例產生唯一 id，正規化 JSON、雜湊與版本摘要可往返', async () => {
    const store = open(); const text = await content();
    expect((await validateAovBundle(text)).ok).toBe(true);
    const first = value(store.createCase('第一個')), second = value(store.createCase('第二個'));
    expect(first.case_id).not.toBe(second.case_id);
    expect(value(store.listCases())).toEqual(expect.arrayContaining([first, second]));
    const row = value(await store.saveVersion({ ...input(first.case_id, JSON.stringify(JSON.parse(text), null, 2)),
      verifiedReport: { z: 2, passed: true, a: 1 } }));
    expect(row.content).toBe(text);
    expect(row.content_hash).toBe(createHash('sha256').update(text).digest('hex'));
    expect(row.verified_report).toBe('{"a":1,"passed":true,"z":2}');
    expect(row.parent_version).toBeNull(); expect(row.version).toBe(1);
    expect(new Date(row.created_at).toISOString()).toBe(row.created_at);
    expect(value(store.getVersion(first.case_id, 1))).toEqual(row);
    expect(value(store.listVersions(first.case_id))).toEqual([{ version: 1, parent_version: null,
      change_reason: '初版', author: '測試作者', created_at: row.created_at }]);
  });

  it.each(['flow_case', 'flow_version', 'node_lifecycle', 'node_alias', 'combo_lifecycle'])(
    '%s 直接 SQL UPDATE 與 DELETE 都不能改歷史', async table => {
      const path = databaseFile(), store = open(path), db = raw(path);
      await saved(store, await content());
      value(store.deprecateNode('x', '不再使用'));
      value(store.mergeNodes({ keep: 'z', drop: 'y', reason: 'z 支援較完整功能' }));
      value(store.deprecateCombo(['x', 'z'], '不再使用'));
      const before = db.prepare(`SELECT * FROM ${table}`).all();
      expect(before.length).toBeGreaterThan(0);
      expect(() => db.exec(`UPDATE ${table} SET ${table === 'flow_case' ? 'name' : table === 'flow_version' ? 'author' : table === 'node_alias' ? 'merge_reason' : 'reason'} = 'changed'`)).toThrow('append only');
      expect(() => db.exec(`DELETE FROM ${table}`)).toThrow('append only');
      db.exec('PRAGMA recursive_triggers = OFF');
      expect(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`)).toThrow('append only');
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(before);
    },
  );

  it('舊版檔經測試 v1→v2 migration 後內容逐位元組相同，正式 schema 仍為 v1', async () => {
    const path = databaseFile(), db = raw(path);
    // Construct the old file by SQL, not by the current store opener.
    db.exec(`CREATE TABLE schema_meta(id INTEGER PRIMARY KEY, version INTEGER NOT NULL, migrated_at TEXT NOT NULL);
      INSERT INTO schema_meta VALUES (1, 1, '2020-01-01T00:00:00.000Z');
      CREATE TABLE flow_version(case_id TEXT, version INTEGER, parent_version INTEGER, content TEXT,
        content_hash TEXT, verified_report TEXT, change_reason TEXT, author TEXT, created_at TEXT);`);
    const text = JSON.stringify(JSON.parse(await content()), null, 2);
    db.prepare('INSERT INTO flow_version VALUES (?, 1, NULL, ?, ?, ?, ?, ?, ?)')
      .run('old', text, createHash('sha256').update(text).digest('hex'), '{"passed":true}', '初版', '作者', '2020-01-01T00:00:00.000Z');
    const before = db.prepare('SELECT CAST(content AS BLOB) AS bytes FROM flow_version').get()!.bytes;
    migrate(db, [migrations[0], connection => connection.exec('CREATE TABLE migration_probe(value TEXT)')]);
    expect(db.prepare('SELECT version FROM schema_meta').get()!.version).toBe(2);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='migration_probe'").get()).toBeDefined();
    expect(db.prepare('SELECT CAST(content AS BLOB) AS bytes FROM flow_version').get()!.bytes).toEqual(before);
    const reader = new (await import('./index')).CaseStore(db);
    expect(value(reader.getVersion('old', 1)).content).toBe(text);
    const freshPath = databaseFile(); open(freshPath);
    expect(raw(freshPath).prepare('SELECT version FROM schema_meta').get()!.version).toBe(1);
  });

  it('未知較新資料庫拒絕開啟，檔內資料不被修改', () => {
    const path = databaseFile(), db = raw(path);
    db.exec("CREATE TABLE schema_meta(id INTEGER PRIMARY KEY, version INTEGER, migrated_at TEXT); INSERT INTO schema_meta VALUES(1, 99, 'unchanged')");
    expect(() => open(path)).toThrow('E-SCHEMA-NEWER');
    expect(db.prepare('SELECT * FROM schema_meta').get()).toEqual({ id: 1, version: 99, migrated_at: 'unchanged' });
  });

  it('migration 中途失敗時 DDL、資料與版本全部回復', () => {
    const db = raw(databaseFile()); migrate(db);
    db.exec("CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES ('original')");
    const before = db.prepare('SELECT * FROM schema_meta').get();
    expect(() => migrate(db, [migrations[0], connection => {
      connection.exec("UPDATE probe SET value='changed'; CREATE TABLE incomplete(value TEXT)");
      throw new Error('injected migration failure');
    }])).toThrow('injected migration failure');
    expect(db.prepare('SELECT * FROM schema_meta').get()).toEqual(before);
    expect(db.prepare('SELECT value FROM probe').get()!.value).toBe('original');
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='incomplete'").get()).toBeUndefined();
  });

  it('migration 每一步獨立提交：後步失敗保留前步，重試只跑尚未完成步驟', () => {
    const db = raw(databaseFile()); migrate(db);
    const second = (connection: DatabaseSync) => connection.exec("CREATE TABLE second(value TEXT); INSERT INTO second VALUES ('kept')");
    expect(() => migrate(db, [migrations[0], second, connection => {
      connection.exec("UPDATE second SET value='lost'"); throw new Error('third failed');
    }])).toThrow('third failed');
    expect(db.prepare('SELECT version FROM schema_meta').get()!.version).toBe(2);
    expect(db.prepare('SELECT value FROM second').get()!.value).toBe('kept');
    migrate(db, [migrations[0], second, connection => connection.exec('CREATE TABLE third(value TEXT)')]);
    expect(db.prepare('SELECT version FROM schema_meta').get()!.version).toBe(3);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='third'").get()!.name).toBe('third');
  });

  it('content 損壞時讀取與使用處掃描回 E-CORRUPT', async () => {
    const path = databaseFile(), store = open(path), row = await saved(store, await content());
    const db = raw(path);
    db.exec("DROP TRIGGER flow_version_no_update; UPDATE flow_version SET content='{}'");
    code(store.getVersion(row.case_id, 1), 'E-CORRUPT');
    code(store.scanUsage('a'), 'E-CORRUPT');
  });

  it.each([undefined, null, {}, { passed: false }, { passed: 'true' }, { passed: 1 }])(
    '報告 %j 未通過時優先拒絕，且不寫版本', async report => {
      const store = open(), flow = value(store.createCase('案例'));
      code(await store.saveVersion({ ...input(flow.case_id, 'invalid'), verifiedReport: report }), 'E-NOT-VERIFIED');
      expect(value(store.listVersions(flow.case_id))).toEqual([]);
    },
  );

  it('完整語意驗證必須執行：合法外殼但 checksum 錯誤不可存', async () => {
    const store = open(), flow = value(store.createCase('案例'));
    const bundle: AovBundle = JSON.parse(await content()); bundle.manifest[0].sha256 = '0'.repeat(64);
    code(await store.saveVersion(input(flow.case_id, canonicalJson(bundle))), 'E-BAD-CONTENT');
    expect(value(store.listVersions(flow.case_id))).toEqual([]);
  });

  it('報告必須是可持久化的 JSON 物件，不能用繼承屬性或陣列假裝 passed', async () => {
    const store = open(), flow = value(store.createCase('案例')), text = await content();
    const cycle: { passed: boolean; self?: unknown } = { passed: true }; cycle.self = cycle;
    for (const report of [Object.create({ passed: true }), Object.assign([], { passed: true }), cycle]) {
      code(await store.saveVersion({ ...input(flow.case_id, text), verifiedReport: report }), 'E-NOT-VERIFIED');
    }
    expect(value(store.listVersions(flow.case_id))).toEqual([]);
  });

  it('資料庫同樣拒絕缺 passed 的報告與非字串組合元素', async () => {
    const path = databaseFile(), store = open(path), row = await saved(store, await content()), db = raw(path);
    expect(() => db.prepare('INSERT INTO flow_version VALUES (?, 2, 1, ?, ?, ?, ?, ?, ?)')
      .run(row.case_id, row.content, row.content_hash, '{}', '修改', '作者', row.created_at)).toThrow();
    expect(() => db.exec("INSERT INTO combo_lifecycle(combo,state,reason,at) VALUES ('[1,2]','deprecated','原因','now')")).toThrow('combo elements must be strings');
    expect(value(store.listVersions(row.case_id))).toHaveLength(1);
  });

  it.each(['bundle', 'platform', 'aov', 'library'])(
    '拒絕未知內嵌或外殼版本：%s', async target => {
      const store = open(), flow = value(store.createCase('案例'));
      const bundle = structuredClone(fixture) as AovBundle;
      if (target === 'bundle') Object.assign(bundle, { version: 99 });
      if (target === 'platform') Object.assign(bundle.platform, { version: 99 });
      if (target === 'aov') Object.assign(bundle.aov, { formatVersion: 99 });
      if (target === 'library') Object.assign(bundle.libraries[0].content, { formatVersion: 99 });
      code(await store.saveVersion(input(flow.case_id, await seal(bundle))), 'E-BAD-CONTENT');
      expect(value(store.listVersions(flow.case_id))).toEqual([]);
    },
  );

  it('UTF-8 原始內容恰好 10 MB 接受，多一 byte 拒絕', async () => {
    const store = open(), flow = value(store.createCase('案例')), text = await content();
    const exact = text + ' '.repeat(10_000_000 - Buffer.byteLength(text));
    value(await store.saveVersion(input(flow.case_id, exact)));
    code(await store.saveVersion(input(flow.case_id, exact + ' ', 1)), 'E-BAD-CONTENT');
    const multibyte: AovBundle = JSON.parse(text);
    multibyte.aov.note = '中'.repeat(Math.floor(10_000_000 / 3));
    const large = await seal(multibyte);
    expect(large.length).toBeLessThan(10_000_000);
    expect(Buffer.byteLength(large)).toBeGreaterThan(10_000_000);
    code(await store.saveVersion(input(flow.case_id, large, 1)), 'E-BAD-CONTENT');
    expect(value(store.listVersions(flow.case_id))).toHaveLength(1);
  });

  it('淘汰只擋新版本；重啟讀取、再啟用與歷史原文保持一致', async () => {
    const path = databaseFile(), store = open(path), row = await saved(store, await content());
    value(store.deprecateNode('a', '已過時'));
    const errors = code(await store.saveVersion(input(row.case_id, row.content, 1)), 'E-DEPRECATED');
    expect(errors).toEqual([{ code: 'E-DEPRECATED', graph: 'example-graph', nodeId: 'a', message: 'a 已淘汰。' }]);
    expect(value(open(path).getVersion(row.case_id, 1)).content).toBe(row.content);
    expect(value(store.resolveNode('a')).state).toBe('deprecated');
    value(store.reactivateNode('a', '重新驗證'));
    expect(value(store.resolveNode('a')).state).toBe('active');
    expect(value(await store.saveVersion(input(row.case_id, row.content, 1))).version).toBe(2);
  });

  it('每個命中的 node 與所在 graph 都列出', async () => {
    const store = open(), flow = value(store.createCase('案例'));
    const bundle: AovBundle = JSON.parse(await content());
    const other = structuredClone(bundle.platform.graphs[0]); other.id = 'other';
    other.nodes.forEach(n => { n.id += '-other'; }); other.edges.forEach(e => { e.from += '-other'; e.to += '-other'; });
    bundle.platform.graphs.push(other); bundle.platform.factories[0].logicGraphIds.push('other');
    value(store.deprecateNode('a', '過時')); value(store.deprecateNode('b', '過時'));
    const errors = code(await store.saveVersion(input(flow.case_id, await seal(bundle))), 'E-DEPRECATED');
    expect(errors.map(e => [e.graph, e.nodeId])).toEqual([['example-graph', 'a'], ['example-graph', 'b'], ['other', 'a'], ['other', 'b']]);
  });

  it('多段合併解析終點，舊 id 拒絕並提示替代；歷史不改寫且循環被拒絕', async () => {
    const store = open(), row = await saved(store, await content());
    value(store.mergeNodes({ keep: 'x', drop: 'a', reason: 'x 包含 a 並補足差異' }));
    value(store.mergeNodes({ keep: 'z', drop: 'x', reason: 'z 補足 x 的限制' }));
    expect(value(store.resolveNode('a'))).toEqual({ nodeId: 'z', state: 'active' });
    const errors = code(await store.saveVersion(input(row.case_id, row.content, 1)), 'E-DEPRECATED');
    expect(errors[0]).toMatchObject({ nodeId: 'a', replacement: 'z' });
    expect(errors[0].message).toContain('z');
    expect(value(store.getVersion(row.case_id, 1)).content).toBe(row.content);
    code(store.mergeNodes({ keep: 'a', drop: 'z', reason: '循環' }), 'E-ALIAS-CYCLE');
    code(store.mergeNodes({ keep: 'z', drop: 'z', reason: '自身' }), 'E-ALIAS-CYCLE');
    expect(value(store.resolveNode('a')).nodeId).toBe('z');
    value(await store.saveVersion(input(row.case_id, await content(['z', 'b']), 1)));
  });

  it('合併拒絕已 merged 的兩方與 deprecated 保留方，允許淘汰方合併', () => {
    const store = open();
    value(store.mergeNodes({ keep: 'b', drop: 'a', reason: '差異' }));
    code(store.mergeNodes({ keep: 'c', drop: 'a', reason: '差異' }), 'E-DEPRECATED');
    code(store.mergeNodes({ keep: 'a', drop: 'c', reason: '差異' }), 'E-DEPRECATED');
    value(store.deprecateNode('d', '淘汰'));
    code(store.mergeNodes({ keep: 'd', drop: 'e', reason: '差異' }), 'E-DEPRECATED');
    value(store.mergeNodes({ keep: 'e', drop: 'd', reason: '差異' }));
    code(store.reactivateNode('d', '恢復'), 'E-DEPRECATED');
  });

  it('合併第二筆寫入失敗時別名與事件一起回復', () => {
    const path = databaseFile(), store = open(path), db = raw(path);
    db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON node_lifecycle BEGIN SELECT RAISE(ABORT, 'injected'); END");
    expect(() => store.mergeNodes({ keep: 'b', drop: 'a', reason: '差異' })).toThrow('injected');
    expect(db.prepare('SELECT * FROM node_alias').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM node_lifecycle').all()).toEqual([]);
  });

  it('直接 SQL 寫入間接循環也被拒絕', () => {
    const path = databaseFile(); open(path); const db = raw(path);
    db.exec("INSERT INTO node_alias VALUES('a','b','差異','now'),('b','c','差異','now')");
    expect(() => db.exec("INSERT INTO node_alias VALUES('c','a','差異','now')")).toThrow('alias cycle');
    expect(db.prepare('SELECT COUNT(*) AS count FROM node_alias').get()!.count).toBe(2);
  });

  it('組合只比有向直接連線，隔 node、無 action 節點與反向皆不命中', async () => {
    const store = open(), flow = value(store.createCase('案例'));
    value(store.deprecateCombo(['a', 'b'], '過時'));
    const errors = code(await store.saveVersion(input(flow.case_id, await content(['a', 'b']))), 'E-DEPRECATED');
    expect(errors[0]).toMatchObject({ combo: ['a', 'b'], graph: 'example-graph' });
    value(await store.saveVersion(input(flow.case_id, await content(['a', 'c', 'b']))));
    value(await store.saveVersion(input(flow.case_id, await content(['a', null, 'b']), 1)));
    value(await store.saveVersion(input(flow.case_id, await content(['b', 'a']), 2)));
    value(store.reactivateCombo(['a', 'b'], '已修正'));
    value(await store.saveVersion(input(flow.case_id, await content(['a', 'b']), 3)));
  });

  it('三節點組合不能用分支湊成，兩側別名正規化後仍命中', async () => {
    const store = open(), flow = value(store.createCase('案例'));
    value(store.deprecateCombo(['old-a', 'old-b', 'c'], '過時'));
    value(store.mergeNodes({ keep: 'a', drop: 'old-a', reason: '差異' }));
    value(store.mergeNodes({ keep: 'b', drop: 'old-b', reason: '差異' }));
    code(await store.saveVersion(input(flow.case_id, await content(['a', 'b', 'c']))), 'E-DEPRECATED');
    const bundle: AovBundle = JSON.parse(await content(['a', 'b', 'c']));
    bundle.platform.graphs[0].edges = [{ id: 'ab', from: 'node-0', to: 'node-1' }, { id: 'ac', from: 'node-0', to: 'node-2' }];
    value(await store.saveVersion(input(flow.case_id, await seal(bundle))));
    value(store.reactivateCombo(['old-a', 'old-b', 'c'], '已修正'));
    value(await store.saveVersion(input(flow.case_id, await content(['a', 'b', 'c']), 1)));
  });

  it('組合每個命中 graph 都列出，最新狀態以原始 combo 文字分開計算', async () => {
    const store = open(), flow = value(store.createCase('案例'));
    const bundle: AovBundle = JSON.parse(await content());
    const other = structuredClone(bundle.platform.graphs[0]); other.id = 'other';
    other.nodes.forEach(n => { n.id += '-other'; }); other.edges.forEach(e => { e.from += '-other'; e.to += '-other'; });
    bundle.platform.graphs.push(other); bundle.platform.factories[0].logicGraphIds.push('other');
    value(store.deprecateCombo(['old', 'b'], '過時'));
    value(store.mergeNodes({ keep: 'a', drop: 'old', reason: '差異' }));
    value(store.reactivateCombo(['a', 'b'], '不同的原始組合'));
    const errors = code(await store.saveVersion(input(flow.case_id, await seal(bundle))), 'E-DEPRECATED');
    expect(errors.map(e => [e.graph, e.combo])).toEqual([['example-graph', ['old', 'b']], ['other', ['old', 'b']]]);
    value(store.reactivateCombo(['old', 'b'], '同一個原始組合'));
    value(await store.saveVersion(input(flow.case_id, await seal(bundle))));
  });

  it('拒絕過期父版本、不分岔、不消耗版本號', async () => {
    const store = open(), row = await saved(store, await content());
    code(await store.saveVersion(input(row.case_id, row.content)), 'E-VERSION-CONFLICT');
    code(await store.saveVersion(input(row.case_id, row.content, 99)), 'E-VERSION-CONFLICT');
    value(await store.saveVersion(input(row.case_id, row.content, 1)));
    code(await store.saveVersion(input(row.case_id, row.content, 1)), 'E-VERSION-CONFLICT');
    value(await store.saveVersion(input(row.case_id, row.content, 2)));
    expect(value(store.listVersions(row.case_id)).map(v => [v.version, v.parent_version])).toEqual([[1, null], [2, 1], [3, 2]]);
  });

  it('兩個 worker 的連線同時儲存：一成功一衝突，重試後連續且持久化', async () => {
    const path = databaseFile(), store = open(path), text = await content(), flow = value(store.createCase('並行'));
    const workers = [0, 1].map(() => new Worker(join(directory, 'worker-loader.cjs'), {
      workerData: { path, input: input(flow.case_id, text) },
    }));
    try {
      await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => {
        worker.once('error', reject); worker.once('message', message => message === 'ready' ? resolve() : reject(new Error('not ready')));
      })));
      const pending = workers.map(worker => new Promise<Result<FlowVersion>>((resolve, reject) => {
        worker.once('error', reject); worker.once('message', resolve);
      }));
      workers.forEach(worker => worker.postMessage('go'));
      const results = await Promise.all(pending);
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.filter(r => !r.ok)).toHaveLength(1);
      code(results.find(r => !r.ok)!, 'E-VERSION-CONFLICT');
      expect(value(store.listVersions(flow.case_id)).map(v => v.version)).toEqual([1]);
      value(await store.saveVersion(input(flow.case_id, text, 1)));
      expect(value(open(path).listVersions(flow.case_id)).map(v => [v.version, v.parent_version])).toEqual([[1, null], [2, 1]]);
    } finally { await Promise.all(workers.map(worker => worker.terminate())); }
  }, 20000);

  it('scanUsage 列出全部案例版本的原始引用，組合仍遵守直接相連', async () => {
    const store = open(), first = await saved(store, await content()), second = await saved(store, await content(['a', 'c', 'b']));
    value(await store.saveVersion(input(first.case_id, first.content, 1)));
    value(store.mergeNodes({ keep: 'new-a', drop: 'a', reason: '差異' }));
    const expected = [1, 2].map(version => ({ case_id: first.case_id, version, graph: 'example-graph' }));
    expect(value(store.scanUsage('a'))).toEqual(expect.arrayContaining([...expected, { case_id: second.case_id, version: 1, graph: 'example-graph' }]));
    expect(value(store.scanUsage('a'))).toHaveLength(3);
    expect(value(store.scanUsage(['a', 'b']))).toEqual(expected);
    expect(value(store.scanUsage('new-a'))).toEqual([]);
  });

  it('欄位長度、空值與找不到資料回可辨識錯誤，不留下版本', async () => {
    const store = open(), flow = value(store.createCase('案'.repeat(300))), text = await content();
    for (const name of ['', ' ', '案'.repeat(301)]) code(store.createCase(name), 'E-INVALID-INPUT');
    for (const patch of [{ author: '' }, { author: 'a'.repeat(101) }, { changeReason: '' }, { changeReason: 'a'.repeat(2001) }]) {
      code(await store.saveVersion({ ...input(flow.case_id, text), ...patch }), 'E-INVALID-INPUT');
    }
    code(store.deprecateNode('', '原因'), 'E-INVALID-INPUT');
    code(store.deprecateNode('a', ''), 'E-INVALID-INPUT');
    code(store.deprecateCombo(['a'], '原因'), 'E-INVALID-INPUT');
    code(store.deprecateCombo(['a', ''], '原因'), 'E-INVALID-INPUT');
    code(store.mergeNodes({ keep: 'a', drop: 'b', reason: '' }), 'E-INVALID-INPUT');
    code(store.resolveNode(''), 'E-INVALID-INPUT');
    code(store.scanUsage([]), 'E-INVALID-INPUT');
    code(store.getVersion(flow.case_id, 0), 'E-INVALID-INPUT');
    code(store.getVersion(flow.case_id, 1), 'E-NOT-FOUND');
    code(store.listVersions('missing'), 'E-NOT-FOUND');
    code(await store.saveVersion(input('missing', text)), 'E-NOT-FOUND');
    expect(value(store.listVersions(flow.case_id))).toEqual([]);
    value(await store.saveVersion({ ...input(flow.case_id, text), author: '人'.repeat(100), changeReason: '因'.repeat(2000) }));
  });
});
