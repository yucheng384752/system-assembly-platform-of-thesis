import { describe, expect, it } from 'vitest';
import type { FormDef } from '../aov-core';
import entry from '../../fixtures/forms/entry.csv?raw';
import { draftFormsFromCsv } from './formCsvImport';
import { blankForm, editIssues, fromDraft, fromFormDef, toFormDef, type EditForm } from './formEdit';

const slip: FormDef = { id: 'stock-in-slip', name: '入庫單', subject: ['lot.ingot'], fields: {
  lot: { label: '批號', type: 'string', required: true },
  weight: { label: '總重量', type: 'quantity', unit: 'kg' },
  grade: { type: 'enum', values: ['A', 'B'] },
} };

describe('表單編輯模型', () => {
  it('表單轉成編輯列再轉回來，內容不變（包含必填、單位、選項）', () => {
    expect(toFormDef(fromFormDef(slip))).toEqual(slip);
  });

  it('CSV 草稿：標題成為標籤，識別碼一律留空等工程師填，點分隔日期附上要確認的提醒', () => {
    const result = draftFormsFromCsv(entry);
    if (!result.ok) throw new Error('expected ok');
    const edit = fromDraft(result.drafts[0]);
    expect(edit).toMatchObject({ id: '', name: '入庫單', subject: [] });
    expect(edit.fields.map(f => [f.label, f.key, f.type])).toEqual([
      ['入庫日期', '', 'datetime'], ['規格', '', 'string'], ['批號', '', 'string'], ['數量', '', 'number'], ['總重量', '', 'number'],
    ]);
    expect(edit.fields[0].note).toContain('YYYY.MM.DD');
    expect(edit.fields[1].note).toBeUndefined();
    expect(JSON.stringify(toFormDef(edit))).not.toContain('note');
  });

  it('草稿在識別碼填好之前不能存，且指出是哪一欄', () => {
    const result = draftFormsFromCsv(entry);
    if (!result.ok) throw new Error('expected ok');
    const issues = editIssues(fromDraft(result.drafts[0]));
    expect(issues).toHaveLength(5);
    expect(issues[0]).toBe('欄位「入庫日期」還沒有填識別碼。');
  });

  it('識別碼重複時指出，不是靜默留下後者', () => {
    const edit: EditForm = { ...fromFormDef(slip), fields: [...fromFormDef(slip).fields, { key: 'lot', label: '另一個批號', type: 'string', unit: '', required: false, values: '' }] };
    expect(editIssues(edit)).toEqual(['欄位「另一個批號」的識別碼「lot」與前面的欄位重複。']);
  });

  it('識別碼填好後，其餘問題由表單庫的檢查回報（缺 subject、數量缺單位）', () => {
    const edit: EditForm = { ...fromFormDef(slip), subject: [], fields: [{ key: 'w', label: '重量', type: 'quantity', unit: '', required: false, values: '' }] };
    expect(editIssues(edit).join('；')).toContain('尚未指定描述的對象');
    expect(editIssues(edit).join('；')).toContain('必須指定單位');
    expect(editIssues(fromFormDef(slip))).toEqual([]);
  });

  it('空白表單從一個空欄位開始，且在填寫前不能存', () => {
    expect(blankForm().fields).toHaveLength(1);
    expect(editIssues(blankForm()).length).toBeGreaterThan(0);
  });

  it('選項一行一個，空行與前後空白被去掉', () => {
    const edit: EditForm = { ...fromFormDef(slip), fields: [{ key: 'g', label: '', type: 'enum', unit: '', required: false, values: ' A \r\n\n B\n' }] };
    expect(toFormDef(edit).fields.g.values).toEqual(['A', 'B']);
  });
});
