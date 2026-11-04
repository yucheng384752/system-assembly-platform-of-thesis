import type { CaseStore, Result } from '../../../libs/case-store';
import { verifyContent } from './verify';

// Pure request handler: no sockets, so every route is testable without a port. main.ts only adapts node:http to it.
export interface ApiRequest { method: string; path: string; body: unknown }
export interface ApiResponse { status: number; body: unknown }

const STATUS: Record<string, number> = {
  'E-INVALID-INPUT': 400, 'E-BAD-CONTENT': 400, 'E-BAD-BACKUP': 400, 'E-NOT-VERIFIED': 422, 'E-DEPRECATED': 409,
  'E-NOT-FOUND': 404, 'E-VERSION-CONFLICT': 409, 'E-NOT-EMPTY': 409, 'E-ALIAS-CYCLE': 409, 'E-BUSY': 503, 'E-CORRUPT': 500,
};
const send = <T>(result: Result<T>, success = 200): ApiResponse => result.ok
  ? { status: success, body: result.value }
  : { status: STATUS[result.errors[0].code] ?? 500, body: { errors: result.errors } };
const bad = (message: string): ApiResponse => ({ status: 400, body: { errors: [{ code: 'E-INVALID-INPUT', message }] } });

type Fields = Record<string, unknown>;
const fields = (body: unknown): Fields | null => (typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Fields : null);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const combo = (value: unknown): string[] => (Array.isArray(value) ? value.map(str) : []);

export async function handle(store: CaseStore, { method, path, body }: ApiRequest): Promise<ApiResponse> {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const b = fields(body);
  const [head, a, tail, c] = parts;

  if (method === 'GET' && parts.length === 1 && head === 'cases') return send(store.listCases());
  if (method === 'POST' && parts.length === 1 && head === 'cases') return b ? send(store.createCase(str(b.name)), 201) : bad('需要 JSON 物件。');
  if (head === 'cases' && a && tail === 'versions') {
    if (method === 'GET' && parts.length === 3) return send(store.listVersions(a));
    if (method === 'GET' && parts.length === 4) return send(store.getVersion(a, Number(c)));
    if (method === 'POST' && parts.length === 3) {
      if (!b) return bad('需要 JSON 物件。');
      if (typeof b.content !== 'string') return bad('content 須為整合包 JSON 文字。');
      if (b.expectedParent !== null && !Number.isSafeInteger(b.expectedParent)) return bad('expectedParent 須為版本號或 null。');
      // Any client-sent report is ignored on purpose: the server verifies the content itself.
      const report = await verifyContent(b.content);
      if (!report.passed) return { status: 422, body: { errors: [{ code: 'E-NOT-VERIFIED', message: '驗證未通過，未儲存。' }], report } };
      return send(await store.saveVersion({ caseId: a, expectedParent: b.expectedParent as number | null, content: b.content,
        verifiedReport: report, changeReason: str(b.changeReason), author: str(b.author) }), 201);
    }
  }
  if (head === 'nodes' && a && method === 'GET' && parts.length === 2) return send(store.resolveNode(a));
  if (head === 'nodes' && a === 'merge' && method === 'POST' && b) {
    return send(store.mergeNodes({ keep: str(b.keep), drop: str(b.drop), reason: str(b.reason) }));
  }
  if (head === 'nodes' && a && (tail === 'deprecate' || tail === 'reactivate') && method === 'POST' && b) {
    return send(tail === 'deprecate' ? store.deprecateNode(a, str(b.reason)) : store.reactivateNode(a, str(b.reason)));
  }
  if (head === 'combos' && (a === 'deprecate' || a === 'reactivate') && method === 'POST' && b) {
    return send(a === 'deprecate' ? store.deprecateCombo(combo(b.combo), str(b.reason)) : store.reactivateCombo(combo(b.combo), str(b.reason)));
  }
  if (head === 'usage' && method === 'POST' && b) return send(store.scanUsage(typeof b.nodeId === 'string' ? b.nodeId : combo(b.combo)));
  if (head === 'backup' && parts.length === 1) {
    if (method === 'GET') return send(store.exportBackup());
    if (method === 'POST') return send(store.importBackup(body));
  }
  return { status: 404, body: { errors: [{ code: 'E-NOT-FOUND', message: '沒有這個路由。' }] } };
}
