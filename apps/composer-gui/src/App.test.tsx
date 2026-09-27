import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';

test('骨架可呈現空狀態', () => {
  expect(renderToStaticMarkup(<App />)).toContain('尚未選取 Kit');
});
