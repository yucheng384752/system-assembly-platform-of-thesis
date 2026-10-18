import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importWorkflow } from '../../apps/composer-gui/src/workflowGraph';
import { detectSource, mapFieldType, prepareImport } from './migrate';

const fixture = (path: string) => readFileSync(new URL(`../../fixtures/aov-merge/${path}`, import.meta.url), 'utf8');
function reject(text: string, code: string) {
  const draft = JSON.parse(fixture('b/v5.valid.json'));
  const before = structuredClone(draft);
  const result = prepareImport(text, draft);
  expect(draft, '每條失敗路徑均須保留草稿，與輸入深度相等').toEqual(before);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('預期拒絕');
  expect(result.errors[0].code).toBe(code);
  expect(result.errors[0].path).toBeTruthy();
  expect(result).not.toHaveProperty('candidate');
}

describe('WP3 格式辨識與原子候選', () => {
  it.each([1, 2, 3, 4, 5])('B v%i 沿用既有升級結果，每則通知均轉為報告且重複轉換相同', version => {
    const text = fixture(`b/v${version}.valid.json`);
    const input = JSON.parse(text);
    const before = structuredClone(input);
    const result = prepareImport(text, input);
    const existing = importWorkflow(text);
    expect(input).toEqual(before);
    expect(result).toEqual(prepareImport(text, input));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('預期通過');
    expect(result.source).toEqual({ kind: 'platform', version });
    expect(result.candidate).toEqual({ kind: 'platform', value: existing.value });
    expect(result.migrationReport.map(item => item.summary)).toEqual(existing.notices);
    expect(result.originalText).toBe(text);
    if (result.candidate.kind === 'platform') result.candidate.value.forms.length = 0;
    expect(input).toEqual(before);
  });
  it.each([
    ['a/v1.0.legacy.valid.json', 'aov-dataflow', '1.0'],
    ['a/v1.1.workflow.valid.json', 'aov-workflow', '1.1'],
    ['a/v1.1.dataflow.valid.json', 'aov-dataflow', '1.1'],
    ['a/v1.2.workflow.derived.json', 'aov-workflow', '1.2'],
    ['c/project.valid.json', 'aov-project', 1],
    ['c/library.valid.json', 'aov-library', 1],
  ])('%s 只辨識並保留原件，不轉成平台或 FormDef', (path, kind, version) => {
    const text = fixture(String(path));
    const draft = JSON.parse(fixture('b/v5.valid.json'));
    const before = structuredClone(draft);
    const result = prepareImport(text, draft);
    expect(result).toEqual(prepareImport(text, draft));
    expect(draft).toEqual(before);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('預期通過');
    expect(result.source).toEqual({ kind, version });
    expect(result.candidate).toEqual({ kind: 'readonly', value: JSON.parse(text) });
    expect(result.originalText).toBe(text);
    expect(result).not.toHaveProperty('formDef');
  });
  it.each([
    ['b/v6.unknown-version.json', 'unknown-version'], ['a/v9.9.unknown-version.json', 'unknown-version'],
    ['c/project.unknown-formatVersion.json', 'unknown-version'],
    ['b/v5.broken-structure.json', 'broken-structure'], ['a/v1.1.broken-structure.json', 'broken-structure'],
    ['c/project.broken-nodes.json', 'broken-structure'], ['c/library.broken-actions.json', 'broken-structure'],
  ])('%s：未知版本與損壞結構可區分，失敗不改草稿', (path, code) => reject(fixture(path), code));
  it.each([
    ['{"format":"other","version":1}', 'unknown-format'],
    ['{"version":1}', 'unknown-format'], ['{"format":"other","formatVersion":1}', 'unknown-format'],
    ['{"kind":"other","formatVersion":1}', 'unknown-format'],
    ['{', 'broken-structure'], ['null', 'broken-structure'], ['[]', 'broken-structure'],
    ['{"format":"composer-aov-list"}', 'broken-structure'], ['{"format":"aov"}', 'broken-structure'],
    ['{"kind":"action-library"}', 'broken-structure'],
    ['{"format":"composer-aov-list","version":"5"}', 'unknown-version'],
    ['{"format":"aov","schemaVersion":"1.1"}', 'broken-structure'],
    ['{"format":"aov","schemaVersion":"1.1","documentType":"workflow"}', 'broken-structure'],
    ['{"formatVersion":1,"extra":1e999}', 'broken-structure'],
  ])('拒絕 %s，unknown-format、unknown-version、broken-structure 各自明確', reject);
  it('A 圖形與連線損壞、C meta 損壞各自拒絕且不改草稿', () => {
    for (const graph of [null, { id: 'g', nodes: [], edges: {} }, { id: 'g', nodes: [null], edges: [] }, { id: 'g', nodes: [], edges: [{ id: 'e' }] }]) {
      const source = JSON.parse(fixture('a/v1.1.workflow.valid.json'));
      source.graphs = [graph]; reject(JSON.stringify(source), 'broken-structure');
    }
    const source = JSON.parse(fixture('c/project.valid.json')); source.meta.version = 0;
    reject(JSON.stringify(source), 'broken-structure');
  });
  it('過深結構拒絕且不改草稿', () => reject('{"formatVersion":1,"extra":' + '['.repeat(102) + '0' + ']'.repeat(102) + '}', 'broken-structure'));
  it('既有 importWorkflow 完整性拒絕仍不改草稿', () => {
    const source = JSON.parse(fixture('b/v5.valid.json'));
    source.graphs[0].edges[0].to = 'missing-node';
    expect(detectSource(JSON.stringify(source)).ok).toBe(true);
    reject(JSON.stringify(source), 'broken-structure');
  });
  it('無損 B 與只讀 C 保留空報告陣列，未指定 subject 不產生 FormDef', () => {
    for (const path of ['b/v5.valid.json', 'c/project.valid.json', 'c/library.valid.json']) {
      const result = prepareImport(fixture(path), {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('預期通過');
      expect(result.migrationReport).toEqual([]);
      expect(result).not.toHaveProperty('formDef');
    }
  });
  it('return 邊保留完整原始描述；附件、外部引用、自由文字、多表單逐項報告，不靜默遺失', () => {
    const text = fixture('migration/legacy-content.json');
    const result = prepareImport(text, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('預期通過');
    expect(result.originalText).toBe(text);
    const paths = result.migrationReport.map(item => item.sourcePath);
    for (const path of ['/graphs/0/edges/0', '/graphs/0/nodes/0/attachments/0/path', '/graphs/0/nodes/0/external/document', '/graphs/0/nodes/0/business/description', '/graphs/0/nodes/0/forms/0/fields/0/id', '/graphs/0/nodes/0/forms/1/fields/0/id']) expect(paths).toContain(path);
    expect(result.migrationReport.find(item => item.sourcePath === '/graphs/0/edges/0')?.summary).toContain('需人工補正，保留原始返回描述');
    expect(result.migrationReport.every(item => item.summary && item.suggestedAction)).toBe(true);
  });
  it('B 多表單動作拆分有報告，表單原樣保留；缺 subject 與單位明確阻擋 FormDef', () => {
    const text = fixture('migration/platform-multiple-forms.json');
    const original = JSON.parse(text);
    const result = prepareImport(text, original);
    expect(original).toEqual(JSON.parse(text));
    expect(result).toEqual(prepareImport(text, original));
    if (!result.ok || result.candidate.kind !== 'platform') throw new Error('預期平台候選');
    expect(result.candidate.value.forms).toEqual(original.forms);
    expect(result.migrationReport.some(item => item.summary.includes('2 張表單'))).toBe(true);
    expect(result.formDefBlockers.filter(item => item.reason.includes('缺 subject'))).toHaveLength(2);
    expect(result.formDefBlockers).toContainEqual({ sourcePath: '/forms/1/fields/0', reason: '缺單位；須指定單位或明確標為「無單位」。' });
    expect(result).not.toHaveProperty('formDef');
  });
});

describe('WP3 明確欄位映射', () => {
  it.each([['text', 'string'], ['boolean', 'bool']])('%s 映射為 %s 且無損報告為空', (type, aovType) => expect(mapFieldType(type)).toEqual({ ok: true, aovType, migrationReport: [] }));
  it('date 每次轉 datetime 都固定報告僅日期無時間，不提供補時間的值轉換', () => {
    const result = mapFieldType('date');
    expect(result).toMatchObject({ ok: true, aovType: 'datetime', migrationReport: [{ summary: '僅日期，無時間' }] });
    expect(mapFieldType('date')).toEqual(result);
  });
  it.each(['integer', 'decimal'])('%s 缺單位或空白單位必須阻擋，明確無單位才接受', type => {
    for (const unit of [undefined, '', '  ']) expect(mapFieldType(type, unit)).toMatchObject({ ok: false, reason: '缺單位' });
    expect(mapFieldType(type, '無單位')).toEqual({ ok: true, aovType: 'number', unit: '無單位', migrationReport: [] });
    expect(mapFieldType(type, 'kg')).toMatchObject({ ok: true, aovType: 'number' });
  });
  it('decimal 僅在指定單位且明確用於數量時轉 quantity，不修改輸入且結果決定性', () => {
    const selection = { unit: 'kg', quantity: true }; const before = structuredClone(selection);
    expect(mapFieldType('decimal', selection)).toEqual({ ok: true, aovType: 'quantity', unit: 'kg', migrationReport: [] });
    expect(mapFieldType('decimal', selection)).toEqual(mapFieldType('decimal', selection));
    expect(selection).toEqual(before);
    expect(mapFieldType('integer', selection)).toMatchObject({ ok: true, aovType: 'number' });
    expect(mapFieldType('decimal', { unit: '無單位', quantity: true }).ok).toBe(false);
    expect(mapFieldType('decimal', { unit: 'kg', quantity: false })).toMatchObject({ aovType: 'number' });
  });
  it.each(['enum', 'string[]', 'json', 'unknown'])('B 沒有 %s，不推測或降成文字', type => expect(mapFieldType(type).ok).toBe(false));
});
