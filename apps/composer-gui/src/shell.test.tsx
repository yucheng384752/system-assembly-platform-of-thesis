// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
afterEach(cleanup);

const nav = () => screen.getByRole('navigation', { name: '主要導覽' });
const go = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

test('the app opens on the home page with five navigation entries (D63)', () => {
  render(<App />);
  expect([...nav().querySelectorAll('button')].map(b => b.textContent)).toEqual(['首頁', '流程', '資料集', '執行記錄', '系統設定']);
  expect(screen.getByRole('button', { name: '首頁' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('heading', { level: 1, name: '首頁' })).toBeTruthy();
});

test('leaving the flow page does not lose the step the user was on, so shell navigation never discards work', () => {
  render(<App />); go('流程');
  fireEvent.click(screen.getByRole('button', { name: /^02/ }));
  go('資料集'); go('流程');
  expect(screen.getByRole('button', { name: /^02/ }).getAttribute('aria-current')).toBe('step');
});

test('pages that are not built yet say so instead of showing made-up data (D16, D63)', () => {
  render(<App />);
  for (const title of ['資料集', '執行記錄', '系統設定']) {
    go(title);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getAllByText('尚未提供').length).toBeGreaterThan(0);
  }
});

test('home shows only counts from the session and states that no execution history exists', () => {
  render(<App />);
  expect(within(screen.getByRole('region', { name: '設定概況' })).getByText('流程節點').nextElementSibling?.textContent).toBe('0');
  expect(screen.getByText(/尚無執行紀錄/)).toBeTruthy();
});

// Collapsing only hides text: every entry stays reachable by name, and the control says what it will do next.
test('the sidebar collapses and expands without losing any navigation entry', () => {
  const { container } = render(<App />);
  const toggle = () => screen.getByRole('button', { name: /導覽$/ });
  expect(toggle().textContent).toBe('收合導覽');
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(toggle());
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(toggle().textContent).toBe('展開導覽');
  expect(container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(true);
  for (const title of ['首頁', '流程', '資料集', '執行記錄', '系統設定']) {
    const entry = screen.getByRole('button', { name: title });
    expect(entry.getAttribute('title')).toBe(title);
    expect(entry.querySelector('.visually-hidden')?.textContent).toBe(title);
  }
  fireEvent.click(toggle());
  expect(container.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(false);
  expect(toggle().textContent).toBe('收合導覽');
});
