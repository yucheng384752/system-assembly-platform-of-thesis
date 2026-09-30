// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { mount } from './bootstrap';
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks(); });
test('a broken catalog shows an explanation instead of a blank page (no silent failure)', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const element = document.body.appendChild(document.createElement('div'));
  await mount(element, () => Promise.reject(new Error('缺少相依：platform-core-kit → missing-kit')));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('請聯絡系統管理者'));
  // Technical detail stays in the collapsed advanced section, not in the default message.
  expect(screen.getByRole('alert').textContent).not.toContain('missing-kit');
  expect(screen.getByText(/missing-kit/).closest('details')).toBeTruthy();
  expect(console.error).toHaveBeenCalled();
});
