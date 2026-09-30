// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { inferFields } from './localData';
import { App, initialRecipe } from './App';
import { exportRecipe } from '../../../libs/ui-runtime/recipe';
import { catalog } from './previewCatalog';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
test('CSV/TSV inference handles BOM, quoted separators, newlines and escaped quotes without returning rows', () => {
  const fields = inferFields('\uFEFF名稱,數量,日期,備註\r\n"示範,資料",2,2026-09-30,"換行\n文字"\r\n"另一""筆",2.5,2026-09-29,\r\n', ',');
  expect(fields.map(f => f.type)).toEqual(['text', 'decimal', 'date', 'text']);
  expect(fields[3].required).toBe(false);
  expect(JSON.stringify(fields)).not.toContain('示範');
  expect(inferFields('代碼\t啟用\n001\ttrue', '\t').map(f => f.type)).toEqual(['text', 'boolean']);
  for (const text of ['', 'a,a\n1,2', 'a,b\n1', 'a\n"未結束', 'a\n"x"z']) expect(() => inferFields(text, ',')).toThrow();
  expect(inferFields('日期\n2026-02-30', ',')[0].type).toBe('text');
});
function csv(name: string, text: string) {
  const file = new File([text], name); Object.defineProperty(file, 'text', { value: async () => text }); return file;
}
test('multi-file upload builds one form per file in the chosen step, lists failures, and never keeps rows or sends them', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open'); const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '新增步驟' })); fireEvent.change(screen.getByLabelText('步驟 1 名稱'), { target: { value: '收料' } });
  fireEvent.click(screen.getByRole('button', { name: '新增步驟' })); fireEvent.change(screen.getByLabelText('步驟 2 名稱'), { target: { value: '檢驗' } });
  fireEvent.click(screen.getByRole('button', { name: /02 表單/ }));
  fireEvent.change(screen.getByLabelText('上傳到步驟'), { target: { value: 'step-2' } });
  fireEvent.change(screen.getByLabelText('選擇 CSV / TSV（可多選）'), { target: { files: [
    csv('檢驗紀錄.csv', '批號,數量\nPRIVATE_SAMPLE_SENTINEL,3'), csv('broken.csv', 'a,a\n1,2'),
  ] } });
  await waitFor(() => expect(screen.getByLabelText('欄位 1 名稱')).toBeTruthy());
  // The failed file is named with its reason instead of being skipped silently (D25).
  expect(screen.getByText(/broken\.csv：第一列須為不重複/)).toBeTruthy();
  expect(document.body.textContent).not.toContain('PRIVATE_SAMPLE_SENTINEL');
  // The form takes the file name and the page asks for de-identification (D27); it lands in the chosen step (D23).
  expect((screen.getByLabelText('表單名稱') as HTMLInputElement).value).toBe('檢驗紀錄');
  expect(screen.getByText(/表單名稱取自檔名，請確認已去識別化/)).toBeTruthy();
  expect((screen.getByLabelText('所屬步驟') as HTMLSelectElement).value).toBe('step-2');
  expect((screen.getByLabelText('欄位 2 型別') as HTMLSelectElement).value).toBe('integer');
  fireEvent.click(screen.getByLabelText('欄位 1 識別欄位'));
  fireEvent.change(screen.getByLabelText('欄位 1 名稱'), { target: { value: '自訂名稱' } });
  fireEvent.click(screen.getByRole('button', { name: /04 功能選配/ }));
  fireEvent.click(screen.getByRole('button', { name: /02 表單/ }));
  expect((screen.getByLabelText('欄位 1 名稱') as HTMLInputElement).value).toBe('自訂名稱');
  expect((screen.getByLabelText('欄位 1 識別欄位') as HTMLInputElement).checked).toBe(true);
  // A new field selects its placeholder name so typing replaces it (G03).
  fireEvent.click(screen.getByRole('button', { name: '新增欄位' }));
  const added = screen.getByLabelText('欄位 3 名稱') as HTMLInputElement;
  expect(document.activeElement).toBe(added);
  expect([added.selectionStart, added.selectionEnd]).toEqual([0, added.value.length]);
  expect(exportRecipe(initialRecipe, catalog)).not.toMatch(/PRIVATE_SAMPLE_SENTINEL|自訂名稱/);
  expect(fetch).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
});
test('a form moved out of its step or left unassigned blocks the forms step and names the form (A20)', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '新增步驟' }));
  fireEvent.click(screen.getByRole('button', { name: /02 表單/ }));
  fireEvent.click(screen.getByRole('button', { name: '新增空白表單' }));
  expect(document.getElementById('step-status')!.textContent).toContain('表單「新表單 1」尚未完成：尚未建立欄位');
  fireEvent.click(screen.getByRole('button', { name: '新增欄位' }));
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /01 流程步驟/ }));
  fireEvent.click(screen.getByRole('button', { name: /^01 新步驟 1/ }));
  fireEvent.click(screen.getByRole('button', { name: '刪除步驟 1' }));
  expect(screen.getByText(/其 1 張表單需在「表單」重新指派步驟/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /02 表單/ }));
  expect(document.getElementById('step-status')!.textContent).toContain('表單「新表單 1」尚未指派步驟');
});
