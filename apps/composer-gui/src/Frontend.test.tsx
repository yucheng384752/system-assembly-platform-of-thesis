// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
afterEach(cleanup);
test('real flows select prerequisites and render both real Kit previews', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  expect(screen.queryByText('紀錄 Kit')).toBeNull();
  expect(screen.queryByText('tenant-auth-kit')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '資料分析' }));
  // A prerequisite flow is locked and says why via its description, not only by being greyed out.
  const prerequisite = screen.getByRole('checkbox', { name: '查詢追溯' }) as HTMLInputElement;
  expect(prerequisite.disabled).toBe(true);
  expect(document.getElementById(prerequisite.getAttribute('aria-describedby')!)?.textContent).toBe('其他流程需要');
  fireEvent.click(screen.getByRole('tab', { name: '查詢與追溯' }));
  expect(screen.getByRole('table', { name: '查詢結果範例' })).toBeTruthy();
  // Configurator: a setting in the side column updates the live preview column.
  fireEvent.change(within(screen.getByRole('region', { name: /調整/ })).getByLabelText('批號的名稱'), { target: { value: '自訂批次' } });
  expect(within(screen.getByRole('region', { name: '即時預覽' })).getByRole('columnheader', { name: '自訂批次' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '檔案上傳與驗證' }));
  expect(screen.getByRole('table', { name: '驗證錯誤範例' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '系統基本功能' }));
  expect(screen.getByText('此功能沒有可調整的畫面')).toBeTruthy();
});
