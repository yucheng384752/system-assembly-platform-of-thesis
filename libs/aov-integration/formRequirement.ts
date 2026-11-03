import { isUnit, type AttrValueType, type FormDef } from '../aov-core';
import { FIELD_TYPES, KEY_PATTERN } from './formLibrary';

// What a workflow needs from a form: the only dependency the workflow side has on the form library.
// Keyed by field key. Labels, order, ranges, required flags and extra fields are the form's own business.
export interface RequiredField { type: AttrValueType; unit?: string; values?: string[] }
export type FormRequirement = Record<string, RequiredField>;
export interface NodeBinding {
  /** Library form this node fills in. */
  form?: string;
  /** When present, replaces the action's default requirement as a whole (no per-field merge, so the engineer sees the full list). */
  requires?: FormRequirement;
}
export interface RequirementFile {
  format: 'composer-form-requirement'; version: 1;
  /** Default requirement per action id. */
  actions: Record<string, FormRequirement>;
  /** Per node id. */
  nodes: Record<string, NodeBinding>;
}
export interface RequirementIssue { code: string; message: string; nodeId?: string; actionId?: string; field?: string }

export const emptyRequirementFile: RequirementFile = { format: 'composer-form-requirement', version: 1, actions: {}, nodes: {} };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function checkRequirement(requirement: unknown, owner: { nodeId?: string; actionId?: string }): RequirementIssue[] {
  const where = owner.nodeId ? `節點「${owner.nodeId}」` : `動作「${owner.actionId}」`;
  if (!isObject(requirement)) return [{ code: 'requirement-shape', message: `${where}的表單需求必須是一個物件。`, ...owner }];
  const issues: RequirementIssue[] = [];
  for (const [key, raw] of Object.entries(requirement)) {
    const add = (code: string, message: string) => issues.push({ code, message: `${where}需要的欄位「${key}」${message}`, ...owner, field: key });
    if (!KEY_PATTERN.test(key)) { add('requirement-key', '的識別碼只能用英文字母、數字與底線，且不可以數字開頭。'); continue; }
    if (!isObject(raw) || !FIELD_TYPES.includes(raw.type as AttrValueType)) { add('requirement-type', '沒有有效的型別。'); continue; }
    if (raw.unit !== undefined && (typeof raw.unit !== 'string' || !isUnit(raw.unit))) add('requirement-unit', `的單位「${String(raw.unit)}」不是已知的單位。`);
    if (raw.type === 'quantity' && raw.unit === undefined) add('requirement-unit-missing', '是帶單位的數量，必須指定單位。');
    if (raw.values !== undefined && (!Array.isArray(raw.values) || !raw.values.every(v => typeof v === 'string' && v !== ''))) add('requirement-values', '的選項必須是文字清單。');
    if (raw.type === 'enum' && (!Array.isArray(raw.values) || !raw.values.length)) add('requirement-values', '是選項欄位，必須列出需要的選項。');
  }
  return issues;
}

export function checkRequirementFile(raw: unknown): RequirementIssue[] {
  if (!isObject(raw)) return [{ code: 'requirement-shape', message: '表單需求檔必須是一個物件。' }];
  if (raw.format !== 'composer-form-requirement') return [{ code: 'requirement-format', message: '這不是表單需求檔。' }];
  if (raw.version !== 1) return [{ code: 'requirement-version', message: `不支援的表單需求檔版本：${String(raw.version)}。` }];
  if (!isObject(raw.actions) || !isObject(raw.nodes)) return [{ code: 'requirement-shape', message: '表單需求檔缺少動作或節點的清單。' }];
  const issues = Object.entries(raw.actions).flatMap(([actionId, r]) => checkRequirement(r, { actionId }));
  for (const [nodeId, binding] of Object.entries(raw.nodes)) {
    if (!isObject(binding)) { issues.push({ code: 'binding-shape', message: `節點「${nodeId}」的設定必須是一個物件。`, nodeId }); continue; }
    if (binding.form !== undefined && (typeof binding.form !== 'string' || !KEY_PATTERN.test(binding.form))) {
      issues.push({ code: 'binding-form', message: `節點「${nodeId}」選擇的表單識別碼無效。`, nodeId });
    }
    if (binding.requires !== undefined) issues.push(...checkRequirement(binding.requires, { nodeId }));
  }
  return issues;
}

/** The requirement in force for a node: its own list if it set one, else its action's default, else nothing. */
export function effectiveRequirement(file: RequirementFile, node: { id: string; action?: string }): FormRequirement {
  const own = file.nodes[node.id]?.requires;
  if (own) return own;
  return (node.action !== undefined ? file.actions[node.action] : undefined) ?? {};
}

export interface Violation { code: 'missing' | 'type' | 'unit' | 'values'; field: string; message: string }

/**
 * Does `form` offer everything `requirement` asks for? Extra fields, other labels, ranges and required flags never matter.
 * A different unit does not satisfy even within one dimension: a guard written against kg must not silently read grams.
 */
export function satisfies(form: FormDef, requirement: FormRequirement): Violation[] {
  const violations: Violation[] = [];
  const name = form.name || form.id;
  for (const [key, need] of Object.entries(requirement)) {
    const have = form.fields[key];
    const say = (code: Violation['code'], message: string) => violations.push({ code, field: key, message: `表單「${name}」${message}` });
    if (!have) { say('missing', `沒有流程需要的欄位「${key}」。`); continue; }
    const shown = have.label ? `「${have.label}」（${key}）` : `「${key}」`;
    if (have.type !== need.type) { say('type', `的欄位${shown}型別與流程需要的不同。`); continue; }
    if (need.unit !== undefined && have.unit !== need.unit) say('unit', `的欄位${shown}單位是「${have.unit ?? '未設定'}」，流程需要「${need.unit}」。`);
    const missing = (need.values ?? []).filter(v => !have.values?.includes(v));
    if (missing.length) say('values', `的欄位${shown}缺少流程用到的選項：${missing.map(v => `「${v}」`).join('、')}。`);
  }
  return violations;
}
