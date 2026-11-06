// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { emptyFormLibrary, type FormLibrary } from '../../../libs/aov-integration/formLibrary';
import { emptyProjectDetails, type NodeBehavior, type ProjectDetails } from '../../../libs/aov-integration/projectDetails';
import { NodeDetailsStep } from './NodeDetailsStep';
import { emptyGraph, type AovGraphDocument, type GraphNode } from './workflowGraph';
afterEach(cleanup);

const node = (id: string, name: string): GraphNode => ({ id, kind: 'node', name, when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null });
const graph: AovGraphDocument = {
  ...emptyGraph,
  factories: [{ id: 'f1', name: '岱暉', logicGraphIds: ['g1'] }],
  graphs: [{ id: 'g1', name: '錫棒生產', nodes: [node('n1', '領料'), node('n2', '填單'), node('n3', '入庫')], edges: [{ id: 'a', from: 'n1', to: 'n2' }, { id: 'b', from: 'n2', to: 'n3' }] }],
};
const base: ProjectDetails = { ...emptyProjectDetails, materials: [{ key: 'ingot', name: '原料錫錠', dimension: 'mass', baseUnit: 'kg' }] };

let latest: ProjectDetails = base;
let latestForms: FormLibrary = emptyFormLibrary;
function Harness({ initial = base, library = emptyFormLibrary }: { initial?: ProjectDetails; library?: FormLibrary }) {
  const [details, setDetails] = useState(initial);
  const [forms, setForms] = useState(library);
  latest = details; latestForms = forms;
  return <NodeDetailsStep graph={graph} details={details} forms={forms} onChange={setDetails} onFormsChange={setForms} />;
}
const card = (name: string) => screen.getByRole('group', { name });
const choose = (label: string, value: string, scope: HTMLElement = document.body) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
const csvFile = (name: string, text: string) => { const file = new File([text], name); Object.defineProperty(file, 'text', { value: async () => text }); return file; };
const editor = () => screen.getByRole('group', { name: /^新增表單/ });
const fieldCard = (n: number) => within(editor()).getAllByRole('group').find(g => g.querySelector('legend')?.textContent?.startsWith(`欄位 ${n}`))!;

const slipCsv = '表單名稱,入庫日期,批號,總重量\r\n入庫單,2026.05.12,LOT-0001,1001.5\r\n';
const slipLibrary: FormLibrary = { format: 'composer-form-library', version: 1, forms: [{ id: 'slip', name: '入庫單', subject: ['lot.ingot'], fields: {
  lot: { label: '批號', type: 'string' }, weight: { label: '總重量', type: 'quantity', unit: 'kg' }, note: { label: '備註', type: 'string' } } }] };

test('客戶 CSV 進表單庫：先列出要補的項目，補齊識別碼、單位與描述的對象才能儲存', async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('上傳客戶表單 CSV'), { target: { files: [csvFile('入庫單.csv', slipCsv)] } });
  await screen.findByRole('group', { name: /^新增表單/ });
  expect((within(editor()).getByLabelText('表單名稱') as HTMLInputElement).value).toBe('入庫單');
  expect(within(fieldCard(1)).getByText(/YYYY\.MM\.DD/)).toBeTruthy(); // the date layout must be confirmed, not converted
  const save = within(editor()).getByRole('button', { name: '儲存表單' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect(within(editor()).getByRole('status').textContent).toContain('欄位「入庫日期」還沒有填識別碼。');

  fireEvent.change(within(editor()).getByLabelText(/^識別碼（英文字母開頭/), { target: { value: 'stock-in-slip' } });
  fireEvent.click(within(editor()).getByLabelText('原料錫錠'));
  ['receivedOn', 'lot', 'totalWeight'].forEach((key, i) => fireEvent.change(within(fieldCard(i + 1)).getByLabelText(/^識別碼（英文，建立後/), { target: { value: key } }));
  fireEvent.change(within(fieldCard(3)).getByLabelText('型別'), { target: { value: 'quantity' } }); // a plain number was inferred; the engineer decides it is a quantity
  expect(within(editor()).getByRole('status').textContent).toContain('必須指定單位');
  fireEvent.change(within(fieldCard(3)).getByLabelText('單位'), { target: { value: 'kg' } });
  expect(save.disabled).toBe(false);
  fireEvent.click(save);

  expect(latestForms.forms).toEqual([{
    id: 'stock-in-slip', name: '入庫單', subject: ['lot.ingot'],
    fields: { receivedOn: { label: '入庫日期', type: 'datetime' }, lot: { label: '批號', type: 'string' }, totalWeight: { label: '總重量', type: 'quantity', unit: 'kg' } },
  }]);
  expect(JSON.stringify(latestForms)).not.toContain('LOT-0001'); // no data value from the CSV is kept
  expect(screen.queryByRole('group', { name: /^新增表單/ })).toBeNull();
});

test('壞掉的 CSV 逐項說明原因，不開編輯器', async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('上傳客戶表單 CSV'), { target: { files: [csvFile('壞.csv', '表單名稱,a,\r\nx,1,2\r\n')] } });
  expect((await screen.findByRole('alert')).textContent).toContain('第 3 欄沒有標題。');
  expect(screen.queryByRole('group', { name: /^新增表單/ })).toBeNull();
});

test('表單識別碼已存在時不能存成另一張', () => {
  render(<Harness library={slipLibrary} />);
  fireEvent.click(screen.getByRole('button', { name: '新增空白表單' }));
  fireEvent.change(within(editor()).getByLabelText(/^識別碼（英文字母開頭/), { target: { value: 'slip' } });
  expect(within(editor()).getByRole('status').textContent).toContain('表單識別碼「slip」已經在表單庫裡。');
});

test('填單節點：選表單、勾流程會用到的欄位，需求記下欄位當時的型別與單位', () => {
  render(<Harness library={slipLibrary} />);
  choose('物料流類別', 'fill', card('填單'));
  expect(latest.nodes.n2).toEqual({ kind: 'fill', material: '', form: '', requires: {} });
  choose('物料型別', 'ingot', card('填單'));
  choose('表單', 'slip', card('填單'));
  fireEvent.click(within(card('填單')).getByLabelText('總重量'));
  fireEvent.click(within(card('填單')).getByLabelText('批號'));
  expect(latest.nodes.n2).toEqual({ kind: 'fill', material: 'ingot', form: 'slip', requires: { weight: { type: 'quantity', unit: 'kg' }, lot: { type: 'string' } } });
  fireEvent.click(within(card('填單')).getByLabelText('批號'));
  expect(Object.keys((latest.nodes.n2 as { requires: object }).requires)).toEqual(['weight']);
  expect(within(card('填單')).queryByLabelText('倉位代碼')).toBeNull(); // a fill step has no warehouse of its own
  choose('表單', '', card('填單'));
  expect((latest.nodes.n2 as { requires: object }).requires).toEqual({}); // another form, another list: ticks never carry over
});

test('被填單節點使用的表單不能移除；改掉需要的欄位後，右側立刻指出流程不再成立', () => {
  const nodes: Record<string, NodeBehavior> = {
    n1: { kind: 'pick', location: 'wh.raw', material: 'ingot' }, n3: { kind: 'sink', direction: 'stock-in', location: 'wh.fg', material: 'ingot' },
    n2: { kind: 'fill', material: 'ingot', form: 'slip', requires: { weight: { type: 'quantity', unit: 'kg' } } },
  };
  render(<Harness initial={{ ...base, nodes }} library={slipLibrary} />);
  expect(within(screen.getByRole('status')).getByText('可以轉成專案。')).toBeTruthy();
  const library = screen.getByRole('group', { name: '入庫單' });
  expect((within(library).getByRole('button', { name: '移除表單' }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(within(library).getByRole('button', { name: '編輯表單' }));
  const edit = screen.getByRole('group', { name: /^編輯表單/ });
  const weight = within(edit).getAllByRole('group').find(g => g.querySelector('legend')?.textContent?.includes('總重量'))!;
  fireEvent.change(within(weight).getByLabelText('單位'), { target: { value: 'g' } });
  fireEvent.click(within(edit).getByRole('button', { name: '儲存表單' }));
  expect(within(screen.getByRole('status')).getByText(/單位是「g」，流程需要「kg」/)).toBeTruthy();
});
