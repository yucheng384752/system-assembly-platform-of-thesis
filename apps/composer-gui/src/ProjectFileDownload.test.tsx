// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectFileDownload } from './ProjectFileDownload';
import { PublishPrepPage } from './PublishPrepPage';
import { App as Standalone } from './AovCanvasApp';
import { App as Composer } from './App';
import { example, projectFixture } from './roundTrip.fixture';
import { preparePlan } from '../../../libs/aov-integration/publishPrep';
import * as transfer from './fileTransfer';
import * as canvas from './WorkflowCanvas';
import * as nodeDetails from './NodeDetailsStep';
import { caseStoreClient } from './caseStoreClient';
import { openFlow } from './testNav';
import { emptyGraph } from './workflowGraph';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const fields = () => within(screen.getByRole('region', { name: '專案檔' }));
function fill(key = 'g/g') {
  fireEvent.change(fields().getByLabelText('生產邏輯'), { target: { value: key } });
  fireEvent.change(fields().getByLabelText(/專案識別碼/), { target: { value: 'sample' } });
}
async function download() {
  fireEvent.click(fields().getByRole('button', { name: '下載專案檔' }));
  await waitFor(() => expect((fields().getByRole('button', { name: '下載專案檔' }) as HTMLButtonElement).disabled).toBe(false));
}

test.each([ProjectFileDownload, PublishPrepPage])('下載元件及發布頁下載正確檔名與完整內容', async Component => {
  const saved = vi.spyOn(transfer, 'downloadJson').mockImplementation(() => {});
  render(<Component {...example()} />); fill(); await download();
  const expected = projectFixture(); expected.meta = { id: 'sample', name: '測試流程', version: 1, status: 'published' };
  expect(saved).toHaveBeenCalledExactlyOnceWith(JSON.stringify(expected, null, 2) + '\n', 'sample.aov-project.json');
  expect(fields().getByRole('status').textContent).toBe('已下載專案檔');
});

test.each([['版本', '0'], ['版本', '1.5'], ['專案名稱', '  '], ['專案識別碼', '錯誤']])('欄位 %s=%s 與 preparePlan 的驗證相同', async (label, value) => {
  const saved = vi.spyOn(transfer, 'downloadJson').mockImplementation(() => {});
  const data = example(); render(<ProjectFileDownload {...data} />); fill();
  fireEvent.change(fields().getByLabelText(new RegExp(label)), { target: { value } });
  const expected = await preparePlan({ doc: data.graph, details: data.details, forms: data.forms, factoryId: 'g', graphId: 'g', projectId: label === '專案識別碼' ? value : 'sample', projectName: label === '專案名稱' ? value : '測試流程', version: label === '版本' ? Number(value) : 1 });
  await download();
  expect(expected.ok).toBe(false);
  if (expected.ok) throw new Error('expected validation failure');
  expect(fields().getByRole('alert').textContent).toBe(expected.issues.map(i => i.message).join(''));
  expect(saved).not.toHaveBeenCalled();
});

test('轉換失敗逐項顯示原因，不下載', async () => {
  const saved = vi.spyOn(transfer, 'downloadJson').mockImplementation(() => {});
  const data = example(); data.details.nodes = {};
  render(<ProjectFileDownload {...data} />); fill(); await download();
  expect(within(fields().getByRole('alert')).getAllByRole('listitem')).toHaveLength(7);
  expect(fields().getByRole('alert').textContent).toContain('節點「填單」');
  expect(saved).not.toHaveBeenCalled();
});

test('沒有流程時說明並停用', () => {
  render(<ProjectFileDownload {...example()} graph={emptyGraph} />);
  expect(fields().getByText('請先建立工廠與生產邏輯')).toBeTruthy();
  expect((fields().getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});

test('細項驗證用節點名稱；修正輸入後清除舊訊息；下載例外不洩漏路徑', async () => {
  const saved = vi.spyOn(transfer, 'downloadJson').mockImplementation(() => { throw new Error('private/path'); });
  const data = example();
  data.details.nodes.n0 = { kind: 'pick', material: 'tin', location: '' };
  const { rerender } = render(<ProjectFileDownload {...data} />); fill(); await download();
  expect(fields().getByRole('alert').textContent).toContain('節點「領料」');
  expect(fields().getByRole('alert').textContent).not.toContain('n0');
  expect(saved).not.toHaveBeenCalled();
  fireEvent.change(fields().getByLabelText('專案名稱'), { target: { value: '新名稱' } });
  expect(fields().queryByRole('alert')).toBeNull();
  rerender(<ProjectFileDownload {...example()} />); await download();
  expect(saved).toHaveBeenCalledTimes(1);
  expect(fields().getByRole('alert').textContent).toBe('專案檔無法下載，請確認設定後再試。');
  expect(fields().queryByRole('status')).toBeNull();
});

test.each([['獨立畫布', Standalone], ['主程式', Composer]] as const)('%s 成功匯入三種狀態，壞檔全部保留原狀', async (kind, Component) => {
  vi.spyOn(caseStoreClient, 'lifecycle').mockResolvedValue({ ok: false, errors: [] });
  const Canvas = canvas.WorkflowCanvas, Details = nodeDetails.NodeDetailsStep;
  const graphs = vi.spyOn(canvas, 'WorkflowCanvas').mockImplementation(p => <Canvas {...p} />);
  const details = vi.spyOn(nodeDetails, 'NodeDetailsStep').mockImplementation(p => <Details {...p} />);
  const saved = vi.spyOn(transfer, 'downloadJson').mockImplementation(() => {});
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(<Component />); if (kind === '主程式') openFlow();
  fireEvent.click(screen.getByRole('button', { name: '匯入流程規格' }));
  const input = (value: unknown) => {
    const toggle = screen.getByRole('button', { name: '匯入流程規格' });
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('流程 JSON'), { target: { value: JSON.stringify(value) } });
    fireEvent.click(screen.getByRole('button', { name: '匯入流程 JSON' }));
  };
  input(projectFixture());
  const graph = graphs.mock.calls.at(-1)![0].value;
  if (kind === '主程式') fireEvent.click(screen.getByRole('button', { name: /^02 節點細項/ }));
  const before = details.mock.calls.at(-1)![0];
  expect(before.details.nodes.n1).toMatchObject({ kind: 'fill', form: 'slip', requires: {} });
  expect(before.forms.forms[0].name).toBe('紀錄單');
  if (kind === '主程式') fireEvent.click(screen.getByRole('button', { name: /^01 流程畫布/ }));
  for (const bad of [
    { formatVersion: 1, nodes: [], flows: [] },
    { ...projectFixture(), nodes: projectFixture().nodes.map(n => ({ ...n, category: 'wrong' })) },
    { ...projectFixture(), flows: [{ id: 'broken', from: { node: 'n0', port: 'out' }, to: { node: 'missing', port: 'in' } }] },
    { ...projectFixture(), artifactTypes: [] },
  ]) {
    input(bad);
    expect(screen.getByRole('alert').textContent).toContain('原流程已保留。');
    expect(graphs.mock.calls.at(-1)![0].value).toBe(graph);
  }
  if (kind === '主程式') fireEvent.click(screen.getByRole('button', { name: /^02 節點細項/ }));
  const after = details.mock.calls.at(-1)![0];
  expect(after.details).toBe(before.details); expect(after.forms).toBe(before.forms);
  if (kind === '獨立畫布') {
    fill('project-sample/project-sample'); await download();
    expect(saved.mock.calls[0][1]).toBe('sample.aov-project.json');
    expect(JSON.parse(saved.mock.calls[0][0]).nodes).toEqual(projectFixture().nodes);
    expect(storage).not.toHaveBeenCalled();
  }
});
