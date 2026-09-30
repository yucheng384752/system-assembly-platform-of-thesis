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
test('local upload retains only fields, never writes storage or sends network; recipe excludes data', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open'); const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(<App />); fireEvent.click(screen.getByRole('button', { name: /01 資料上傳/ }));
  const file = new File(['名稱,數量\nPRIVATE_SAMPLE_SENTINEL,3'], 'sample.csv');
  Object.defineProperty(file, 'text', { value: async () => '名稱,數量\nPRIVATE_SAMPLE_SENTINEL,3' });
  fireEvent.change(screen.getByLabelText('選擇資料樣本（會替換目前欄位）'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText('欄位 1 名稱')).toBeTruthy());
  expect(document.body.textContent).not.toContain('PRIVATE_SAMPLE_SENTINEL');
  expect((screen.getByLabelText('欄位 2 型別') as HTMLSelectElement).value).toBe('integer');
  fireEvent.change(screen.getByLabelText('欄位 1 名稱'), { target: { value: '自訂名稱' } });
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  fireEvent.click(screen.getByRole('button', { name: /01 資料上傳/ }));
  expect((screen.getByLabelText('欄位 1 名稱') as HTMLInputElement).value).toBe('自訂名稱');
  expect(exportRecipe(initialRecipe, catalog)).not.toMatch(/PRIVATE_SAMPLE_SENTINEL|自訂名稱/);
  expect(fetch).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
});
