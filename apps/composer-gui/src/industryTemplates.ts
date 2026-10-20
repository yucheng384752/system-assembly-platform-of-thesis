import templates from './industryTemplates.json';
import { addCanvasNode, patchCanvasNode } from './canvasEditing';
import { nextId } from './workflow';
import { MAX_FORMS, type FormField } from './localData';
import { MAX_NODES, type AovGraphDocument } from './workflowGraph';
export const industryTemplates = templates;
// Templates provide record fields through the existing forms capability, not manufacturing automation.
export function addIndustryTemplate(doc: AovGraphDocument, graphId: string, templateId: string): AovGraphDocument {
  const template = templates.find(t => t.id === templateId), graph = doc.graphs.find(g => g.id === graphId);
  if (!template || !graph) throw new Error('範本或流程不存在。');
  if (doc.forms.length >= MAX_FORMS || graph.nodes.length >= MAX_NODES) throw new Error('已達表單或節點上限，未新增範本。');
  let next = addCanvasNode(doc, graphId, 'define-form');
  const node = next.graphs.find(g => g.id === graphId)!.nodes.at(-1)!;
  const id = nextId('form', next.forms);
  const numeric = new Set(['數量', '計畫數量', '實際用量', '實際重量', '充填重量', '轉速', '檢驗值', '實測值', '抽樣數']);
  const fields: FormField[] = template.fields.map((name, i) => ({ id: `field-${i + 1}`, name, type: numeric.has(name) ? 'decimal' : 'text', required: true, isKey: false }));
  next = patchCanvasNode(next, node.id, { name: template.name, formId: id, when: '完成作業時填寫紀錄', owner: '現場操作員' });
  return { ...next, forms: [...next.forms, { id, name: `${template.name}紀錄`, fields }] };
}
