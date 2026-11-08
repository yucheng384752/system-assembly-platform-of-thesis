// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './AovCanvasApp';
import * as transfer from './fileTransfer';
import { emptyGraph, exportAovGraph } from './workflowGraph';
import { loadExample } from './exampleHints';
import { startLogic } from './testNav';
import { readFileSync } from 'node:fs';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
async function importFile(text: string) {
  const toggle = screen.getByRole('button', { name: '匯入流程規格' });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  const file = new File([text], 'flow.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  fireEvent.change(screen.getByLabelText('選擇流程規格檔'), { target: { files: [file] } });
  await waitFor(() => expect((screen.getByLabelText('選擇流程規格檔') as HTMLInputElement).disabled).toBe(false));
}

test('standalone title, controls, empty factory screen and live canvas render', () => {
  render(<App />);
  expect(screen.getByRole('heading', { level: 1, name: 'AoV 畫布' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '匯入流程規格' }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('button', { name: '下載流程規格' }).classList.contains('primary')).toBe(true);
  expect(screen.getByText('關閉或重新整理前請先下載流程規格')).toBeTruthy();
  expect(screen.getByLabelText('工廠名稱')).toBeTruthy();
  startLogic();
  expect(screen.getByRole('heading', { name: '工具箱' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '開始' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '結束' })).toBeTruthy();
});

test('exported file imports into the real canvas and downloads identical content', async () => {
  const download = vi.spyOn(transfer, 'downloadJson').mockImplementation(() => {});
  const value = loadExample(emptyGraph);
  const text = exportAovGraph(value);
  render(<App />);
  startLogic('舊工廠');
  await importFile(text);
  await waitFor(() => expect(screen.getByText('流程匯入成功，已替換流程、表單與關聯。').closest('[role="status"]')).toBeTruthy());
  expect(screen.queryByDisplayValue('舊工廠')).toBeNull();
  expect(screen.getByDisplayValue(value.factories[0].name)).toBeTruthy();
  click(new RegExp(`^開啟：${value.graphs[0].name}`));
  for (const node of value.graphs[0].nodes) expect(screen.getByRole('button', { name: node.name })).toBeTruthy();
  click('下載流程規格');
  expect(download).toHaveBeenCalledExactlyOnceWith(text, 'aov-flow.json');
  expect(JSON.parse(download.mock.calls[0][0])).toEqual(value);
  expect(screen.getByText('已下載流程規格').getAttribute('role')).toBe('status');
});

test('bad format alerts and keeps the current flow and open canvas', async () => {
  const download = vi.spyOn(transfer, 'downloadJson').mockImplementation(() => {});
  const value = loadExample(emptyGraph);
  const text = exportAovGraph(value);
  render(<App />);
  await importFile(text);
  await waitFor(() => expect(screen.getByDisplayValue(value.factories[0].name)).toBeTruthy());
  click(new RegExp(`^開啟：${value.graphs[0].name}`));
  await importFile('{"format":"unrecognized"}');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('無法辨識的檔案格式。原流程已保留。'));
  expect(screen.getByRole('button', { name: '開始' })).toBeTruthy();
  click('下載流程規格');
  expect(download).toHaveBeenCalledExactlyOnceWith(text, 'aov-flow.json');
});

test('incomplete flow keeps download enabled but blocks the file with an alert', () => {
  const download = vi.spyOn(transfer, 'downloadJson').mockImplementation(() => {});
  render(<App />);
  expect((screen.getByRole('button', { name: '下載流程規格' }) as HTMLButtonElement).disabled).toBe(false);
  click('下載流程規格');
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('流程規格尚未完成：請先建立工廠與生產邏輯。');
  startLogic();
  click('下載流程規格');
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('尚未建立節點');
});

test('remount clears flow data without writing browser storage', async () => {
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const view = render(<App />);
  await importFile(exportAovGraph(loadExample(emptyGraph)));
  await waitFor(() => expect(screen.getByText('流程匯入成功，已替換流程、表單與關聯。')).toBeTruthy());
  expect(write).not.toHaveBeenCalled();
  view.unmount();
  render(<App />);
  expect((screen.getByLabelText('工廠名稱') as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('button', { name: /^開啟：/ })).toBeNull();
});

// jsdom has no layout, so a collapsed canvas is invisible to the render tests above. React Flow sizes itself from 100% of its
// parent, so the canvas needs a definite height: "height: auto" made it zero tall and the nodes were never drawn (found in Chrome).
test('the standalone page never gives the canvas an automatic height', () => {
  const css = readFileSync(`${import.meta.dirname}/style.css`, 'utf8');
  const rules = [...css.matchAll(/([^{}]*\.aov-standalone[^{}]*\.workflow-canvas\b[^{}]*)\{([^}]*)\}/g)];
  for (const [, , body] of rules) expect(body).not.toMatch(/(^|;)\s*height\s*:\s*auto/);
  expect(css).toContain('.workflow-canvas { height: 70vh; min-height: 28rem;');
});
