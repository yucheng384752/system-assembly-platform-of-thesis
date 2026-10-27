import Ajv from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import schema from '../../schemas/executable-plan.schema.json';
import valid from '../../fixtures/executable-plan/valid.json';
import timingMissing from '../../fixtures/executable-plan/timing-missing.json';
import notExecutable from '../../fixtures/executable-plan/not-executable.json';
import idMismatch from '../../fixtures/executable-plan/plan-id-mismatch.json';
import tampered from '../../fixtures/executable-plan/content-tampered.json';
import unknownVersion from '../../fixtures/executable-plan/unknown-version.json';
import vectors from '../../fixtures/executable-plan/canonical-vectors.json';
import { canonicalJson, contentSha256 } from './index';

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
type Plan = typeof valid;
const fresh = () => structuredClone(valid) as Plan;

// Contract section 5: the planId covers the whole plan except the planId field itself.
async function planIdOf(plan: Record<string, unknown>) {
  const { planId: _omitted, ...rest } = plan;
  return contentSha256(rest);
}
function rejects(plan: unknown, path: string) {
  expect(validate(plan), '預期 schema 拒絕').toBe(false);
  expect(validate.errors?.some(e => e.instancePath.startsWith(path) || e.schemaPath.includes(path)), JSON.stringify(validate.errors)).toBe(true);
}

describe('可執行計畫 schema 與 fixtures（契約第 3、4、5、9 節）', () => {
  it('合法計畫通過 schema，且宣告的 planId 等於重新計算的值', async () => {
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
    expect(valid.planId).toBe(await planIdOf(valid));
  });

  it('物件鍵順序不影響 planId，數值不同則改變（確定性）', async () => {
    const reversed = Object.fromEntries(Object.entries(valid).reverse());
    expect(await planIdOf(reversed)).toBe(valid.planId);
    const changed = fresh();
    changed.params[0].default = 12;
    expect(await planIdOf(changed)).not.toBe(valid.planId);
  });

  it('表單內容雜湊一變，新計畫的 planId 改變，舊計畫不受影響', async () => {
    const next = fresh();
    next.nodes[1].form!.contentSha256 = 'f'.repeat(64);
    expect(await planIdOf(next)).not.toBe(valid.planId);
    expect(valid.planId).toBe(await planIdOf(valid));
  });

  it('缺工時以 missing 表示且不帶數字；fixture 通過且不是 0', async () => {
    expect(validate(timingMissing), JSON.stringify(validate.errors)).toBe(true);
    for (const node of timingMissing.nodes) expect(node.timing).toEqual({ state: 'missing' });
    expect(timingMissing.planId).toBe(await planIdOf(timingMissing));
    const zeroed = fresh();
    (zeroed.nodes[0] as { timing: unknown }).timing = { state: 'missing', setupMin: 0 };
    rejects(zeroed, '/nodes/0/timing');
  });

  it('找不到能力對應的節點標為不可執行並有 reason；計畫仍可儲存供檢視', async () => {
    expect(validate(notExecutable), JSON.stringify(validate.errors)).toBe(true);
    const bad = notExecutable.nodes.filter(n => !n.executable);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ nodeId: 'mix', reason: expect.any(String) });
    expect(bad[0]).not.toHaveProperty('binding');
  });

  it('可執行節點缺 binding、不可執行節點缺 reason、可執行節點帶 reason，都被拒絕', () => {
    const noBinding = fresh();
    delete (noBinding.nodes[1] as { binding?: unknown }).binding;
    rejects(noBinding, '/nodes/1');
    const noReason = fresh();
    Object.assign(noReason.nodes[1], { executable: false });
    delete (noReason.nodes[1] as { binding?: unknown }).binding;
    rejects(noReason, '/nodes/1');
    const both = fresh();
    Object.assign(both.nodes[1], { reason: 'should not be here' });
    rejects(both, '/nodes/1');
  });

  it('宣告的 planId 與內容不符，或內容在封存後被改，重新計算都對不上（接收端據此拒絕）', async () => {
    expect(validate(idMismatch), JSON.stringify(validate.errors)).toBe(true);
    expect(idMismatch.planId).not.toBe(await planIdOf(idMismatch));
    expect(validate(tampered), JSON.stringify(validate.errors)).toBe(true);
    expect(tampered.planId).not.toBe(await planIdOf(tampered));
  });

  it('未知的 formatVersion 被 schema 拒絕，不嘗試猜測', () => {
    expect(unknownVersion.formatVersion).toBe(2);
    rejects(unknownVersion, '/formatVersion');
  });

  it('負的工時、缺必填欄位、多餘欄位、壞的 expandedFrom 被拒絕', () => {
    const negative = fresh();
    negative.nodes[1].timing = { state: 'specified', setupMin: -1, perUnitMin: 1, quantityUnit: 'kg' };
    rejects(negative, '/nodes/1/timing');
    const missingTop = fresh();
    delete (missingTop as { businessOnly?: unknown }).businessOnly;
    rejects(missingTop, '');
    const extra = fresh();
    (extra as Record<string, unknown>).subplans = [];
    rejects(extra, '');
    const badExpand = fresh();
    badExpand.nodes[3].expandedFrom = 'pack/seal';
    rejects(badExpand, '/nodes/3/expandedFrom');
  });

  it('可調整參數必須有預設值；範圍只能用在數值型參數', () => {
    const noDefault = fresh();
    delete (noDefault.params[0] as { default?: unknown }).default;
    rejects(noDefault, '/params/0');
    const rangeOnString = fresh();
    Object.assign(rangeOnString.params[3], { range: { min: 0, max: 1 } });
    rejects(rangeOnString, '/params/3');
  });

  it('警報規則只接受 manager 為最低角色，收件人名單不在計畫內', () => {
    const wrongRole = fresh();
    Object.assign(wrongRole.alarmRules[0], { minRole: 'operator' });
    rejects(wrongRole, '/alarmRules/0/minRole');
    const listed = fresh();
    Object.assign(listed.alarmRules[0], { recipients: ['someone'] });
    rejects(listed, '/alarmRules/0');
  });

  it('跨語言正規化向量：鍵依 UTF-16 排序、不做 Unicode 正規化（Python 端須得到相同結果）', async () => {
    for (const v of vectors.vectors) {
      expect(canonicalJson(v.input), v.name).toBe(v.canonical);
      expect(await contentSha256(v.input), v.name).toBe(v.sha256);
    }
    const decomposed = vectors.vectors.find(v => 'decomposed' in (v.input as object))!;
    const { decomposed: d, precomposed: p } = decomposed.input as { decomposed: string; precomposed: string };
    expect(d).not.toBe(p);
  });
});
