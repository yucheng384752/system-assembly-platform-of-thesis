import type { AttrValueType, FormDef } from '../aov-core';
import { checkFormDef, type LibraryIssue } from './formLibrary';

// Customer CSV: a header row, then one data row per record; the first column names the form (表單名稱).
// (aov-core's formCsv.ts is the other orientation, one row per field, and is left alone.)
// A draft keeps headers and the kind of value each column holds. Data rows are read once to infer that and are not kept.
export const FORM_NAME_HEADER = '表單名稱';
export type DateFormat = 'YYYY-MM-DD' | 'YYYY.MM.DD';
export interface DraftColumn {
  header: string;
  /** A suggestion only: a number column may be a quantity, which needs a unit nobody can read from a CSV. */
  suggestedType: AttrValueType;
  /** Set when the column holds dates in a layout that must be confirmed before use; nothing is converted here. */
  dateFormat?: DateFormat;
}
export interface FormDraft { name: string; columns: DraftColumn[] }
export type DraftResult = { ok: true; drafts: FormDraft[] } | { ok: false; errors: string[] };

export const MAX_CSV_BYTES = 2 * 1024 * 1024;

// RFC 4180 subset: quoted cells may hold commas, quotes ("") and line breaks.
function parseRows(text: string): string[][] | string {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, started = false;
  const endCell = () => { row.push(cell); cell = ''; started = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && !started) { quoted = true; started = true; }
    else if (c === ',') endCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endCell(); rows.push(row); row = [];
    } else { cell += c; started = true; }
  }
  if (quoted) return '有一個欄位的引號沒有結束。';
  if (cell !== '' || row.length) { endCell(); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOT_DATE = /^\d{4}\.\d{2}\.\d{2}$/;
const real = (year: number, month: number, day: number) => {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
};
const isDate = (value: string, pattern: RegExp, separator: string) => pattern.test(value) && real(...(value.split(separator).map(Number) as [number, number, number]));

function inferColumn(header: string, values: string[]): DraftColumn {
  const filled = values.map(v => v.trim()).filter(v => v !== '');
  const all = (test: (v: string) => boolean) => filled.length > 0 && filled.every(test);
  if (all(v => isDate(v, ISO_DATE, '-'))) return { header, suggestedType: 'datetime', dateFormat: 'YYYY-MM-DD' };
  if (all(v => isDate(v, DOT_DATE, '.'))) return { header, suggestedType: 'datetime', dateFormat: 'YYYY.MM.DD' };
  if (all(v => NUMBER.test(v) && Number.isFinite(Number(v)))) return { header, suggestedType: 'number' };
  if (all(v => /^(true|false)$/i.test(v))) return { header, suggestedType: 'bool' };
  return { header, suggestedType: 'string' };
}

export function draftFormsFromCsv(raw: string): DraftResult {
  if (raw.length > MAX_CSV_BYTES) return { ok: false, errors: ['檔案超過 2 MB，請拆成較小的檔案。'] };
  const rows = parseRows(raw.replace(/^﻿/, ''));
  if (typeof rows === 'string') return { ok: false, errors: [rows] };
  if (rows.length < 1) return { ok: false, errors: ['檔案是空的。'] };
  const [header, ...data] = rows;
  const errors: string[] = [];
  if (header[0]?.trim() !== FORM_NAME_HEADER) errors.push(`第 1 欄的標題必須是「${FORM_NAME_HEADER}」。`);
  const names = header.map(h => h.trim());
  names.forEach((h, i) => { if (!h) errors.push(`第 ${i + 1} 欄沒有標題。`); });
  const seen = new Set<string>();
  names.forEach((h, i) => { if (h && seen.has(h)) errors.push(`第 ${i + 1} 欄的標題「${h}」重複。`); seen.add(h); });
  if (names.length < 2) errors.push('除了表單名稱之外，至少要有一個欄位。');
  data.forEach((r, i) => { if (r.length > names.length) errors.push(`第 ${i + 2} 列的欄位數量比標題多。`); });
  if (!data.length) errors.push('沒有任何資料列，無法判斷各欄位的內容。');
  if (errors.length) return { ok: false, errors };

  const groups = new Map<string, string[][]>();
  data.forEach((r, i) => {
    const name = (r[0] ?? '').trim();
    if (!name) { errors.push(`第 ${i + 2} 列沒有填表單名稱。`); return; }
    groups.set(name, [...(groups.get(name) ?? []), r]);
  });
  if (errors.length) return { ok: false, errors };
  const drafts = [...groups].map(([name, group]): FormDraft => ({
    name,
    columns: names.slice(1).map((h, i) => inferColumn(h, group.map(r => r[i + 1] ?? ''))),
  }));
  return { ok: true, drafts };
}

/** What the engineer decides for one column. Nothing here is guessed from the CSV. */
export interface ColumnSetting {
  header: string;
  /** English identifier; never derived from the header. */
  key: string;
  type: AttrValueType;
  unit?: string;
  values?: string[];
  required?: boolean;
}
export interface FormSetting {
  id: string; subject: string[]; extends?: string; columns: ColumnSetting[];
  /** Headers the form deliberately leaves out. */
  skip?: string[];
}
export type FormBuild = { ok: true; form: FormDef } | { ok: false; issues: LibraryIssue[] };

/** Draft plus the engineer's settings, as a FormDef the library accepts. The CSV header becomes the label. */
export function buildFormDef(draft: FormDraft, setting: FormSetting): FormBuild {
  const issues: LibraryIssue[] = [];
  const known = new Set(draft.columns.map(c => c.header));
  const fields: FormDef['fields'] = {};
  for (const column of setting.columns) {
    if (!known.has(column.header)) { issues.push({ code: 'column-unknown', message: `表單「${draft.name}」沒有名為「${column.header}」的欄位。` }); continue; }
    if (column.key in fields) { issues.push({ code: 'field-key-duplicate', message: `欄位識別碼「${column.key}」被用了兩次。`, field: column.key }); continue; }
    fields[column.key] = {
      label: column.header, type: column.type,
      ...(column.unit !== undefined ? { unit: column.unit } : {}),
      ...(column.values !== undefined ? { values: [...column.values] } : {}),
      ...(column.required ? { required: true } : {}),
    };
  }
  for (const header of setting.skip ?? []) if (!known.has(header)) issues.push({ code: 'column-unknown', message: `表單「${draft.name}」沒有名為「${header}」的欄位可略過。` });
  const unset = draft.columns.filter(c => ![...setting.columns.map(s => s.header), ...(setting.skip ?? [])].includes(c.header));
  for (const column of unset) issues.push({ code: 'column-unset', message: `欄位「${column.header}」還沒有設定識別碼與型別；不需要的欄位請明確略過。` });
  const form: FormDef = { id: setting.id, name: draft.name, subject: [...setting.subject], ...(setting.extends ? { extends: setting.extends } : {}), fields };
  issues.push(...checkFormDef(form));
  return issues.length ? { ok: false, issues } : { ok: true, form };
}
