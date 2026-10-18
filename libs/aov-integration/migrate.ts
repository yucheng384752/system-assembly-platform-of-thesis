import Ajv from 'ajv/dist/2020';
import bundleSchema from '../../schemas/aov-bundle.schema.json';
import { schemas } from '../ui-runtime/schema';
import { importWorkflow } from '../../apps/composer-gui/src/workflowGraph';
import type { AovGraphDocument } from '../../apps/composer-gui/src/workflowGraph';
import type { AovBundle } from './index';

export type MigrationReport = AovBundle['migrationReport'];
export type SourceKind = 'platform' | 'aov-workflow' | 'aov-dataflow' | 'aov-project' | 'aov-library';
type Failure = { ok: false; errors: { code: 'unknown-format' | 'unknown-version' | 'broken-structure'; path: string; message: string }[] };
type Source = { kind: SourceKind; version: number | string };
type Detection = { ok: true; source: Source; value: Record<string, unknown> } | Failure;
export type ImportResult = Failure | {
  ok: true; source: Source; originalText: string; migrationReport: MigrationReport;
  formDefBlockers: { sourcePath: string; reason: string }[];
  candidate: { kind: 'platform'; value: AovGraphDocument } | { kind: 'readonly'; value: Record<string, unknown> };
};

const ajv = new Ajv({ allErrors: true, strict: false });
const shell = (name: 'project' | 'library') => ajv.compile({ $defs: bundleSchema.$defs, $ref: `#/$defs/${name}` });
const projectShell = shell('project');
const libraryShell = shell('library');
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const fail = (code: Failure['errors'][number]['code'], path: string, message: string): Failure => ({ ok: false, errors: [{ code, path, message }] });

export function detectSource(text: string): Detection {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { return fail('broken-structure', '/', '必須提供有效 JSON。'); }
  if (!record(value)) return fail('broken-structure', '/', '文件必須是物件。');
  // Bound traversal before validators and report generation inspect untrusted payloads.
  const pending = [{ value: value as unknown, depth: 0 }];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.depth > 100 || (typeof item.value === 'number' && !Number.isFinite(item.value))) {
      return fail('broken-structure', '/', '巢狀層數超過 100 或含非有限數值。');
    }
    if (item.value && typeof item.value === 'object') for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
  }
  let kind: SourceKind;
  let version: number | string;
  if (value.format === 'composer-aov-list') {
    if (!Object.hasOwn(value, 'version')) return fail('broken-structure', '/version', '缺少版本。');
    if (![1, 2, 3, 4, 5].includes(value.version as number)) return fail('unknown-version', '/version', '未知平台版本。');
    if (!schemas.aov(value)) return fail('broken-structure', '/', '平台結構不符合既有契約。');
    kind = 'platform'; version = value.version as number;
  } else if (value.format === 'aov') {
    if (!Object.hasOwn(value, 'schemaVersion')) return fail('broken-structure', '/schemaVersion', '缺少版本。');
    if (!['1.0', '1.1', '1.2'].includes(value.schemaVersion as string)) return fail('unknown-version', '/schemaVersion', '未知舊格式版本。');
    version = value.schemaVersion as string;
    if (version !== '1.0' && value.documentType !== 'workflow' && value.documentType !== 'dataflow') return fail('broken-structure', '/documentType', '缺少或不支援的文件種類。');
    kind = version === '1.0' || value.documentType === 'dataflow' ? 'aov-dataflow' : 'aov-workflow';
    if (!record(value.project) || typeof value.project.id !== 'string' || typeof value.project.name !== 'string' || typeof value.rootGraphId !== 'string' || !Array.isArray(value.graphs) || !record(value.layout)) return fail('broken-structure', '/', '舊文件外殼損壞。');
    for (const [i, graph] of value.graphs.entries()) {
      if (!record(graph) || typeof graph.id !== 'string' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return fail('broken-structure', `/graphs/${i}`, '圖形須含識別碼、節點與連線陣列。');
      if (graph.nodes.some(n => !record(n) || typeof n.id !== 'string') || graph.edges.some(e => !record(e) || typeof e.id !== 'string' || !['forward', 'return'].includes(e.kind as string) || typeof e.source !== 'string' || typeof e.target !== 'string')) return fail('broken-structure', `/graphs/${i}`, '節點或連線結構損壞。');
    }
  } else if (!Object.hasOwn(value, 'format') && (Object.hasOwn(value, 'formatVersion') || value.kind === 'action-library')) {
    if (Object.hasOwn(value, 'kind') && value.kind !== 'action-library') return fail('unknown-format', '/kind', '未知文件種類。');
    if (!Object.hasOwn(value, 'formatVersion')) return fail('broken-structure', '/formatVersion', '缺少版本。');
    if (value.formatVersion !== 1) return fail('unknown-version', '/formatVersion', '未知 AOV 版本。');
    kind = value.kind === 'action-library' ? 'aov-library' : 'aov-project'; version = 1;
    const validate = kind === 'aov-library' ? libraryShell : projectShell;
    if (!validate(value)) return fail('broken-structure', validate.errors?.[0]?.instancePath || '/', 'AOV 外殼不符合整合包契約。');
  } else return fail('unknown-format', '/format', '無法辨識來源格式。');
  return { ok: true, source: { kind, version }, value };
}

function legacyReport(value: Record<string, unknown>): MigrationReport {
  const report: MigrationReport = [{ sourcePath: '/', summary: '舊格式僅供只讀保存，未轉換為平台文件。', suggestedAction: '保留原檔，逐項人工遷移；自由文字不作為可執行規則。' }];
  function visit(value: unknown, path: string) {
    if (record(value) && value.kind === 'return') report.push({ sourcePath: path, summary: `return 邊：${JSON.stringify(value).slice(0, 1900)}`, suggestedAction: '原始描述保留於原檔；人工確認返回／重工邊界，不自動轉為順序邊。' });
    if (value !== null && typeof value === 'object' && Object.keys(value).length) {
      for (const [key, child] of Object.entries(value)) visit(child, `${path}/${pointer(key)}`);
    } else if (value !== '' && value !== null) {
      // Enumerate every payload leaf, including unknown extensions, so attachments and forms cannot disappear.
      report.push({ sourcePath: path, summary: `未轉換的原始內容：${JSON.stringify(value).slice(0, 1900)}`, suggestedAction: '依來源位置檢視保留的原檔，人工遷移此項內容；不推測其語意。' });
    }
  }
  for (const [key, child] of Object.entries(value)) if (!['format', 'schemaVersion', 'documentType'].includes(key)) visit(child, `/${pointer(key)}`);
  return report;
}

// A successful result is a detached candidate, never a state replacement or a FormDef.
export function prepareImport(text: string, _currentDraft: unknown): ImportResult {
  const detected = detectSource(text);
  if (!detected.ok) return detected;
  const { source, value } = detected;
  if (source.kind === 'platform') {
    try {
      const imported = importWorkflow(text);
      // B has neither subject nor unit settings; preserving B forms is not permission to emit FormDef.
      const formDefBlockers = imported.value.forms.flatMap((form, i) => [
        { sourcePath: `/forms/${i}`, reason: '缺 subject；須由使用者在整合設定中指定，禁止產生 FormDef。' },
        ...form.fields.flatMap((field, j) => field.type === 'integer' || field.type === 'decimal'
          ? [{ sourcePath: `/forms/${i}/fields/${j}`, reason: '缺單位；須指定單位或明確標為「無單位」。' }] : []),
      ]);
      return { ok: true, source, originalText: text, formDefBlockers, candidate: { kind: 'platform', value: imported.value }, migrationReport: imported.notices.map(summary => ({ sourcePath: '/', summary, suggestedAction: '對照保留的原檔確認此項升級通知，再採用候選文件。' })) };
    } catch (error) { return fail('broken-structure', '/', error instanceof Error ? error.message : '平台匯入失敗。'); }
  }
  return { ok: true, source, originalText: text, formDefBlockers: [], candidate: { kind: 'readonly', value }, migrationReport: source.kind === 'aov-workflow' || source.kind === 'aov-dataflow' ? legacyReport(value) : [] };
}

export type UnitSelection = string | { unit: string; quantity: boolean };
export type FieldMapping = { ok: true; aovType: 'string' | 'bool' | 'datetime' | 'number' | 'quantity'; unit?: string; migrationReport: MigrationReport } | { ok: false; reason: string; migrationReport: MigrationReport };

// Explicit "無單位" is accepted; quantity additionally requires the caller's declared purpose.
export function mapFieldType(type: string, unit?: UnitSelection): FieldMapping {
  const migrationReport: MigrationReport = [];
  const blocked = (reason: string): FieldMapping => ({ ok: false, reason, migrationReport: [{ sourcePath: '/type', summary: reason, suggestedAction: '補齊明確的欄位設定後再映射，不產生 FormDef。' }] });
  if (type === 'text') return { ok: true, aovType: 'string', migrationReport };
  if (type === 'boolean') return { ok: true, aovType: 'bool', migrationReport };
  if (type === 'date') return { ok: true, aovType: 'datetime', migrationReport: [{ sourcePath: '/type', summary: '僅日期，無時間', suggestedAction: '保留 YYYY-MM-DD 原值，不補時間。' }] };
  if (type !== 'integer' && type !== 'decimal') return blocked('不支援的欄位型別，不推測對應。');
  const name = typeof unit === 'string' ? unit : unit?.unit;
  if (!name?.trim()) return blocked('缺單位');
  const quantity = type === 'decimal' && typeof unit === 'object' && unit.quantity;
  if (quantity && name.trim() === '無單位') return blocked('數量必須指定單位。');
  return { ok: true, aovType: quantity ? 'quantity' : 'number', unit: name, migrationReport };
}
