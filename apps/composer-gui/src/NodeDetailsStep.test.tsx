// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { emptyFormLibrary, type FormLibrary } from '../../../libs/aov-integration/formLibrary';
import { emptyProjectDetails, type ProjectDetails } from '../../../libs/aov-integration/projectDetails';
import { App } from './App';
import { NodeDetailsStep, nodeDetailsError } from './NodeDetailsStep';
import { openFlow } from './testNav';
import { emptyGraph, type AovGraphDocument, type GraphNode } from './workflowGraph';
afterEach(cleanup);

const node = (id: string, name: string, kind: GraphNode['kind'] = 'node'): GraphNode =>
  ({ id, kind, name, when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null });
const graph: AovGraphDocument = {
  ...emptyGraph,
  factories: [{ id: 'f1', name: '岱暉', logicGraphIds: ['g1'] }],
  graphs: [{ id: 'g1', name: '錫棒生產', nodes: [node('s', '開始', 'start'), node('n1', '領料'), node('n2', '入庫'), node('n3', '加工'), node('e', '結束', 'end')], edges: [] }],
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

test('只列出最上層的一般節點：開始與結束是畫布裝飾，不需要設定', () => {
  render(<Harness />);
  expect(screen.getAllByRole('group').map(g => g.querySelector('legend')?.textContent)).toEqual(expect.arrayContaining(['領料', '入庫', '加工']));
  expect(screen.queryByRole('group', { name: '開始' })).toBeNull();
  expect(screen.queryByRole('group', { name: '結束' })).toBeNull();
});

test('領料只問倉位與物料；入庫或出庫多問方向，切換類別時保留已填的倉位與物料', () => {
  render(<Harness />);
  choose('物料流類別', 'pick', card('領料'));
  expect(within(card('領料')).queryByLabelText('方向')).toBeNull();
  choose('倉位代碼', 'wh.raw', card('領料')); choose('物料型別', 'ingot', card('領料'));
  expect(latest.nodes.n1).toEqual({ kind: 'pick', location: 'wh.raw', material: 'ingot' });

  choose('物料流類別', 'sink', card('領料'));
  expect(latest.nodes.n1).toEqual({ kind: 'sink', direction: '', location: 'wh.raw', material: 'ingot' });
  const options = within(within(card('領料')).getByLabelText('方向')).getAllByRole('option').map(o => o.textContent);
  expect(options).toEqual(['請選擇', '入庫', '出庫（給客戶）', '出庫（到外部）']);
});

test('選回「尚未設定」就移除該節點的設定', () => {
  render(<Harness initial={{ ...base, nodes: { n1: { kind: 'pick', location: 'wh.raw', material: 'ingot' } } }} />);
  choose('物料流類別', '', card('領料'));
  expect(latest.nodes).toEqual({});
});

test('填到一半的設定擋下步驟並用業務語言說明；完整後顯示可以轉成專案', () => {
  render(<Harness />);
  choose('物料流類別', 'sink', card('入庫'));
  expect(nodeDetailsError(latest)).toContain('尚未選擇入庫或出庫的方向');
  expect(within(screen.getByRole('status')).getByText(/尚有未填完的設定/)).toBeTruthy();
  choose('方向', 'stock-in', card('入庫')); choose('倉位代碼', 'wh.fg', card('入庫')); choose('物料型別', 'ingot', card('入庫'));
  expect(nodeDetailsError(latest)).toBe('');
});

test('還沒設定的節點不擋步驟（目前只支援三種），但轉成專案時被指出', () => {
  render(<Harness initial={{ ...base, nodes: { n1: { kind: 'pick', location: 'wh.raw', material: 'ingot' } } }} />);
  expect(nodeDetailsError(latest)).toBe('');
  const status = screen.getByRole('status');
  expect(within(status).getByText('尚不能轉成專案：')).toBeTruthy();
  expect(within(status).getByText('節點「入庫」還沒有設定物料流類別（領料、入庫或出庫）。')).toBeTruthy();
  expect(within(status).getByText('岱暉 / 錫棒生產')).toBeTruthy();
});

test('被節點使用的物料型別不能移除、識別碼不能改；沒被使用的可以', () => {
  render(<Harness initial={{ ...base, materials: [...base.materials, { key: 'bar', name: '錫棒', dimension: 'mass', baseUnit: 'kg' }], nodes: { n1: { kind: 'pick', location: 'wh.raw', material: 'ingot' } } }} />);
  const [first, second] = screen.getAllByRole('group').filter(g => g.querySelector('legend')?.textContent?.startsWith('物料型別'));
  expect((within(first).getByRole('button', { name: '移除物料型別' }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(first).getByLabelText(/識別碼/) as HTMLInputElement).readOnly).toBe(true);
  fireEvent.click(within(second).getByRole('button', { name: '移除物料型別' }));
  expect(latest.materials.map(m => m.key)).toEqual(['ingot']);
});

test('新增物料型別給一個不會重複的英文識別碼，名稱留白待填；換量綱時單位跟著換', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '新增物料型別' }));
  expect(latest.materials[1]).toEqual({ key: 'material2', name: '', dimension: 'mass', baseUnit: 'kg' });
  expect(nodeDetailsError(latest)).toContain('沒有名稱');
  const group = screen.getAllByRole('group').find(g => g.querySelector('legend')?.textContent === '物料型別 2')!;
  choose('量綱', 'count', group);
  expect(latest.materials[1]).toMatchObject({ dimension: 'count', baseUnit: 'pcs' });
});

test('沒有工廠時提示先建立，而不是顯示空白', () => {
  render(<NodeDetailsStep graph={emptyGraph} details={emptyProjectDetails} forms={emptyFormLibrary} onChange={() => {}} onFormsChange={() => {}} />);
  expect(screen.getByText('請先在「流程畫布」建立工廠與生產邏輯。')).toBeTruthy();
});

test('步驟條在「流程畫布」與「功能選配」之間多了「節點細項」', () => {
  render(<App />); openFlow();
  const names = screen.getAllByRole('button', { name: /^0\d / }).map(b => b.textContent?.replace(/\s+/g, ' ').trim());
  expect(names.slice(0, 3).map(n => n?.slice(0, 7))).toEqual(['01 流程畫布', '02 節點細項', '03 功能選配']);
  fireEvent.click(screen.getByRole('button', { name: /02 節點細項/ }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('節點細項');
});

test('載入了別的流程的設定：對應的節點已不在流程中時，右側列出節點識別碼', () => {
  render(<Harness initial={{ ...base, nodes: { n1: { kind: 'pick', location: 'wh.raw', material: 'ingot' }, gone: { kind: 'pick', location: 'wh.raw', material: 'ingot' } } }} />);
  expect(screen.getByText(/有 1 個設定對應的節點已不在目前的流程中（gone）/)).toBeTruthy();
});

