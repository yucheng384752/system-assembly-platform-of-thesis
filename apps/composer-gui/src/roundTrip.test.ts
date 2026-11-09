import { expect, test } from 'vitest';
import { convertCanvas } from '../../../libs/aov-integration/canvasToProject';
import { canvasWithLayout } from './kitExamples';
import { projectToCanvas } from './projectToCanvas';
import { exportAovGraph } from './workflowGraph';
import { importAny } from './importAny';
import { example, projectFixture } from './roundTrip.fixture';

test.each([false, true])('畫布與專案檔往返，完整案例=%s', full => {
  const original = projectFixture(full);
  const restored = projectToCanvas(original);
  const again = convertCanvas({ doc: restored.value, factoryId: 'project-sample', graphId: 'project-sample', details: restored.details, forms: restored.forms, meta: original.meta });
  expect(again.ok).toBe(true);
  if (!again.ok) throw new Error(JSON.stringify(again.issues));
  expect(JSON.stringify(again.project)).toBe(JSON.stringify(original));
  const { graph } = example(full);
  expect(importAny(exportAovGraph(graph)).value).toEqual(graph);
});

test('D191：其他生產邏輯與孤兒細項的物料不混入專案，往返不遺失專案物料', () => {
  const { graph, details, forms } = example(false);
  details.materials.push({ key: 'other', name: '別的物料', dimension: 'count', baseUnit: 'pcs' });
  details.nodes.orphan = { kind: 'pick', material: 'other', location: 'elsewhere' };
  details.nodes.other = { kind: 'pick', material: 'other', location: 'elsewhere' };
  const other = canvasWithLayout('other-logic', '其他流程', [{ ...graph.graphs[0].nodes[1], id: 'other' }], []);
  graph.factories.push(...other.factories); graph.graphs.push(...other.graphs);
  const result = convertCanvas({ doc: graph, factoryId: 'g', graphId: 'g', details, forms, meta: projectFixture(false).meta });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  const restored = projectToCanvas(result.project);
  expect(restored.details.materials.map(m => m.key)).toEqual(['tin']);
  const again = convertCanvas({ doc: restored.value, factoryId: 'project-sample', graphId: 'project-sample', details: restored.details, forms: restored.forms, meta: result.project.meta });
  expect(again.ok && JSON.stringify(again.project)).toBe(JSON.stringify(result.project));
});
