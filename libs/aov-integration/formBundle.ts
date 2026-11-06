import { checkFormDef } from './formLibrary';
import { contentSha256 } from './index';
import type { PlanForm } from './executablePlan';

// The forms a plan names, in the shape the factory takes them: each entry is exactly a `POST /api/factory/forms` body.
// Composer downloads this beside the plan; the system package assembler carries it into the package.
export interface FormBundle { format: 'composer-form-bundle'; version: 1; forms: PlanForm[] }

export const makeFormBundle = (forms: PlanForm[]): FormBundle => ({ format: 'composer-form-bundle', version: 1, forms });

export async function checkFormBundle(raw: unknown): Promise<string[]> {
  const bundle = raw as Partial<FormBundle> | null;
  if (!bundle || typeof bundle !== 'object' || bundle.format !== 'composer-form-bundle') return ['這不是表單檔包。'];
  if (bundle.version !== 1) return [`不支援的表單檔包版本：${String(bundle.version)}。`];
  if (!Array.isArray(bundle.forms)) return ['表單檔包缺少表單清單。'];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of bundle.forms.entries()) {
    const at = `第 ${index + 1} 張表單`;
    if (!entry || typeof entry !== 'object' || Object.keys(entry).sort().join() !== 'contentSha256,definition') { errors.push(`${at}必須正好有 contentSha256 與 definition。`); continue; }
    const problems = checkFormDef(entry.definition);
    if (problems.length) { errors.push(...problems.map(p => p.message)); continue; }
    let actual: string;
    try { actual = await contentSha256(entry.definition); }
    catch (error) { errors.push(`${at}的內容無法計算雜湊：${error instanceof Error ? error.message : String(error)}`); continue; }
    if (actual !== entry.contentSha256) { errors.push(`${at}（${entry.definition.id}）的雜湊與內容不符，內容在產生後被改過。`); continue; }
    if (seen.has(actual)) errors.push(`${at}（${entry.definition.id}）與前面的表單內容重複。`);
    seen.add(actual);
  }
  return errors;
}
