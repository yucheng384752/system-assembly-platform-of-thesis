import { describe, expect, it } from 'vitest';
import formFixtures from '../../fixtures/executable-plan/forms.json';
import type { PlanForm } from './executablePlan';
import { checkFormBundle, makeFormBundle } from './formBundle';

const real = formFixtures.forms[0] as unknown as PlanForm;

describe('表單檔包', () => {
  it('Composer 產生的表單（含真實雜湊）通過檢查', async () => {
    expect(await checkFormBundle(makeFormBundle([real]))).toEqual([]);
    expect(await checkFormBundle(makeFormBundle([]))).toEqual([]);
  });
  it('內容被改過（雜湊不符）時指出是哪一張，不是靜默收下', async () => {
    const tampered = { ...real, definition: { ...real.definition, name: '被改過' } };
    const errors = await checkFormBundle(makeFormBundle([tampered]));
    expect(errors).toEqual([`第 1 張表單（${real.definition.id}）的雜湊與內容不符，內容在產生後被改過。`]);
  });
  it('每份必須正好是上傳本文的兩個鍵，多出的鍵與重複的內容都被指出', async () => {
    expect((await checkFormBundle({ ...makeFormBundle([real]), forms: [{ ...real, extra: 1 }] }))[0]).toContain('正好有 contentSha256 與 definition');
    expect(await checkFormBundle(makeFormBundle([real, real]))).toEqual([`第 2 張表單（${real.definition.id}）與前面的表單內容重複。`]);
  });
  it('定義本身不合格（缺 subject）時回報表單庫的檢查訊息', async () => {
    const { subject: _s, ...rest } = real.definition as unknown as Record<string, unknown>;
    expect((await checkFormBundle(makeFormBundle([{ ...real, definition: rest as never }]))).join()).toContain('尚未指定描述的對象');
  });
  it('不是表單檔包、版本不對、缺清單都回報', async () => {
    for (const raw of [null, [], {}, { format: 'composer-form-bundle', version: 2, forms: [] }, { format: 'composer-form-bundle', version: 1 }]) {
      expect((await checkFormBundle(raw)).length, JSON.stringify(raw)).toBe(1);
    }
  });
});
