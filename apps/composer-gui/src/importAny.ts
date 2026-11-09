import { importWorkflow, type AovGraphDocument } from './workflowGraph';
import { kits } from './catalog';
import { parseKitWorkflow } from './kitWorkflows';
import { kitWorkflowToCanvas } from './kitExamples';

export function importAny(text: string): { value: AovGraphDocument; notices: string[] } {
  let input: unknown;
  try { input = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('無法辨識的檔案格式。原流程已保留。'); }
  if (typeof input === 'object' && input !== null && 'format' in input && input.format === 'composer-kit-workflow'
    && 'kitId' in input && typeof input.kitId === 'string') {
    const kit = kits.find(kit => kit.id === input.kitId);
    if (!kit) throw new Error('此流程所屬功能尚未登錄。原流程已保留。');
    if (!('kitVersion' in input) || input.kitVersion !== kit.version) throw new Error('此流程的功能版本不符。原流程已保留。');
    try { return kitWorkflowToCanvas(parseKitWorkflow(text, kit), kit); }
    catch { throw new Error('此功能的流程內容或連線不符合規格。原流程已保留。'); }
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || ('format' in input && input.format !== 'composer-aov-list')) {
    throw new Error('無法辨識的檔案格式。原流程已保留。');
  }
  return importWorkflow(text);
}
