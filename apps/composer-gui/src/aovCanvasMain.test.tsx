// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';
import { mount } from './bootstrap';

vi.mock('./bootstrap', () => ({ mount: vi.fn() }));
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); vi.resetModules(); });
const source = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
function imports(text: string): string[] {
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) result.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) result.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('entry.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return result;
}
const forbidden = ['./App', './OutputPage', './RecipeTransfer', './CaseLibraryPage'];

test.each(['./AovCanvasApp.tsx', './aovCanvasMain.tsx'])('%s import list stays independent', name => {
  const list = imports(source(name));
  expect(list.length).toBeGreaterThan(0);
  expect(list.filter(path => forbidden.includes(path.replace(/\.tsx?$/, '')))).toEqual([]);
});

test.each(forbidden)('import-list guard detects static and dynamic %s dependencies', path => {
  expect(imports(`import { App } from '${path}';`)).toContain(path);
  expect(imports(`void import('${path}');`)).toContain(path);
});

test('HTML declares the standalone title, mount target and entry', () => {
  const html = new DOMParser().parseFromString(source('../aov-canvas.html'), 'text/html');
  expect(html.title).toBe('AoV 畫布');
  expect(html.documentElement.lang).toBe('zh-Hant');
  expect(html.getElementById('root')).not.toBeNull();
  expect(html.querySelector('script[type="module"]')?.getAttribute('src')).toBe('/src/aovCanvasMain.tsx');
});

test('entry uses bootstrap.mount with the standalone named App export', async () => {
  const root = document.createElement('div'); root.id = 'root'; document.body.append(root);
  await import('./aovCanvasMain');
  expect(mount).toHaveBeenCalledTimes(1);
  const [target, load] = vi.mocked(mount).mock.calls[0];
  expect(target).toBe(root);
  const loaded = await load();
  const standalone = await import('./AovCanvasApp');
  expect(loaded.App).toBe(standalone.App);
  expect(typeof loaded.App).toBe('function');
});

test('entry reports a missing mount target', async () => {
  await expect(import('./aovCanvasMain')).rejects.toThrow('缺少應用程式掛載節點');
  expect(mount).not.toHaveBeenCalled();
});
