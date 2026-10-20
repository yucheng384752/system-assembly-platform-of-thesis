import type { FormField } from './localData';
export function simulationFieldError(field: FormField, value: string): string {
  if (!value.trim()) return field.required ? `${field.name}為必填。` : '';
  const r = field.validation;
  if (field.type === 'integer' || field.type === 'decimal') {
    const n = Number(value);
    if (!Number.isFinite(n) || (field.type === 'integer' && !Number.isSafeInteger(n))) return `${field.name}需為有效${field.type === 'integer' ? '整數' : '數值'}。`;
    if ((r?.minimum !== undefined && n < r.minimum) || (r?.maximum !== undefined && n > r.maximum)) return `${field.name}超出表單規格。`;
  }
  if (field.type === 'text' && ((r?.maxLength !== undefined && value.length > r.maxLength) || (r?.allowedValues && !r.allowedValues.includes(value)))) return `${field.name}不符合文字規則。`;
  if (field.type === 'date') {
    const d = new Date(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) return `${field.name}日期無效。`;
    if ((r?.minimumDate && value < r.minimumDate) || (r?.maximumDate && value > r.maximumDate)) return `${field.name}超出日期範圍。`;
  }
  if (field.type === 'boolean' && !['true', 'false'].includes(value)) return `${field.name}請選擇是或否。`;
  return '';
}
export interface SimulationSession { values: Record<string, Record<string, string>>; completed: string[]; active: string; signature: string; product: string }
export const emptySimulation: SimulationSession = { values: {}, completed: [], active: '', signature: '', product: '' };
