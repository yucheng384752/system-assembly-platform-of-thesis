import { importWorkflow, type AovGraphDocument } from './workflowGraph';

export function importAny(text: string): { value: AovGraphDocument; notices: string[] } {
  let input: unknown;
  try { input = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('無法辨識的檔案格式。原流程已保留。'); }
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || ('format' in input && input.format !== 'composer-aov-list')) {
    throw new Error('無法辨識的檔案格式。原流程已保留。');
  }
  return importWorkflow(text);
}
