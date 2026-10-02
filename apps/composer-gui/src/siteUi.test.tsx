// @vitest-environment jsdom
import { openFlow } from './testNav';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import a from '../../../config/site/examples/demo-site-a.site.json';
import b from '../../../config/site/examples/demo-site-b.site.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function page(number: string) { fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${number} `) })); }
async function upload(value: unknown) {
  const text = JSON.stringify(value);
  const file = new File([text], 'mock.site.json'); Object.defineProperty(file, 'text', { value: async () => text });
  fireEvent.change(screen.getByLabelText('匯入場域設定'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText('匯入場域設定').matches(':disabled')).toBe(false));
}
function preview() { page('04'); fireEvent.click(screen.getByRole('tab', { name: '檔案上傳與驗證' })); }

// D54/D56: import is atomic and session-only; controls and preview must resolve the same Site values.
test('場域切換鎖定有效值，匯入失敗保留原場域，移除後還原使用者值', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(<App />); openFlow(); preview();
  fireEvent.change(screen.getByLabelText('資料列的欄寬'), { target: { value: '200' } });
  page('05'); await upload(a);
  expect(screen.getByText('目前場域：模擬場域 A，版本 1.0.0')).toBeTruthy();
  expect(screen.getByText('待 MIS 確認：模擬說明')).toBeTruthy();
  preview();
  const width = screen.getByLabelText('資料列的欄寬') as HTMLInputElement;
  expect(width.disabled).toBe(true); expect(width.value).toBe('240');
  expect(screen.getByRole('columnheader', { name: '模擬列號 A' }).style.width).toBe('240px');
  expect(document.getElementById(width.id + '-site')?.textContent).toContain('由場域鎖定（模擬場域 A）');
  expect(width.getAttribute('aria-describedby')).toContain(width.id + '-site');
  page('05'); await upload({ ...b, password: 'mock-value' });
  expect(screen.getByText('目前場域：模擬場域 A，版本 1.0.0')).toBeTruthy();
  expect(screen.getByText(/場域設定匯入失敗，原場域已保留/)).toBeTruthy();
  await upload(b); preview();
  expect((screen.getByLabelText('資料列的欄寬') as HTMLInputElement).value).toBe('280');
  expect(screen.getByRole('columnheader', { name: '模擬列號 B' })).toBeTruthy();
  page('05'); fireEvent.click(screen.getByRole('button', { name: '移除場域' })); preview();
  expect((screen.getByLabelText('資料列的欄寬') as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText('資料列的欄寬') as HTMLInputElement).value).toBe('200');
  expect(screen.getByRole('columnheader', { name: '資料列' }).style.width).toBe('200px');
  expect(storage).not.toHaveBeenCalled();
});

// D57: preserve conflicting selections and block both confirmation and output until explicitly repaired.
test('既有選項及新輸入超限時顯示限制並阻擋輸出，不截斷', async () => {
  render(<App />); openFlow(); preview();
  fireEvent.change(screen.getByLabelText('錯誤說明的欄寬'), { target: { value: '350' } });
  page('05'); await upload(a);
  expect(document.getElementById('site-conflict')?.textContent).toContain('最大 300');
  expect((screen.getByRole('button', { name: '下載設定交付包' }) as HTMLButtonElement).disabled).toBe(true);
  preview();
  expect((screen.getByLabelText('錯誤說明的欄寬') as HTMLInputElement).value).toBe('350');
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('錯誤說明的欄寬'), { target: { value: '250' } });
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('錯誤說明的欄寬'), { target: { value: '310' } });
  expect((screen.getByLabelText('錯誤說明的欄寬') as HTMLInputElement).value).toBe('310');
  expect(screen.getByText(/「錯誤說明的欄寬」的值不符合限制。場域限制：最大 300/)).toBeTruthy();
  page('05'); expect(document.getElementById('site-conflict')?.textContent).toContain('最大 300');
  fireEvent.click(screen.getByRole('button', { name: '移除場域' })); preview();
  expect((screen.getByLabelText('錯誤說明的欄寬') as HTMLInputElement).value).toBe('310');
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(false);
});
