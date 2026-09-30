// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StepShell, steps } from './StepShell';
afterEach(cleanup);
test('keyboard steps expose current and confirmed state and focus the sole h1', () => {
  render(<StrictMode><StepShell renderStep={step => <p>內容 {step}</p>} /></StrictMode>);
  // Initial load must not steal focus, otherwise the first Tab skips the skip link and step navigation.
  expect(document.activeElement).toBe(document.body);
  expect(screen.getByRole('link', { name: '跳到主要內容' }).getAttribute('href')).toBe('#main-content');
  expect(screen.getByRole('main')).toBeTruthy();
  // AoV is optional: it must not look like pending work that blocks completion.
  expect(screen.getByRole('button', { name: `${steps[3]}（非必要填寫）` })).toBeTruthy();
  const first = screen.getByRole('button', { name: new RegExp(steps[0]) });
  expect(first.getAttribute('aria-current')).toBe('step');
  first.focus(); fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(steps[1]);
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  expect(first.hasAttribute('aria-current')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '確認本步驟並繼續' }));
  expect(screen.getByRole('button', { name: `${steps[1]}（已確認）` })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: new RegExp(steps[2]) }), { key: 'End' });
  expect(document.activeElement?.textContent).toBe(steps[3]);
});
test('a step with validation errors cannot be marked confirmed, so "已確認" never hides broken content', () => {
  let error = '請填寫表單名稱。';
  const { rerender } = render(<StepShell stepError={step => step === 0 ? error : ''} renderStep={step => <p>內容 {step}</p>} />);
  const confirm = screen.getByRole('button', { name: '確認本步驟並繼續' }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('請填寫表單名稱');
  error = '';
  rerender(<StepShell stepError={step => step === 0 ? error : ''} renderStep={step => <p>內容 {step}</p>} />);
  fireEvent.click(screen.getByRole('button', { name: '確認本步驟並繼續' }));
  expect(screen.getByRole('button', { name: `${steps[0]}（已確認）` })).toBeTruthy();
});
