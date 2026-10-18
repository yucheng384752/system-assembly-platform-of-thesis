// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { openFlow } from './testNav';
afterEach(cleanup);
// D-A2: parameters live in their own step 03; step 02 keeps only the sub-feature switches.
test('參數設定是獨立的第 3 步，功能選配步驟不再顯示參數編輯', () => {
  render(<App />); openFlow();
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: '查詢追溯' }));
  fireEvent.click(screen.getByRole('tab', { name: '查詢與追溯' }));
  expect(screen.queryByLabelText('批號的名稱')).toBeNull();
  expect(screen.getByRole('region', { name: /調整/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /03 參數設定/ }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('參數設定');
  fireEvent.click(screen.getByRole('tab', { name: '查詢與追溯' }));
  const panel = screen.getByRole('region', { name: /參數設定/ });
  expect(within(panel).getByLabelText('批號的名稱')).toBeTruthy();
  expect(within(panel).getByText(/這是組裝期的初始值/)).toBeTruthy();
  // The wording must not promise a runtime settings center that does not exist yet.
  expect(panel.textContent).toContain('目前尚未提供');
});
test('步驟列有四個必填步驟，輸出為第 4 步', () => {
  render(<App />); openFlow();
  const names = screen.getAllByRole('button', { name: /^0[1-4] / }).map(b => b.textContent?.trim().slice(0, 6));
  expect(names).toHaveLength(4);
  expect(screen.getByRole('button', { name: /04 輸出/ })).toBeTruthy();
});
