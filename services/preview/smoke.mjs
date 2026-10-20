// Real-API smoke test for the preview backend (WP4b). Run after `node services/preview/preview.mjs up`.
// Usage: node services/preview/smoke.mjs [baseUrl]   (default http://127.0.0.1:18000)
// Every call goes to the running container; nothing here is mocked. Test data is synthetic.
const base = process.argv[2] ?? 'http://127.0.0.1:18000';
const tenant = '00000000-0000-4000-8000-000000000001';
// The preview stands in for identity with a fixed fake admin key (see app/main.py); this is not authentication.
const headers = { 'X-Tenant-Id': tenant, 'X-Admin-API-Key': 'preview-fake-admin-key' };
const rows = [];
// A known gap (listed in docs/preview-todo.md) is reported as GAP, never as PASS, and never hidden.
const gaps = new Map();
const record = (kit, name, ok, detail) => { const gap = !ok && gaps.get(name); rows.push({ kit, name, ok, gap: gap || undefined, detail }); console.log(`${ok ? 'PASS' : gap ? 'GAP ' : 'FAIL'}  ${kit.padEnd(24)} ${name}  ${detail}${gap ? `  [${gap}]` : ''}`); };

async function call(method, path, { json, form } = {}) {
  const init = { method, headers: { ...headers } };
  if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
  if (form) init.body = form;
  const response = await fetch(base + path, init);
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}
const knownGap = (name, todo) => gaps.set(name, todo);
const check = async (kit, name, run) => {
  try { const [ok, detail] = await run(); record(kit, name, ok, detail); }
  catch (error) { record(kit, name, false, `例外：${error instanceof Error ? error.message : error}`); }
};
const csv = (header, lines) => new Blob([[header, ...lines].join('\n') + '\n'], { type: 'text/csv' });

await check('platform-core-kit', 'GET /healthz', async () => { const r = await call('GET', '/healthz'); return [r.status === 200 && r.body.status === 'ok', `status ${r.status}`]; });
await check('platform-core-kit', '功能契約清單 /api/kit/contracts', async () => { const r = await call('GET', '/api/kit/contracts'); return [r.status === 200, `status ${r.status}`]; });
await check('platform-core-kit', '端點權限讀取與寫回', async () => {
  const r = await call('GET', '/api/admin/endpoint-permissions');
  if (r.status !== 200) return [false, `GET status ${r.status}`];
  const w = await call('PUT', '/api/admin/endpoint-permissions', { json: r.body.permissions });
  return [w.status === 200, `PUT status ${w.status}`];
});

const code = `smoke-${Date.now().toString(36)}`;
await check('generic-forms-kit', '建立表單 POST /api/forms', async () => { const r = await call('POST', '/api/forms', { json: { code, name: 'Smoke form' } }); return [r.status === 200 || r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`]; });
await check('generic-forms-kit', '列出表單含剛建立者', async () => { const r = await call('GET', '/api/forms'); return [r.status === 200 && JSON.stringify(r.body).includes(code), `status ${r.status}`]; });

let reasonId;
await check('audit-edit-kit', '建立修正原因 POST /api/edit/reasons', async () => { const r = await call('POST', '/api/edit/reasons', { json: { code: `r-${code}`.slice(0, 30), label: 'Smoke reason' } }); reasonId = r.body?.id ?? r.body?.reason_id; return [(r.status === 200 || r.status === 201) && !!reasonId, `status ${r.status}`]; });
await check('audit-edit-kit', '讀取修正原因與稽核事件', async () => { const a = await call('GET', '/api/edit/reasons'); const b = await call('GET', '/api/audit/events'); return [a.status === 200 && b.status === 200, `reasons ${a.status}, events ${b.status}`]; });
await check('generic-forms-kit', '設定欄位 PUT /api/forms/{code}/schema', async () => {
  if (!reasonId) return [false, '缺少 reason_id（上一步失敗）'];
  const r = await call('PUT', `/api/forms/${code}/schema`, { json: { reason_id: reasonId, fields: [{ name: 'lot_no', type: 'text', required: true, is_key: true }] } });
  return [r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`];
});
await check('generic-forms-kit', '匯入預覽與提交資料列', async () => {
  const form = () => { const f = new FormData(); f.append('file', csv('lot_no', ['A001', 'A002']), 'rows.csv'); return f; };
  const p = await call('POST', `/api/forms/${code}/import/preview`, { form: form() });
  const c = await call('POST', `/api/forms/${code}/import/commit`, { form: form() });
  const l = await call('GET', `/api/forms/${code}/records`);
  return [p.status === 200 && c.status === 200 && l.status === 200, `preview ${p.status}, commit ${c.status}, list ${l.status} ${JSON.stringify(l.body).slice(0, 80)}`];
});

let processId;
await check('upload-validation-kit', '上傳檔案 POST /api/upload', async () => {
  const f = new FormData(); f.append('file', csv('lot_no,qty', ['A001,1', 'A002,2']), 'upload.csv');
  const r = await call('POST', '/api/upload', { form: f }); processId = r.body?.process_id ?? r.body?.id;
  return [r.status === 200 || r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`];
});
await check('upload-validation-kit', '查詢上傳狀態', async () => { if (!processId) return [false, '缺少 process_id']; const r = await call('GET', `/api/upload/${processId}/status`); return [r.status === 200, `status ${r.status}`]; });

knownGap('系統日誌清單與摘要', 'T10 asyncpg 與日期字串');
async function waitForJob(id, expected) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = await call('GET', `/api/v2/import/jobs/${id}`);
    if (r.status !== 200) throw new Error(`查詢 ${r.status}: ${JSON.stringify(r.body)}`);
    if (r.body.status === expected) return r.body;
    if (['FAILED', 'CANCELLED', 'COMPLETED'].includes(r.body.status)) {
      throw new Error(`預期 ${expected}: ${JSON.stringify(r.body)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`工作 ${id} 等待 ${expected} 逾時`);
}

async function importAndCommit(tableCode, header, lines, filename) {
  const f = new FormData();
  if (tableCode) f.append('table_code', tableCode);
  f.append('allow_duplicate', 'true');
  f.append('files', csv(header, lines), filename);
  const r = await call('POST', '/api/v2/import/jobs', { form: f });
  const id = r.body?.id;
  if (r.status !== 201 || !id) throw new Error(`建立 ${r.status}: ${JSON.stringify(r.body)}`);
  await waitForJob(id, 'READY');
  const errors = await call('GET', `/api/v2/import/jobs/${id}/errors`);
  if (errors.status !== 200 || !Array.isArray(errors.body) || errors.body.length) {
    throw new Error(`查錯誤 ${errors.status}: ${JSON.stringify(errors.body)}`);
  }
  const committed = await call('POST', `/api/v2/import/jobs/${id}/commit`);
  if (committed.status !== 200) throw new Error(`提交 ${committed.status}: ${JSON.stringify(committed.body)}`);
  return waitForJob(id, 'COMPLETED');
}

await check('import-pipeline-kit', '建立匯入工作並查詢', async () => {
  // Omit table_code to exercise the seeded header fingerprint, not only explicit lookup.
  const job = await importAndCommit(null, 'entry_key,value', ['preview-entry,synthetic-value'], 'entries.csv');
  // Read back through query-traceability (a different kit). The generic-forms listing cannot be used here: a code that
  // is both a station and a table_registry entry is treated by the baseline as a domain-backed table (T12).
  const r = await call('GET', '/api/v2/query/lot/preview-entry');
  const found = Array.isArray(r.body) && r.body.some(group => group.station_code === 'preview_entries'
    && group.records?.some(row => row.lot_no_raw === 'preview-entry' && row.data?.entry_key === 'preview-entry'
      && row.data?.value === 'synthetic-value'));
  return [job.table_code === 'preview_entries' && r.status === 200 && found,
    `工作 ${job.status}, 讀回 ${r.status}, 合成列 ${!!found}`];
});
for (const tableCode of ['P1', 'P2', 'P3']) {
  await check('import-pipeline-kit', `${tableCode} 建立與提交（T1）`, async () => {
    const job = await importAndCommit(tableCode,
      tableCode === 'P3' ? 'lot_no,date' : 'lot_no',
      [tableCode === 'P3' ? '9000001_01,2099-01-01' : '9000001_01'],
      `${tableCode}_preview.csv`);
    return [job.table_code === tableCode && job.total_rows === 1 && job.error_count === 0,
      `工作 ${job.status}, 資料列 ${job.total_rows}, 錯誤 ${job.error_count}`];
  });
}

await check('analytics-kit', '上傳歷史與趨勢', async () => { const a = await call('GET', '/api/analytics/upload-history'); const b = await call('GET', `/api/analytics/trend?code=${code}`); return [a.status === 200 && b.status === 200, `history ${a.status}, trend ${b.status}`]; });
await check('logs-ops-kit', '系統日誌清單與摘要', async () => { const a = await call('GET', '/api/logs/'); const b = await call('GET', '/api/logs/summary'); return [a.status === 200 && b.status === 200, `list ${a.status}, summary ${b.status}`]; });
await check('logs-ops-kit', '以起訖時間過濾日誌（T10 補丁涵蓋的查詢參數）', async () => { const r = await call('GET', `/api/logs/?since=${encodeURIComponent(new Date(Date.now() - 3600000).toISOString())}&until=${encodeURIComponent(new Date(Date.now() + 3600000).toISOString())}`); return [r.status === 200, `status ${r.status}`]; });
await check('query-traceability-kit', '以批號查詢', async () => { const a = await call('GET', '/api/v2/query/lot/A001'); const b = await call('GET', '/api/v2/query/trace/A001'); return [a.status < 500 && b.status < 500, `lot ${a.status}, trace ${b.status}`]; });
await check('mod-subscription-kit', '訂閱同步使用本機假服務', async () => { const r = await call('POST', '/api/mod/subscriptions/sync', { json: { external_subscription_id: 'smoke-sub' } }); return [r.status < 500, `status ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`]; });

const failed = rows.filter(r => !r.ok && !r.gap);
const gapRows = rows.filter(r => !r.ok && r.gap);
console.log(`\n${rows.filter(r => r.ok).length}/${rows.length} 通過，${gapRows.length} 項已知缺口，${failed.length} 項未預期失敗`);
process.exitCode = failed.length ? 1 : 0;
