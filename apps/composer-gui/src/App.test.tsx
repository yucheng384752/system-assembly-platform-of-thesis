// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';

afterEach(cleanup);
test('role metadata is presented as guidance without claiming identity authorization', () => {
  render(<App />);
  expect(screen.getByText(/Composer 尚無身分驗證/).textContent).toContain('未執行身分授權檢查');
  fireEvent.click(screen.getByRole('checkbox', { name: '紀錄 Kit' }));
  expect(screen.getAllByText(/角色提示：User/).length).toBeGreaterThan(0);
});
test.skip('未涵蓋：以 User 身分修改 MIS 項目由授權邊界拒絕（尚無身分機制）', () => {});
test('Recipe transfer is atomic and successful import clears stale editor and preview state', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('checkbox', { name: '紀錄 Kit' }));
  fireEvent.change(screen.getByLabelText('name label'), { target: { value: '已保存' } });
  fireEvent.click(screen.getByRole('button', { name: '匯出 Recipe' }));
  const text = screen.getByLabelText('Recipe JSON') as HTMLTextAreaElement;
  const saved = text.value;
  fireEvent.change(screen.getByLabelText('name label'), { target: { value: '目前草稿' } });
  const invalid = JSON.parse(saved);
  invalid.enabledKits.push('missing-kit');
  fireEvent.change(text, { target: { value: JSON.stringify(invalid) } });
  fireEvent.click(screen.getByRole('button', { name: '匯入 Recipe' }));
  expect(screen.getByRole('alert').textContent).toContain('未知 Kit');
  expect(screen.getByRole('columnheader', { name: '目前草稿' })).toBeTruthy();
  expect(screen.getAllByRole('tab')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('name width'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('狀態篩選'), { target: { value: 'closed' } });
  fireEvent.change(text, { target: { value: saved } });
  fireEvent.click(screen.getByRole('button', { name: '匯入 Recipe' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('name label') as HTMLInputElement).value).toBe('已保存');
  expect((screen.getByLabelText('name width') as HTMLInputElement).value).toBe('180');
  expect(screen.getByText('Mock A')).toBeTruthy();
  expect(screen.queryByText('Mock B')).toBeNull();
});
test('selected Kit tabs have keyboard navigation and infrastructure explanation', () => {
  render(<App />);
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.getByText('尚未選取 Kit。')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '紀錄 Kit' }));
  fireEvent.click(screen.getByLabelText('入口權限 Kit'));
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.queryByText('tenant-auth-kit')).toBeNull();
  const first = screen.getByRole('tab', { name: '紀錄 Kit' }); first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '入口權限 Kit' }));
  expect(screen.getByText('此 Kit 無獨立操作畫面；本預覽不可編輯。')).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(first.getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByLabelText('紀錄畫面'));
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '紀錄 Kit' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '紀錄 Kit' }));
  fireEvent.click(screen.getByRole('tab', { name: '紀錄 Kit' }));
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByLabelText('紀錄畫面'));
  expect(screen.getByRole('table')).toBeTruthy();
});

test('editing preserves focus, selection, last valid preview and Kit drafts; mock action does not request network', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
  try {
    render(<App />); fireEvent.click(screen.getByRole('checkbox', { name: '紀錄 Kit' }));
    const label = screen.getByLabelText('name label') as HTMLInputElement;
    label.focus(); fireEvent.change(label, { target: { value: '新名稱', selectionStart: 2, selectionEnd: 2 } });
    expect(document.activeElement).toBe(label); expect(label.selectionStart).toBe(2);
    expect(screen.getByRole('columnheader', { name: '新名稱' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('name width'), { target: { value: '10' } });
    expect(screen.getByRole('alert').textContent).toContain('超出範圍');
    expect(screen.getByRole('columnheader', { name: '新名稱' }).style.width).toBe('180px');
    fireEvent.change(screen.getByLabelText('name width'), { target: { value: '250' } });
    expect(screen.getByRole('columnheader', { name: '新名稱' }).style.width).toBe('250px');
    fireEvent.change(screen.getByLabelText('name order'), { target: { value: '3' } });
    expect(screen.getAllByRole('columnheader')[0].textContent).toBe('status');
    fireEvent.click(screen.getByLabelText('name visible')); expect(screen.queryByRole('columnheader', { name: '新名稱' })).toBeNull();
    fireEvent.click(screen.getByLabelText('name visible'));
    fireEvent.change(screen.getByLabelText('狀態篩選'), { target: { value: 'closed' } });
    expect(screen.getByText('Mock B')).toBeTruthy(); expect(screen.queryByText('Mock A')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: '入口權限 Kit' }));
    fireEvent.click(screen.getByRole('tab', { name: '入口權限 Kit' }));
    expect(screen.queryByLabelText('name label')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '紀錄 Kit' }));
    expect((screen.getByLabelText('name label') as HTMLInputElement).value).toBe('新名稱');
    fireEvent.click(screen.getByLabelText('紀錄畫面')); expect(screen.queryByLabelText('name label')).toBeNull();
    fireEvent.click(screen.getByLabelText('紀錄畫面'));
    expect(screen.getByRole('columnheader', { name: '新名稱' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '紀錄 Kit' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '紀錄 Kit' }));
    expect(screen.getByRole('columnheader', { name: '新名稱' })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
