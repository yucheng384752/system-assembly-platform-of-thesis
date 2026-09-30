import { expect, test } from 'vitest';
import { emptyAov, exportAov, formErrors, importAov, relationErrors, sha256Hex, stepErrors, workflowErrors, type AovDocument } from './workflow';
import { addRelation, inferCandidates, traceForm } from './relations';
import { inferForms, MAX_FILES } from './localData';

const field = (id: string, name: string, type: 'text' | 'integer' = 'text', isKey = false) => ({ id, name, type, required: true, isKey });
// Receiving (warehouse) → inspection (QC) → shipping (logistics); lot number is the shared identifier.
function sample(): AovDocument {
  return { ...emptyAov,
    steps: [
      { id: 'step-1', name: '收料', when: '到貨時', owner: '倉管', formIds: ['form-1'] },
      { id: 'step-2', name: '檢驗', when: '收料後', owner: '品管', formIds: ['form-2'] },
      { id: 'step-3', name: '出貨', when: '', owner: '物流', formIds: ['form-3'] },
    ],
    forms: [
      { id: 'form-1', name: '收料單', fields: [field('field-1', '批號', 'text', true), field('field-2', '數量', 'integer')] },
      { id: 'form-2', name: '檢驗單', fields: [field('field-1', ' 批 號 '), field('field-2', '數量', 'text')] },
      { id: 'form-3', name: '出貨單', fields: [field('field-1', '批號')] },
    ],
    relations: [] };
}

test('A20: steps must reference existing, complete forms and each form belongs to exactly one step', () => {
  expect(workflowErrors(sample()).filter(e => !e.includes('關聯'))).toEqual([]);
  expect(stepErrors({ ...sample(), steps: [] })).toEqual(['請至少建立一個流程步驟。']);
  const dangling = sample(); dangling.steps[0].formIds.push('form-9');
  expect(formErrors(dangling).join()).toContain('步驟「收料」引用的表單不存在');
  const incomplete = sample(); incomplete.forms[1].fields = [];
  // The message names both the step and the form so the user knows where to fix it.
  expect(formErrors(incomplete)).toContain('步驟「檢驗」的表單「檢驗單」尚未完成：尚未建立欄位。');
  const orphan = sample(); orphan.steps[2].formIds = [];
  expect(formErrors(orphan)).toContain('表單「出貨單」尚未指派步驟。');
  const shared = sample(); shared.steps[1].formIds.push('form-1');
  expect(formErrors(shared).join()).toContain('同時屬於多個步驟：收料、檢驗');
  expect(() => exportAov(dangling)).toThrow('引用的表單不存在');
});

test('D19: candidates need matching name (ignoring spaces), matching type and one isKey side; they never apply themselves', () => {
  const doc = sample();
  const candidates = inferCandidates(doc);
  // 數量 is excluded (integer vs text, no key); form-2 → form-3 is excluded because neither 批號 is a key.
  expect(candidates).toEqual([
    { from: { formId: 'form-1', fieldId: 'field-1' }, to: { formId: 'form-2', fieldId: 'field-1' } },
    { from: { formId: 'form-1', fieldId: 'field-1' }, to: { formId: 'form-3', fieldId: 'field-1' } },
  ]);
  expect(doc.relations).toEqual([]);
  // Upstream is decided by step order, not by the order forms were created in.
  const reordered = { ...doc, forms: [...doc.forms].reverse() };
  expect(inferCandidates(reordered)[0].from.formId).toBe('form-1');
  // A confirmed pair is no longer proposed.
  const confirmed = addRelation(doc, candidates[0], 'inferred');
  expect(confirmed.relations[0]).toMatchObject({ id: 'rel-1', origin: 'inferred', confirmed: true });
  expect(inferCandidates(confirmed)).toEqual([candidates[1]]);
});

test('A21 and D22: mismatched key types, duplicate pairs, self links and cycles block export and name the fields', () => {
  const doc = sample();
  const mismatch = addRelation(doc, { from: { formId: 'form-1', fieldId: 'field-2' }, to: { formId: 'form-2', fieldId: 'field-2' } }, 'user');
  expect(relationErrors(mismatch)).toEqual(['「收料單」的「數量」（整數）與「檢驗單」的「數量」（文字）型別不同，無法作為關聯鍵。']);
  expect(() => exportAov(mismatch)).toThrow('型別不同');
  const link = (d: AovDocument, a: string, b: string) => addRelation(d, { from: { formId: a, fieldId: 'field-1' }, to: { formId: b, fieldId: 'field-1' } }, 'user');
  expect(relationErrors(link(link(doc, 'form-1', 'form-2'), 'form-2', 'form-1')).join()).toContain('之間只能有一條關聯');
  expect(relationErrors(link(doc, 'form-1', 'form-1')).join()).toContain('不能與同一張表單建立關聯');
  const cycle = link(link(link(doc, 'form-1', 'form-2'), 'form-2', 'form-3'), 'form-3', 'form-1');
  expect(relationErrors(cycle)).toContain('關聯形成循環：收料單 → 檢驗單 → 出貨單 → 收料單。');
  // A candidate that would close a cycle is not proposed: with 出貨單 → 檢驗單 → 收料單 already linked by hand, 收料單 → 出貨單 is dropped.
  const backward = link(link(doc, 'form-3', 'form-2'), 'form-2', 'form-1');
  expect(inferCandidates(doc).some(c => c.to.formId === 'form-3')).toBe(true);
  expect(inferCandidates(backward)).toEqual([]);
});

test('A22: export keeps only definitions and confirmed relations, round-trips, and its checksum matches the downloaded bytes', async () => {
  const doc = addRelation(sample(), inferCandidates(sample())[0], 'inferred');
  const polluted = { ...doc, rows: [['PRIVATE_ROW_SENTINEL']], forms: doc.forms.map(f => ({ ...f, sample: 'PRIVATE_SAMPLE_SENTINEL' })) } as AovDocument;
  const text = exportAov(polluted);
  expect(text).not.toMatch(/PRIVATE_ROW_SENTINEL|PRIVATE_SAMPLE_SENTINEL/);
  expect(importAov(text)).toEqual({ value: doc, notices: [] });
  // Known-answer vector, then the bytes of the Blob that downloadJson saves (UTF-8, with non-ASCII names).
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const saved = new Uint8Array(await crypto.subtle.digest('SHA-256', await new Blob([text], { type: 'application/json;charset=utf-8' }).arrayBuffer()));
  expect(await sha256Hex(text)).toBe([...saved].map(b => b.toString(16).padStart(2, '0')).join(''));
  expect(await sha256Hex(text + ' ')).not.toBe(await sha256Hex(text));
});

test('A23: a form record traces to its step, owner and the forms linked through confirmed relations only', () => {
  const [first, second] = inferCandidates(sample());
  const doc = addRelation(addRelation(sample(), first, 'inferred'), second, 'inferred');
  const trace = traceForm(doc, 'form-1')!;
  expect([trace.step?.name, trace.step?.owner]).toEqual(['收料', '倉管']);
  expect(trace.upstream).toEqual([]);
  expect(trace.downstream.map(l => [l.form.name, l.step?.owner, l.via])).toEqual([['檢驗單', '品管', '批號 ＝  批 號 '], ['出貨單', '物流', '批號']]);
  expect(traceForm(doc, 'form-3')!.upstream.map(l => l.form.name)).toEqual(['收料單']);
  // Unconfirmed candidates do not appear in the trace.
  expect(traceForm(sample(), 'form-1')!.downstream).toEqual([]);
});

test('import rejects broken structure atomically and migrates version 1 with an explicit notice', () => {
  const text = exportAov(sample());
  const broken = JSON.parse(text); broken.steps[1].formIds.push('form-1');
  expect(() => importAov(JSON.stringify(broken))).toThrow('同一張表單不可屬於多個步驟。原流程已保留。');
  expect(() => importAov('{"steps":[]}')).toThrow('原流程已保留');
  const v1 = { format: 'composer-aov-list', version: 1, steps: [{ id: 'a', name: '檢查', when: '', owner: '品管', formId: 'form-1' }, { id: 'b', name: '核對', when: '', owner: '', formId: '' }] };
  const migrated = importAov(JSON.stringify(v1));
  expect(migrated.value.steps.map(s => s.formIds)).toEqual([[], []]);
  expect(migrated.notices).toEqual(['舊版流程規格不含表單定義，已清除以下步驟的表單指派：「檢查」。']);
});

test('D25 and D27: each file is inferred independently, failures are listed, and the form keeps the file name', async () => {
  const file = (name: string, text: string) => { const f = new File([text], name); Object.defineProperty(f, 'text', { value: async () => text }); return f; };
  const result = await inferForms([file('收料紀錄.csv', '批號,數量\nL1,3'), file('bad.csv', 'a,a\n1,2'), file('notes.txt', 'x')], 0);
  expect(result.forms.map(f => [f.name, f.fields.map(x => x.name)])).toEqual([['收料紀錄', ['批號', '數量']]]);
  expect(result.failures.map(f => f.file)).toEqual(['bad.csv', 'notes.txt']);
  expect(JSON.stringify(result)).not.toContain('L1');
  await expect(inferForms(Array.from({ length: MAX_FILES + 1 }, (_, i) => file(`${i}.csv`, 'a\n1')), 0)).rejects.toThrow('一次最多選擇 10 個檔案');
  await expect(inferForms([file('a.csv', 'a\n1')], 50)).rejects.toThrow('流程最多 50 張表單');
  const big = file('big.csv', 'a'); Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
  await expect(inferForms([big, big], 0)).rejects.toThrow('合計不可超過 20 MB');
});
