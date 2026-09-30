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
