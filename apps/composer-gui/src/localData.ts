export const fieldTypes = { text: '文字', integer: '整數', decimal: '小數', boolean: '是／否', date: '日期' };
export type FieldType = keyof typeof fieldTypes;
export interface FormField { id: string; name: string; type: FieldType; required: boolean }
export interface FormDraft { id: string; name: string; fields: FormField[] }
export const emptyForm: FormDraft = { id: 'form-1', name: '我的表單', fields: [] };
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

function inferType(value: string): FieldType {
  if (/^(true|false)$/i.test(value)) return 'boolean';
  if (/^-?(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value))) return 'integer';
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(value) && Number.isFinite(Number(value))) return 'decimal';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value) return 'date';
  }
  return 'text';
}

// Raw cells exist only during inference. No data rows or samples leave this function.
export function inferFields(text: string, separator: ',' | '\t'): FormField[] {
  if (text.length > MAX_FILE_BYTES) throw new Error('檔案過大，請使用 2 MB 以下的樣本。');
  text = text.replace(/^\uFEFF/, '');
  let cell = ''; let row: string[] = []; let quoted = false; let closed = false; let rowCount = 0;
  let fields: FormField[] = []; const inferred: (FieldType | undefined)[] = [];
  function endCell() {
    row.push(cell); cell = ''; closed = false;
    if (row.length > 100) throw new Error('欄位不可超過 100 個。');
  }
  function endRow() {
    endCell();
    if (rowCount === 0) {
      const headers = row.map(v => v.trim());
      if (headers.some(v => !v || v.length > 100) || new Set(headers).size !== headers.length) throw new Error('第一列須為不重複且非空白的欄位名稱，每個名稱最多 100 字。');
      fields = headers.map((name, index) => ({ id: `field-${index + 1}`, name, type: 'text', required: true }));
    } else {
      if (row.length !== fields.length) throw new Error(`第 ${rowCount + 1} 列的欄位數與標題不一致。`);
      row.forEach((value, index) => {
        const trimmed = value.trim();
        if (!trimmed) { fields[index].required = false; return; }
        const type = inferType(trimmed); const previous = inferred[index];
        inferred[index] = previous === undefined || previous === type ? type
          : [previous, type].every(t => t === 'integer' || t === 'decimal') ? 'decimal' : 'text';
      });
    }
    row = []; rowCount++;
    if (rowCount > 10001) throw new Error('樣本不可超過 10000 筆資料。');
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === separator) endCell();
    else if (char === '\n' || char === '\r') { endRow(); if (char === '\r' && text[i + 1] === '\n') i++; }
    else if (char === '"' && cell === '' && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error('引號格式不正確，請檢查檔案。');
      cell += char;
    }
  }
  if (quoted) throw new Error('引號未結束，請檢查檔案。');
  if (cell || row.length || closed) endRow();
  if (!fields.length) throw new Error('檔案沒有欄位標題。');
  return fields.map((field, index) => ({ ...field, type: inferred[index] ?? 'text', required: rowCount > 1 && field.required }));
}

export function formError(form: FormDraft): string {
  if (!form.name.trim()) return '請填寫表單名稱。';
  if (form.fields.some(f => !f.name.trim())) return '請填寫每個欄位的名稱。';
  if (new Set(form.fields.map(f => f.name.trim())).size !== form.fields.length) return '欄位名稱不能重複。';
  return '';
}
