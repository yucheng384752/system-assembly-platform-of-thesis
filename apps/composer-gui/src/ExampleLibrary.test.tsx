// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ExampleLibrary } from './ExampleLibrary';
import { App as Standalone } from './AovCanvasApp';
import { App as Composer } from './App';
import { loadKitExamples } from './kitExamples';
import { emptyGraph } from './workflowGraph';
import { importAny } from './importAny';
import * as transfer from './fileTransfer';
import { caseStoreClient } from './caseStoreClient';
import { openFlow, startLogic } from './testNav';
import * as canvas from './WorkflowCanvas';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const examples = loadKitExamples();
const example = examples[0];
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const loadName = `載入到畫布：${example.name}`;

test('panel disclosure, state, counts, and immediate empty-canvas load of a detached copy', () => {
  const onLoad = vi.fn();
  render(<ExampleLibrary current={emptyGraph} onLoad={onLoad} examples={[example]} />);
  const toggle = screen.getByRole('button', { name: '範例庫' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.getAttribute('aria-controls')).toBe('example-library');
  expect(screen.queryByRole('button', { name: loadName })).toBeNull();
  click('範例庫');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('範例是各功能提供的參考流程，載入後可以修改；內容多為草稿，不代表已通過執行驗證。')).toBeTruthy();
  expect(screen.getByText(`${example.name} ${example.version}`)).toBeTruthy();
  expect(screen.getByText('草稿，尚未審閱')).toBeTruthy();
  expect(screen.getByText(`${example.steps} 個步驟中 ${example.mapped} 個可對應功能`)).toBeTruthy();
  click(loadName);
  expect(screen.queryByRole('group')).toBeNull();
  expect(onLoad).toHaveBeenCalledExactlyOnceWith(example.result!.value);
  expect(onLoad.mock.calls[0][0]).not.toBe(example.result!.value);
  for (const notice of example.result!.notices) expect(within(screen.getByRole('status')).getByText(notice)).toBeTruthy();
  click('範例庫');
  expect(screen.queryByRole('button', { name: loadName })).toBeNull();
});

test('existing factories require confirmation; cancel leaves current untouched', () => {
  const current = structuredClone(example.result!.value), before = structuredClone(current), onLoad = vi.fn();
  render(<ExampleLibrary current={current} onLoad={onLoad} examples={[example]} />);
  click('範例庫'); click(loadName);
  expect(screen.getByRole('group', { name: `確認載入：${example.name}` })).toBeTruthy();
  expect(screen.getByText('載入會替換目前的流程、表單與關聯')).toBeTruthy();
  expect(onLoad).not.toHaveBeenCalled();
  click('取消');
  expect(screen.queryByRole('group')).toBeNull();
  expect(onLoad).not.toHaveBeenCalled(); expect(current).toEqual(before);
  click(loadName); click('確認載入');
  expect(onLoad).toHaveBeenCalledExactlyOnceWith(example.result!.value);
  expect(screen.queryByRole('group')).toBeNull();
});

test('invalid rows remain visible and disabled, with empty state when none are usable', () => {
  const bad = { kitId: 'bad', name: '<img src=x onerror=alert(1)>', version: '1', error: '內容不正確' };
  const { rerender } = render(<ExampleLibrary current={emptyGraph} onLoad={vi.fn()} examples={[bad]} />);
  click('範例庫');
  expect(screen.getByText('目前沒有可用的範例')).toBeTruthy();
  expect(screen.getByText('無法載入：內容不正確')).toBeTruthy();
  expect(screen.getByText(`${bad.name} 1`).querySelector('img')).toBeNull();
  expect((screen.getByRole('button', { name: `載入到畫布：${bad.name}` }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: `下載範例流程規格（草稿）：${bad.name}` }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<ExampleLibrary current={emptyGraph} onLoad={vi.fn()} examples={[]} />);
  expect(screen.getByText('目前沒有可用的範例')).toBeTruthy();
  expect(screen.queryByText('無法載入：內容不正確')).toBeNull();
});

test('draft download includes incomplete examples and round trips with correct filename', () => {
  const incomplete = examples.find(row => row.result?.notices.some(n => n.startsWith('尚有 ')))!;
  const download = vi.spyOn(transfer, 'downloadJson').mockImplementation(() => {});
  const onLoad = vi.fn();
  render(<ExampleLibrary current={emptyGraph} onLoad={onLoad} examples={[incomplete]} />);
  click('範例庫'); click(`下載範例流程規格（草稿）：${incomplete.name}`);
  expect(download).toHaveBeenCalledTimes(1);
  expect(download.mock.calls[0][1]).toBe(`${incomplete.kitId}-example.json`);
  expect(importAny(download.mock.calls[0][0]).value).toEqual(incomplete.result!.value);
  expect(onLoad).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toContain('已下載範例流程規格（草稿）。');
  download.mockImplementation(() => { throw new Error('private/path'); });
  click(`下載範例流程規格（草稿）：${incomplete.name}`);
  expect(screen.getByRole('alert').textContent).toBe('範例流程規格無法下載，請確認範例內容。');
});

test.each([['standalone', Standalone], ['composer', Composer]] as const)('%s loads an example into the real canvas and resets an already open flow', async (kind, App) => {
  vi.spyOn(caseStoreClient, 'lifecycle').mockResolvedValue({ ok: false, errors: [] });
  const RealCanvas = canvas.WorkflowCanvas;
  const renders = vi.spyOn(canvas, 'WorkflowCanvas').mockImplementation(props => <RealCanvas {...props} />);
  render(<App />);
  if (kind === 'composer') openFlow();
  startLogic('原工廠');
  const beforeReset = renders.mock.calls.at(-1)![0].resetKey!;
  click('範例庫'); click(loadName); click('確認載入');
  expect(renders.mock.calls.at(-1)![0].resetKey).toBe(beforeReset + 1);
  expect(screen.queryByRole('button', { name: '開始' })).toBeNull();
  expect(screen.getAllByDisplayValue(example.name)).toHaveLength(2);
  click(new RegExp(`^開啟：${example.name}`));
  for (const node of example.result!.value.graphs[0].nodes) expect(screen.getByRole('button', { name: node.name })).toBeTruthy();
  const node = example.result!.value.graphs[0].nodes.find(n => n.kind === 'node')!;
  click(node.name);
  expect(screen.getByRole('button', { name: '關閉細項' })).toBeTruthy();
  click(loadName); click('確認載入');
  expect(renders.mock.calls.at(-1)![0].resetKey).toBe(beforeReset + 2);
  click(new RegExp(`^開啟：${example.name}`));
  expect(screen.queryByRole('button', { name: '關閉細項' })).toBeNull();
});
