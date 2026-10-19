// @vitest-environment jsdom
import { openFlow, startLogic, addTool } from './testNav';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { deriveKits } from '../../../libs/ui-runtime/actions';
import { actionCatalog } from './workflow';
import { registry } from './registryData';
afterEach(cleanup);
test('real flows select prerequisites and render both real Kit previews', () => {
  render(<App />); openFlow();
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
  // Configurator (step 03, D-A2): a setting in the side column updates the live preview column.
  fireEvent.click(screen.getByRole('button', { name: /03 參數設定/ }));
  fireEvent.click(screen.getByRole('tab', { name: '查詢與追溯' }));
  fireEvent.change(within(screen.getByRole('region', { name: /參數設定/ })).getByLabelText('批號的名稱'), { target: { value: '自訂批次' } });
  expect(within(screen.getByRole('region', { name: '即時預覽' })).getByRole('columnheader', { name: '自訂批次' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '檔案上傳與驗證' }));
  expect(screen.getByRole('table', { name: '驗證錯誤範例' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '系統基本功能' }));
  expect(screen.getByText('此功能沒有可調整的畫面')).toBeTruthy();
});
test('A-C11/C14: tracing derives four functions, locks required ones, and uses business names only', () => {
  const result = deriveKits(['trace-records'], actionCatalog, registry);
  expect(result.kits.map(k => k.kitId)).toHaveLength(4);
  render(<App />); openFlow(); startLogic();
  addTool('查詢追溯');
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  for (const name of ['通用表單', '站點資料串聯']) {
    const input = screen.getByRole('checkbox', { name: `${name}（流程需要）` }) as HTMLInputElement;
    expect(input.checked).toBe(true); expect(input.disabled).toBe(true);
  }
  expect(document.body.textContent).not.toMatch(/forms\.create|query\.trace|mService|Function|generic-forms-kit|station-data-link-kit/);
  // The reason is a short label: node → action, with where it sits (D81, D-A3).
  expect(screen.getAllByRole('button', { name: '到流程畫布查看節點：查詢追溯' }).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/A 廠／生產邏輯 1/).length).toBeGreaterThan(0);
});

// The feature step no longer lists a separate block of "dependent features": the reasons live with each derived feature.
test('the feature step has no dependent-features block, and each derived feature keeps its own reasons', () => {
  render(<App />); openFlow(); startLogic(); addTool('查詢追溯');
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  expect(screen.queryByRole('heading', { name: '相依功能' })).toBeNull();
  expect(screen.queryByText(/目前選了 \d+ 個流程/)).toBeNull();
  const derived = screen.getByRole('region', { name: '由流程畫布帶入' });
  expect(within(derived).getAllByText(/因為/).length).toBeGreaterThan(0);
  // The manual feature catalogue stays under advanced.
  expect(screen.getByText('進階：功能目錄與搜尋')).toBeTruthy();
});
