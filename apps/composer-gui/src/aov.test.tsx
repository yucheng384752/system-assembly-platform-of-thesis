// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
afterEach(cleanup);

test('the Workflow is the first, required step: no steps means step 01 cannot be confirmed (D17)', () => {
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('流程步驟');
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById('step-status')!.textContent).toContain('請至少建立一個流程步驟');
  fireEvent.click(screen.getByRole('button', { name: '新增步驟' }));
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(false);
});
test('native keyboard-activatable controls add, move and delete with focus; failed import retains state', () => {
  render(<App />);
  const add = screen.getByRole('button', { name: '新增步驟' }); add.focus();
  // Native button click is the browser's activation result for Enter/Space; no pointer-only handler.
  fireEvent.click(add);
  expect(document.activeElement).toBe(screen.getByLabelText('步驟 1 名稱'));
  // New step selects its placeholder so typing replaces it rather than producing 「新步驟 1收料檢查」 (G03).
  const added = document.activeElement as HTMLInputElement;
  expect([added.selectionStart, added.selectionEnd]).toEqual([0, added.value.length]);
  fireEvent.change(document.activeElement!, { target: { value: '第一個' } }); fireEvent.click(add);
  fireEvent.change(screen.getByLabelText('步驟 2 名稱'), { target: { value: '第二個' } });
  const move = screen.getByRole('button', { name: '上移步驟 2' }); move.focus(); fireEvent.click(move);
  expect((screen.getByLabelText('步驟 1 名稱') as HTMLInputElement).value).toBe('第二個');
  expect(document.activeElement).toBe(screen.getByLabelText('步驟 1 名稱'));
  // Moving an existing step keeps its name unselected so a stray keystroke cannot wipe it.
  const moved = document.activeElement as HTMLInputElement;
  expect(moved.selectionEnd! - moved.selectionStart!).toBe(0);
  fireEvent.click(screen.getByText('進階：貼上流程 JSON'));
  fireEvent.change(screen.getByLabelText('流程 JSON'), { target: { value: '{"steps":[]}' } });
  fireEvent.click(screen.getByRole('button', { name: '匯入流程 JSON' }));
  expect(screen.getByRole('alert').textContent).toContain('原流程已保留');
  expect((screen.getByLabelText('步驟 1 名稱') as HTMLInputElement).value).toBe('第二個');
  fireEvent.click(screen.getByRole('button', { name: '刪除步驟 1' }));
  expect(document.activeElement).toBe(screen.getByLabelText('步驟 1 名稱'));
  expect((document.activeElement as HTMLInputElement).value).toBe('第一個');
});
test('the step list selects which step the middle column edits, and moves focus there', () => {
  render(<App />);
  const add = screen.getByRole('button', { name: '新增步驟' });
  fireEvent.click(add); fireEvent.change(screen.getByLabelText('步驟 1 名稱'), { target: { value: '填寫紀錄' } });
  fireEvent.click(add); fireEvent.change(screen.getByLabelText('步驟 2 名稱'), { target: { value: '核對資料' } });
  // Only the selected step is editable, so edits cannot land on a step the user is not looking at.
  expect(screen.queryByLabelText('步驟 1 名稱')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^01 填寫紀錄/ }));
  expect(document.activeElement).toBe(screen.getByLabelText('步驟 1 名稱'));
  expect(screen.getByRole('button', { name: /^01 填寫紀錄/ }).getAttribute('aria-current')).toBe('true');
  expect(screen.getByRole('heading', { name: '編輯步驟 01' })).toBeTruthy();
});
test('importing a version 1 file keeps its steps and says which form assignments were dropped', () => {
  render(<App />);
  const v1 = { format: 'composer-aov-list', version: 1, steps: [{ id: 'a', name: '檢查', when: '', owner: '品管', formId: 'form-1' }] };
  fireEvent.click(screen.getByText('進階：貼上流程 JSON'));
  fireEvent.change(screen.getByLabelText('流程 JSON'), { target: { value: JSON.stringify(v1) } });
  fireEvent.click(screen.getByRole('button', { name: '匯入流程 JSON' }));
  expect(screen.getByText(/已清除以下步驟的表單指派：「檢查」/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /^01 檢查/ })).toBeTruthy();
});
