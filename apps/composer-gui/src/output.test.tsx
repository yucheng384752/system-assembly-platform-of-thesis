// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, initialRecipe } from './App';
import { exportRecipe, importRecipe } from '../../../libs/ui-runtime/recipe';
import { validateSchema } from '../../../libs/ui-runtime/schema';
import { catalog } from './previewCatalog';
import { downloadJson } from './fileTransfer';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function captureDownloads() {
  const contents: string[] = [];
  const NativeBlob = Blob;
  vi.stubGlobal('Blob', class extends NativeBlob { constructor(parts: BlobPart[], options?: BlobPropertyBag) { super(parts, options); contents.push(parts.join('')); } });
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return contents;
}
test('real file downloads contain validated recipe and independent AOV, never uploaded rows or credentials', async () => {
  const contents = captureDownloads(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const storage = vi.spyOn(Storage.prototype, 'setItem'); const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /01 資料上傳/ }));
  const file = new File(['name\nPRIVATE_UPLOAD_SENTINEL'], 'sample.csv');
  Object.defineProperty(file, 'text', { value: async () => 'name\nPRIVATE_UPLOAD_SENTINEL' });
  fireEvent.change(screen.getByLabelText('選擇 CSV / TSV'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText('欄位 1 名稱')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /04 AoV 設定/ }));
  fireEvent.click(screen.getByRole('button', { name: '新增步驟' }));
  fireEvent.click(screen.getByRole('button', { name: '下載流程規格' }));
  validateSchema('aov', JSON.parse(contents[0]));
  fireEvent.click(screen.getByRole('button', { name: /03 輸出/ }));
  expect(screen.getByText(/部署套件產生功能尚未提供/)).toBeTruthy();
  // Output cannot be confirmed until the required client name is filled (G05).
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('客戶代稱'), { target: { value: '示範客戶' } });
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '下載系統設定檔' }));
  expect(contents).toHaveLength(2); const output = JSON.parse(contents[1]);
  validateSchema('recipe', output); expect(output.clientName).toBe('示範客戶');
  expect(output.enabledKits).toEqual(initialRecipe.enabledKits);
  expect(contents.join()).not.toMatch(/PRIVATE_UPLOAD_SENTINEL|password|token|tableData/);
  expect(contents[1]).not.toContain('steps');
  expect(fetch).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
});
test('Recipe file import is atomic and restores flow selection and editor settings', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: '查詢追溯' }));
  fireEvent.click(screen.getByRole('tab', { name: '查詢與追溯' }));
  fireEvent.change(screen.getByLabelText('批號的名稱'), { target: { value: '保留中的欄位' } });
  fireEvent.click(screen.getByRole('button', { name: /03 輸出/ }));
  const input = screen.getByLabelText('選擇 JSON 檔案');
  const invalid = new File(['{}'], 'invalid.json'); Object.defineProperty(invalid, 'text', { value: async () => '{}' });
  fireEvent.change(input, { target: { files: [invalid] } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('原設定已保留'));
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  fireEvent.click(screen.getByRole('tab', { name: '查詢與追溯' }));
  expect(screen.getByRole('columnheader', { name: '保留中的欄位' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /03 輸出/ }));
  const good = new File([''], 'valid.json');
  Object.defineProperty(good, 'text', { value: async () => exportRecipe({ ...initialRecipe, clientName: '匯入客戶' }, catalog) });
  fireEvent.change(screen.getByLabelText('選擇 JSON 檔案'), { target: { files: [good] } });
  await waitFor(() => expect((screen.getByLabelText('客戶代稱') as HTMLInputElement).value).toBe('匯入客戶'));
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  expect(screen.queryByRole('tab', { name: '查詢與追溯' })).toBeNull();
  expect((screen.getByRole('checkbox', { name: '查詢追溯' }) as HTMLInputElement).checked).toBe(false);
});
test('real Recipe rejects omitted dependencies and projects out secrets; download releases object URLs', () => {
  const missing = { ...initialRecipe, enabledKits: initialRecipe.enabledKits.filter(id => id !== 'entry-permission-kit') };
  expect(() => importRecipe(JSON.stringify(missing), catalog)).toThrow('相依');
  const extra = { ...initialRecipe, clientName: '示範', password: 'SECRET_SENTINEL', rows: [{ data: 'PRIVATE_UPLOAD_SENTINEL' }], database: { ...initialRecipe.database, token: 'TOKEN_SENTINEL' } };
  expect(exportRecipe(extra, catalog)).not.toMatch(/SECRET_SENTINEL|PRIVATE_UPLOAD_SENTINEL|TOKEN_SENTINEL/);
  captureDownloads(); vi.useFakeTimers(); downloadJson('{}', 'example.json');
  expect(document.querySelector('a[download]')).toBeNull();
  vi.advanceTimersByTime(1000); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
});
