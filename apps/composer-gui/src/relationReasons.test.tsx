// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { explainMissedCandidates, inferCandidates } from './relations';
import { RelationsPage } from './RelationsPage';
import { emptyAov, type AovDocument } from './workflow';
import type { FieldType, FormDraft } from './localData';

afterEach(cleanup);
const field = (id: string, name: string, type: FieldType, isKey = false) => ({ id, name, type, required: true, isKey });
const form = (id: string, name: string, ...fields: FormDraft['fields']): FormDraft => ({ id, name, fields });
const doc = (forms: FormDraft[], relations: AovDocument['relations'] = []): AovDocument => ({ ...emptyAov,
  steps: [{ id: 'step-1', name: '錫膏流程', when: '', owner: 'OP', formIds: forms.map(f => f.id), actions: [] }], forms, relations });

// Reported case: only two of three forms share an identically named and typed key; production calls it something else.
// Field names and types only; the shape comes from real sample headers, no row values are used (M01).
const reported = () => doc([
  form('form-1', 'inspection', field('f1', '表單名稱', 'text'), field('f2', '批號', 'integer', true)),
  form('form-2', 'production', field('f1', '表單名稱', 'text'), field('f2', '生產批號', 'text', true)),
  form('form-3', 'entry', field('f1', '表單名稱', 'text'), field('f2', '批號', 'integer', true)),
]);

test('the reported case: one candidate, and the missing partner is explained instead of silently absent', () => {
  const value = reported();
  expect(inferCandidates(value).map(c => `${c.from.formId}>${c.to.formId}`)).toEqual(['form-1>form-3']);
  const reasons = explainMissedCandidates(value);
  // The user must learn which field, why it does not match, and what to change (name and type).
  expect(reasons.some(r => r.includes('「inspection」的識別欄位「批號」') && r.includes('「production」') && r.includes('「生產批號」名稱相近')
    && r.includes('型別改成相同（目前是整數與文字）'))).toBe(true);
  // Every explained pair involves production; the working pair inspection and entry is not reported.
  expect(reasons.every(r => r.includes('production'))).toBe(true);
});
test('same name but different type is refused with both types named (A21)', () => {
  const reasons = explainMissedCandidates(doc([
    form('form-1', 'inspection', field('f1', '批號', 'integer', true)),
    form('form-2', 'production', field('f1', '批號', 'text', true)),
  ]));
  expect(reasons).toEqual(['「inspection」的「批號」是整數，「production」的「批號」是文字，型別不同，無法相連。請到「表單」把兩邊改成相同型別。']);
});
test('a pair where both sides are identifier fields is explained once, not twice', () => {
  expect(explainMissedCandidates(reported()).length).toBe(2);
});
test('following the advice makes the candidate appear and the explanation disappear', () => {
  const fixed = reported();
  fixed.forms[1].fields[1] = field('f2', '批號', 'integer', true);
  expect(inferCandidates(fixed).map(c => `${c.from.formId}>${c.to.formId}`)).toEqual(['form-1>form-2', 'form-1>form-3', 'form-2>form-3']);
  expect(explainMissedCandidates(fixed)).toEqual([]);
});
test('no noise: columns shared by every form but not marked as identifiers are never explained, and linked pairs are skipped', () => {
  const plain = doc([
    form('form-1', 'a', field('f1', '表單名稱', 'text'), field('f2', '編號', 'integer')),
    form('form-2', 'b', field('f1', '表單名稱', 'text'), field('f2', '產品編號', 'text')),
  ]);
  expect(explainMissedCandidates(plain)).toEqual([]);
  // Already linked by hand under different names: a hint now would only tell the user to fix something that is settled.
  const linkedDoc = doc([
    form('form-1', 'a', field('f1', '批號', 'integer', true)), form('form-2', 'b', field('f1', '生產批號', 'integer', true)),
  ], [{ id: 'rel-1', kind: 'shared-key', from: { formId: 'form-1', fieldId: 'f1' }, to: { formId: 'form-2', fieldId: 'f1' }, origin: 'user', confirmed: true }]);
  expect(explainMissedCandidates(linkedDoc)).toEqual([]);
});
test('short or equal names are not treated as similar, so a one-character field cannot trigger a hint', () => {
  expect(explainMissedCandidates(doc([
    form('form-1', 'a', field('f1', '號', 'integer', true)), form('form-2', 'b', field('f1', '批號', 'integer')),
  ]))).toEqual([]);
});
test('the relations page shows the explanation next to the candidates, and hides the section when there is nothing to explain', () => {
  const { unmount } = render(<RelationsPage value={reported()} onChange={() => {}} />);
  const section = screen.getByRole('region', { name: '未成為候選的原因' });
  expect(section.textContent).toContain('「生產批號」名稱相近');
  expect(screen.getAllByRole('button', { name: /確認/ }).length).toBe(1);
  unmount();
  render(<RelationsPage value={doc([form('form-1', 'a', field('f1', '批號', 'integer', true))])} onChange={() => {}} />);
  expect(screen.queryByRole('region', { name: '未成為候選的原因' })).toBeNull();
});
