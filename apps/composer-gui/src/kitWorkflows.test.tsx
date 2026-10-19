// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { catalog } from './previewCatalog';
import { initialRecipe } from './App';
import { parseKitWorkflow, summarizeKitWorkflows, workflowFiles, workflowTable, type KitWorkflow } from './kitWorkflows';
import { KitWorkflowSummary } from './KitWorkflowSummary';
import { registry } from './registryData';

afterEach(cleanup);
const kit = catalog.kits.find(k => k.id === 'upload-validation-kit')!;
const path = `kits/${kit.id}/workflow.aov.json`;
const template = () => JSON.parse(workflowFiles[path]) as KitWorkflow;
const recipe = { ...initialRecipe, enabledKits: [kit.id], selectedSubfeatures: { [kit.id]: ['csv-excel-upload-validation'] } };

const wp2KitIds = [
  'generic-forms-kit', 'station-data-link-kit', 'import-pipeline-kit',
  'analytics-kit', 'audit-edit-kit', 'mod-subscription-kit',
  'logs-ops-kit', 'platform-core-kit', 'query-traceability-kit',
];

test.each(wp2KitIds)('%s template parses and only references verified capabilities', kitId => {
  const currentKit = catalog.kits.find(item => item.id === kitId)!;
  const parsed = parseKitWorkflow(workflowFiles[`kits/${kitId}/workflow.aov.json`], currentKit);
  expect(parsed.status).toBe('draft');
  const capabilities = registry.find(entry => entry.kitId === kitId)!.capabilities;
  for (const node of parsed.nodes) {
    expect(node.capabilityIds.length).toBeGreaterThan(0);
    for (const id of node.capabilityIds) {
      expect(capabilities.find(capability => capability.id === id)?.verified).toBe(true);
    }
  }
  for (const capability of capabilities.filter(item => !item.verified)) {
    expect(parsed.scope).toContain(capability.id);
  }
});

test('catalog summary lists only kits without workflow files as missing', () => {
  const rows = summarizeKitWorkflows({
    enabledKits: catalog.kits.map(item => item.id),
    selectedSubfeatures: {},
  }, catalog.kits);
  expect(rows.filter(row => row.status === 'missing').map(row => row.kitId)).toEqual(
    catalog.kits.filter(item => !Object.hasOwn(workflowFiles, `kits/${item.id}/workflow.aov.json`)).map(item => item.id),
  );
  expect(rows.filter(row => row.status === 'invalid')).toEqual([]);
  for (const kitId of wp2KitIds) {
    expect(rows.find(row => row.kitId === kitId)?.status).toBe('draft');
  }
});

test('kit-local template resolves its version, subfeatures and registered capabilities', () => {
  const parsed = parseKitWorkflow(workflowFiles[path], kit);
  expect(parsed.edges).toEqual([{ from: 'upload', to: 'status' }]);
  expect(parsed.status).toBe('draft');
});

test.each([
  ['unknown version', (value: KitWorkflow) => { value.version = 2 as 1; }],
  ['wrong kit', (value: KitWorkflow) => { value.kitId = 'other'; }],
  ['stale kit version', (value: KitWorkflow) => { value.kitVersion = 'old'; }],
  ['duplicate node', (value: KitWorkflow) => { value.nodes.push(value.nodes[0]); }],
  ['dangling edge', (value: KitWorkflow) => { value.edges[0].to = 'missing'; }],
  ['cycle', (value: KitWorkflow) => { value.edges.push({ from: 'status', to: 'upload' }); }],
  ['unknown subfeature', (value: KitWorkflow) => { value.nodes[0].subfeatureId = 'unknown'; }],
  ['unknown capability', (value: KitWorkflow) => { value.nodes[0].capabilityIds = ['unknown']; }],
])('rejects %s and reports invalid instead of showing a successful graph', (_, mutate) => {
  const value = template(); mutate(value);
  const text = JSON.stringify(value);
  expect(() => parseKitWorkflow(text, kit)).toThrow();
  const row = summarizeKitWorkflows(recipe, catalog.kits, { [path]: text })[0];
  expect(row.status).toBe('invalid');
  expect(row.workflow).toBeUndefined();
});

test('only selected kits appear; missing files stay visible, disabled nodes are removed without reconnecting', () => {
  const value = template();
  value.nodes.push({ id: 'end', name: '完成', capabilityIds: [] });
  delete value.nodes[0].subfeatureId;
  value.edges.push({ from: 'status', to: 'end' });
  const rows = summarizeKitWorkflows({ ...recipe, selectedSubfeatures: { [kit.id]: [] } }, catalog.kits, { [path]: JSON.stringify(value) });
  expect(rows.map(row => row.kitId)).toEqual([kit.id]);
  expect(rows[0].workflow?.nodes.map(node => node.id)).toEqual(['upload', 'end']);
  expect(rows[0].workflow?.edges).toEqual([]);
  expect(summarizeKitWorkflows(recipe, catalog.kits, {})[0].status).toBe('missing');
  expect(() => summarizeKitWorkflows({ ...recipe, enabledKits: ['unknown'] }, catalog.kits)).toThrow('未登錄');
});

test('summary is deterministic and Markdown escapes table and HTML content', () => {
  const rows = summarizeKitWorkflows(recipe, catalog.kits);
  expect(workflowTable(rows)).toBe(workflowTable(summarizeKitWorkflows(recipe, catalog.kits)));
  expect(workflowTable(rows)).toContain('上傳檔案 → 查詢上傳狀態');
  expect(workflowTable([{ ...rows[0], name: '<script>|\n名稱' }])).toContain('&lt;script&gt;&#124; 名稱');
});

test('identical local node IDs in different kits stay in separate graphs', () => {
  const other = { ...kit, id: 'other-kit', displayName: '另一功能' };
  const value = template(); value.kitId = other.id;
  value.nodes.forEach(node => { node.capabilityIds = []; });
  const rows = summarizeKitWorkflows({ enabledKits: [kit.id, other.id], selectedSubfeatures: {} }, [kit, other], {
    [path]: workflowFiles[path], [`kits/${other.id}/workflow.aov.json`]: JSON.stringify(value),
  });
  expect(rows.map(row => row.workflow?.kitId)).toEqual([kit.id, other.id]);
  expect(rows.map(row => row.workflow?.nodes[0].id)).toEqual(['upload', 'upload']);
});

test('UI lists selected workflows and their draft status', () => {
  render(<KitWorkflowSummary recipe={recipe} kits={catalog.kits} />);
  // Native details is closed until the user opens it.
  screen.getByText('所選功能流程總表').click();
  expect(screen.getByText('草稿，尚未審閱')).toBeTruthy();
  expect(screen.getByText('上傳檔案 → 查詢上傳狀態')).toBeTruthy();
  expect(screen.queryByText('資料分析')).toBeNull();
});
