import { convertCanvas } from '../../../libs/aov-integration/canvasToProject';
import { emptyFormLibrary, type FormLibrary } from '../../../libs/aov-integration/formLibrary';
import { emptyProjectDetails, type ProjectDetails } from '../../../libs/aov-integration/projectDetails';
import { canvasWithLayout } from './kitExamples';
import type { GraphNode } from './workflowGraph';

export function example(full = true) {
  const names = full ? ['領料', '填單', '入庫', '客戶出庫', '外部出庫', '客戶領料', '外部領料'] : ['領料', '入庫'];
  const nodes: GraphNode[] = names.map((name, i) => ({ id: `n${i}`, name, kind: 'node', when: '每天', owner: '操作員', actionId: null, params: {}, formId: null, childGraphId: null }));
  const edges = full ? [{ id: 'e0', from: 'n0', to: 'n1' }, { id: 'e2', from: 'n1', to: 'n2' }, { id: 'e3', from: 'n5', to: 'n3' }, { id: 'e4', from: 'n6', to: 'n4' }] : [{ id: 'e0', from: 'n0', to: 'n1' }];
  const graph = canvasWithLayout('g', '測試流程', nodes, edges);
  const details: ProjectDetails = { ...emptyProjectDetails, materials: [{ key: 'tin', name: '錫', dimension: 'mass', baseUnit: 'kg' }], nodes: {
    n0: { kind: 'pick', material: 'tin', location: 'raw' },
    ...(full ? {
      n1: { kind: 'fill' as const, material: 'tin', form: 'slip', requires: { batch: { type: 'string' as const } } },
      n2: { kind: 'sink' as const, direction: 'stock-in' as const, material: 'tin', location: 'stock' },
      n3: { kind: 'sink' as const, direction: 'ship-customer' as const, material: 'tin', location: 'customer' },
      n4: { kind: 'sink' as const, direction: 'ship-external' as const, material: 'tin', location: 'external' },
      n5: { kind: 'pick' as const, material: 'tin', location: 'raw' },
      n6: { kind: 'pick' as const, material: 'tin', location: 'raw' },
    } : { n1: { kind: 'sink' as const, direction: 'stock-in' as const, material: 'tin', location: 'stock' } }),
  } };
  const forms: FormLibrary = { ...emptyFormLibrary, forms: full ? [{ id: 'slip', name: '紀錄單', subject: ['lot.tin'], fields: { batch: { type: 'string', label: '批號' } } }] : [] };
  return { graph, details, forms };
}
export function projectFixture(full = true) {
  const { graph, details, forms } = example(full);
  const result = convertCanvas({ doc: graph, factoryId: 'g', graphId: 'g', details, forms, meta: { id: 'sample', name: '測試專案', version: 1, status: 'draft' } });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

