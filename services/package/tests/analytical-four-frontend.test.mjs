import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { appSource, frontendTree, selectedPages } from '../frontend.mjs';
import { scanExclusions } from '../assemble-system.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const kits = path.join(repository, 'kits');
const kit = path.join(kits, 'analytical-four-kit');
const SELECTION = ['platform-core-kit', 'entry-permission-kit', 'analytical-four-kit'];

test('the Kit adds one tab that renders only behind the login gate', () => {
  const pages = selectedPages(SELECTION);
  assert.deepEqual(pages.map(page => page.component), ['AnalyticalFourPage']);
  const source = appSource(pages);
  assert.match(source, /signedIn && tab === "analyticalFour" \? <AnalyticalFourPage \/> : null/);
  assert.match(source, /label: t\("tabs\.analyticalFour"\)/);
});

test('the tab label exists in both languages', async () => {
  for (const language of ['zh-TW', 'en']) {
    const locale = JSON.parse(await readFile(path.join(repository, `services/frontend/base/src/locales/${language}/common.json`), 'utf8'));
    assert.ok(locale.tabs.analyticalFour, language);
  }
});

test('the assembled frontend carries the page, its client and its styles, and nothing from other Kits', async () => {
  const tree = await frontendTree(kits, SELECTION);
  for (const name of ['frontend/src/pages/AnalyticalFourPage.tsx', 'frontend/src/services/analyticalFour.ts', 'frontend/src/styles/analytical-four.css',
    'frontend/src/components/analyticalFour/PreparePanel.tsx', 'frontend/src/components/analyticalFour/SettingsPanel.tsx',
    'frontend/src/components/analyticalFour/RunPanel.tsx', 'frontend/src/components/analyticalFour/FeedbackPanel.tsx']) {
    assert.ok(tree.has(name), name);
  }
  assert.ok(![...tree.keys()].some(name => /UploadPage|QueryPage|AnalyticsPage|FormsPage/.test(name)));
  scanExclusions(tree);
});

/** Every file of the Kit's own frontend source, as text. */
async function sources() {
  const found = [];
  /** @param {string} directory */
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.push([full, await readFile(full, 'utf8')]);
    }
  }
  await walk(path.join(kit, 'src/frontend'));
  return found;
}

test('user-editable text is only ever rendered as text', async () => {
  for (const [file, text] of await sources()) {
    assert.doesNotMatch(text, /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|eval\(/, file);
  }
});

test('the client calls exactly the routes the Kit declares', async () => {
  const client = await readFile(path.join(kit, 'src/frontend/src/services/analyticalFour.ts'), 'utf8');
  const contract = JSON.parse(await readFile(path.join(kit, 'kit.contract.json'), 'utf8'));
  const normalize = (/** @type {string} */ value) => value.replace(/\$\{query\}/g, '').replace(/\$\{[^}]+\}/g, '{}').replace(/\{[^}]+\}/g, '{}').replace(/\?.*$/, '');
  const base = '/api/analytical-four';
  const used = new Set([...client.matchAll(/call<[^>]*(?:<[^>]*>[^>]*)*>\(\s*[`"]([^`"]+)[`"]/g)].map(match => normalize(base + match[1])));
  const declared = new Set(contract.provides.api.map((/** @type {{path: string}} */ route) => normalize(route.path)));
  // the demo route and the template download are called by name, not through call<>()
  used.add(normalize(`${base}/templates/{name}`));
  for (const route of used) assert.ok(declared.has(route), `the client calls ${route}, which the Kit does not declare`);
  for (const route of declared) assert.ok(used.has(route), `the Kit declares ${route}, which the client never calls`);
});

test('language-dependent details come from the labels, so the English page does not show Chinese punctuation, time format or a bare gateway word', async () => {
  const folder = path.join(kit, 'src/frontend/src/components/analyticalFour');
  const labels = await readFile(path.join(folder, 'labels.ts'), 'utf8');
  assert.match(labels, /locale: "zh-TW"/);
  assert.match(labels, /locale: "en-US"/);
  assert.match(labels, /colon: "："/);
  assert.match(labels, /colon: ": "/);
  const common = await readFile(path.join(folder, 'Common.tsx'), 'utf8');
  assert.match(common, /toLocaleString\(L\.locale\)/, 'time follows the page language, not the browser region');
  assert.match(common, /\^forbidden\$/i, 'the gateway bare "Forbidden" is replaced by the page own sentence');
  for (const file of (await readdir(folder)).filter(name => name.endsWith('.tsx'))) {
    const source = await readFile(path.join(folder, file), 'utf8');
    assert.doesNotMatch(source, /\}：/, `${file}: a full-width colon after a label shows in the English page; use L.colon`);
    for (const call of source.matchAll(/formatTime\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
      if (!call[0].includes('value:')) assert.ok(call[1].endsWith(', L'), `${file}: formatTime needs the labels for the locale: ${call[0]}`);
    }
  }
});
