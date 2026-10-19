import { MAX_FORMS, type FieldType, type FormDraft } from './localData';
import { deleteFactory } from './canvasEditing';
import { integrityErrors, MAX_FACTORIES, MAX_GRAPHS, MAX_LOGICS, MAX_NODES, newGraphParts, type AovGraphDocument, type GraphNode } from './workflowGraph';

export const exampleHints = {
  factory: '例：第一廠', logic: '例：配料混合產線', name: '例：配料',
  when: '例：領料完成後', owner: '例：現場操作員', form: '例：配料紀錄',
  field: '例：批號、原料 A 實際重量', number: '依貴廠規格填寫',
};

export const hasExample = (doc: AovGraphDocument) => doc.factories.some(f => f.id.startsWith('example-'));

// Use the same ownership-based deletion as the factory page, including user edits inside example factories.
export function clearExample(doc: AovGraphDocument) {
  const factories = doc.factories.filter(f => f.id.startsWith('example-'));
  const result: ReturnType<typeof deleteFactory> & { factories: typeof factories } = {
    value: doc, factories, graphs: [], nodes: [], forms: [], relations: [],
  };
  for (const factory of factories) {
    const removed = deleteFactory(result.value, factory.id);
    result.value = removed.value;
    result.graphs.push(...removed.graphs); result.nodes.push(...removed.nodes);
    result.forms.push(...removed.forms); result.relations.push(...removed.relations);
  }
  return result;
}

// Include every namespace: example ids never collide even with fields in existing forms.
function documentIds(doc: AovGraphDocument): string[] {
  return [...doc.factories, ...doc.graphs, ...doc.graphs.flatMap(g => [...g.nodes, ...g.edges]),
    ...doc.forms, ...doc.forms.flatMap(f => f.fields), ...doc.relations].map(item => item.id);
}

export function loadExample(doc: AovGraphDocument): AovGraphDocument {
  if (hasExample(doc)) return doc;
  if (doc.factories.length >= MAX_FACTORIES) throw new Error('工廠數量已達上限，未載入範例。');
  if (doc.graphs.length >= MAX_GRAPHS) throw new Error('流程數量已達上限，未載入範例。');
  if (doc.forms.length + 5 > MAX_FORMS) throw new Error('表單數量已達上限，未載入範例。');
  if (doc.relations.length + 4 > 1225) throw new Error('關聯數量已達上限，未載入範例。');
  const used = new Set(documentIds(doc));
  const fresh = (name: string) => {
    const base = `example-${name}`;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id); return id;
  };
  const form = (name: string, fields: [string, FieldType][]): FormDraft => ({
    id: fresh('form'), name, fields: [['批號', 'text'] as [string, FieldType], ...fields].map(([name, type], index) => ({
      id: fresh('field'), name, type, required: index === 0, isKey: index === 0,
    })),
  });
  const forms = [
    form('領料單', [['工單號', 'text'], ['領料數量', 'decimal'], ['領料日期', 'date']]),
    form('配料紀錄', [['原料 A 實際重量', 'decimal'], ['原料 B 實際重量', 'decimal']]),
    form('混合紀錄', [['混合時間', 'integer'], ['混合完成', 'boolean']]),
    form('檢驗紀錄', [['檢驗值', 'decimal'], ['檢驗日期', 'date']]),
    form('包裝紀錄', [['包裝數量', 'integer']]),
  ];
  const steps: [string, string, string, string | null][] = [
    ['開立領料單', '接到生產工單後', '生管人員', forms[0].id],
    ['領料', '領料單核准後', '倉管人員', null],
    ['配料', '領料完成後', '現場操作員', forms[1].id],
    ['混合', '配料完成後', '現場操作員', forms[2].id],
    ['品質檢驗', '混合完成後', '品管人員', forms[3].id],
    ['包裝入庫', '檢驗合格後', '現場操作員', forms[4].id],
  ];
  const graph = newGraphParts(fresh('graph'), '配料混合產線（範例）').graph;
  const [start, end] = graph.nodes.map(node => ({ ...node, id: fresh(node.kind) }));
  const nodes: GraphNode[] = steps.map(([name, when, owner, formId]) => ({
    id: fresh('node'), kind: 'node', name, when, owner, formId, actionId: null, params: {}, childGraphId: null,
  }));
  graph.nodes = [start, ...nodes, end];
  graph.edges = graph.nodes.slice(1).map((node, i) => ({ id: fresh('edge'), from: graph.nodes[i].id, to: node.id }));
  const factory = { id: fresh('factory'), name: '第一廠（範例）', logicGraphIds: [graph.id] };
  if (graph.nodes.length > MAX_NODES || factory.logicGraphIds.length > MAX_LOGICS) throw new Error('節點或生產邏輯數量已達上限，未載入範例。');
  const value: AovGraphDocument = {
    ...doc, factories: [...doc.factories, factory], graphs: [...doc.graphs, graph], forms: [...doc.forms, ...forms],
    layout: { ...doc.layout, [graph.id]: Object.fromEntries(graph.nodes.map((node, i) => [node.id, { x: i * 160, y: 0 }])) },
    relations: [...doc.relations, ...forms.slice(1).map((form, i) => ({
      id: fresh('relation'), kind: 'shared-key' as const, origin: 'user' as const, confirmed: true as const,
      from: { formId: forms[i].id, fieldId: forms[i].fields[0].id }, to: { formId: form.id, fieldId: form.fields[0].id },
    }))],
  };
  const [error] = integrityErrors(value);
  if (error) throw new Error(`${error}未載入範例。`);
  return value;
}
