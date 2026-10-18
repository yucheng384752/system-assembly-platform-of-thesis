import { expect, test } from 'vitest';
import { validateSchema } from '../../../libs/ui-runtime/schema';
import { loadExample } from './exampleHints';
import { emptyGraph, exportAovGraph, importAovGraph, integrityErrors, MAX_FACTORIES, MAX_GRAPHS, workingNodes, type AovGraphDocument } from './workflowGraph';
import { MAX_FORMS } from './localData';

function check(doc: AovGraphDocument) {
  expect(integrityErrors(doc)).toEqual([]);
  expect(() => validateSchema('aov', doc)).not.toThrow();
  expect(importAovGraph(exportAovGraph(doc)).value).toEqual(doc);
}

test('the documented scenario has six business nodes, five owned forms and four batch-key relations', () => {
  const doc = loadExample(emptyGraph);
  check(doc);
  expect(doc.factories).toHaveLength(1);
  const nodes = workingNodes(doc.graphs[0]);
  expect(nodes.map(n => n.name)).toEqual(['開立領料單', '領料', '配料', '混合', '品質檢驗', '包裝入庫']);
  expect(nodes[1].formId).toBeNull();
  expect(nodes.every(n => n.actionId === null)).toBe(true);
  expect(doc.forms.map(f => f.name)).toEqual(['領料單', '配料紀錄', '混合紀錄', '檢驗紀錄', '包裝紀錄']);
  expect(nodes.filter(n => n.formId)).toHaveLength(5);
  expect(doc.relations).toHaveLength(4);
  doc.relations.forEach((r, i) => {
    expect(r).toMatchObject({ kind: 'shared-key', origin: 'user', confirmed: true,
      from: { formId: doc.forms[i].id, fieldId: doc.forms[i].fields[0].id },
      to: { formId: doc.forms[i + 1].id, fieldId: doc.forms[i + 1].fields[0].id } });
  });
  const ids = [...doc.factories, ...doc.graphs, ...doc.graphs.flatMap(g => [...g.nodes, ...g.edges]), ...doc.forms, ...doc.forms.flatMap(f => f.fields), ...doc.relations].map(x => x.id);
  expect(ids.every(id => /^example-[a-z0-9-]+$/.test(id))).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  expect(doc.forms.flatMap(f => f.fields).every(f => !f.validation)).toBe(true);
  expect(loadExample(doc)).toBe(doc);
  expect(emptyGraph.factories).toEqual([]);
});

test('adding to an existing complete document preserves it and avoids ids in every namespace', () => {
  const original: AovGraphDocument = JSON.parse(JSON.stringify(loadExample(emptyGraph)).replaceAll('example-', 'user-'));
  original.forms[0].fields[1].id = 'example-node';
  const before = structuredClone(original);
  const doc = loadExample(original);
  check(doc);
  expect(original).toEqual(before);
  expect(doc.factories[0]).toEqual(original.factories[0]);
  expect(doc.graphs[0]).toEqual(original.graphs[0]);
  expect(doc.forms.slice(0, 5)).toEqual(original.forms);
  expect(doc.relations.slice(0, 4)).toEqual(original.relations);
  expect(doc.layout[original.graphs[0].id]).toEqual(original.layout[original.graphs[0].id]);
  expect(doc.graphs[1].nodes.some(n => n.id === 'example-node')).toBe(false);
  expect(loadExample(doc)).toBe(doc);
});

test('capacity failures are atomic and explain what reached the limit', () => {
  const sample = loadExample(emptyGraph);
  for (const [doc, reason] of [
    [{ ...emptyGraph, factories: Array.from({ length: MAX_FACTORIES }, (_, i) => ({ id: `factory-${i}`, name: '第一廠', logicGraphIds: [] })) }, '工廠'],
    [{ ...emptyGraph, graphs: Array(MAX_GRAPHS).fill(sample.graphs[0]) }, '流程'],
    [{ ...emptyGraph, forms: Array(MAX_FORMS - 4).fill(sample.forms[0]) }, '表單'],
    [{ ...emptyGraph, relations: Array(1222).fill(sample.relations[0]) }, '關聯'],
  ] as [AovGraphDocument, string][]) {
    const before = structuredClone(doc);
    expect(() => loadExample(doc)).toThrow(reason);
    expect(doc).toEqual(before);
  }
});
