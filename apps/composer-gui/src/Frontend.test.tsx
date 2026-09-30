// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
afterEach(cleanup);
test('real flows select prerequisites and render both real Kit previews', () => {
  render(<App />);
  expect(screen.queryByText('紀錄 Kit')).toBeNull();
  expect(screen.queryByText('tenant-auth-kit')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '資料分析' }));
  expect((screen.getByRole('checkbox', { name: '查詢追溯（其他流程需要）' }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('tab', { name: '查詢與追溯' }));
  expect(screen.getByRole('table', { name: '查詢結果範例' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('批號的名稱'), { target: { value: '自訂批次' } });
  expect(screen.getByRole('columnheader', { name: '自訂批次' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '檔案上傳與驗證' }));
  expect(screen.getByRole('table', { name: '驗證錯誤範例' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '系統基本功能' }));
  expect(screen.getByText('此功能沒有可調整的畫面')).toBeTruthy();
});
