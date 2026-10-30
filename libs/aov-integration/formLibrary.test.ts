import { describe, expect, it } from 'vitest';
import type { FormDef } from '../aov-core';
import { checkFormDef, checkFormLibrary, emptyFormLibrary, type FormLibrary } from './formLibrary';

const form = (patch: Partial<FormDef> = {}): FormDef => ({
  id: 'entry', name: '入庫單', subject: ['mat.tin'],
  fields: {
    receivedOn: { label: '入庫日期', type: 'datetime', required: true },
    lot: { label: '批號', type: 'string', required: true },
    totalWeight: { label: '總重量', type: 'quantity', unit: 'kg' },
    grade: { label: '等級', type: 'enum', values: ['A', 'B'] },
  },
  ...patch,
});
const library = (...forms: unknown[]) => ({ format: 'composer-form-library', version: 1, forms });
const codes = (issues: { code: string }[]) => issues.map(i => i.code);

describe('表單庫的檢查（表單獨立於流程）', () => {
  it('完整的表單通過，空的表單庫也通過', () => {
    expect(checkFormDef(form())).toEqual([]);
    expect(checkFormLibrary(library(form()))).toEqual([]);
    expect(checkFormLibrary(emptyFormLibrary satisfies FormLibrary)).toEqual([]);
  });

  it('欄位鍵必須是英文識別碼：中文鍵會讓計畫雜湊與運算式引用都不可靠', () => {
    const issues = checkFormDef(form({ fields: { '重量_實測值': { type: 'number' } } }));
    expect(codes(issues)).toEqual(['field-key']);
    expect(issues[0].message).toContain('重量_實測值');
    for (const key of ['1abc', 'a b', 'a.b', '']) expect(codes(checkFormDef(form({ fields: { [key]: { type: 'number' } } })))).toEqual(['field-key']);
  });

  it('缺 subject 或缺單位時不補預設值，直接指出缺了什麼', () => {
    expect(codes(checkFormDef(form({ subject: [] })))).toEqual(['form-subject']);
    expect(codes(checkFormDef(form({ subject: [' '] })))).toEqual(['form-subject']);
    const noUnit = checkFormDef(form({ fields: { weight: { type: 'quantity' } } }));
    expect(codes(noUnit)).toEqual(['field-unit-missing']);
    expect(noUnit[0].message).toContain('weight');
  });

  it('未知單位與未知型別被擋下，不被當成文字', () => {
    expect(codes(checkFormDef(form({ fields: { w: { type: 'quantity', unit: 'furlong' } } })))).toEqual(['field-unit']);
    expect(codes(checkFormDef(form({ fields: { w: { type: 'integer' as never } } })))).toEqual(['field-type']);
  });

  it('選項欄位必須有不重複的選項', () => {
    for (const values of [undefined, [], ['A', 'A'], ['A', '']]) {
      expect(codes(checkFormDef(form({ fields: { g: { type: 'enum', values } } }))), JSON.stringify(values)).toEqual(['field-values']);
    }
  });

  it('沒有欄位的表單、沒有名稱的表單都被指出，訊息帶表單名稱', () => {
    expect(codes(checkFormDef(form({ fields: {} })))).toEqual(['form-fields']);
    const issues = checkFormDef(form({ name: ' ' }));
    expect(codes(issues)).toEqual(['form-name']);
    expect(issues[0].message).toContain('entry');
  });

  it('表單識別碼重複時要求二選一，而不是取後者', () => {
    const issues = checkFormLibrary(library(form(), form({ name: '入庫單（舊）' })));
    expect(codes(issues)).toEqual(['form-duplicate']);
  });

  it('結構不對的輸入回報錯誤而不是丟出例外', () => {
    for (const raw of [null, [], 'x', {}, { format: 'composer-form-library' }, { format: 'composer-form-library', version: 2, forms: [] },
                       { format: 'composer-form-library', version: 1, forms: {} }]) {
      expect(checkFormLibrary(raw).length, JSON.stringify(raw)).toBeGreaterThan(0);
    }
    expect(codes(checkFormLibrary(library(null, 5)))).toEqual(['form-shape', 'form-shape']);
  });
});
