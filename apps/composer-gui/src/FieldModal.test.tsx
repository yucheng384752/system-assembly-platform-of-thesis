// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { WorkflowCanvas } from './WorkflowCanvas';
import { emptyGraph, type AovGraphDocument } from './workflowGraph';
import { addTool, startLogic } from './testNav';
afterEach(cleanup);
let current = emptyGraph;
function Editor() {
  const [doc, setDoc] = useState<AovGraphDocument>(emptyGraph); current = doc;
  const [path, setPath] = useState<string[]>([]);
  return <WorkflowCanvas value={doc} onChange={setDoc} path={path} onPathChange={setPath} />;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
function withFields(count = 2) {
  render(<Editor />); startLogic(); addTool('建立表單'); click('新增空白表單');
  for (let i = 0; i < count; i++) click('新增欄位');
}
const dialog = () => screen.queryByRole('dialog', { name: '欄位設定' });
const open = () => click('展開全螢幕');

// D88: the CSV-like field table can be opened full screen: centred, over a dimmed backdrop, with the keyboard kept inside.
test('the full-screen button exists only once the form has fields', () => {
  render(<Editor />); startLogic(); addTool('建立表單'); click('新增空白表單');
  expect(screen.queryByRole('button', { name: '展開全螢幕' })).toBeNull();
  click('新增欄位');
  expect(screen.getByRole('button', { name: '展開全螢幕' })).toBeTruthy();
});

test('opening shows the table in a modal dialog on the page body and nowhere else', () => {
  withFields();
  const trigger = screen.getByRole('button', { name: '展開全螢幕' });
  expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
  open();
  const box = dialog()!;
  expect(box.getAttribute('aria-modal')).toBe('true');
  // Mounted straight on the body (a panel's stacking context cannot cover it) with the dimming backdrop around it.
  expect(box.parentElement!.className).toBe('modal-backdrop');
  expect(box.parentElement!.parentElement).toBe(document.body);
  expect(within(box).getByRole('table')).toBeTruthy();
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.activeElement).toBe(box);
});

test('settings still change the document from inside the dialog, and fields can be added there', () => {
  withFields();
  open();
  fireEvent.click(within(dialog()!).getByLabelText('欄位 2 識別欄位'));
  expect(current.forms[0].fields.map(f => f.isKey)).toEqual([false, true]);
  fireEvent.click(within(dialog()!).getByRole('button', { name: '新增欄位' }));
  expect(current.forms[0].fields).toHaveLength(3);
  expect(document.activeElement).toBe(within(dialog()!).getByLabelText('欄位 3 名稱'));
});

test.each([
  ['the close button', () => click('關閉全螢幕')],
  ['Escape', () => fireEvent.keyDown(dialog()!, { key: 'Escape' })],
  ['a press on the backdrop', () => fireEvent.mouseDown(dialog()!.parentElement!)],
])('closing with %s puts the table back in the page and returns focus to the button', (_name, close) => {
  withFields();
  const trigger = screen.getByRole('button', { name: '展開全螢幕' });
  open();
  close();
  expect(dialog()).toBeNull();
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(screen.getByRole('region', { name: '欄位設定' })).toBeTruthy();
  expect(document.body.style.overflow).toBe('');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
});

test('a press inside the dialog does not close it', () => {
  withFields();
  open();
  fireEvent.mouseDown(within(dialog()!).getByRole('table'));
  expect(dialog()).not.toBeNull();
});

// Tab wraps around inside the dialog, so the keyboard never reaches the page hidden behind the backdrop.
test('Tab and Shift+Tab stay inside the dialog', () => {
  withFields();
  open();
  const box = dialog()!;
  const items = [...box.querySelectorAll<HTMLElement>('button, input, select, textarea, summary')].filter(e => !e.closest('details:not([open])') || e.tagName === 'SUMMARY');
  const [first, last] = [items[0], items.at(-1)!];
  expect(first.textContent).toBe('關閉全螢幕');
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
});

test('deleting a field from the dialog asks inside the dialog, and deleting the last one closes it', () => {
  withFields(1);
  open();
  fireEvent.click(within(dialog()!).getByRole('button', { name: '刪除欄位 1' }));
  const confirm = within(dialog()!).getByRole('region', { name: '確認刪除表單內容' });
  fireEvent.click(within(confirm).getByRole('button', { name: '確認刪除表單內容' }));
  expect(current.forms[0].fields).toEqual([]);
  expect(dialog()).toBeNull();
  expect(screen.queryByRole('button', { name: '展開全螢幕' })).toBeNull();
  expect(document.body.style.overflow).toBe('');
});
