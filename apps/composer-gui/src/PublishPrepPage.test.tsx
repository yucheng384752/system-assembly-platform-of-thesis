// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { emptyProjectDetails, type ProjectDetails } from '../../../libs/aov-integration/projectDetails';
import { emptyFormLibrary } from '../../../libs/aov-integration/formLibrary';
import { PublishPrepPage } from './PublishPrepPage';
import { emptyGraph, type AovGraphDocument, type GraphNode } from './workflowGraph';

const saved = vi.hoisted(() => vi.fn());
vi.mock('./fileTransfer', () => ({ downloadJson: saved, downloadBlob: vi.fn() }));
beforeEach(() => saved.mockReset());
afterEach(cleanup);

const node = (id: string, name: string): GraphNode => ({ id, kind: 'node', name, when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null });
const graph: AovGraphDocument = {
  ...emptyGraph,
  factories: [{ id: 'f1', name: '岱暉', logicGraphIds: ['g1'] }],
  graphs: [{ id: 'g1', name: '錫棒入庫', nodes: [node('n1', '領料'), node('n2', '入庫')], edges: [{ id: 'e1', from: 'n1', to: 'n2' }] }],
};
const details: ProjectDetails = {
  ...emptyProjectDetails,
  materials: [{ key: 'ingot', name: '原料錫錠', dimension: 'mass', baseUnit: 'kg' }],
  nodes: { n1: { kind: 'pick', location: 'wh.raw', material: 'ingot' }, n2: { kind: 'sink', direction: 'stock-in', location: 'wh.fg', material: 'ingot' } },
};
const fill = () => {
  fireEvent.change(screen.getByLabelText('生產邏輯'), { target: { value: 'f1/g1' } });
  fireEvent.change(screen.getByLabelText(/專案識別碼/), { target: { value: 'tin-bar' } });
};
const generate = async () => { fireEvent.click(screen.getByRole('button', { name: '產生計畫' })); await waitFor(() => expect(screen.getByRole('status').textContent).not.toContain('按「產生計畫」後')); };

test('還沒有工廠時提示先建立，產生按鈕不出現', () => {
  render(<PublishPrepPage graph={emptyGraph} details={emptyProjectDetails} forms={emptyFormLibrary} />);
  expect(screen.getByText('請先在「流程畫布」建立工廠與生產邏輯。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '產生計畫' })).toBeNull();
});

test('選了生產邏輯才能產生；專案名稱預設為生產邏輯名稱', () => {
  render(<PublishPrepPage graph={graph} details={details} forms={emptyFormLibrary} />);
  expect((screen.getByRole('button', { name: '產生計畫' }) as HTMLButtonElement).disabled).toBe(true);
  fill();
  expect((screen.getByLabelText('專案名稱') as HTMLInputElement).value).toBe('錫棒入庫');
  expect((screen.getByRole('button', { name: '產生計畫' }) as HTMLButtonElement).disabled).toBe(false);
});

test('產生後說明節點數與不可執行的節點及原因，並提供計畫檔下載；沒有表單就沒有表單檔包按鈕', async () => {
  render(<PublishPrepPage graph={graph} details={details} forms={emptyFormLibrary} />);
  fill(); await generate();
  const status = screen.getByRole('status');
  expect(status.textContent).toContain('計畫已產生：共 2 個節點，0 張表單。');
  expect(status.textContent).toContain('有 2 個節點目前不可執行，工廠端無法據此開工');
  expect(within(status).getByText(/^領料：/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /下載表單檔包/ })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /下載計畫檔/ }));
  expect(saved).toHaveBeenCalledTimes(1);
  const [text, name] = saved.mock.calls[0];
  const plan = JSON.parse(text);
  expect(plan.format).toBe('composer-executable-plan');
  expect(name).toBe(`tin-bar-v1-${plan.planId.slice(0, 12)}.plan.json`);
});

test('問題以業務語言列出，不產生可下載的檔案', async () => {
  render(<PublishPrepPage graph={graph} details={{ ...details, nodes: { n1: details.nodes.n1 } }} forms={emptyFormLibrary} />);
  fill(); await generate();
  expect(screen.getByRole('status').textContent).toContain('節點「入庫」還沒有設定物料流類別（領料、入庫或出庫）。');
  expect(screen.queryByRole('button', { name: /下載/ })).toBeNull();
});

test('識別碼寫成中文時指出怎麼改', async () => {
  render(<PublishPrepPage graph={graph} details={details} forms={emptyFormLibrary} />);
  fill(); fireEvent.change(screen.getByLabelText(/專案識別碼/), { target: { value: '錫棒' } }); await generate();
  expect(screen.getByRole('status').textContent).toContain('專案識別碼只能用英文字母、數字、底線與連字號');
});

test('改了任何輸入，舊的結果就收起來：下載的檔案不會與畫面上的設定不一致', async () => {
  render(<PublishPrepPage graph={graph} details={details} forms={emptyFormLibrary} />);
  fill(); await generate();
  expect(screen.getByRole('button', { name: /下載計畫檔/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('版本'), { target: { value: '2' } });
  expect(screen.queryByRole('button', { name: /下載計畫檔/ })).toBeNull();
  await generate();
  fireEvent.click(screen.getByRole('button', { name: /下載計畫檔/ }));
  expect(saved.mock.calls[0][1]).toMatch(/^tin-bar-v2-/);
});
