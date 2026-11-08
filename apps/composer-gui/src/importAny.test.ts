import { afterEach, expect, test, vi } from 'vitest';
import { importAny } from './importAny';
import * as workflow from './workflowGraph';
import { loadExample } from './exampleHints';

afterEach(() => vi.restoreAllMocks());

test('v5 export imports unchanged, including a BOM', () => {
  const value = loadExample(workflow.emptyGraph);
  const text = workflow.exportAovGraph(value);
  expect(importAny(text)).toEqual({ value, notices: [] });
  expect(importAny(`\uFEFF${text}`)).toEqual(importAny(text));
});

test('legacy list delegates conversion and preserves notices', () => {
  const text = JSON.stringify({ format: 'composer-aov-list', version: 1,
    steps: [{ id: 'check', name: '檢查', when: '', owner: '品管', formId: 'old-form' }] });
  const expected = workflow.importWorkflow(text);
  expect(expected.notices.length).toBeGreaterThan(0);
  expect(importAny(text)).toEqual(expected);
  expect(importAny(text).value.version).toBe(5);
});

test('missing format still delegates to the legacy validator', () => {
  const text = '{"version":1,"steps":[]}';
  const delegate = vi.spyOn(workflow, 'importWorkflow');
  expect(() => importAny(text)).toThrow('流程規格格式不正確');
  expect(delegate).toHaveBeenCalledExactlyOnceWith(text);
});

test.each(['{broken', 'null', '[]', '42', '"text"', '{"format":"composer-kit-workflow"}', '{"format":null}'])('unknown input %s has the exact business error', text => {
  expect(() => importAny(text)).toThrow(new Error('無法辨識的檔案格式。原流程已保留。'));
});
