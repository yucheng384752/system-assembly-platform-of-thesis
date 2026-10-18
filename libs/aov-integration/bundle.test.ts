import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/aov-merge/bundle/v1.valid.json';
import platformFixture from '../../fixtures/aov-merge/b/v5.valid.json';
import brokenProject from '../../fixtures/aov-merge/c/project.broken-nodes.json';
import unknownProject from '../../fixtures/aov-merge/c/project.unknown-formatVersion.json';
import brokenLibrary from '../../fixtures/aov-merge/c/library.broken-actions.json';
import { parseActionCatalog } from '../ui-runtime/registry';
import actionData from '../../config/actions.json';
const actionCatalog = parseActionCatalog(actionData);
import { canonicalJson, contentSha256, HASH_LIMITATION, MAX_BUNDLE_BYTES, validateAovBundle, type AovBundle } from './index';

const fresh = () => structuredClone(fixture) as AovBundle;
async function seal(bundle: AovBundle) {
  const parts: [string, unknown][] = [
    ['platform.json', bundle.platform], ['aov.json', bundle.aov], ['bindings.json', bundle.bindings],
    ['migration-report.json', bundle.migrationReport], ...bundle.libraries.map((lib, i): [string, unknown] => [`libraries/${i}.json`, lib]),
  ];
  bundle.manifest = await Promise.all(parts.map(async ([path, value]) => ({ path, sha256: await contentSha256(value), sourceProject: 'example', sourceVersion: '1' })));
}
async function rejected(text: string, path: string, code?: string) {
  const draft = fresh();
  const before = structuredClone(draft);
  const result = await validateAovBundle(text, draft);
  expect(draft, '拒絕候選時不得變更傳入的目前草稿').toEqual(before);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('預期拒絕');
  expect(result.errors.some(error => error.path === path && (!code || error.code === code)), JSON.stringify(result.errors)).toBe(true);
  expect(result).not.toHaveProperty('value');
  return result.errors;
}

describe('WP2 整合包的候選驗證', () => {
  it('既有去識別化 fixture 組成的正常包往返相等，成功候選與目前草稿不共用物件', async () => {
    const draft = fresh();
    const before = structuredClone(draft);
    const result = await validateAovBundle(JSON.stringify(fixture), draft);
    expect(result).toEqual({ ok: true, value: fixture });
    if (!result.ok) throw new Error('預期通過');
    expect(result.value.platform).toEqual(platformFixture);
    expect(await validateAovBundle(JSON.stringify(result.value))).toEqual(result);
    result.value.aov.meta.name = '候選修改';
    expect(draft).toEqual(before);
  });
  it('正規化遞迴排序所有鍵（含數字字樣與 __proto__），保留陣列順序且與獨立 sha256 一致', async () => {
    const value = JSON.parse('{"z":{"b":2,"a":1},"2":2,"10":10,"__proto__":{"b":1},"a":[2,1]}');
    const expected = '{"10":10,"2":2,"__proto__":{"b":1},"a":[2,1],"z":{"a":1,"b":2}}';
    expect(canonicalJson(value)).toBe(expected);
    expect(await contentSha256(value)).toBe(createHash('sha256').update(expected).digest('hex'));
    expect(await contentSha256({ a: 1, b: { c: 2, a: 3 } })).toBe(await contentSha256({ b: { a: 3, c: 2 }, a: 1 }));
    expect(await contentSha256([1, 2])).not.toBe(await contentSha256([2, 1]));
  });
  it.each(['format', 'version', 'platform', 'aov', 'libraries', 'bindings', 'manifest', 'migrationReport'])(
    '缺少必填 %s 時指出欄位且保留草稿', async key => {
      const bundle: Record<string, unknown> = fresh() as unknown as Record<string, unknown>;
      delete bundle[key];
      await rejected(JSON.stringify(bundle), `/${key}`, 'S0-shape');
    },
  );
  it.each([
    ['未知 format', '/format', (b: AovBundle) => Object.assign(b, { format: 'unknown' })],
    ['未知 version', '/version', (b: AovBundle) => Object.assign(b, { version: 99 })],
    ['未知平台格式', '/platform/format', (b: AovBundle) => Object.assign(b.platform, { format: 'unknown' })],
    ['舊平台版本不得在 WP2 自動升級', '/platform/version', (b: AovBundle) => Object.assign(b.platform, { version: 4 })],
    ['C 未知版本', '/aov/formatVersion', (b: AovBundle) => { b.aov = unknownProject as AovBundle['aov']; }],
    ['C nodes 損壞', '/aov/nodes', (b: AovBundle) => { b.aov = brokenProject as unknown as AovBundle['aov']; }],
    ['動作庫 actions 損壞', '/libraries/0/content/actions', (b: AovBundle) => { b.libraries[0].content = brokenLibrary as unknown as AovBundle['libraries'][number]['content']; }],
    ['動作庫未知格式', '/libraries/0/content/kind', (b: AovBundle) => Object.assign(b.libraries[0].content, { kind: 'unknown' })],
    ['動作庫未知版本', '/libraries/0/content/formatVersion', (b: AovBundle) => Object.assign(b.libraries[0].content, { formatVersion: 2 })],
  ] as const)('%s 應拒絕並指出位置', async (_intent, path, change) => {
    const bundle = fresh(); change(bundle);
    await rejected(JSON.stringify(bundle), path);
  });
  it.each([
    ['平台表單', '/platform/forms/5/id', (b: AovBundle) => b.platform.forms.push(structuredClone(b.platform.forms[0]))],
    ['映射的來源節點', '/bindings/nodes/1/platformNodeId', (b: AovBundle) => b.bindings.nodes.push(structuredClone(b.bindings.nodes[0]))],
    ['映射的目標節點', '/bindings/nodes/1/aovNodeId', (b: AovBundle) => b.bindings.nodes.push({ ...b.bindings.nodes[0], platformNodeId: 'example-node-2' })],
    ['欄位映射', '/bindings/forms/0/fields/1/sourceFieldId', (b: AovBundle) => b.bindings.forms[0].fields.push({ ...b.bindings.forms[0].fields[0] })],
    ['動作庫', '/libraries/1/id', (b: AovBundle) => b.libraries.push(structuredClone(b.libraries[0]))],
  ] as const)('%s 重複 ID 時拒絕，不由後一筆覆蓋前一筆', async (_intent, path, change) => {
    const bundle = fresh(); change(bundle); await seal(bundle);
    await rejected(JSON.stringify(bundle), path, 'duplicate-id');
  });
  it('壞 checksum 明寫雜湊不是簽章且不證明來源', async () => {
    const bundle = fresh(); bundle.manifest[0].sha256 = '0'.repeat(64);
    const errors = await rejected(JSON.stringify(bundle), '/manifest/0/sha256', 'checksum');
    expect(errors.find(e => e.path === '/manifest/0/sha256')?.message).toContain(HASH_LIMITATION);
  });
  it('表單改動即使重算 manifest，舊 sourceVersion 仍失效', async () => {
    const bundle = fresh(); bundle.platform.forms[0].name = '修改表單'; await seal(bundle);
    const errors = await rejected(JSON.stringify(bundle), '/bindings/forms/0/sourceVersion', 'checksum');
    expect(errors[0].message).toContain(HASH_LIMITATION);
  });
  it('僅變更鍵的排列順序不會讓既有 checksum 或 sourceVersion 失效', async () => {
    const bundle = fresh(); bundle.platform.forms[0] = Object.fromEntries(Object.entries(bundle.platform.forms[0]).reverse()) as typeof bundle.platform.forms[number];
    expect((await validateAovBundle(JSON.stringify(bundle))).ok).toBe(true);
  });
  it('缺少動作庫依賴即拒絕，含不被 bindings 使用的間接依賴', async () => {
    const bundle = fresh(); bundle.libraries[0].dependencies.push({ id: 'missing', version: 1 }); await seal(bundle);
    await rejected(JSON.stringify(bundle), '/libraries/0/dependencies/0', 'dependency');
  });
  it('同 ID 不同版本不得並存', async () => {
    const bundle = fresh(); const other = structuredClone(bundle.libraries[0]); other.version = 2; other.content.meta.version = 2;
    bundle.libraries.push(other); await seal(bundle);
    await rejected(JSON.stringify(bundle), '/libraries/1/id', 'version-conflict');
  });
  it('依賴要求的版本與內含版本不同時拒絕', async () => {
    const bundle = fresh(); bundle.libraries[0].dependencies.push({ id: bundle.libraries[0].id, version: 2 }); await seal(bundle);
    await rejected(JSON.stringify(bundle), '/libraries/0/dependencies/0', 'version-conflict');
  });
  it('引用 ID 與內容 meta 不符時拒絕，不以 wrapper 隱藏版本差異', async () => {
    const bundle = fresh(); bundle.libraries[0].content.meta.version = 2; await seal(bundle);
    await rejected(JSON.stringify(bundle), '/libraries/0/content/meta', 'dependency');
  });
  it.each(['/tmp/aov.json', 'C:/aov.json', '\\\\host\\file.json', '../aov.json', 'libraries/../aov.json', 'aov..json', 'aov.json:stream', 'CON.json', 'aov?.json', 'aov.json ', '%2e%2e/aov.json'])(
    'manifest 不允許絕對路徑、穿越或不安全檔名：%s', async path => {
      const bundle = fresh(); bundle.manifest[0].path = path;
      await rejected(JSON.stringify(bundle), '/manifest/0/path', 'S0-shape');
    },
  );
  it('manifest 不得遺漏區塊，即使其餘 checksum 都正確', async () => {
    const bundle = fresh(); bundle.manifest.pop();
    await rejected(JSON.stringify(bundle), '/manifest', 'manifest');
  });
  it('manifest 不得重複覆蓋同一路徑或引用不存在的 library', async () => {
    const bundle = fresh(); bundle.manifest.push({ ...bundle.manifest[0] });
    await rejected(JSON.stringify(bundle), '/manifest/5/path', 'duplicate-id');
    bundle.manifest[5].path = 'libraries/99.json';
    await rejected(JSON.stringify(bundle), '/manifest/5/path', 'manifest');
  });
  it.each(['password', 'connectionString', 'connection_string', 'apiKey', 'token', 'pwd'])(
    '不透明的 C 區塊中疑似秘密值欄位 %s 也必須拒絕', async key => {
      const bundle = fresh(); bundle.aov[key] = 'synthetic-test-value'; await seal(bundle);
      const errors = await rejected(JSON.stringify(bundle), `/aov/${key}`, 'secret');
      expect(JSON.stringify(errors)).not.toContain('synthetic-test-value');
    },
  );
  it('秘密值不能藏在一般字串或 secret_ref 物件裡', async () => {
    const bundle = fresh(); bundle.aov.description = 'postgres://example:example@invalid/database';
    await rejected(JSON.stringify(bundle), '/aov/description', 'secret');
    delete bundle.aov.description; bundle.aov.secret_ref = { password: 'synthetic' };
    await rejected(JSON.stringify(bundle), '/aov/secret_ref', 'secret');
  });
  it('合法 secret_ref 僅保留外部識別碼，不解析或讀取秘密值', async () => {
    const bundle = fresh(); bundle.aov.secret_ref = 'example/connection'; await seal(bundle);
    expect((await validateAovBundle(JSON.stringify(bundle))).ok).toBe(true);
  });
  it('資料列不得借 C 外殼夾帶進整合包', async () => {
    const bundle = fresh(); bundle.aov.rows = [];
    await rejected(JSON.stringify(bundle), '/aov/rows', 'data');
  });
  it('10 MB 以原始 UTF-8 位元組計算，恰好上限接受，多一 byte 或多位元字元超標拒絕', async () => {
    const text = JSON.stringify(fixture);
    const padding = MAX_BUNDLE_BYTES - new TextEncoder().encode(text).length;
    const exact = text + ' '.repeat(padding);
    expect((await validateAovBundle(exact)).ok).toBe(true);
    await rejected(exact + ' ', '/', 'size');
    const multibyte = JSON.stringify({ value: '中'.repeat(Math.floor(MAX_BUNDLE_BYTES / 3)) });
    expect(multibyte.length).toBeLessThan(MAX_BUNDLE_BYTES);
    await rejected(multibyte, '/', 'size');
  });
  it.each(['null', '[]', '{}', '{', '{}{}'])('非物件、損壞或多份 JSON 不會改動草稿：%s', async text => {
    const draft = fresh(), before = structuredClone(draft);
    expect((await validateAovBundle(text, draft)).ok).toBe(false);
    expect(draft).toEqual(before);
  });
  it('惡意深層 JSON 與無限大數值回傳診斷而不丟例外', async () => {
    const deep = '['.repeat(102) + '0' + ']'.repeat(102);
    expect((await validateAovBundle(deep)).ok).toBe(false);
    await rejected('{"x":1e999}', '/x', 'json');
  });
  it('僅驗 C 外殼，保留內部未知內容供 C 驗證，不假裝已驗證 port／規則語意', async () => {
    const bundle = fresh(); bundle.aov.nodes.push(null); bundle.aov.flows.push('opaque'); await seal(bundle);
    expect((await validateAovBundle(JSON.stringify(bundle))).ok).toBe(true);
  });
  it.each([
    ['來源節點', '/bindings/nodes/0/platformNodeId', (b: AovBundle) => { b.bindings.nodes[0].platformNodeId = 'missing'; }],
    ['目標節點', '/bindings/nodes/0/aovNodeId', (b: AovBundle) => { b.bindings.nodes[0].aovNodeId = 'missing'; }],
    ['來源表單', '/bindings/forms/0/sourceFormId', (b: AovBundle) => { b.bindings.forms[0].sourceFormId = 'missing'; }],
    ['目標表單', '/bindings/forms/0/aovFormId', (b: AovBundle) => { b.bindings.forms[0].aovFormId = 'missing'; }],
    ['來源欄位', '/bindings/forms/0/fields/0/sourceFieldId', (b: AovBundle) => { b.bindings.forms[0].fields[0].sourceFieldId = 'missing'; }],
    ['目標欄位', '/bindings/forms/0/fields/0/aovFieldId', (b: AovBundle) => { b.bindings.forms[0].fields[0].aovFieldId = 'missing'; }],
  ] as const)('缺少映射引用的%s時拒絕，即使 manifest 已重算', async (_intent, path, change) => {
    const bundle = fresh(); change(bundle); await seal(bundle);
    await rejected(JSON.stringify(bundle), path, 'dependency');
  });
  it('公開的正規化工具不把非 JSON 值靜默轉成其他內容', () => {
    for (const value of [undefined, NaN, Infinity, 1n, new Date()]) expect(() => canonicalJson(value)).toThrow();
  });
  it('動作映射由既有 catalog 取得內容版本，缺動作庫時拒絕', async () => {
    const bundle = fresh(); const action = actionCatalog.actions[0];
    bundle.bindings.actions.push({ platformActionId: action.id, sourceVersion: await contentSha256(action), aovActionId: 'inspect', libraryId: 'demo-lib', libraryVersion: 1 });
    await seal(bundle);
    expect((await validateAovBundle(JSON.stringify(bundle))).ok).toBe(true);
    bundle.libraries = []; await seal(bundle);
    await rejected(JSON.stringify(bundle), '/bindings/actions/0/libraryId', 'dependency');
  });
});
