// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StepShell, steps } from './StepShell';
afterEach(cleanup);
test('step buttons expose current and confirmed state and focus the sole h1', () => {
  render(<StrictMode><StepShell renderStep={step => <p>內容 {step}</p>} /></StrictMode>);
  // Initial load must not steal focus, otherwise the first Tab skips the skip link and step navigation.
  expect(document.activeElement).toBe(document.body);
  expect(screen.getByRole('link', { name: '跳到主要內容' }).getAttribute('href')).toBe('#main-content');
  expect(screen.getByRole('main')).toBeTruthy();
  // AoV is optional: labelled 選填 instead of pending work that blocks completion.
  expect(screen.getByRole('button', { name: '04 AoV 設定 選填' })).toBeTruthy();
  // Pending state is still announced even though the stepper only shows it visually as an empty circle.
  const first = screen.getByRole('button', { name: '01 資料上傳 待確認' });
  expect(first.getAttribute('aria-current')).toBe('step');
  // Step buttons are plain Tab stops; arrow keys must not switch steps (G02: they only worked once because focus left the nav).
  first.focus(); fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(first.getAttribute('aria-current')).toBe('step');
  fireEvent.click(screen.getByRole('button', { name: /02 功能選配/ }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(steps[1].title);
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  expect(first.hasAttribute('aria-current')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '確認並繼續' }));
  // Confirmed = check mark plus visible text, never the icon alone (the number stays in the accessible name).
  const confirmed = screen.getByRole('button', { name: '02 功能選配 已確認' });
  expect(confirmed.querySelector('.step-state')?.textContent).toBe('已確認');
  // Last step says 確認本步驟 because there is nothing to continue to.
  fireEvent.click(screen.getByRole('button', { name: /04 AoV 設定/ }));
  expect(screen.getByRole('button', { name: '確認本步驟' })).toBeTruthy();
});
test('a step with validation errors cannot be marked confirmed, so "已確認" never hides broken content', () => {
  let error = '請填寫表單名稱。';
  const { rerender } = render(<StepShell stepError={step => step === 0 ? error : ''} renderStep={step => <p>內容 {step}</p>} />);
  const confirm = screen.getByRole('button', { name: '確認並繼續' }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('請填寫表單名稱');
  error = '';
  rerender(<StepShell stepError={step => step === 0 ? error : ''} renderStep={step => <p>內容 {step}</p>} />);
  fireEvent.click(screen.getByRole('button', { name: '確認並繼續' }));
  expect(screen.getByRole('button', { name: '01 資料上傳 已確認' })).toBeTruthy();
});
