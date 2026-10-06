// @vitest-environment jsdom
import { openFlow, startLogic, wireChain, addTool } from './testNav';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
afterEach(cleanup);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const name = () => screen.getByLabelText('名稱') as HTMLInputElement;
test('D17: the workflow is the first required step; an empty graph cannot be confirmed', () => {
  render(<App />); openFlow();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('流程畫布');
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById('step-status')!.textContent).toContain('請先建立工廠與生產邏輯');
  startLogic();
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById('step-status')!.textContent).toContain('尚未建立節點');
  addTool('業務節點');
  // A new node starts unconnected (D84), so the step is still not complete until the user draws its lines.
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById('step-status')!.textContent).toContain('尚未接到開始與結束');
  wireChain(['業務節點']);
  expect((screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement).disabled).toBe(false);
});
test('native controls add, move and delete; failed import retains the selected node and work', () => {
  render(<App />); openFlow(); startLogic(); addTool('業務節點');
  expect(document.activeElement).toBe(name());
  expect([name().selectionStart, name().selectionEnd]).toEqual([0, name().value.length]);
  fireEvent.change(name(), { target: { value: '第一個' } }); addTool('業務節點');
  fireEvent.change(name(), { target: { value: '第二個' } });
  fireEvent.change(screen.getByLabelText('橫向位置'), { target: { value: '250' } });
  expect((screen.getByLabelText('橫向位置') as HTMLInputElement).value).toBe('250');
  fireEvent.click(screen.getByText('匯入流程規格')); fireEvent.click(screen.getByText('進階：貼上流程 JSON'));
  fireEvent.change(screen.getByLabelText('流程 JSON'), { target: { value: '{"steps":[]}' } }); click('匯入流程 JSON');
  expect(screen.getByRole('alert').textContent).toContain('原流程已保留'); expect(name().value).toBe('第二個');
  click('刪除節點'); expect(name().value).toBe('第二個'); click('確認刪除'); click('第一個');
  expect(name().value).toBe('第一個'); expect(document.activeElement).toBe(name());
});
test('selecting a node edits only that node and moves focus to its name', () => {
  render(<App />); openFlow(); startLogic(); addTool('業務節點'); fireEvent.change(name(), { target: { value: '填寫紀錄' } });
  addTool('業務節點'); fireEvent.change(name(), { target: { value: '核對資料' } }); click('填寫紀錄');
  expect(screen.getAllByLabelText('名稱')).toHaveLength(1); expect(name().value).toBe('填寫紀錄');
  expect(document.activeElement).toBe(name()); expect(screen.getByRole('button', { name: '填寫紀錄' }).getAttribute('aria-current')).toBe('true');
});
test('legacy import keeps nodes and lists conversion and dropped form assignment notices', () => {
  render(<App />); openFlow();
  fireEvent.click(screen.getByText('匯入流程規格')); fireEvent.click(screen.getByText('進階：貼上流程 JSON'));
  for (const version of [1, 2]) {
    const value = version === 1 ? { format: 'composer-aov-list', version, steps: [{ id: 'a', name: '檢查', when: '', owner: '品管', formId: 'form-1' }] }
      : { format: 'composer-aov-list', version, steps: [{ id: 'a', name: '檢查', when: '', owner: '品管', formIds: [] }], forms: [], relations: [] };
    fireEvent.change(screen.getByLabelText('流程 JSON'), { target: { value: JSON.stringify(value) } }); click('匯入流程 JSON');
    // An import returns to the factory list; the notices stay while the user looks at it, and the converted flow opens from there.
    expect(screen.getByText(/舊版流程已轉換為畫布/)).toBeTruthy(); expect(screen.getByDisplayValue('預設工廠')).toBeTruthy();
    click(/^開啟：主流程/); expect(screen.getByRole('button', { name: '檢查' })).toBeTruthy(); expect(screen.getByText(/舊版流程已轉換為畫布/)).toBeTruthy(); click('工廠');
    if (version === 1) expect(screen.getByText(/已清除以下步驟的表單指派：「檢查」/)).toBeTruthy();
  }
});
