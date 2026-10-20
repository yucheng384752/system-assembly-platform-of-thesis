export interface ProductionSettings {
  version: 1;
  formats: { id: string; name: string; pattern: string }[];
  defaultFormatId: string;
  products: { id: string; name: string; formatId: string; formId: string; fieldId: string; lower: number | null; upper: number | null; unit: string }[];
}
export const emptyProduction: ProductionSettings = { version: 1, formats: [], defaultFormatId: '', products: [] };
export function productionErrors(s: ProductionSettings): string[] {
  const errors: string[] = [];
  const tokens = ['廠區', '產品', '類別', '日期', '流水號'];
  for (const f of s.formats) {
    if (!f.id.trim() || !f.name.trim()) errors.push('批號格式需有代碼與名稱。');
    const matches = [...f.pattern.matchAll(/\{([^{}]+)\}/g)];
    if (!matches.some(m => m[1] === '流水號') || matches.some(m => !tokens.includes(m[1])) || /[{}]/.test(f.pattern.replace(/\{[^{}]+\}/g, ''))) errors.push(`「${f.name}」格式須包含 {流水號}，且只能使用廠區、產品、類別、日期、流水號。`);
  }
  if (new Set(s.formats.map(f => f.id)).size !== s.formats.length || new Set(s.formats.map(f => f.name.trim())).size !== s.formats.length) errors.push('批號格式代碼與名稱不可重複。');
  if ((s.formats.length || s.defaultFormatId) && !s.formats.some(f => f.id === s.defaultFormatId)) errors.push('請選擇預設批號格式。');
  if (new Set(s.products.map(p => p.id.trim())).size !== s.products.length) errors.push('產品代碼不可重複。');
  for (const p of s.products) {
    if (!p.id.trim() || !p.name.trim()) errors.push('請填寫產品代碼與名稱。');
    if (!s.formats.some(f => f.id === p.formatId)) errors.push(`「${p.name}」請指定批號格式。`);
    if (!p.formId || !p.fieldId || !p.unit.trim() || p.lower === null || p.upper === null || !Number.isFinite(p.lower) || !Number.isFinite(p.upper) || p.lower > p.upper) errors.push(`「${p.name}」需指定檢驗欄位、單位與有效上下限；下限不可大於上限。`);
  }
  return errors;
}
export function sampleBatch(pattern: string, product: string): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/-/g, '');
  return pattern.replace(/\{([^{}]+)\}/g, (_, key: string) => ({ 廠區: 'DEMO', 產品: product, 類別: 'A', 日期: date, 流水號: '0001' }[key] ?? `{${key}}`));
}
