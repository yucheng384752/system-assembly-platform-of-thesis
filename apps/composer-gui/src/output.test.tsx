// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, initialRecipe } from './App';
import { exportRecipe, importRecipe } from '../../../libs/ui-runtime/recipe';
import { validateSchema } from '../../../libs/ui-runtime/schema';
import { catalog } from './previewCatalog';
import { downloadJson } from './fileTransfer';
import { sha256Hex } from './workflow';
import { readZip } from './testZip';
import * as manual from './manual';
import siteA from '../../../config/site/examples/demo-site-a.site.json';
import siteB from '../../../config/site/examples/demo-site-b.site.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function captureDownloads(binary: Uint8Array[] = []) {
  const contents: string[] = [];
  const NativeBlob = Blob;
  vi.stubGlobal('Blob', class extends NativeBlob { constructor(parts: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    if (parts[0] instanceof Uint8Array) binary.push(parts[0]); else contents.push(parts.join(''));
  } });
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return contents;
}
function csv(name: string, text: string) {
  const file = new File([text], name); Object.defineProperty(file, 'text', { value: async () => text }); return file;
}
// Two steps with one uploaded form each; the shared 批號 is a key on the upstream form.
async function buildWorkflow() {
  render(<App />);
  for (const [i, name, owner] of [[1, '收料', '倉管'], [2, '檢驗', '品管']] as const) {
    fireEvent.click(screen.getByRole('button', { name: '新增步驟' }));
    fireEvent.change(screen.getByLabelText(`步驟 ${i} 名稱`), { target: { value: name } });
    fireEvent.change(screen.getByLabelText(`步驟 ${i} 負責職務`), { target: { value: owner } });
  }
  fireEvent.click(screen.getByRole('button', { name: /02 表單/ }));
  for (const [step, file] of [['step-1', csv('收料單.csv', '批號,數量\nPRIVATE_UPLOAD_SENTINEL,3')], ['step-2', csv('檢驗單.csv', '批號,結果\nPRIVATE_UPLOAD_SENTINEL,ok')]] as const) {
    fireEvent.change(screen.getByLabelText('上傳到步驟'), { target: { value: step } });
    fireEvent.change(screen.getByLabelText('選擇 CSV / TSV（可多選）'), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByLabelText('表單名稱') as HTMLInputElement).value).toBe(file.name.replace('.csv', '')));
  }
  fireEvent.click(screen.getByRole('button', { name: /收料單/ }));
  fireEvent.click(screen.getByLabelText('欄位 1 識別欄位'));
}
test('relations: candidates need confirmation, type mismatches are refused, and the trace names step and owner (D19, A21, A23)', async () => {
  await buildWorkflow();
  fireEvent.click(screen.getByRole('button', { name: /03 表單關聯/ }));
  expect(screen.getByText('尚未確認任何關聯。')).toBeTruthy();
  // Manual relation with mismatched types (數量 integer vs 結果 text) is refused and both fields are named.
  fireEvent.change(screen.getByLabelText('上游表單'), { target: { value: 'form-1' } });
  fireEvent.change(screen.getByLabelText('上游欄位'), { target: { value: 'field-2' } });
  fireEvent.change(screen.getByLabelText('下游表單'), { target: { value: 'form-2' } });
  fireEvent.change(screen.getByLabelText('下游欄位'), { target: { value: 'field-2' } });
  fireEvent.click(screen.getByRole('button', { name: '新增關聯' }));
  expect(screen.getByRole('alert').textContent).toBe('無法建立關聯：「收料單」的「數量」（整數）與「檢驗單」的「結果」（文字）型別不同，無法作為關聯鍵。');
  expect(screen.getByText('尚未確認任何關聯。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '確認關聯 「收料單」的「批號」 → 「檢驗單」的「批號」' }));
  expect(screen.getByText('系統推測，已確認')).toBeTruthy();
  expect(screen.getByText('目前沒有候選關聯。', { exact: false })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('表單'), { target: { value: 'form-2' } });
  expect(screen.getByText('收料單（收料・倉管），以「批號」相連')).toBeTruthy();
  // The relation drives a fixed-rule suggestion that the user applies; tracing brings table management (D26).
  fireEvent.click(screen.getByRole('button', { name: /04 功能選配/ }));
  expect((screen.getByRole('checkbox', { name: '查詢追溯' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '加入「查詢追溯」' }));
  expect((screen.getByRole('checkbox', { name: '查詢追溯' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: '通用表格管理' }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole('button', { name: '加入「查詢追溯」' })).toBeNull();
});
test('A22, A15: downloads validate, carry no rows, the Recipe checksum matches the Workflow bytes, and the package packs the same files', async () => {
  const zips: Uint8Array[] = []; const contents = captureDownloads(zips); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const storage = vi.spyOn(Storage.prototype, 'setItem'); const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
  await buildWorkflow();
  fireEvent.click(screen.getByRole('button', { name: /03 表單關聯/ }));
  fireEvent.click(screen.getByRole('button', { name: /^確認關聯/ }));
  fireEvent.click(screen.getByRole('button', { name: /05 輸出/ }));
  // D52: draft manuals are included, and their status must be readable before the download.
  expect(document.getElementById('manual-status')?.textContent).toContain('手冊齊全');
  expect(document.getElementById('manual-status')?.textContent).toContain('含草稿內容');
  expect((screen.getByRole('button', { name: '下載設定交付包' }) as HTMLButtonElement).disabled).toBe(true);
  // Output cannot be confirmed until the required client name is filled (G05).
  expect((screen.getByRole('button', { name: '確認本步驟' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('客戶代稱'), { target: { value: '示範客戶' } });
  expect((screen.getByRole('button', { name: '確認本步驟' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '下載流程規格' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '下載系統設定檔' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '下載系統設定檔' }));
  expect(contents).toHaveLength(2);
  const workflow = JSON.parse(contents[0]); const recipe = JSON.parse(contents[1]);
  validateSchema('aov', workflow); validateSchema('recipe', recipe);
  expect(workflow.relations).toHaveLength(1);
  expect(workflow.forms.map((f: { name: string }) => f.name)).toEqual(['收料單', '檢驗單']);
  expect(recipe.clientName).toBe('示範客戶');
  expect(recipe.workflowRef).toEqual({ path: 'workflow.aov.json', sha256: await sha256Hex(contents[0]) });
  expect(contents.join()).not.toMatch(/PRIVATE_UPLOAD_SENTINEL|password|token|tableData/);
  expect(contents[1]).not.toContain('steps');
  fireEvent.click(screen.getByRole('button', { name: '下載設定交付包' }));
  await waitFor(() => expect(zips).toHaveLength(1));
  expect(screen.getByText(/^已下載 my-system-delivery-[0-9a-f]{12}\.zip/)).toBeTruthy();
  const packed = Object.fromEntries(readZip(zips[0]).map(e => [e.path, new TextDecoder().decode(e.data)]));
  expect(packed['aov/workflow.aov.json']).toBe(contents[0]);
  expect(packed['config/system.recipe.json']).toBe(contents[1]);
  for (const role of manual.manualRoles) expect(packed[`docs/manual-${role}.md`]).toContain('本手冊含草稿內容，尚未經審閱');
  expect(packed['docs/manual-user.md']).toContain('操作順序：上傳頁 → 匯入工作頁 → 錯誤檢視頁');
  expect(Object.values(packed).join()).not.toMatch(/PRIVATE_UPLOAD_SENTINEL/);
  expect(fetch).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
});

// D34: missing manual text must name the feature and role without disabling an otherwise valid download.
test('missing manual status names the feature and role while configuration delivery stays available', async () => {
  const fragments = manual.loadFragments();
  const kit = catalog.kits.find(k => k.id === initialRecipe.enabledKits[0])!;
  delete fragments[manual.fragmentPath(kit, 'user')];
  vi.spyOn(manual, 'loadFragments').mockReturnValue(fragments);
  const zips: Uint8Array[] = []; captureDownloads(zips);
  await buildWorkflow();
  fireEvent.click(screen.getByRole('button', { name: /05 輸出/ }));
  const status = document.getElementById('manual-status')!;
  expect(status.getAttribute('role')).toBe('status');
  expect(status.textContent).toContain(`${kit.displayName}（一般使用者）`);
  expect(status.textContent).toContain('仍可下載設定');
  expect(status.textContent).not.toContain(kit.id);
  fireEvent.change(screen.getByLabelText('客戶代稱'), { target: { value: '示範客戶' } });
  const button = screen.getByRole('button', { name: '下載設定交付包' }) as HTMLButtonElement;
  expect(button.getAttribute('aria-describedby')).toContain('manual-status');
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(zips).toHaveLength(1));
  expect(readZip(zips[0]).some(file => file.path.startsWith('docs/'))).toBe(false);
});
test('an incomplete Workflow blocks every download and says why', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /05 輸出/ }));
  fireEvent.change(screen.getByLabelText('客戶代稱'), { target: { value: '示範客戶' } });
  expect(screen.getByRole('alert').textContent).toContain('請至少建立一個流程步驟');
  expect((screen.getByRole('button', { name: '下載流程規格' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '下載系統設定檔' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '下載設定交付包' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById('step-status')!.textContent).toContain('流程規格尚未完成');
});
test('Recipe file import is atomic and restores flow selection and editor settings', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /04 功能選配/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: '查詢追溯' }));
  fireEvent.click(screen.getByRole('tab', { name: '查詢與追溯' }));
  fireEvent.change(screen.getByLabelText('批號的名稱'), { target: { value: '保留中的欄位' } });
  fireEvent.click(screen.getByRole('button', { name: /05 輸出/ }));
  const input = screen.getByLabelText('選擇 JSON 檔案');
  const invalid = new File(['{}'], 'invalid.json'); Object.defineProperty(invalid, 'text', { value: async () => '{}' });
  fireEvent.change(input, { target: { files: [invalid] } });
  await waitFor(() => expect(document.getElementById('recipe-error')!.textContent).toContain('原設定已保留'));
  fireEvent.click(screen.getByRole('button', { name: /04 功能選配/ }));
  fireEvent.click(screen.getByRole('tab', { name: '查詢與追溯' }));
  expect(screen.getByRole('columnheader', { name: '保留中的欄位' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /05 輸出/ }));
  const good = new File([''], 'valid.json');
  Object.defineProperty(good, 'text', { value: async () => exportRecipe({ ...initialRecipe, clientName: '匯入客戶' }, catalog) });
  fireEvent.change(screen.getByLabelText('選擇 JSON 檔案'), { target: { files: [good] } });
  await waitFor(() => expect((screen.getByLabelText('客戶代稱') as HTMLInputElement).value).toBe('匯入客戶'));
  fireEvent.click(screen.getByRole('button', { name: /04 功能選配/ }));
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

// A09/D60 integration: real import -> locked preview -> exact package bytes, replace Site, then remove it.
test('場域 A／B 匯入、預覽及交付包使用同一份設定，移除後還原使用者值', async () => {
  const zips: Uint8Array[] = []; const contents = captureDownloads(zips);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
  await buildWorkflow();
  const page = (number: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${number} `) }));
  page('04'); fireEvent.click(screen.getByRole('tab', { name: '檔案上傳與驗證' }));
  fireEvent.change(screen.getByLabelText('資料列的欄寬'), { target: { value: '210' } });
  page('05'); fireEvent.change(screen.getByLabelText('客戶代稱'), { target: { value: '模擬客戶' } });
  for (const [index, site] of [siteA, siteB].entries()) {
    const text = ` ${JSON.stringify(site, null, 3)}\r\n`;
    fireEvent.change(screen.getByLabelText('匯入場域設定'), { target: { files: [csv('mock.site.json', `\uFEFF${text}`)] } });
    await screen.findByText(`目前場域：${site.displayName}，版本 1.0.0`);
    page('04'); fireEvent.click(screen.getByRole('tab', { name: '檔案上傳與驗證' }));
    const key = 'upload-validation-kit::csv-excel-error-summary';
    const width = screen.getByLabelText('資料列的欄寬') as HTMLInputElement;
    expect(width.disabled).toBe(true);
    expect(width.value).toBe(String(site.optionOverrides[key]['row-width']));
    expect(document.getElementById(`${width.id}-site`)?.textContent).toContain(`最大 ${site.optionLimits[key]['row-width'].maximum}`);
    expect(screen.getByRole('columnheader', { name: site.optionOverrides[key]['row-label'] }).style.width).toBe(`${width.value}px`);
    page('05');
    await waitFor(() => expect((screen.getByRole('button', { name: '下載設定交付包' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '下載系統設定檔' }));
    fireEvent.click(screen.getByRole('button', { name: '下載設定交付包' }));
    await waitFor(() => expect(zips).toHaveLength(index + 1));
    const files = Object.fromEntries(readZip(zips[index]).map(e => [e.path, new TextDecoder().decode(e.data)]));
    expect(files['config/site/site.profile.json']).toBe(text);
    const recipe = JSON.parse(files['config/system.recipe.json']);
    expect(files['config/system.recipe.json']).toBe(contents[index]);
    expect(recipe.siteRef).toEqual({ path: 'site.profile.json', sha256: await sha256Hex(text) });
    // Recipe preserves the user's lower layer; Site stays in its own declared artifact.
    expect(recipe.selectedSubfeatureOptions[key]['row-width']).toBe(210);
  }
  expect(zips[0]).not.toEqual(zips[1]);
  fireEvent.click(screen.getByRole('button', { name: '移除場域' }));
  page('04'); fireEvent.click(screen.getByRole('tab', { name: '檔案上傳與驗證' }));
  expect((screen.getByLabelText('資料列的欄寬') as HTMLInputElement).value).toBe('210');
  expect((screen.getByLabelText('資料列的欄寬') as HTMLInputElement).disabled).toBe(false);
  page('05');
  await waitFor(() => expect((screen.getByRole('button', { name: '下載設定交付包' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '下載設定交付包' }));
  await waitFor(() => expect(zips).toHaveLength(3));
  const removed = Object.fromEntries(readZip(zips[2]).map(e => [e.path, new TextDecoder().decode(e.data)]));
  expect(removed['config/site/site.profile.json']).toBeUndefined();
  expect(JSON.parse(removed['config/system.recipe.json']).siteRef).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
});
