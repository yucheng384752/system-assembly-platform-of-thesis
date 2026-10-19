/**
 * 表單 CSV 匯入／匯出：一個 CSV 對應一張表單，每列一個欄位。
 * 表頭（中英文皆可）：欄位id(id)、標籤(label)、型別(type)、單位(unit)、預設值(default)、列舉值(values，以 | 分隔)、必填(required)
 */
import { isUnit } from '../model/units';
import type { AttrValueType, FieldDef, FormDef } from '../model/types';

export const FORM_CSV_HEADER = ['欄位id', '標籤', '型別', '單位', '預設值', '列舉值', '必填'] as const;
type Column = (typeof FORM_CSV_HEADER)[number];

export const FORM_CSV_TEMPLATE = `${FORM_CSV_HEADER.join(',')}
batchNo,批號,string,,B-20260101-01,,是
targetQty,生產總重,quantity,kg,100,,是
mixTemp,攪拌溫度,quantity,degC,25,,
grade,等級,enum,,A,A|B|C,
`;

const COLUMN_ALIASES: Record<string, Column> = {
  id: '欄位id',
  欄位id: '欄位id',
  欄位: '欄位id',
  label: '標籤',
  標籤: '標籤',
  type: '型別',
  型別: '型別',
  unit: '單位',
  單位: '單位',
  default: '預設值',
  預設值: '預設值',
  values: '列舉值',
  列舉值: '列舉值',
  required: '必填',
  必填: '必填',
};

const TYPE_ALIASES: Record<string, AttrValueType> = {
  number: 'number',
  數字: 'number',
  數值: 'number',
  string: 'string',
  文字: 'string',
  bool: 'bool',
  boolean: 'bool',
  布林: 'bool',
  是否: 'bool',
  datetime: 'datetime',
  日期時間: 'datetime',
  日期: 'datetime',
  enum: 'enum',
  列舉: 'enum',
  quantity: 'quantity',
  數量: 'quantity',
  'string[]': 'string[]',
  文字清單: 'string[]',
  json: 'json',
};

const TRUE_WORDS = new Set(['是', 'true', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['否', 'false', 'no', 'n', '0']);

/** RFC 4180 的最小實作：引號、雙引號跳脫、欄位內換行、CRLF、BOM */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface FormCsvMeta {
  id: string;
  name: string;
  /** 這張表描述什麼型別 */
  subject: string[];
}

export interface FormCsvResult {
  form?: FormDef;
  /** 每筆都帶列號（含表頭為第 1 列）；有任何錯誤就不產生 form */
  errors: string[];
}

export function parseFormCsv(text: string, meta: FormCsvMeta): FormCsvResult {
  const errors: string[] = [];
  const rows = parseCsv(text);
  if (rows.length === 0) return { errors: ['CSV 是空的'] };

  const col = new Map<Column, number>();
  rows[0].forEach((h, i) => {
    const t = h.trim();
    const key = COLUMN_ALIASES[t] ?? COLUMN_ALIASES[t.toLowerCase()];
    if (key && !col.has(key)) col.set(key, i);
  });
  for (const need of ['欄位id', '型別'] as const) {
    if (!col.has(need)) errors.push(`第 1 列：表頭缺少「${need}」欄（需要：${FORM_CSV_HEADER.join('、')}）`);
  }
  if (errors.length) return { errors };
  const get = (r: string[], k: Column) => (col.has(k) ? (r[col.get(k)!] ?? '').trim() : '');

  const fields: Record<string, FieldDef> = {};
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const err = (m: string) => void errors.push(`第 ${line} 列：${m}`);
    const id = get(r, '欄位id');
    if (!id) return err('欄位id 不可空白');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) return err(`欄位id「${id}」只能用英數字與底線，且不可以數字開頭（運算式會用 in.<表單>.${id} 引用）`);
    if (fields[id]) return err(`欄位id「${id}」重複`);
    const rawType = get(r, '型別');
    const type = TYPE_ALIASES[rawType] ?? TYPE_ALIASES[rawType.toLowerCase()];
    if (!type) return err(`欄位「${id}」的型別「${rawType}」不認得（可用：number、string、bool、datetime、enum、quantity、string[]、json）`);

    const f: FieldDef = { type };
    const label = get(r, '標籤');
    if (label) f.label = label;
    const unit = get(r, '單位');
    if (unit) {
      if (!isUnit(unit)) return err(`欄位「${id}」的單位「${unit}」不認得`);
      if (type !== 'quantity' && type !== 'number') return err(`欄位「${id}」是 ${type}，不能設定單位`);
      f.unit = unit;
    }
    if (type === 'quantity' && !f.unit) return err(`欄位「${id}」是 quantity，必須填單位`);
    const values = get(r, '列舉值');
    if (type === 'enum') {
      const list = values.split('|').map((x) => x.trim()).filter(Boolean);
      if (list.length === 0) return err(`欄位「${id}」是 enum，必須填列舉值（以 | 分隔，由低到高）`);
      f.values = list;
    } else if (values) return err(`欄位「${id}」不是 enum，不能設定列舉值`);

    const def = get(r, '預設值');
    if (def !== '') {
      if (type === 'number' || type === 'quantity') {
        const n = Number(def);
        if (!Number.isFinite(n)) return err(`欄位「${id}」的預設值「${def}」不是數字`);
        f.default = n;
      } else if (type === 'bool') {
        const w = def.toLowerCase();
        if (TRUE_WORDS.has(w)) f.default = true;
        else if (FALSE_WORDS.has(w)) f.default = false;
        else return err(`欄位「${id}」的預設值「${def}」不是 是／否`);
      } else if (type === 'enum') {
        if (!f.values!.includes(def)) return err(`欄位「${id}」的預設值「${def}」不在列舉值 ${f.values!.join('|')} 內`);
        f.default = def;
      } else if (type === 'string[]') {
        f.default = def.split('|').map((x) => x.trim()).filter(Boolean);
      } else if (type === 'json') {
        try {
          f.default = JSON.parse(def);
        } catch {
          return err(`欄位「${id}」的預設值不是合法 JSON`);
        }
      } else f.default = def;
    }
    const req = get(r, '必填').toLowerCase();
    if (req) {
      if (TRUE_WORDS.has(req)) f.required = true;
      else if (!FALSE_WORDS.has(req)) return err(`欄位「${id}」的必填「${req}」不是 是／否`);
    }
    fields[id] = f;
  });
  if (errors.length === 0 && Object.keys(fields).length === 0) errors.push('沒有任何欄位');
  if (errors.length) return { errors };
  return { form: { id: meta.id, name: meta.name, subject: meta.subject, fields }, errors };
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function defaultText(v: unknown): string {
  if (v === undefined) return '';
  if (Array.isArray(v)) return v.join('|');
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** 匯出成可用 Excel 編輯再匯入的 CSV */
export function formToCsv(form: FormDef): string {
  const lines = [FORM_CSV_HEADER.join(',')];
  for (const [id, f] of Object.entries(form.fields)) {
    const cells = [id, f.label ?? '', f.type, f.unit ?? '', defaultText(f.default), (f.values ?? []).join('|'), f.required ? '是' : ''];
    lines.push(cells.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
