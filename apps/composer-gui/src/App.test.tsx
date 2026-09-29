// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';

afterEach(cleanup);
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
