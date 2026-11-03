import { describe, expect, it } from 'vitest';
import type { FormDef } from '../aov-core';
import { checkRequirementFile, effectiveRequirement, emptyRequirementFile, satisfies, type FormRequirement, type RequirementFile } from './formRequirement';

const form = (fields: FormDef['fields'] = {}): FormDef => ({
  id: 'inspection', name: '錫棒製程檢查表', subject: ['mat.tin'],
  fields: {
    moldTemp: { label: '鑄模溫度', type: 'quantity', unit: 'degC', required: true },
    weight: { label: '實測重量', type: 'quantity', unit: 'kg' },
    verdict: { label: '品質判定', type: 'enum', values: ['OK', 'NG', 'HOLD'] },
    ...fields,
  },
});
const need: FormRequirement = {
  weight: { type: 'quantity', unit: 'kg' },
  verdict: { type: 'enum', values: ['OK', 'NG'] },
};
const codes = (violations: { code: string }[]) => violations.map(v => v.code);

describe('表單滿足流程需求（低與中危險度的修改不得使 guard 失效）', () => {
  it('表單提供了需求的全部欄位就滿足', () => {
    expect(satisfies(form(), need)).toEqual([]);
    expect(satisfies(form(), {})).toEqual([]);
  });

  it('加欄位、改標籤、調必填、多加選項、調上下限：仍然滿足', () => {
    const edited = form({
      weight: { label: '重量（實測）', type: 'quantity', unit: 'kg', required: true, default: 20 },
      verdict: { label: '判定', type: 'enum', values: ['OK', 'NG', 'HOLD', 'REWORK'] },
      note: { label: '備註', type: 'string' },
    });
    expect(satisfies(edited, need)).toEqual([]);
  });

  it('刪除被需要的欄位：不滿足，並指出是哪個欄位（改鍵等同刪除再新增）', () => {
    const { weight: _dropped, ...rest } = form().fields;
    const violations = satisfies({ ...form(), fields: { ...rest, weightMeasured: { type: 'quantity', unit: 'kg' } } }, need);
    expect(codes(violations)).toEqual(['missing']);
    expect(violations[0].field).toBe('weight');
    expect(violations[0].message).toContain('weight');
  });

  it('刪除沒有被任何節點需要的欄位：仍然滿足', () => {
    const { moldTemp: _dropped, ...rest } = form().fields;
    expect(satisfies({ ...form(), fields: rest }, need)).toEqual([]);
  });

  it('改型別：不滿足，數量不能改成一般數字', () => {
    expect(codes(satisfies(form({ weight: { type: 'number' } }), need))).toEqual(['type']);
  });

  it('改單位：不滿足，即使同為質量；以 kg 寫的條件不能默默讀成 g', () => {
    const violations = satisfies(form({ weight: { type: 'quantity', unit: 'g' } }), need);
    expect(codes(violations)).toEqual(['unit']);
    expect(violations[0].message).toContain('g');
    expect(violations[0].message).toContain('kg');
  });

  it('流程用到的選項被拿掉：不滿足，並列出缺的選項', () => {
    const violations = satisfies(form({ verdict: { type: 'enum', values: ['OK', 'HOLD'] } }), need);
    expect(codes(violations)).toEqual(['values']);
    expect(violations[0].message).toContain('NG');
  });

  it('多個問題一次全部回報，不是只報第一個', () => {
    const violations = satisfies(form({ weight: { type: 'number' }, verdict: { type: 'enum', values: ['OK'] } }), need);
    expect(codes(violations).sort()).toEqual(['type', 'values']);
  });
});

describe('節點的有效需求：動作給預設、節點可整份覆寫', () => {
  const file: RequirementFile = {
    ...emptyRequirementFile,
    actions: { inspect: need, store: { lot: { type: 'string' } } },
    nodes: { n2: { requires: { lot: { type: 'string' } } }, n3: { form: 'inspection' } },
  };
  it('沒有覆寫就用動作預設', () => {
    expect(effectiveRequirement(file, { id: 'n1', action: 'inspect' })).toEqual(need);
    expect(effectiveRequirement(file, { id: 'n3', action: 'inspect' })).toEqual(need); // choosing a form alone is not an override
  });
  it('有覆寫就整份取代，不與動作預設逐欄合併', () => {
    expect(effectiveRequirement(file, { id: 'n2', action: 'inspect' })).toEqual({ lot: { type: 'string' } });
  });
  it('沒有動作也沒有覆寫就沒有需求', () => {
    expect(effectiveRequirement(file, { id: 'n9' })).toEqual({});
    expect(effectiveRequirement(file, { id: 'n9', action: 'unknown' })).toEqual({});
  });
});

describe('表單需求檔的檢查', () => {
  it('有效檔案與空檔案通過', () => {
    expect(checkRequirementFile(emptyRequirementFile)).toEqual([]);
    expect(checkRequirementFile({ ...emptyRequirementFile, actions: { inspect: need }, nodes: { n1: { form: 'inspection', requires: need } } })).toEqual([]);
  });
  it('中文鍵、數量缺單位、選項欄位沒有選項、未知單位都被指出', () => {
    const bad = { ...emptyRequirementFile, actions: {
      a: { '重量': { type: 'number' } }, b: { w: { type: 'quantity' } }, c: { g: { type: 'enum' } }, d: { w: { type: 'quantity', unit: 'furlong' } },
    } };
    expect(codes(checkRequirementFile(bad))).toEqual(['requirement-key', 'requirement-unit-missing', 'requirement-values', 'requirement-unit']);
  });
  it('結構不對回報錯誤而不是丟出例外', () => {
    for (const raw of [null, [], {}, { format: 'composer-form-requirement', version: 9, actions: {}, nodes: {} },
                       { format: 'composer-form-requirement', version: 1, actions: [], nodes: {} },
                       { ...emptyRequirementFile, nodes: { n1: 5 } }, { ...emptyRequirementFile, nodes: { n1: { form: '1 bad' } } }]) {
      expect(checkRequirementFile(raw).length, JSON.stringify(raw)).toBeGreaterThan(0);
    }
  });
});
