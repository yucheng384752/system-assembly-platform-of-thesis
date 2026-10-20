import { PREVIEW_BASE, type Fetcher } from '../previewBackend';

// Response shapes were measured against the running preview backend (smoke.mjs and the kit routes), not guessed.
export interface FormSummary { id: string; code: string; name: string; fieldCount: number }
export interface FormRecord { id: string; lotNo: string; data: Record<string, string>; createdAt: string }
export interface RecordPage { total: number; records: FormRecord[] }
export interface UploadError { rowIndex: number; field: string; message: string }
export interface UploadResult { processId: string; totalRows: number; validRows: number; invalidRows: number; errors: UploadError[] }
export interface UploadStatus { status: string; filename: string; totalRows: number; validRows: number; invalidRows: number }
export interface LotGroup { stationName: string; records: FormRecord[] }
export interface TraceNode { key: string; stationName: string; lotNo: string; depth: number }
export interface TraceResult { nodes: TraceNode[]; edgeCount: number }

export class PreviewError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const num = (value: unknown): number => typeof value === 'number' ? value : 0;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function toRecord(value: unknown): FormRecord {
  const row = isRecord(value) ? value : {};
  const data = isRecord(row.data) ? Object.fromEntries(Object.entries(row.data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v) ?? ''])) : {};
  return { id: text(row.id), lotNo: text(row.lot_no_raw), data, createdAt: text(row.created_at) };
}

async function detail(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  if (isRecord(body) && typeof body.detail === 'string') return body.detail;
  if (isRecord(body) && Array.isArray(body.detail)) return body.detail.map(d => isRecord(d) ? text(d.msg) : '').filter(Boolean).join('；');
  return '';
}

export function createPreviewApi(fetcher: Fetcher) {
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try { response = await fetcher(`${PREVIEW_BASE}${path}`, init); }
    catch { throw new PreviewError(0, '無法連線到預覽後端'); }
    if (!response.ok) throw new PreviewError(response.status, await detail(response));
    return response.json();
  }
  return {
    async listForms(): Promise<FormSummary[]> {
      return list(await request('/api/forms')).map(item => { const row = isRecord(item) ? item : {}; return { id: text(row.id), code: text(row.code), name: text(row.name), fieldCount: list(row.fields).length }; });
    },
    async createForm(code: string, name: string): Promise<FormSummary> {
      const row = await request('/api/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }) });
      const r = isRecord(row) ? row : {};
      return { id: text(r.id), code: text(r.code), name: text(r.name), fieldCount: list(r.fields).length };
    },
    async listRecords(code: string): Promise<RecordPage> {
      const body = await request(`/api/forms/${encodeURIComponent(code)}/records`);
      const r = isRecord(body) ? body : {};
      return { total: num(r.total), records: list(r.records).map(toRecord) };
    },
    async upload(file: File): Promise<UploadResult> {
      const form = new FormData(); form.append('file', file, file.name);
      const body = await request('/api/upload', { method: 'POST', body: form });
      const r = isRecord(body) ? body : {};
      return { processId: text(r.process_id), totalRows: num(r.total_rows), validRows: num(r.valid_rows), invalidRows: num(r.invalid_rows),
        errors: list(r.sample_errors).map(e => { const x = isRecord(e) ? e : {}; return { rowIndex: num(x.row_index), field: text(x.field), message: text(x.message) }; }) };
    },
    async uploadStatus(processId: string): Promise<UploadStatus> {
      const r = await request(`/api/upload/${encodeURIComponent(processId)}/status`);
      const x = isRecord(r) ? r : {};
      return { status: text(x.status), filename: text(x.filename), totalRows: num(x.total_rows), validRows: num(x.valid_rows), invalidRows: num(x.invalid_rows) };
    },
    async lot(lotNo: string): Promise<LotGroup[]> {
      return list(await request(`/api/v2/query/lot/${encodeURIComponent(lotNo)}`)).map(g => { const x = isRecord(g) ? g : {}; return { stationName: text(x.station_name) || text(x.station_code), records: list(x.records).map(toRecord) }; });
    },
    async trace(lotNo: string): Promise<TraceResult> {
      const r = await request(`/api/v2/query/trace/${encodeURIComponent(lotNo)}`);
      const x = isRecord(r) ? r : {};
      return { edgeCount: list(x.edges).length, nodes: list(x.nodes).map(n => { const y = isRecord(n) ? n : {}; const rec = toRecord(y.record); return { key: text(y.key), stationName: text(y.station_name) || text(y.station_code), lotNo: rec.lotNo, depth: num(y.depth) }; }) };
    },
  };
}
export type PreviewApi = ReturnType<typeof createPreviewApi>;

// Business-language error text; status stays visible so a failure can be traced.
export function describeError(error: unknown, notFound = '找不到對應的資料'): string {
  if (!(error instanceof PreviewError)) return '發生未預期的錯誤';
  if (error.status === 0) return error.message;
  if (error.status === 404) return `${notFound}（HTTP 404）${error.message ? `：${error.message}` : ''}`;
  return `預覽後端無法完成這個操作（HTTP ${error.status}）${error.message ? `：${error.message}` : ''}`;
}
export const INIT_HINT = '預覽資料尚未初始化：請先在預覽後端執行種子指令（docker compose ... exec -T backend python -m app.preview_seed）。';
