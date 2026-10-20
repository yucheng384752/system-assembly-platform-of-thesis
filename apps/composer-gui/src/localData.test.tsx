// @vitest-environment jsdom
import { openFlow, startLogic, wireChain, addTool } from './testNav';
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
test('single-node upload names failures, retains only fields, and never sends or saves rows', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open'); const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(<App />); openFlow(); startLogic();
  addTool('建立表單');
  fireEvent.change(screen.getByLabelText('名稱'), { target: { value: '檢驗' } });
  fireEvent.change(screen.getByLabelText('選擇標準 CSV 樣本'), { target: { files: [csv('broken.csv', 'a,a\n1,2')] } });
  await screen.findByText(/broken\.csv：第一列須為不重複/);
  fireEvent.change(screen.getByLabelText('選擇標準 CSV 樣本'), { target: { files: [csv('檢驗紀錄.csv', '批號,數量\nPRIVATE_SAMPLE_SENTINEL,3')] } });
  await waitFor(() => expect(screen.getByLabelText('欄位 1 名稱')).toBeTruthy());
  expect(document.body.textContent).not.toContain('PRIVATE_SAMPLE_SENTINEL');
  expect((screen.getByLabelText('表單名稱') as HTMLInputElement).value).toBe('檢驗紀錄');
  expect(screen.getByText(/表單名稱取自檔名，請確認已去識別化/)).toBeTruthy();
  expect((screen.getByLabelText('名稱') as HTMLInputElement).value).toBe('檢驗');
  expect((screen.getByLabelText('欄位 2 型別') as HTMLSelectElement).value).toBe('integer');
  fireEvent.click(screen.getByLabelText('欄位 1 識別欄位'));
  fireEvent.change(screen.getByLabelText('欄位 1 名稱'), { target: { value: '自訂名稱' } });
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  fireEvent.click(screen.getByRole('button', { name: /01 流程畫布/ }));
  fireEvent.click(screen.getByRole('button', { name: '檢驗' }));
  expect((screen.getByLabelText('欄位 1 名稱') as HTMLInputElement).value).toBe('自訂名稱');
  expect((screen.getByLabelText('欄位 1 識別欄位') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '新增欄位' }));
  const added = screen.getByLabelText('欄位 3 名稱') as HTMLInputElement;
  expect(document.activeElement).toBe(added);
  expect([added.selectionStart, added.selectionEnd]).toEqual([0, added.value.length]);
  expect(exportRecipe(initialRecipe, catalog)).not.toMatch(/PRIVATE_SAMPLE_SENTINEL|自訂名稱/);
  expect(fetch.mock.calls.filter(([url]) => url !== "/preview-api/healthz")).toEqual([]); expect(xhr).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
});
test('A20/D23: incomplete and unassigned forms block confirmation and name the form', () => {
  render(<App />); openFlow(); startLogic();
  addTool('業務節點');
  wireChain(['業務節點']);
  fireEvent.click(screen.getByRole('button', { name: '業務節點' }));
  fireEvent.click(screen.getByRole('button', { name: '新增空白表單' }));
  expect(document.getElementById('step-status')!.textContent).toContain('表單「新表單 1」尚未完成：尚未建立欄位');
  fireEvent.click(screen.getByRole('button', { name: '新增欄位' }));
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(false);
  // Imported drafts can contain an unassigned form; it must remain visible as an error (no silent removal).
  const value = { format: 'composer-aov-list', version: 4, rootGraphId: 'root', graphs: [{ id: 'root', name: '主流程', nodes: [{ id: 'n', name: '收料', when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null }], edges: [] }], layout: {}, forms: [{ id: 'f', name: '待指派表單', fields: [{ id: 'field-1', name: '批號', type: 'text', required: true, isKey: false }] }], relations: [] };
  fireEvent.click(screen.getByText('匯入流程規格')); fireEvent.click(screen.getByText('進階：貼上流程 JSON'));
  fireEvent.change(screen.getByLabelText('流程 JSON'), { target: { value: JSON.stringify(value) } });
  fireEvent.click(screen.getByRole('button', { name: '匯入流程 JSON' }));
  expect(document.getElementById('step-status')!.textContent).toContain('表單「待指派表單」尚未指派給任何節點');
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(true);
});
