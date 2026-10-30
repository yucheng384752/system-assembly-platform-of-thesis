import { isUnit, type AttrValueType, type FormDef } from '../aov-core';

// The form library: form definitions kept apart from any workflow. A workflow only names a form and the fields it needs
// (formRequirement.ts); nothing here refers to a node, an action or a flow.
export interface FormLibrary { format: 'composer-form-library'; version: 1; forms: FormDef[] }
export interface LibraryIssue { code: string; message: string; formId?: string; field?: string }

export const emptyFormLibrary: FormLibrary = { format: 'composer-form-library', version: 1, forms: [] };

// Same rule as aov-core's form CSV: expressions reach a field as in.<form>.<key>, so a key is an identifier.
// It is also never normalized by the plan's canonical JSON (contract 5), which is why a key is not free text.
export const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Mirrors services/factory/factory_core/forms.py FIELD_TYPES.
export const FIELD_TYPES: readonly AttrValueType[] = ['number', 'string', 'bool', 'datetime', 'enum', 'quantity', 'string[]', 'json'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

export function checkFormDef(form: unknown): LibraryIssue[] {
  if (!isObject(form)) return [{ code: 'form-shape', message: '表單必須是一個物件。' }];
  const issues: LibraryIssue[] = [];
  const id = typeof form.id === 'string' ? form.id : undefined;
  const label = isText(form.name) ? `表單「${form.name}」` : id ? `表單「${id}」` : '有一張表單';
  const add = (code: string, message: string, field?: string) => issues.push({ code, message: `${label}${message}`, formId: id, field });

  if (!id || !KEY_PATTERN.test(id)) add('form-id', '的識別碼只能用英文字母、數字與底線，且不可以數字開頭。');
  if (!isText(form.name)) add('form-name', '沒有名稱。');
  if (!Array.isArray(form.subject) || !form.subject.length || !form.subject.every(isText)) add('form-subject', '尚未指定描述的對象（subject）。');
  if (form.extends !== undefined && !isText(form.extends)) add('form-extends', '的繼承型別必須是文字。');
  if (!isObject(form.fields) || !Object.keys(form.fields).length) { add('form-fields', '尚未建立欄位。'); return issues; }

  for (const [key, raw] of Object.entries(form.fields)) {
    const at = `欄位「${key}」`;
    if (!KEY_PATTERN.test(key)) { add('field-key', `的${at}識別碼只能用英文字母、數字與底線，且不可以數字開頭。`, key); continue; }
    if (!isObject(raw)) { add('field-shape', `的${at}必須是一個物件。`, key); continue; }
    if (!FIELD_TYPES.includes(raw.type as AttrValueType)) { add('field-type', `的${at}型別不明。`, key); continue; }
    if (raw.label !== undefined && !isText(raw.label)) add('field-label', `的${at}標籤不能是空白。`, key);
    if (raw.required !== undefined && typeof raw.required !== 'boolean') add('field-required', `的${at}必填必須是是或否。`, key);
    if (raw.unit !== undefined && (typeof raw.unit !== 'string' || !isUnit(raw.unit))) add('field-unit', `的${at}單位「${String(raw.unit)}」不是已知的單位。`, key);
    if (raw.type === 'quantity' && raw.unit === undefined) add('field-unit-missing', `的${at}是帶單位的數量，必須指定單位。`, key);
    if (raw.type === 'enum') {
      const values = raw.values;
      if (!Array.isArray(values) || !values.length || !values.every(isText) || new Set(values).size !== values.length) {
        add('field-values', `的${at}是選項欄位，必須列出不重複的選項。`, key);
      }
    }
  }
  return issues;
}

export function checkFormLibrary(raw: unknown): LibraryIssue[] {
  if (!isObject(raw)) return [{ code: 'library-shape', message: '表單庫必須是一個物件。' }];
  if (raw.format !== 'composer-form-library') return [{ code: 'library-format', message: '這不是表單庫檔案。' }];
  if (raw.version !== 1) return [{ code: 'library-version', message: `不支援的表單庫版本：${String(raw.version)}。` }];
  if (!Array.isArray(raw.forms)) return [{ code: 'library-shape', message: '表單庫缺少表單清單。' }];
  const issues = raw.forms.flatMap(checkFormDef);
  const seen = new Set<string>();
  for (const form of raw.forms) {
    const id = isObject(form) ? form.id : undefined;
    if (typeof id !== 'string') continue;
    if (seen.has(id)) issues.push({ code: 'form-duplicate', message: `表單識別碼「${id}」重複，無法決定使用哪一張。`, formId: id });
    seen.add(id);
  }
  return issues;
}
