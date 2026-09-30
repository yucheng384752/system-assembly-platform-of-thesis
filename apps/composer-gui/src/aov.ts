import { validateSchema } from '../../../libs/ui-runtime/schema';
export interface AovStep { id: string; name: string; when: string; owner: string; formId: string }
export interface AovDocument { format: 'composer-aov-list'; version: 1; steps: AovStep[] }
export const emptyAov: AovDocument = { format: 'composer-aov-list', version: 1, steps: [] };
export function importAov(text: string, formIds: string[]): AovDocument {
  if (text.length > 2 * 1024 * 1024) throw new Error('流程規格不可超過 2 MB。');
  let value: AovDocument;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); validateSchema('aov', value); }
  catch { throw new Error('流程規格格式不正確。請使用本頁下載的清單格式，檢查必填名稱與文字長度。原流程已保留。'); }
  if (new Set(value.steps.map(s => s.id)).size !== value.steps.length) throw new Error('流程步驟識別碼重複，原流程已保留。');
  if (value.steps.some(s => !s.name.trim())) throw new Error('請填寫每個步驟的名稱。');
  if (value.steps.some(s => s.formId !== '' && !formIds.includes(s.formId))) throw new Error('流程引用的表單不存在或尚未完成，請先在資料來源頁建立表單。原流程已保留。');
  return value;
}
export function exportAov(value: AovDocument, formIds: string[]): string {
  return JSON.stringify(importAov(JSON.stringify(value), formIds), null, 2);
}
