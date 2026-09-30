// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
import { emptyAov, exportAov, importAov } from './aov';
afterEach(cleanup);
test('AOV round trip rejects extra fields, duplicate IDs, missing forms and invalid names', () => {
  const value = { ...emptyAov, steps: [{ id: 'one', name: '檢查', when: '收到檔案', owner: '品管', formId: 'form-1' }] };
  expect(importAov(exportAov(value, ['form-1']), ['form-1'])).toEqual(value);
  for (const invalid of [{ ...value, rows: [] }, { ...value, version: 9 }, { ...value, steps: [value.steps[0], value.steps[0]] }, { ...value, steps: [{ ...value.steps[0], name: ' ' }] }]) expect(() => importAov(JSON.stringify(invalid), ['form-1'])).toThrow();
  expect(() => importAov(JSON.stringify(value), [])).toThrow('表單');
});
test('native keyboard-activatable controls add, move and delete with focus; failed import retains state', () => {
  render(<App />); fireEvent.click(screen.getByRole('button', { name: /AOV 流程規格/ }));
  const add = screen.getByRole('button', { name: '新增步驟' }); add.focus();
  // Native button click is the browser's activation result for Enter/Space; no pointer-only handler.
  fireEvent.click(add);
  expect(document.activeElement).toBe(screen.getByLabelText('步驟 1 名稱'));
  fireEvent.change(document.activeElement!, { target: { value: '第一個' } }); fireEvent.click(add);
  fireEvent.change(screen.getByLabelText('步驟 2 名稱'), { target: { value: '第二個' } });
  const move = screen.getByRole('button', { name: '上移步驟 2' }); move.focus(); fireEvent.click(move);
  expect((screen.getByLabelText('步驟 1 名稱') as HTMLInputElement).value).toBe('第二個');
  expect(document.activeElement).toBe(screen.getByLabelText('步驟 1 名稱'));
  fireEvent.click(screen.getByText('進階：貼上流程 JSON'));
  fireEvent.change(screen.getByLabelText('流程 JSON'), { target: { value: '{"steps":[]}' } });
  fireEvent.click(screen.getByRole('button', { name: '匯入流程 JSON' }));
  expect(screen.getByRole('alert').textContent).toContain('原流程已保留');
  expect((screen.getByLabelText('步驟 1 名稱') as HTMLInputElement).value).toBe('第二個');
  fireEvent.click(screen.getByRole('button', { name: '刪除步驟 1' }));
  expect(document.activeElement).toBe(screen.getByLabelText('步驟 1 名稱'));
  expect((document.activeElement as HTMLInputElement).value).toBe('第一個');
});
