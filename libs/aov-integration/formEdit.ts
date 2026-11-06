import type { AttrValueType, FormDef } from '../aov-core';
import { checkFormDef } from './formLibrary';
import type { FormDraft } from './formCsvImport';

// The form as the engineer edits it: a list of rows with text boxes, which may be half filled. Only a complete one becomes a FormDef.
export interface EditField {
  key: string;
  label: string;
  type: AttrValueType;
  unit: string;
  required: boolean;
  /** Options of an enum field, one per line. */
  values: string;
  /** Something the engineer must confirm, e.g. the date layout found in a CSV; never saved. */
  note?: string;
}
export interface EditForm { id: string; name: string; subject: string[]; fields: EditField[] }

export const FIELD_TYPE_LABEL: Record<AttrValueType, string> = {
  string: '文字', number: '數字', quantity: '數量（含單位）', bool: '是或否', datetime: '日期與時間', enum: '選項', 'string[]': '文字清單', json: '結構資料',
};

export const blankField = (): EditField => ({ key: '', label: '', type: 'string', unit: '', required: false, values: '' });
export const blankForm = (): EditForm => ({ id: '', name: '', subject: [], fields: [blankField()] });

export function fromFormDef(def: FormDef): EditForm {
  return {
    id: def.id, name: def.name, subject: [...def.subject],
    fields: Object.entries(def.fields).map(([key, f]) => ({ key, label: f.label ?? '', type: f.type, unit: f.unit ?? '', required: f.required === true, values: (f.values ?? []).join('\n') })),
  };
}

/** A CSV draft: headers become labels, the suggested types are only a start, and every key is left for the engineer. */
export function fromDraft(draft: FormDraft): EditForm {
  return {
    id: '', name: draft.name, subject: [],
    fields: draft.columns.map(c => ({
      key: '', label: c.header, type: c.suggestedType, unit: '', required: false, values: '',
      ...(c.dateFormat === 'YYYY.MM.DD' ? { note: `CSV 的日期寫成 ${c.dateFormat}，請確認格式。` } : {}),
    })),
  };
}

const lines = (text: string) => text.split(/\r?\n/).map(v => v.trim()).filter(Boolean);

export function toFormDef(edit: EditForm): FormDef {
  const fields: FormDef['fields'] = {};
  for (const f of edit.fields) {
    fields[f.key] = {
      ...(f.label.trim() ? { label: f.label.trim() } : {}), type: f.type,
      ...(f.unit ? { unit: f.unit } : {}), ...(f.type === 'enum' ? { values: lines(f.values) } : {}), ...(f.required ? { required: true } : {}),
    };
  }
  return { id: edit.id, name: edit.name, subject: [...edit.subject], fields };
}

/** Why this form cannot be saved yet, in business language. Empty means it can. */
export function editIssues(edit: EditForm): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  edit.fields.forEach((f, i) => {
    const name = f.label.trim() ? `欄位「${f.label.trim()}」` : `第 ${i + 1} 個欄位`;
    if (!f.key.trim()) issues.push(`${name}還沒有填識別碼。`);
    else if (seen.has(f.key)) issues.push(`${name}的識別碼「${f.key}」與前面的欄位重複。`);
    seen.add(f.key);
  });
  if (issues.length) return issues;
  return checkFormDef(toFormDef(edit)).map(i => i.message);
}
