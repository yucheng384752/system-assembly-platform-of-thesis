import type { Fetcher } from './previewBackend';
import type { FlowCase, VersionSummary, FlowVersion, NodeState, ComboState, Usage, StoreError } from '../../../libs/case-store';

export type { FlowCase, VersionSummary, FlowVersion, NodeState, ComboState, Usage };
export interface Lifecycle { nodes: NodeState[]; combos: ComboState[] }
export type CaseResult<T> = { ok: true; value: T } | { ok: false; errors: StoreError[]; report?: unknown };
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const textFields = (v: Record<string, unknown>, keys: string[]) => keys.every(key => typeof v[key] === 'string');
const caseRow = (v: unknown): v is FlowCase => record(v) && textFields(v, ['case_id', 'name', 'created_at']);
const summary = (v: unknown): v is VersionSummary => record(v) && Number.isSafeInteger(v.version) && Number(v.version) > 0 &&
  (v.parent_version === null || (Number.isSafeInteger(v.parent_version) && Number(v.parent_version) > 0)) && textFields(v, ['change_reason', 'author', 'created_at']);
const version = (v: unknown): v is FlowVersion => summary(v) && record(v) && textFields(v, ['case_id', 'content', 'content_hash', 'verified_report']);
const node = (v: unknown): v is NodeState => record(v) && textFields(v, ['node_id', 'reason', 'at']) &&
  ['active', 'deprecated', 'merged'].includes(String(v.state)) && (v.replaced_by === null || typeof v.replaced_by === 'string');
const combo = (v: unknown): v is ComboState => record(v) && strings(v.combo) && v.combo.length >= 2 &&
  (v.state === 'active' || v.state === 'deprecated') && textFields(v, ['reason', 'at']);
const arrayOf = <T>(guard: (v: unknown) => v is T) => (v: unknown): v is T[] => Array.isArray(v) && v.every(guard);
const lifecycle = (v: unknown): v is Lifecycle => record(v) && arrayOf(node)(v.nodes) && arrayOf(combo)(v.combos);
const usage = (v: unknown): v is Usage => record(v) && textFields(v, ['case_id', 'graph']) && Number.isSafeInteger(v.version) && Number(v.version) > 0;
const errorRow = (v: unknown): v is StoreError => record(v) && textFields(v, ['code', 'message']) &&
  ['graph', 'nodeId', 'replacement'].every(k => v[k] === undefined || typeof v[k] === 'string') && (v.combo === undefined || strings(v.combo));
const nothing = (v: unknown): v is null => v === null;

export function createCaseStoreClient(fetcher: Fetcher = (input, init) => globalThis.fetch(input, init)) {
  async function request<T>(path: string, guard: (v: unknown) => v is T, body?: unknown): Promise<CaseResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher(`/case-store-api${path}`, { signal: controller.signal,
        ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      let data: unknown;
      try { data = await response.json(); } catch { return { ok: false, errors: [{ code: 'E-RESPONSE', message: '案例庫回覆無法讀取，請確認啟動方式後重試。' }] }; }
      if (!response.ok) {
        return record(data) && arrayOf(errorRow)(data.errors) && data.errors.length
          ? { ok: false, errors: data.errors, report: data.report }
          : { ok: false, errors: [{ code: 'E-RESPONSE', message: '案例庫無法完成要求，請稍後重試。' }] };
      }
      return guard(data) ? { ok: true, value: data } : { ok: false, errors: [{ code: 'E-RESPONSE', message: '案例庫回覆格式不符，請確認版本後重試。' }] };
    } catch { return { ok: false, errors: [{ code: 'E-CONNECTION', message: '無法連線到案例庫，請確認啟動方式後重試。' }] }; }
    finally { clearTimeout(timer); }
  }
  const id = encodeURIComponent;
  return {
    listCases: () => request('/cases', arrayOf(caseRow)),
    createCase: (name: string) => request('/cases', caseRow, { name }),
    listVersions: (caseId: string) => request(`/cases/${id(caseId)}/versions`, arrayOf(summary)),
    getVersion: (caseId: string, n: number) => request(`/cases/${id(caseId)}/versions/${n}`, version),
    saveVersion: (caseId: string, input: { expectedParent: number | null; content: string; changeReason: string; author: string }) => request(`/cases/${id(caseId)}/versions`, version, input),
    lifecycle: () => request('/lifecycle', lifecycle),
    setNode: (nodeId: string, state: 'deprecate' | 'reactivate', reason: string) => request(`/nodes/${id(nodeId)}/${state}`, nothing, { reason }),
    merge: (keep: string, drop: string, reason: string) => request('/nodes/merge', nothing, { keep, drop, reason }),
    setCombo: (combo: string[], state: 'deprecate' | 'reactivate', reason: string) => request(`/combos/${state}`, nothing, { combo, reason }),
    usage: (target: { nodeId: string } | { combo: string[] }) => request('/usage', arrayOf(usage), target),
  };
}
export type CaseStoreClient = ReturnType<typeof createCaseStoreClient>;
export const caseStoreClient = createCaseStoreClient();
