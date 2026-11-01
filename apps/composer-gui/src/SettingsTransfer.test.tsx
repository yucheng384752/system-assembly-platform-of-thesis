// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { exportFormLibrary, type FormLibrary } from '../../../libs/aov-integration/formLibrary';
import { emptyProjectDetails, exportProjectDetails, type ProjectDetails } from '../../../libs/aov-integration/projectDetails';
import { initialRecipe } from './App';
import { OutputPage } from './OutputPage';
import { SettingsTransfer } from './SettingsTransfer';
import { exportAovGraph, listToGraph } from './workflowGraph';
import type { AovDocument } from './workflow';
import { readZip } from './testZip';

const saved = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock('./fileTransfer', async importOriginal => ({ ...(await importOriginal<typeof import('./fileTransfer')>()), downloadJson: saved.json }));
// The package is a Blob of one Uint8Array; keep those bytes so the zip can be opened.
const zips: Uint8Array[] = [];
beforeEach(() => {
  saved.json.mockReset(); zips.length = 0;
  const NativeBlob = Blob;
  vi.stubGlobal('Blob', class extends NativeBlob { constructor(parts: BlobPart[], options?: BlobPropertyBag) { super(parts, options); if (parts[0] instanceof Uint8Array) zips.push(parts[0]); } });
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const details: ProjectDetails = { ...emptyProjectDetails, materials: [{ key: 'ingot', name: '原料錫錠', dimension: 'mass', baseUnit: 'kg' }], nodes: { n1: { kind: 'pick', location: 'wh.raw', material: 'ingot' } } };
const library: FormLibrary = { format: 'composer-form-library', version: 1, forms: [{ id: 'slip', name: '入庫單', subject: ['lot.ingot'], fields: { lot: { type: 'string' } } }] };
const file = (name: string, text: string) => { const f = new File([text], name); Object.defineProperty(f, 'text', { value: async () => text }); return f; };

function Harness({ onDetails = () => {}, onForms = () => {} }: { onDetails?: (d: ProjectDetails) => void; onForms?: (f: FormLibrary) => void }) {
  return <SettingsTransfer details={details} forms={library} onDetailsImport={onDetails} onFormsImport={onForms} />;
}

test('下載的就是交付包裡的那兩份檔案內容', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: /下載節點細項/ }));
  fireEvent.click(screen.getByRole('button', { name: /下載表單庫/ }));
  expect(saved.json.mock.calls).toEqual([[exportProjectDetails(details), 'project-details.json'], [exportFormLibrary(library), 'form-library.json']]);
});

test('載入完整的檔案才取代；有問題的檔案整份不載入，列出原因並保留目前內容', async () => {
  const onDetails = vi.fn(), onForms = vi.fn();
  render(<Harness onDetails={onDetails} onForms={onForms} />);
  fireEvent.change(screen.getByLabelText('載入節點細項'), { target: { files: [file('x.json', exportProjectDetails({ ...details, materials: [] }))] } });
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('節點細項沒有載入，目前的內容已保留');
  expect(alert.textContent).toContain('選擇的物料型別不存在');
  expect(onDetails).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('載入表單庫'), { target: { files: [file('forms.json', exportFormLibrary(library))] } });
  await waitFor(() => expect(onForms).toHaveBeenCalledWith(library));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('表單庫已載入，取代目前的內容。')).toBeTruthy();
});

test('不是 JSON 檔案或內容壞掉都回報，不丟例外', async () => {
  const onForms = vi.fn();
  render(<Harness onForms={onForms} />);
  fireEvent.change(screen.getByLabelText('載入表單庫'), { target: { files: [file('forms.txt', '{}')] } });
  expect((await screen.findByRole('alert')).textContent).toContain('請選擇 JSON 設定檔。');
  fireEvent.change(screen.getByLabelText('載入表單庫'), { target: { files: [file('forms.json', '{oops')] } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('表單庫檔案必須是有效的 JSON。'));
  expect(onForms).not.toHaveBeenCalled();
});

const legacy: AovDocument = {
  format: 'composer-aov-list', version: 3,
  steps: [{ id: 'step-1', name: '收料', when: '', owner: '倉管', formIds: ['form-1'], actions: [] }],
  forms: [{ id: 'form-1', name: '收料單', fields: [{ id: 'field-1', name: '批號', type: 'text', required: true, isKey: true }] }],
  relations: [],
};
const outputPage = (over: { details?: ProjectDetails; forms?: FormLibrary } = {}) => <OutputPage recipe={{ ...initialRecipe, clientName: '示範客戶' }} workflow={listToGraph(legacy).value} selectedFlows={[]}
  onChange={() => {}} onImport={() => {}} details={over.details ?? emptyProjectDetails} forms={over.forms ?? { format: 'composer-form-library', version: 1, forms: [] }} onDetailsImport={() => {}} onFormsImport={() => {}} />;
const download = async () => {
  const button = screen.getByRole('button', { name: /下載設定交付包/ }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
};

test('輸出頁：有節點細項與表單庫時打包進交付包，並出現在「進階」的個別檔案區', async () => {
  render(outputPage({ details, forms: library }));
  fireEvent.click(screen.getByRole('button', { name: '進階：個別檔案與載入設定' }));
  expect(within(screen.getByLabelText('個別檔案與載入設定')).getByRole('button', { name: /下載表單庫/ })).toBeTruthy();
  await download();
  await waitFor(() => expect(zips).toHaveLength(1));
  const files = Object.fromEntries(readZip(zips[0]).map(e => [e.path, new TextDecoder().decode(e.data)]));
  expect(files['aov/project-details.json']).toBe(exportProjectDetails(details));
  expect(files['aov/form-library.json']).toBe(exportFormLibrary(library));
});

test('輸出頁：節點細項填到一半時擋下交付包並說明，不是產生缺一塊的包', async () => {
  const half = { ...details, nodes: { n1: { kind: 'sink' as const, direction: '' as const, location: '', material: '' } } };
  render(outputPage({ details: half }));
  await download();
  expect((await screen.findByText(/節點細項尚未填完：.*尚未選擇入庫或出庫的方向/))).toBeTruthy();
  expect(zips).toHaveLength(0);
});

test('輸出頁：沒有細項與表單庫時交付包不含這兩個檔案', async () => {
  render(outputPage());
  await download();
  await waitFor(() => expect(zips).toHaveLength(1));
  const paths = readZip(zips[0]).map(e => e.path);
  expect(paths).not.toContain('aov/project-details.json');
  expect(paths).not.toContain('aov/form-library.json');
});
