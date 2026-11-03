import { describe, expect, it } from 'vitest';
import entry from '../../fixtures/forms/entry.csv?raw';
import inspection from '../../fixtures/forms/inspection.csv?raw';
import material from '../../fixtures/forms/material.csv?raw';
import blankHeader from '../../fixtures/forms/entry-blank-header.csv?raw';
import mixed from '../../fixtures/forms/mixed.csv?raw';
import { buildFormDef, draftFormsFromCsv, type FormDraft } from './formCsvImport';

const drafts = (text: string): FormDraft[] => {
  const result = draftFormsFromCsv(text);
  if (!result.ok) throw new Error(result.errors.join('；'));
  return result.drafts;
};

describe('客戶 CSV 轉成表單草稿', () => {
  it('標題列變成欄位，第一欄的值是表單名稱；型別只是建議', () => {
    const [draft] = drafts(entry);
    expect(draft.name).toBe('入庫單');
    expect(draft.columns).toEqual([
      { header: '入庫日期', suggestedType: 'datetime', dateFormat: 'YYYY.MM.DD' },
      { header: '規格', suggestedType: 'string' },
      { header: '批號', suggestedType: 'string' },
      { header: '數量', suggestedType: 'number' },
      { header: '總重量', suggestedType: 'number' },
    ]);
  });

  it('草稿不保留任何資料列的值：客戶資料不能經由草稿外流', () => {
    const text = JSON.stringify(drafts(inspection));
    for (const value of ['PRODUCT-A', 'LOT-0001', '20.03', '280']) expect(text).not.toContain(value);
  });

  it('點分隔的日期標為格式待確認，不自動轉換；判定欄位仍是文字', () => {
    const [draft] = drafts(inspection);
    expect(draft.columns.find(c => c.header === '製造日期')).toMatchObject({ suggestedType: 'datetime', dateFormat: 'YYYY.MM.DD' });
    expect(draft.columns.find(c => c.header === '品質判定')?.suggestedType).toBe('string');
    expect(draft.columns.find(c => c.header === '重量_實測值')?.suggestedType).toBe('number');
  });

  it('不存在的日期不被當成日期（2026.02.30）', () => {
    const [draft] = drafts('表單名稱,d\r\nx,2026.02.30\r\n');
    expect(draft.columns[0].suggestedType).toBe('string');
  });

  it('同一欄混用日期寫法時退回文字，不挑一種', () => {
    const [draft] = drafts('表單名稱,d\r\nx,2026.05.12\r\nx,2026-05-13\r\n');
    expect(draft.columns[0]).toEqual({ header: 'd', suggestedType: 'string' });
  });

  it('一個檔案有多張表單時各自成草稿，各自推論', () => {
    const result = drafts(mixed);
    expect(result.map(d => d.name)).toEqual(['入庫單', '倉儲單']);
    expect(result[0].columns[0]).toEqual({ header: '入庫日期', suggestedType: 'string' }); // dotted and dashed dates mixed
    expect(result[1].columns[0]).toMatchObject({ suggestedType: 'datetime', dateFormat: 'YYYY-MM-DD' });
  });

  it('標題缺漏時指出是第幾欄，並且不產生任何草稿', () => {
    const result = draftFormsFromCsv(blankHeader);
    expect(result).toEqual({ ok: false, errors: ['第 3 欄沒有標題。'] });
  });

  it('其他壞檔案都以業務語言回報', () => {
    const errors = (text: string) => { const r = draftFormsFromCsv(text); return r.ok ? [] : r.errors; };
    expect(errors('')).toEqual(['檔案是空的。']);
    expect(errors('名稱,a\r\nx,1\r\n')[0]).toContain('表單名稱');
    expect(errors('表單名稱,a,a\r\nx,1,2\r\n')).toEqual(['第 3 欄的標題「a」重複。']);
    expect(errors('表單名稱,a\r\n')).toEqual(['沒有任何資料列，無法判斷各欄位的內容。']);
    expect(errors('表單名稱\r\nx\r\n')[0]).toContain('至少要有一個欄位');
    expect(errors('表單名稱,a\r\n,1\r\n')).toEqual(['第 2 列沒有填表單名稱。']);
    expect(errors('表單名稱,a\r\nx,1,2\r\n')).toEqual(['第 2 列的欄位數量比標題多。']);
    expect(errors('表單名稱,a\r\n"x,1\r\n')).toEqual(['有一個欄位的引號沒有結束。']);
    expect(errors('x'.repeat(2 * 1024 * 1024 + 1))).toEqual(['檔案超過 2 MB，請拆成較小的檔案。']);
  });

  it('引號內的逗號、換行與雙引號被正確讀取，BOM 與 LF 結尾都可', () => {
    const [draft] = drafts('﻿表單名稱,"品名, 規格","備註""A"""\n入庫單,x,y\n');
    expect(draft.columns.map(c => c.header)).toEqual(['品名, 規格', '備註"A"']);
  });
});

describe('草稿加工程師的設定才成為表單', () => {
  const [draft] = drafts(entry);
  const setting = {
    id: 'entry', subject: ['mat.tin'],
    columns: [
      { header: '入庫日期', key: 'receivedOn', type: 'datetime' as const, required: true },
      { header: '批號', key: 'lot', type: 'string' as const, required: true },
      { header: '數量', key: 'qty', type: 'number' as const },
      { header: '總重量', key: 'totalWeight', type: 'quantity' as const, unit: 'kg' },
    ],
    skip: ['規格'],
  };

  it('標題成為標籤，鍵由工程師給；產生的表單通過表單庫檢查', () => {
    const built = buildFormDef(draft, setting);
    expect(built).toEqual({ ok: true, form: {
      id: 'entry', name: '入庫單', subject: ['mat.tin'],
      fields: {
        receivedOn: { label: '入庫日期', type: 'datetime', required: true },
        lot: { label: '批號', type: 'string', required: true },
        qty: { label: '數量', type: 'number' },
        totalWeight: { label: '總重量', type: 'quantity', unit: 'kg' },
      },
    } });
  });

  it('沒有設定也沒有略過的欄位被指出：不能悄悄丟掉客戶的欄位', () => {
    const built = buildFormDef(draft, { ...setting, skip: [] });
    expect(built.ok).toBe(false);
    expect(!built.ok && built.issues.map(i => i.code)).toEqual(['column-unset']);
    expect(!built.ok && built.issues[0].message).toContain('規格');
  });

  it('不替工程師補單位與 subject：缺了就不成立', () => {
    const noUnit = buildFormDef(draft, { ...setting, columns: setting.columns.map(c => c.key === 'totalWeight' ? { ...c, unit: undefined } : c) });
    expect(!noUnit.ok && noUnit.issues.map(i => i.code)).toEqual(['field-unit-missing']);
    const noSubject = buildFormDef(draft, { ...setting, subject: [] });
    expect(!noSubject.ok && noSubject.issues.map(i => i.code)).toEqual(['form-subject']);
  });

  it('中文鍵、重複鍵、不存在的欄位都被擋下', () => {
    const bad = buildFormDef(draft, { ...setting, columns: [
      { header: '批號', key: '批號', type: 'string' }, { header: '數量', key: 'qty', type: 'number' }, { header: '總重量', key: 'qty', type: 'number' },
      { header: '入庫日期', key: 'receivedOn', type: 'datetime' }, { header: '不存在', key: 'x', type: 'string' },
    ] });
    expect(!bad.ok && bad.issues.map(i => i.code).sort()).toEqual(['column-unknown', 'field-key', 'field-key-duplicate']);
  });
});
