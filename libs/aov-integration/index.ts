import type { ValidateFunction } from 'ajv';
import { schemas } from '../ui-runtime/schema';
import { parseActionCatalog } from '../ui-runtime/registry';
import actionData from '../../config/actions.json';
import { sha256Hex } from './hash';
import type { AovGraphDocument } from '../../apps/composer-gui/src/workflowGraph';

// Dependency rule (D102): primitives (hash, action catalog) come from libs; B app types are imported as types only.
const actionCatalog = parseActionCatalog(actionData);
export const MAX_BUNDLE_BYTES = 10_000_000;
export const HASH_LIMITATION = '雜湊不是簽章，不證明來源，只偵測損壞或改動。';
interface Meta { id: string; name: string; version: number; status: string }
interface ProjectShell { formatVersion: 1; meta: Meta; nodes: unknown[]; flows: unknown[]; [key: string]: unknown }
interface LibraryShell { formatVersion: 1; kind: 'action-library'; meta: Meta; actions: unknown[]; [key: string]: unknown }
interface LibraryRef { id: string; version: number }
export interface AovBundle {
  format: 'composer-aov-bundle'; version: 1; platform: AovGraphDocument; aov: ProjectShell;
  libraries: (LibraryRef & { dependencies: LibraryRef[]; content: LibraryShell })[];
  bindings: {
    nodes: { platformNodeId: string; aovNodeId: string; sourceVersion: string }[];
    forms: { sourceFormId: string; sourceVersion: string; aovFormId: string; fields: {
      sourceFieldId: string; aovFieldId: string; aovType: 'string' | 'number' | 'bool' | 'datetime' | 'quantity'; unit?: string;
    }[] }[];
    actions: { platformActionId: string; aovActionId: string; sourceVersion: string; libraryId: string; libraryVersion: number }[];
  };
  manifest: { path: string; sha256: string; sourceProject: string; sourceVersion: string }[];
  migrationReport: { sourcePath: string; summary: string; suggestedAction: string }[];
}
export interface BundleError { code: string; path: string; message: string }
export type BundleResult = { ok: true; value: AovBundle } | { ok: false; errors: BundleError[] };

// Serialize keys directly: JSON.stringify(object) reorders integer-like keys even after sorting.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('JSON 不接受非有限數值。');
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('只接受 JSON 值。');
  return JSON.stringify(value);
}
export async function contentSha256(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

// The caller retains its draft; even success returns only a detached candidate, never installs it.
export async function validateAovBundle(text: string, _currentDraft?: unknown): Promise<BundleResult> {
  const errors: BundleError[] = [];
  const fail = (code: string, path: string, message: string) => { errors.push({ code, path: path || '/', message }); };
  if (text.length > MAX_BUNDLE_BYTES || new TextEncoder().encode(text).length > MAX_BUNDLE_BYTES) {
    fail('size', '/', '整合包不可超過 10 MB（10,000,000 UTF-8 bytes）。');
    return { ok: false, errors };
  }
  let input: unknown;
  try { input = JSON.parse(text); }
  catch { fail('json', '/', '整合包必須是單一有效 JSON。'); return { ok: false, errors }; }

  // Inspect open C payloads too, before schema or hashing; iterative traversal tolerates hostile nesting.
  const pending = [{ value: input, path: '', depth: 0 }];
  while (pending.length) {
    const { value, path, depth } = pending.pop()!;
    if (depth > 100) { fail('depth', path, 'JSON 巢狀層數不可超過 100。'); break; }
    if (typeof value === 'number' && !Number.isFinite(value)) fail('json', path, 'JSON 數值超出可表示範圍。');
    if (typeof value === 'string' && (/\w+:\/\/[^\s]*@|BEGIN (?:[A-Z]+ )*PRIVATE KEY|Bearer\s+|(?:password|pwd|token|api[_-]?key)\s*=/i.test(value))) {
      fail('secret', path, '含疑似連線字串或秘密值，請使用 secret_ref 外部引用。');
    }
    if (Array.isArray(value)) value.forEach((item, i) => pending.push({ value: item, path: `${path}/${i}`, depth: depth + 1 }));
    else if (record(value)) for (const [key, item] of Object.entries(value)) {
      const at = `${path}/${pointer(key)}`;
      if (/password|passwd|pwd|secret|token|credential|connection|dsn|api[_-]?key|private[_-]?key/i.test(key) && key !== 'secret_ref') {
        fail('secret', at, '禁止疑似秘密值欄位；只接受 secret_ref 外部引用。');
      }
      if (key === 'secret_ref' && (typeof item !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(item))) {
        fail('secret', at, 'secret_ref 必須是外部引用識別碼，不可內嵌秘密值。');
      }
      if (/^(rows|dataRows|records)$/i.test(key)) fail('data', at, '整合包不得包含資料列。');
      pending.push({ value: item, path: at, depth: depth + 1 });
    }
  }
  if (errors.length) return { ok: false, errors };
  function checkSchema(validate: ValidateFunction, value: unknown, prefix = '') {
    if (validate(value)) return;
    for (const error of validate.errors ?? []) {
      const key = error.params.missingProperty ?? error.params.additionalProperty;
      const path = prefix + error.instancePath + (typeof key === 'string' ? `/${pointer(key)}` : '');
      fail('S0-shape', path, `結構不符合契約：${error.message ?? error.keyword}。${path.endsWith('/sha256') || path.endsWith('/sourceVersion') ? HASH_LIMITATION : ''}`);
    }
  }
  checkSchema(schemas.aovBundle, input);
  if (errors.length) return { ok: false, errors };
  const bundle = input as AovBundle;
  if (bundle.platform.format !== 'composer-aov-list') fail('format', '/platform/format', '未知平台格式。');
  if (bundle.platform.version !== 5) fail('version', '/platform/version', '平台文件必須是 version 5；本入口不升級舊版。');
  checkSchema(schemas.aov, bundle.platform, '/platform');
  if (errors.length) return { ok: false, errors };

  function unique(values: string[], path: string, key: string) {
    const seen = new Set<string>();
    values.forEach((id, i) => {
      if (seen.has(id)) fail('duplicate-id', `${path}/${i}/${key}`, '識別碼重複。');
      seen.add(id);
    });
  }
  const b = bundle.bindings;
  const p = bundle.platform;
  const platformNodes = p.graphs.flatMap(graph => graph.nodes);
  for (const key of ['factories', 'graphs', 'forms', 'relations'] as const) unique(p[key].map(item => item.id), `/platform/${key}`, 'id');
  const nodeIds = new Set<string>();
  p.graphs.forEach((graph, i) => {
    graph.nodes.forEach((node, j) => {
      if (nodeIds.has(node.id)) fail('duplicate-id', `/platform/graphs/${i}/nodes/${j}/id`, '節點識別碼重複。');
      nodeIds.add(node.id);
    });
    unique(graph.edges.map(edge => edge.id), `/platform/graphs/${i}/edges`, 'id');
  });
  p.forms.forEach((form, i) => unique(form.fields.map(field => field.id), `/platform/forms/${i}/fields`, 'id'));
  unique(b.nodes.map(n => n.platformNodeId), '/bindings/nodes', 'platformNodeId');
  unique(b.nodes.map(n => n.aovNodeId), '/bindings/nodes', 'aovNodeId');
  unique(b.forms.map(f => f.sourceFormId), '/bindings/forms', 'sourceFormId');
  unique(b.forms.map(f => f.aovFormId), '/bindings/forms', 'aovFormId');
  unique(b.actions.map(a => a.platformActionId), '/bindings/actions', 'platformActionId');
  unique(b.actions.map(a => `${a.libraryId}\0${a.aovActionId}`), '/bindings/actions', 'aovActionId');

  const libraries = new Map<string, number>();
  bundle.libraries.forEach((lib, i) => {
    const previous = libraries.get(lib.id);
    if (previous !== undefined) fail(previous === lib.version ? 'duplicate-id' : 'version-conflict', `/libraries/${i}/id`, '動作庫 ID 重複或同 ID 不同版本。');
    libraries.set(lib.id, lib.version);
    if (lib.id !== lib.content.meta.id || lib.version !== lib.content.meta.version) fail('dependency', `/libraries/${i}/content/meta`, '動作庫內容與引用的 ID／版本不符。');
    unique(lib.dependencies.map(dep => dep.id), `/libraries/${i}/dependencies`, 'id');
  });
  function dependency(id: string, version: number, at: string) {
    if (!libraries.has(id)) fail('dependency', at, '缺少引用的動作庫。');
    else if (libraries.get(id) !== version) fail('version-conflict', at, '動作庫同 ID 不同版本。');
  }
  bundle.libraries.forEach((lib, i) => lib.dependencies.forEach((dep, j) => dependency(dep.id, dep.version, `/libraries/${i}/dependencies/${j}`)));
  async function checkHash(value: unknown, hash: string, path: string) {
    if (await contentSha256(value) !== hash) fail('checksum', path, `內容 checksum 不符，對應已失效。${HASH_LIMITATION}`);
  }
  for (const [i, binding] of b.nodes.entries()) {
    const node = platformNodes.find(n => n.id === binding.platformNodeId);
    if (!node) fail('dependency', `/bindings/nodes/${i}/platformNodeId`, '來源節點不存在。');
    else await checkHash(node, binding.sourceVersion, `/bindings/nodes/${i}/sourceVersion`);
    // C internals stay opaque; checking existence is not a substitute for C's validator.
    if (bundle.aov.nodes.filter(n => record(n) && n.id === binding.aovNodeId).length !== 1) fail('dependency', `/bindings/nodes/${i}/aovNodeId`, '對應節點不存在或 ID 不唯一。');
  }
  const targetForms = [bundle.aov, ...bundle.libraries.map(lib => lib.content)]
    .flatMap(doc => Array.isArray(doc.forms) ? doc.forms : []).filter(record);
  for (const [i, binding] of b.forms.entries()) {
    const form = p.forms.find(f => f.id === binding.sourceFormId);
    if (!form) fail('dependency', `/bindings/forms/${i}/sourceFormId`, '來源表單不存在。');
    else {
      await checkHash(form, binding.sourceVersion, `/bindings/forms/${i}/sourceVersion`);
      binding.fields.forEach((field, j) => {
        if (!form.fields.some(f => f.id === field.sourceFieldId)) fail('dependency', `/bindings/forms/${i}/fields/${j}/sourceFieldId`, '來源欄位不存在。');
      });
    }
    unique(binding.fields.map(f => f.sourceFieldId), `/bindings/forms/${i}/fields`, 'sourceFieldId');
    unique(binding.fields.map(f => f.aovFieldId), `/bindings/forms/${i}/fields`, 'aovFieldId');
    const targets = targetForms.filter(f => f.id === binding.aovFormId);
    if (targets.length !== 1) fail('dependency', `/bindings/forms/${i}/aovFormId`, '對應表單不存在或 ID 不唯一。');
    else {
      const fields = targets[0].fields;
      binding.fields.forEach((field, j) => {
        if (!record(fields) || !Object.hasOwn(fields, field.aovFieldId)) fail('dependency', `/bindings/forms/${i}/fields/${j}/aovFieldId`, '對應欄位不存在。');
      });
    }
  }
  for (const [i, binding] of b.actions.entries()) {
    dependency(binding.libraryId, binding.libraryVersion, `/bindings/actions/${i}/libraryId`);
    const action = actionCatalog.actions.find(a => a.id === binding.platformActionId);
    if (!action) fail('dependency', `/bindings/actions/${i}/platformActionId`, '來源動作不存在。');
    else await checkHash(action, binding.sourceVersion, `/bindings/actions/${i}/sourceVersion`);
    const library = bundle.libraries.find(lib => lib.id === binding.libraryId);
    if (library && library.content.actions.filter(a => record(a) && a.id === binding.aovActionId).length !== 1) fail('dependency', `/bindings/actions/${i}/aovActionId`, '對應動作不存在或 ID 不唯一。');
  }

  const contents = new Map<string, unknown>([
    ['platform.json', p], ['aov.json', bundle.aov], ['bindings.json', b], ['migration-report.json', bundle.migrationReport],
    ...bundle.libraries.map((lib, i): [string, unknown] => [`libraries/${i}.json`, lib]),
  ]);
  unique(bundle.manifest.map(entry => entry.path), '/manifest', 'path');
  for (const [i, entry] of bundle.manifest.entries()) {
    if (!contents.has(entry.path)) fail('manifest', `/manifest/${i}/path`, 'manifest 引用不存在的內容。');
    else await checkHash(contents.get(entry.path), entry.sha256, `/manifest/${i}/sha256`);
  }
  for (const path of contents.keys()) if (!bundle.manifest.some(entry => entry.path === path)) fail('manifest', '/manifest', `缺少 ${path} 的 checksum。`);
  return errors.length ? { ok: false, errors } : { ok: true, value: bundle };
}
