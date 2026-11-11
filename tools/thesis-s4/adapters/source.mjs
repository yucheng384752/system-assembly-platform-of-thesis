// 來源系統（Form-analysis-server-specify-kit，commit 362cc7c）的轉接層。
//
// 職責：把「與系統無關的操作」翻成來源的 HTTP 請求，並把回應正規化成可比對的結果。
// 產出系統之後要提供同一組操作（同樣的名稱、同樣的回傳形狀），才能用同一份情境比對。
//
// 請求與回應格式都讀自來源程式碼（be/api/*.py），尚未在執行中的來源系統上驗證；
// 第一次跑基準時若有欄位名稱不符，情境會記成執行錯誤而不是默默通過。
//
// 正規化原則：不輸出識別碼、時間戳記、權杖、文字措辭；只輸出狀態碼與業務內容。
import { randomBytes } from 'node:crypto';
import { createHttp, buildForm } from '../lib/http.mjs';
import { pollUntil, sleep } from '../lib/runner.mjs';
import { HEADERS, inputFiles } from '../lib/synthetic.mjs';

const ZERO_ID = '00000000-0000-0000-0000-000000000000';
const ADMIN_HEADER = 'X-Admin-API-Key';
const TOKEN_HEADER = 'X-API-Key';

const pick = (object, keys) =>
  Object.fromEntries(keys.filter((key) => object && key in object).map((key) => [key, object[key]]));
const sortBy = (list, keyOf) => [...list].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
const detailOf = (body) => (body && typeof body === 'object' ? body.detail : undefined);

// 驗證錯誤訊息 → 與措辭無關的類別
function errorCategory(message) {
  const text = String(message || '');
  if (/^Missing /i.test(text)) return 'missing';
  if (/^Invalid .* format/i.test(text)) return 'invalid-format';
  if (/numeric/i.test(text)) return 'not-numeric';
  return 'other';
}

function normalizeRecord(record) {
  const type = record.data_type;
  const rows = (record.additional_data?.rows ?? []).map((row) => pick(row, HEADERS[type] ?? []));
  return {
    type,
    lot: record.lot_no,
    productionDate: record.production_date ?? null,
    winders: record.winder_numbers ?? null,
    productId: record.product_id ?? null,
    machine: record.machine_no ?? null,
    mold: record.mold_no ?? null,
    rows,
  };
}

const normalizeRecords = (body) =>
  sortBy((body?.records ?? []).map(normalizeRecord), (r) => `${r.type}|${r.lot}|${r.productId ?? ''}`);

export function createSourceDriver({ baseUrl, altBaseUrl, adminKey, log = () => {} }) {
  if (!adminKey) throw new Error('缺少管理者金鑰（環境變數 S4_ADMIN_KEY）');
  const http = createHttp(baseUrl);
  const altHttp = altBaseUrl ? createHttp(altBaseUrl) : null;
  const files = inputFiles();
  const tokens = {}; // 帳號 → 目前有效的權杖
  const passwords = {}; // 帳號 → 目前的密碼（只存在記憶體，不寫入任何檔案）
  const userIds = {};

  const newPassword = () => `S4-${randomBytes(12).toString('base64url')}`;

  // 身分：'anonymous' | 'user' | 'manager' | 'keyAndAccount' | 'keyOnly' | { account: '帳號' }
  // 「金鑰+帳號」依 user 2026-11-11 的決定，用 User 帳號的權杖加管理者金鑰。
  function headersFor(role) {
    if (role && typeof role === 'object') return { [TOKEN_HEADER]: requireToken(role.account) };
    switch (role) {
      case 'anonymous':
        return {};
      case 'user':
        return { [TOKEN_HEADER]: requireToken('s4_user') };
      case 'manager':
        return { [TOKEN_HEADER]: requireToken('s4_manager') };
      case 'keyAndAccount':
        return { [TOKEN_HEADER]: requireToken('s4_user'), [ADMIN_HEADER]: adminKey };
      case 'keyOnly':
        return { [ADMIN_HEADER]: adminKey };
      default:
        throw new Error(`未知的身分：${JSON.stringify(role)}`);
    }
  }
  function requireToken(account) {
    if (!tokens[account]) throw new Error(`帳號 ${account} 還沒有登入取得權杖`);
    return tokens[account];
  }
  function accountOf(role) {
    if (role && typeof role === 'object') return role.account;
    if (role === 'user' || role === 'keyAndAccount') return 's4_user';
    if (role === 'manager') return 's4_manager';
    throw new Error(`身分 ${JSON.stringify(role)} 沒有對應的帳號`);
  }

  async function createAccount(username, role) {
    passwords[username] = newPassword();
    const res = await http.post('/api/auth/users', {
      headers: { [ADMIN_HEADER]: adminKey },
      json: { username, password: passwords[username], role },
    });
    if (res.status !== 201) {
      throw new Error(`建立帳號 ${username} 失敗（${res.status}）：${JSON.stringify(res.body).slice(0, 200)}`);
    }
    userIds[username] = res.body.id;
  }

  async function loginRaw(client, username, password) {
    const res = await client.post('/api/auth/login', { json: { username, password } });
    if (res.status === 200 && res.body?.api_key) tokens[username] = res.body.api_key;
    return res;
  }

  async function findRecordId(role, type, lot) {
    const res = await http.get('/api/v2/query/records', { headers: headersFor(role), query: { lot_no: lot, data_type: type } });
    const id = res.body?.records?.[0]?.id;
    if (res.status !== 200 || !id) throw new Error(`找不到 ${type} 批號 ${lot} 的紀錄（${res.status}）`);
    return id;
  }

  const ops = {
    // ---- 登入與身分 ----
    async login(_role, { account, password = 'right', via = 'main' }) {
      const client = via === 'alt' ? altHttp : http;
      if (!client) throw new Error('未執行：需要第二個來源位址（--alt-base-url）');
      const secret = password === 'right' ? passwords[account] ?? newPassword() : 'S4-definitely-wrong-password';
      const res = await loginRaw(client, account, secret);
      return { obs: { status: res.status } };
    },
    async whoami(role) {
      const res = await http.get('/api/auth/whoami', { headers: headersFor(role) });
      const body = res.status === 200 ? res.body : {};
      return { obs: { status: res.status, role: body.actor_role ?? null, isAdmin: body.is_admin ?? null } };
    },
    async changePassword(role, { oldPassword = 'right', newPassword: kind = 'fresh' }) {
      let account = null;
      try {
        account = accountOf(role);
      } catch {
        // 沒有帳號的身分（未登入、只有金鑰）：照樣送出，記錄被拒絕的狀態碼
      }
      const current = (account && passwords[account]) || 'S4-placeholder-old';
      const next = kind === 'same' ? current : kind === 'short' ? 'short' : newPassword();
      const res = await http.post('/api/auth/me/password', {
        headers: headersFor(role),
        json: { old_password: oldPassword === 'right' ? current : 'S4-definitely-wrong-password', new_password: next },
      });
      if (res.status === 204 && account) passwords[account] = next;
      return { obs: { status: res.status } };
    },
    async unlockAdmin(_role, { key }) {
      const value = key === 'valid' ? adminKey : 'S4-invalid-admin-key';
      const res = await http.get('/api/auth/bootstrap-status', { headers: { [ADMIN_HEADER]: value } });
      return { obs: { status: res.status } };
    },
    // 用「指定的舊權杖」打一個需要登入的端點，確認它是否仍有效
    async tokenWorks(_role, { token }) {
      const res = await http.get('/api/auth/whoami', { headers: { [TOKEN_HEADER]: token } });
      return { obs: { status: res.status } };
    },

    // ---- CSV 匯入 ----
    async createImportJob(role, { table, fileKeys, allowDuplicate = false }) {
      const form = buildForm(
        { table_code: table, allow_duplicate: allowDuplicate },
        fileKeys.map((key) => ({ field: 'files', name: files[key].name, data: files[key].data, type: 'text/csv' })),
      );
      const res = await http.post('/api/v2/import/jobs', { headers: headersFor(role), form });
      const detail = detailOf(res.body);
      const errorCode = detail && typeof detail === 'object' ? detail.error_code ?? null : null;
      return { obs: { status: res.status, errorCode }, ref: res.body?.id ?? ZERO_ID };
    },
    async createImportJobFromText(role, { table, name, text, allowDuplicate = false }) {
      const form = buildForm({ table_code: table, allow_duplicate: allowDuplicate }, [
        { field: 'files', name, data: Buffer.from(text, 'utf8'), type: 'text/csv' },
      ]);
      const res = await http.post('/api/v2/import/jobs', { headers: headersFor(role), form });
      return { obs: { status: res.status }, ref: res.body?.id ?? ZERO_ID };
    },
    async importJobState(role, { job }) {
      const res = await http.get(`/api/v2/import/jobs/${job}`, { headers: headersFor(role) });
      return { obs: { status: res.status, state: res.status === 200 ? String(res.body.status) : null } };
    },
    async waitImportJob(role, { job, until }) {
      const res = await pollUntil(
        () => http.get(`/api/v2/import/jobs/${job}`, { headers: headersFor(role) }),
        (r) => r.status !== 200 || until.includes(String(r.body.status)),
        { what: `匯入工作到達 ${until.join(' 或 ')}` },
      );
      if (res.status !== 200) return { obs: { status: res.status, state: null } };
      return {
        obs: {
          status: 200,
          state: String(res.body.status),
          totalRows: res.body.total_rows ?? null,
          errorCount: res.body.error_count ?? null,
        },
      };
    },
    async importErrors(role, { job }) {
      const res = await http.get(`/api/v2/import/jobs/${job}/errors`, { headers: headersFor(role) });
      const rows = Array.isArray(res.body) ? res.body : [];
      return {
        obs: {
          status: res.status,
          rows: rows.map((row) => ({
            rowIndex: row.row_index,
            errors: (row.errors_json ?? row.errors ?? []).map((e) => ({ field: e.field, category: errorCategory(e.message) })),
          })),
        },
      };
    },
    async commitImportJob(role, { job }) {
      const res = await http.post(`/api/v2/import/jobs/${job}/commit`, { headers: headersFor(role) });
      return { obs: { status: res.status } };
    },
    async cancelImportJob(role, { job }) {
      const res = await http.post(`/api/v2/import/jobs/${job}/cancel`, { headers: headersFor(role) });
      return { obs: { status: res.status, state: res.status === 200 ? String(res.body.status) : null } };
    },

    // ---- PDF 轉 CSV ----
    async uploadPdf(role, { fileKey }) {
      const file = files[fileKey];
      const form = buildForm({}, [{ field: 'file', name: file.name, data: file.data, type: 'application/pdf' }]);
      const res = await http.post('/api/upload/pdf', { headers: headersFor(role), form });
      return { obs: { status: res.status }, ref: res.body?.process_id ?? ZERO_ID };
    },
    async convertPdf(role, { pdf }) {
      const res = await http.post(`/api/upload/pdf/${pdf}/convert`, { headers: headersFor(role) });
      return { obs: { status: res.status } };
    },
    async waitPdf(role, { pdf, timeoutMs = 120_000 }) {
      const res = await pollUntil(
        () => http.get(`/api/upload/pdf/${pdf}/convert/status`, { headers: headersFor(role) }),
        (r) => r.status !== 200 || ['COMPLETED', 'FAILED'].includes(String(r.body.status)),
        { what: 'PDF 轉檔結束', timeoutMs },
      );
      if (res.status === 200 && String(res.body.status) === 'COMPLETED') {
        // 來源在標記完成之後才把收卷機編號寫回 CSV（背景處理的後半段），沒有可輪詢的訊號，只能等一下。
        await sleep(1500);
      }
      return {
        obs: {
          status: res.status,
          state: res.status === 200 ? String(res.body.status) : null,
          errorStage: res.body?.error_summary?.stage ?? null,
        },
      };
    },
    async pdfStatus(role, { pdf }) {
      const res = await http.get(`/api/upload/pdf/${pdf}/convert/status`, { headers: headersFor(role) });
      return { obs: { status: res.status } };
    },
    async pdfOutputs(role, { pdf }) {
      const res = await http.get(`/api/upload/pdf/${pdf}/convert/outputs`, {
        headers: headersFor(role),
        query: { include_csv_text: 1 },
      });
      const outputs = res.status === 200 ? res.body.outputs ?? [] : [];
      return {
        obs: {
          status: res.status,
          files: sortBy(
            outputs.map((o) => ({ name: o.filename, csv: String(o.csv_text ?? '').replace(/\r\n/g, '\n') })),
            (o) => o.name,
          ),
        },
        ref: outputs,
      };
    },
    async ingestPdf(role, { pdf }) {
      const res = await http.post(`/api/upload/pdf/${pdf}/convert/ingest`, { headers: headersFor(role) });
      const uploads = res.status === 200 ? res.body.uploads ?? [] : [];
      return {
        obs: {
          status: res.status,
          uploads: sortBy(
            uploads.map((u) => ({
              name: u.filename,
              totalRows: u.total_rows,
              validRows: u.valid_rows,
              invalidRows: u.invalid_rows,
              hasImportJob: Boolean(u.import_job_id),
            })),
            (u) => u.name,
          ),
        },
      };
    },

    // ---- 查詢與追溯 ----
    async suggestLots(role, { term }) {
      const res = await http.get('/api/v2/query/lots/suggestions', { headers: headersFor(role), query: { term } });
      return { obs: { status: res.status, lots: Array.isArray(res.body) ? [...new Set(res.body)].sort() : [] } };
    },
    async queryRecords(role, { lot, type }) {
      const res = await http.get('/api/v2/query/records', { headers: headersFor(role), query: { lot_no: lot, data_type: type } });
      return { obs: { status: res.status, records: normalizeRecords(res.body) } };
    },
    // 進階查詢：條件用與系統無關的名稱，這裡翻成來源的 filters
    async queryAdvanced(role, { type, lot, machine, mold, specification, material, winder, dateFrom, dateTo, ngOnly }) {
      const filters = [];
      if (lot) filters.push({ field: 'lot_no', op: 'eq', value: lot });
      if (machine) filters.push({ field: 'machine_no', op: 'all_of', value: [machine] });
      if (mold) filters.push({ field: 'mold_no', op: 'all_of', value: [mold] });
      if (specification) filters.push({ field: 'specification', op: 'all_of', value: [specification] });
      if (material) filters.push({ field: 'material', op: 'all_of', value: [material] });
      if (winder !== undefined) filters.push({ field: 'winder_number', op: 'eq', value: winder });
      if (dateFrom && dateTo) filters.push({ field: 'production_date', op: 'between', value: [dateFrom, dateTo] });
      if (ngOnly && type === 'P2') filters.push({ field: 'slitting_result', op: 'eq', value: 0 });
      if (ngOnly && type === 'P3') filters.push({ field: 'row_data.Finish', op: 'eq', value: '0' });
      const res = await http.post('/api/v2/query/records/dynamic', {
        headers: headersFor(role),
        json: { data_type: type ?? null, filters, page: 1, page_size: 200 },
      });
      return { obs: { status: res.status, records: normalizeRecords(res.body) } };
    },
    async queryOptions(role, { field }) {
      const res = await http.get(`/api/v2/query/options/${field}`, { headers: headersFor(role) });
      return { obs: { status: res.status, values: Array.isArray(res.body) ? [...res.body].sort() : [] } };
    },
    async traceProduct(role, { productId }) {
      const res = await http.get(`/api/traceability/product/${encodeURIComponent(productId)}`, { headers: headersFor(role) });
      if (res.status !== 200) return { obs: { status: res.status } };
      const { p3, p2, p1 } = res.body;
      return {
        obs: {
          status: 200,
          complete: res.body.trace_complete,
          missing: [...(res.body.missing_links ?? [])].sort(),
          p3: p3 ? { lot: p3.lot_no, productId: p3.product_id, sourceWinder: p3.source_winder ?? null } : null,
          p2: p2 ? { lot: p2.lot_no, winder: p2.winder_number } : null,
          p1: p1 ? { lot: p1.lot_no } : null,
        },
      };
    },
    async traceWinder(role, { lot, winder }) {
      const res = await http.get(`/api/traceability/winder/${encodeURIComponent(lot)}/${winder}`, { headers: headersFor(role) });
      if (res.status !== 200) return { obs: { status: res.status } };
      return {
        obs: {
          status: 200,
          p2: res.body.p2 ? { lot: res.body.p2.lot_no, winder: res.body.p2.winder_number } : null,
          p1: res.body.p1 ? { lot: res.body.p1.lot_no } : null,
          p3ProductIds: (res.body.p3_records ?? []).map((r) => r.product_id).sort(),
        },
      };
    },

    // ---- 修改已匯入的紀錄 ----
    async initReasons(role) {
      const res = await http.post('/api/edit/reasons/init', { headers: headersFor(role) });
      return { obs: { status: res.status, codes: Array.isArray(res.body) ? res.body.map((r) => r.reason_code).sort() : [] } };
    },
    async listReasons(role) {
      const res = await http.get('/api/edit/reasons', { headers: headersFor(role) });
      return {
        obs: { status: res.status, codes: Array.isArray(res.body) ? res.body.map((r) => r.reason_code).sort() : [] },
        ref: Array.isArray(res.body) ? res.body : [],
      };
    },
    async createReason(role, { code, description }) {
      const res = await http.post('/api/edit/reasons', { headers: headersFor(role), json: { reason_code: code, description } });
      return { obs: { status: res.status }, ref: res.body?.id ?? ZERO_ID };
    },
    async updateReason(role, { reason, description }) {
      const res = await http.patch(`/api/edit/reasons/${reason}`, { headers: headersFor(role), json: { description } });
      return { obs: { status: res.status, description: res.status === 200 ? res.body.description : null } };
    },
    // lookupAs：用哪個身分查出紀錄；被拒絕的身分查不到紀錄，所以由有權限的身分代查
    async editRecord(role, { type, lot, updates, reasonText, lookupAs = 'manager' }) {
      const id = await findRecordId(lookupAs, type, lot);
      const res = await http.patch(`/api/edit/records/${type}/${id}`, {
        headers: headersFor(role),
        json: { updates, reason_text: reasonText },
      });
      const body = res.status === 200 ? res.body : {};
      return { obs: { status: res.status, lot: body.lot_no_raw ?? null, extras: pick(body.extras ?? {}, Object.keys(updates)) } };
    },
    async recordEdits(role, { type, lot, keys, lookupAs = 'manager' }) {
      const id = await findRecordId(lookupAs, type, lot);
      const res = await http.get(`/api/edit/records/${type}/${id}/edits`, { headers: headersFor(role) });
      const edits = Array.isArray(res.body) ? res.body : [];
      return {
        obs: {
          status: res.status,
          count: edits.length,
          latest: edits[0]
            ? {
                reasonText: edits[0].reason_text ?? null,
                before: pick(edits[0].before_json?.extras ?? {}, keys),
                after: pick(edits[0].after_json?.extras ?? {}, keys),
              }
            : null,
        },
      };
    },

    // ---- 分析 ----
    async analyze(role, { dateFrom, dateTo, stations, productIds = [] }) {
      const res = await http.post('/api/v2/analytics/analyze', {
        headers: headersFor(role),
        json: { start_date: dateFrom ?? null, end_date: dateTo ?? null, product_ids: productIds, stations },
      });
      return { obs: { status: res.status, result: res.status === 200 ? res.body : null } };
    },
    async extractionAnalysis(role, { station, dateFrom, dateTo }) {
      const res = await http.post('/api/v2/analytics/extraction-analysis', {
        headers: headersFor(role),
        json: { product_ids: [], start_date: dateFrom ?? null, end_date: dateTo ?? null, station },
      });
      const body = res.status === 200 ? res.body : {};
      return {
        obs: {
          status: res.status,
          ...pick(body, ['station', 'boundary_count', 'spe_score', 't2_score', 'final_raw_score', 'features_used', 'sample_counts']),
        },
      };
    },
    async complaintAnalysis(role, { productIds }) {
      const res = await http.post('/api/v2/analytics/complaint-analysis', {
        headers: headersFor(role),
        json: { product_ids: productIds, include_basic_stats: true, include_outliers: true },
      });
      if (res.status !== 200) return { obs: { status: res.status } };
      return {
        obs: {
          status: 200,
          requested: res.body.requested_ids,
          mapping: res.body.mapping,
          sourceScope: res.body.source_scope,
          winderDistribution: sortBy(
            (res.body.winder_distribution ?? []).map((w) => ({ name: w.name, count: w.count })),
            (w) => String(w.name),
          ),
        },
      };
    },
    async analysisArtifacts(role) {
      const list = await http.get('/api/v2/analytics/artifacts', { headers: headersFor(role) });
      const entries = Array.isArray(list.body) ? list.body : [];
      const views = {};
      for (const suffix of ['', '/list', '/snapshot']) {
        const res = await http.get(`/api/v2/analytics/artifacts/serialized_events${suffix}`, { headers: headersFor(role) });
        views[suffix || '/'] = res.status;
      }
      const resolve = await http.get('/api/v2/analytics/artifacts/serialized_events/resolve-input', {
        headers: headersFor(role),
        query: { product_ids: '' },
      });
      return {
        obs: {
          status: list.status,
          artifacts: sortBy(entries.map((e) => ({ key: e.key, exists: e.exists })), (e) => e.key),
          views,
          resolveInput: resolve.status,
        },
      };
    },
    async externalEndpoints(role, { group }) {
      const paths = {
        X1: ['/api/v2/analytics/flatten?product_ids=none', '/api/v2/analytics/flatten/monthly?year=2050&month=1', '/api/v2/analytics/health'],
        X2: ['/api/v2/ut/flatten?year=2050&month=1&location=P1', '/api/v2/ut/health'],
        X3: ['/api/constants/materials', '/api/constants/slitting-machines', '/api/constants/slitting-machines/1', '/api/constants/all'],
      }[group];
      const statuses = [];
      for (const path of paths) statuses.push((await http.get(path, { headers: headersFor(role) })).status);
      return { obs: { statuses } };
    },

    // ---- 管理 ----
    async listUsers(role) {
      const res = await http.get('/api/auth/users', { headers: headersFor(role), query: { include_inactive: true } });
      const users = Array.isArray(res.body) ? res.body : [];
      return {
        obs: {
          status: res.status,
          users: sortBy(users.map((u) => ({ username: u.username, role: u.role, active: u.is_active })), (u) => u.username),
        },
      };
    },
    async createUser(role, { username, userRole = 'user' }) {
      passwords[username] = newPassword();
      const res = await http.post('/api/auth/users', {
        headers: headersFor(role),
        json: { username, password: passwords[username], role: userRole },
      });
      if (res.status === 201) userIds[username] = res.body.id;
      return { obs: { status: res.status } };
    },
    async updateUser(role, { username, changes }) {
      const res = await http.patch(`/api/auth/users/${userIds[username] ?? ZERO_ID}`, {
        headers: headersFor(role),
        json: { ...(changes.role ? { role: changes.role } : {}), ...(changes.active !== undefined ? { is_active: changes.active } : {}) },
      });
      return { obs: { status: res.status } };
    },
    async deleteUser(role, { username }) {
      const res = await http.delete(`/api/auth/users/${userIds[username] ?? ZERO_ID}`, { headers: headersFor(role) });
      return { obs: { status: res.status } };
    },
    async resetPassword(role, { username }) {
      const next = newPassword();
      const res = await http.post(`/api/auth/users/${userIds[username] ?? ZERO_ID}/password-reset`, {
        headers: headersFor(role),
        json: { new_password: next },
      });
      if (res.status === 200) passwords[username] = next;
      return { obs: { status: res.status } };
    },
    async systemLogs(role) {
      const call = async (method, path, query) => (await http[method](path, { headers: headersFor(role), query })).status;
      return {
        obs: {
          files: await call('get', '/api/logs/files'),
          view: await call('get', '/api/logs/view/app', { limit: 1 }),
          stats: await call('get', '/api/logs/stats'),
          search: await call('get', '/api/logs/search', { query: 'S4', limit: 1 }),
          download: await call('get', '/api/logs/download/app'),
          cleanup: await call('delete', '/api/logs/cleanup'),
        },
      };
    },
    async readStations(role, { code }) {
      const get = async (path) => (await http.get(path, { headers: headersFor(role) })).status;
      const list = await http.get('/api/stations', { headers: headersFor(role) });
      return {
        obs: {
          list: list.status,
          codes: Array.isArray(list.body) ? list.body.map((s) => s.code).sort() : [],
          schema: await get(`/api/stations/${code}/schema`),
          fields: await get(`/api/stations/${code}/schema/fields`),
          rules: await get(`/api/stations/${code}/validation-rules`),
          mapping: await get(`/api/stations/${code}/analytics-mapping`),
          links: await get('/api/stations/links'),
          trace: await get('/api/stations/traceability/990101101'),
        },
      };
    },
    // 依序做 13 個寫入；前面的建立若被拒絕，後面用不存在的識別碼照樣送出，記錄每一步的狀態碼
    async writeStations(role, { code }) {
      const headers = headersFor(role);
      const other = `${code}B`;
      const steps = {};
      const send = async (name, method, path, json) => {
        const res = await http[method](path, { headers, json });
        steps[name] = res.status;
        return res;
      };
      await send('createStation', 'post', '/api/stations', { code, name: `S4 ${code}`, sort_order: 90 });
      await send('createSecondStation', 'post', '/api/stations', { code: other, name: `S4 ${other}`, sort_order: 91 });
      await send('updateStation', 'put', `/api/stations/${code}`, { name: `S4 ${code} renamed` });
      await send('upsertSchema', 'put', `/api/stations/${code}/schema`, {
        record_fields: [{ name: 'lot_no', type: 'string', required: true }],
      });
      const rule = await send('createRule', 'post', '/api/stations/validation-rules', {
        station_code: code,
        field_name: 'lot_no',
        rule_type: 'required',
        rule_config: {},
      });
      const ruleId = rule.body?.id ?? ZERO_ID;
      await send('updateRule', 'put', `/api/stations/validation-rules/${ruleId}`, { is_active: false });
      await send('deleteRule', 'delete', `/api/stations/validation-rules/${ruleId}`);
      const mapping = await send('createMapping', 'post', '/api/stations/analytics-mappings', {
        station_code: code,
        source_path: 'lot_no',
        output_column: 'S4 lot',
        output_order: 1,
      });
      const mappingId = mapping.body?.id ?? ZERO_ID;
      await send('updateMapping', 'put', `/api/stations/analytics-mappings/${mappingId}`, { output_order: 2 });
      await send('deleteMapping', 'delete', `/api/stations/analytics-mappings/${mappingId}`);
      const link = await send('createLink', 'post', '/api/stations/links', {
        from_station_code: code,
        to_station_code: other,
        link_type: 'lot',
      });
      const linkId = link.body?.id ?? ZERO_ID;
      await send('updateLink', 'put', `/api/stations/links/${linkId}`, { sort_order: 5 });
      await send('deleteLink', 'delete', `/api/stations/links/${linkId}`);
      await send('deleteStation', 'delete', `/api/stations/${code}`);
      await send('deleteSecondStation', 'delete', `/api/stations/${other}`);
      return { obs: { steps } };
    },
    // 稽核事件：只回答「這類操作有沒有留下紀錄」，不比事件名稱
    async auditRecorded(role, { kind }) {
      const action = { recordEdit: 'edit.record', passwordChange: 'auth.password.change', importCommit: 'import.job.commit.requested' }[kind];
      if (!action) throw new Error(`未知的稽核種類：${kind}`);
      const res = await http.get('/api/audit-events', { headers: headersFor(role), query: { action, limit: 500 } });
      return { obs: { status: res.status, recorded: Array.isArray(res.body) ? res.body.length > 0 : null } };
    },
  };

  return {
    label: `來源系統 ${baseUrl}`,
    hasAltAddress: Boolean(altHttp),
    /** 取出某帳號目前的權杖（只給「舊權杖是否失效」這類情境用，不得寫入結果） */
    currentToken: (account) => requireToken(account),
    async setup() {
      const probe = await http.get('/api/auth/bootstrap-status', { headers: { [ADMIN_HEADER]: adminKey } });
      if (probe.status !== 200) {
        throw new Error(`管理者金鑰無法使用（GET /api/auth/bootstrap-status 回 ${probe.status}）；請確認 ADMIN_API_KEYS 與 S4_ADMIN_KEY 一致`);
      }
      await createAccount('s4_manager', 'manager');
      await createAccount('s4_user', 'user');
      for (const account of ['s4_manager', 's4_user']) {
        const res = await loginRaw(http, account, passwords[account]);
        if (res.status !== 200) throw new Error(`帳號 ${account} 登入失敗（${res.status}）`);
      }
      log('已建立 s4_manager、s4_user 並登入');
    },
    /** 建立情境專用帳號（密碼只在記憶體）並登入 */
    async provision(username, role = 'user', { login = true } = {}) {
      await createAccount(username, role);
      if (login) {
        const res = await loginRaw(http, username, passwords[username]);
        if (res.status !== 200) throw new Error(`帳號 ${username} 登入失敗（${res.status}）`);
      }
    },
    async call(role, name, args = {}) {
      const op = ops[name];
      if (!op) throw new Error(`轉接層沒有這個操作：${name}`);
      return op(role, args);
    },
    operations: Object.keys(ops),
  };
}
