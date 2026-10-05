import { validateSchema } from '../../../libs/ui-runtime/schema';
import { parseActionCatalog } from '../../../libs/ui-runtime/registry';
import actionData from '../../../config/actions.json';
import { fieldTypes, type FormDraft } from './localData';

// AoV Workflow document (business view, D18): steps, the forms filled at each step and confirmed relations (spec 4.2).
// An action only names what the step does and on which of its forms; the Kits it needs are derived from the registry (D62, D66).
export interface AovAction { actionId: string; formIds: string[] }
export interface AovStep { id: string; name: string; when: string; owner: string; formIds: string[]; actions: AovAction[] }
export interface FormEndpoint { formId: string; fieldId: string }
// Only confirmed relations are stored; inferred candidates stay derived until the user confirms them (D19).
export interface FormRelation { id: string; kind: 'shared-key'; from: FormEndpoint; to: FormEndpoint; origin: 'inferred' | 'user'; confirmed: true }
export interface AovDocument { format: 'composer-aov-list'; version: 3; steps: AovStep[]; forms: FormDraft[]; relations: FormRelation[] }
interface AovDocumentV2 { format: 'composer-aov-list'; version: 2; steps: Omit<AovStep, 'actions'>[]; forms: FormDraft[]; relations: FormRelation[] }
interface AovDocumentV1 { format: 'composer-aov-list'; version: 1; steps: { id: string; name: string; when: string; owner: string; formId: string }[] }

export const WORKFLOW_FILE = 'workflow.aov.json';
export const actionCatalog = parseActionCatalog(actionData);
const emptyAov: AovDocument = { format: 'composer-aov-list', version: 3, steps: [], forms: [], relations: [] };

const formName = (form: FormDraft) => form.name.trim() || '（未命名表單）';
export function nextId(prefix: string, taken: { id: string }[]): string {
  let count = 1; while (taken.some(item => item.id === `${prefix}-${count}`)) count++;
  return `${prefix}-${count}`;
}
// Form and relation helpers only need these two lists, so the graph document (version 4) reuses them.
export type FormsAndRelations = Pick<AovDocument, 'forms' | 'relations'>;
export function endpoint(doc: FormsAndRelations, at: FormEndpoint) {
  const form = doc.forms.find(f => f.id === at.formId);
  return { form, field: form?.fields.find(f => f.id === at.fieldId) };
}
export function describeEndpoint(doc: FormsAndRelations, at: FormEndpoint): string {
  const { form, field } = endpoint(doc, at);
  return form && field ? `「${formName(form)}」的「${field.name.trim() || '（未命名欄位）'}」` : '（已刪除的欄位）';
}

// A21 and D22: endpoints exist, key types match, one relation per form pair, no self link and no cycle.
export function relationErrors(doc: FormsAndRelations): string[] {
  const errors: string[] = [];
  const pairs = new Set<string>();
  for (const relation of doc.relations) {
    const from = endpoint(doc, relation.from); const to = endpoint(doc, relation.to);
    if (!from.field || !to.field) { errors.push('有關聯引用已刪除的表單或欄位，請刪除該關聯。'); continue; }
    if (relation.from.formId === relation.to.formId) errors.push(`${describeEndpoint(doc, relation.from)}不能與同一張表單建立關聯。`);
    else if (from.field.type !== to.field.type) errors.push(`${describeEndpoint(doc, relation.from)}（${fieldTypes[from.field.type]}）與${describeEndpoint(doc, relation.to)}（${fieldTypes[to.field.type]}）型別不同，無法作為關聯鍵。`);
    const pair = [relation.from.formId, relation.to.formId].sort().join('|');
    if (pairs.has(pair)) errors.push(`「${formName(from.form!)}」與「${formName(to.form!)}」之間只能有一條關聯。`);
    pairs.add(pair);
  }
  const cycle = findCycle(doc);
  if (cycle) errors.push(`關聯形成循環：${cycle.map(id => formName(doc.forms.find(f => f.id === id)!)).join(' → ')}。`);
  return errors;
}

// Directed form graph; returns the first cycle as a closed path of form IDs.
export function findCycle(doc: FormsAndRelations, extra?: { from: string; to: string }): string[] | undefined {
  const edges = [...doc.relations.map(r => ({ from: r.from.formId, to: r.to.formId })), ...(extra ? [extra] : [])]
    .filter(e => e.from !== e.to && doc.forms.some(f => f.id === e.from) && doc.forms.some(f => f.id === e.to));
  const done = new Set<string>();
  function visit(id: string, path: string[]): string[] | undefined {
    if (path.includes(id)) return [...path.slice(path.indexOf(id)), id];
    if (done.has(id)) return undefined;
    for (const edge of edges.filter(e => e.from === id)) { const found = visit(edge.to, [...path, id]); if (found) return found; }
    done.add(id); return undefined;
  }
  for (const form of doc.forms) { const found = visit(form.id, []); if (found) return found; }
  return undefined;
}

// Structural integrity the editor cannot represent; completeness problems stay visible as step errors instead.
function integrityError(doc: AovDocument): string {
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (!unique(doc.steps.map(s => s.id)) || !unique(doc.forms.map(f => f.id)) || !unique(doc.relations.map(r => r.id))
    || doc.forms.some(f => !unique(f.fields.map(field => field.id)))) return '流程規格含重複的識別碼。';
  if (doc.steps.some(s => s.formIds.some(id => !doc.forms.some(f => f.id === id)))) return '流程步驟引用的表單不存在。';
  if (doc.forms.some(f => doc.steps.filter(s => s.formIds.includes(f.id)).length > 1)) return '同一張表單不可屬於多個步驟。';
  if (doc.relations.some(r => !endpoint(doc, r.from).field || !endpoint(doc, r.to).field)) return '表單關聯引用的表單或欄位不存在。';
  const unknown = doc.steps.flatMap(s => s.actions.map(a => a.actionId)).find(id => !actionCatalog.actions.some(a => a.id === id));
  if (unknown) return `流程步驟引用了不存在的動作「${unknown}」。`;
  if (doc.steps.some(s => !unique(s.actions.map(a => a.actionId)))) return '同一個步驟不可重複相同的動作。';
  if (doc.steps.some(s => s.actions.some(a => a.formIds.some(id => !doc.forms.some(f => f.id === id))))) return '動作引用的表單不存在。';
  return '';
}

// Imports into a detached candidate; callers replace the session only after this returns.
export function importAov(text: string): { value: AovDocument; notices: string[] } {
  if (text.length > 2 * 1024 * 1024) throw new Error('流程規格不可超過 2 MB。');
  let input: AovDocument | AovDocumentV2 | AovDocumentV1;
  try { input = JSON.parse(text.replace(/^﻿/, '')); validateSchema('aov', input); }
  catch { throw new Error('流程規格格式不正確。請使用本系統下載的流程規格檔。原流程已保留。'); }
  if ((input as { version: number }).version === 4) throw new Error('此流程規格是畫布版本（version 4），目前的編輯畫面尚未支援。原流程已保留。');
  const notices: string[] = [];
  let value: AovDocument;
  if (input.version === 1) {
    // Version 1 has no form definitions, so its single form references cannot be resolved.
    const dropped = input.steps.filter(s => s.formId).map(s => `「${s.name}」`);
    if (dropped.length) notices.push(`舊版流程規格不含表單定義，已清除以下步驟的表單指派：${dropped.join('、')}。`);
    value = { ...emptyAov, steps: input.steps.map(({ formId: _formId, ...step }) => ({ ...step, formIds: [], actions: [] })) };
  } else if (input.version === 2) value = { ...input, version: 3, steps: input.steps.map(step => ({ ...step, actions: [] })) };
  else value = input;
  const error = integrityError(value);
  if (error) throw new Error(`${error}原流程已保留。`);
  return { value, notices };
}

// SHA-256 of the exact UTF-8 bytes that are downloaded, recorded in Recipe.workflowRef (D29, A22).
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
