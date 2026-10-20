// Real-API check of the selection gate (WP5/WP6b, D108, D109). Run after `preview.mjs up` and `app.preview_seed`.
// Usage: node services/preview/smoke-gating.mjs [baseUrl]   (default http://127.0.0.1:18000)
// It leaves the preview in `all` mode when it finishes. Data written by the full smoke test is kept, never deleted.
const base = process.argv[2] ?? 'http://127.0.0.1:18000';
const tenant = '00000000-0000-4000-8000-000000000001';
const user = { 'X-Tenant-Id': tenant };
const admin = { ...user, 'X-Admin-API-Key': 'preview-fake-admin-key' };
const rows = [];
const record = (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const check = async (name, run) => { try { const [ok, detail] = await run(); record(name, ok, detail); } catch (error) { record(name, false, `例外：${error instanceof Error ? error.message : error}`); } };

async function call(method, path, { headers = user, json } = {}) {
  const init = { method, headers: { ...headers } };
  if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
  const response = await fetch(base + path, init);
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}
const recipe = kits => ({ recipeVersion: '1', name: 'gating-check', sourceManifest: 'gating-check', database: { engine: 'postgresql' }, enabledKits: kits });
const snapshot = async () => (await call('GET', '/_preview/capabilities')).body;
// Add the dependencies the gate asks for, one by one, exactly as a Composer Recipe already carries them.
async function applyWithDependencies(kit) {
  const kits = [kit];
  for (let i = 0; i < 8; i++) {
    const r = await call('PUT', '/_preview/recipe', { headers: admin, json: recipe(kits) });
    if (r.status === 200) return { kits, response: r };
    const missing = /缺少依賴 ([a-z0-9-]+)/.exec(String(r.body?.detail ?? ''))?.[1];
    if (!missing || kits.includes(missing)) return { kits, response: r };
    kits.push(missing);
  }
  throw new Error('依賴展開過深');
}

await call('DELETE', '/_preview/recipe', { headers: admin });
await check('開始時為 all 模式', async () => { const s = await snapshot(); return [s.mode === 'all' && s.allowed.length > 0, `mode ${s.mode}, 開放 ${s.allowed.length}`]; });

await check('寫入需要預覽管理員標頭', async () => { const r = await call('PUT', '/_preview/recipe', { headers: user, json: recipe(['generic-forms-kit', 'platform-core-kit']) }); return [r.status === 403, `status ${r.status}`]; });

await check('無效 Recipe 被拒絕且目前選配不變', async () => {
  const before = JSON.stringify(await snapshot());
  const statuses = [];
  statuses.push((await call('PUT', '/_preview/recipe', { headers: admin, json: { enabledKits: 'x' } })).status);
  statuses.push((await call('PUT', '/_preview/recipe', { headers: admin, json: recipe(['no-such-kit']) })).status);
  statuses.push((await call('PUT', '/_preview/recipe', { headers: admin, json: recipe(['generic-forms-kit']) })).status); // dependency missing
  const unchanged = JSON.stringify(await snapshot()) === before;
  return [statuses.every(s => s === 422) && unchanged, `狀態 ${statuses.join(',')}, 選配不變 ${unchanged}`];
});

// Make sure a form exists so data retention can be checked after switching.
const code = `gate-${Date.now().toString(36)}`;
await call('POST', '/api/forms', { json: { code, name: 'Gate form' } });

const forms = await applyWithDependencies('generic-forms-kit');
await check('只選通用表單：套用成功並帶入必要依賴', async () => [forms.response.status === 200 && forms.response.body.mode === 'recipe', `kits ${forms.kits.join(', ')}; status ${forms.response.status}`]);
await check('開放的 Kit 可用，其餘 Kit 的直接呼叫回 403', async () => {
  const ok = await call('GET', '/api/forms');
  const upload = await call('GET', '/api/upload/00000000-0000-4000-8000-000000000009/status');
  const importJob = await call('GET', '/api/v2/import/jobs/00000000-0000-4000-8000-000000000009');
  const trend = await call('GET', `/api/analytics/trend?code=${code}`);
  const denied = [upload, importJob, trend].every(r => r.status === 403 && r.body?.kit);
  return [ok.status === 200 && denied, `forms ${ok.status}; upload ${upload.status}, import ${importJob.status}, analytics ${trend.status}`];
});
await check('通用轉發端點不能繞過選配', async () => {
  const r = await call('POST', '/api/kit/call/upload.file.create', { headers: admin, json: {} });
  const s = await snapshot();
  return [r.status === 403 && s.denied.some(d => d.capability === 'upload.file.create'), `status ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`];
});
await check('未知路由預設拒絕，健康檢查與選配端點不受影響', async () => {
  const unknown = await call('GET', '/api/definitely-not-a-route');
  const health = await call('GET', '/healthz');
  const caps = await call('GET', '/_preview/capabilities');
  return [unknown.status === 403 && health.status === 200 && caps.status === 200, `unknown ${unknown.status}, healthz ${health.status}, capabilities ${caps.status}`];
});

const upload = await applyWithDependencies('upload-validation-kit');
await check('切換為上傳驗證：新選配立即生效', async () => {
  const f = await call('GET', '/api/forms');
  const status = await call('GET', '/api/upload/00000000-0000-4000-8000-000000000009/status');
  return [upload.response.status === 200 && f.status === 403 && status.status !== 403, `kits ${upload.kits.join(', ')}; forms ${f.status}, upload ${status.status}`];
});

await check('子功能層級：未選取的子功能被拒絕，選取後開放', async () => {
  const base = recipe([...upload.kits]);
  const none = await call('PUT', '/_preview/recipe', { headers: admin, json: { ...base, selectedSubfeatures: { 'upload-validation-kit': [] } } });
  const denied = await call('GET', '/api/upload/00000000-0000-4000-8000-000000000009/status');
  const some = await call('PUT', '/_preview/recipe', { headers: admin, json: { ...base, selectedSubfeatures: { 'upload-validation-kit': ['csv-excel-upload-validation'] } } });
  const allowed = await call('GET', '/api/upload/00000000-0000-4000-8000-000000000009/status');
  return [none.status === 200 && denied.status === 403 && denied.body?.detail === '子功能未開放' && some.status === 200 && allowed.status !== 403, `全不選 ${denied.status} ${denied.body?.detail}；選取後 ${allowed.status}`];
});

const back = await applyWithDependencies('generic-forms-kit');
await check('切回通用表單：先前寫入的資料仍在（切換不刪資料）', async () => {
  const list = await call('GET', '/api/forms');
  return [back.response.status === 200 && list.status === 200 && JSON.stringify(list.body).includes(code), `status ${list.status}`];
});

await check('預覽不可用的 Kit 可隨 Recipe 套用，但被標為不可用並回 403', async () => {
  const kits = [...back.kits, 'entry-permission-kit', 'station-data-link-kit'];
  const r = await call('PUT', '/_preview/recipe', { headers: admin, json: recipe(kits) });
  const s = await snapshot();
  const unavailable = (s.unavailable ?? []).map(u => u.kit);
  return [r.status === 200 && unavailable.includes('entry-permission-kit') && (s.warnings ?? []).length >= 0, `status ${r.status}; unavailable ${unavailable.join(', ')}; warnings ${(s.warnings ?? []).length}`];
});

await check('含生產設定（productionSettings，D111）的 Recipe 依目前 schema 通過，結構錯誤被拒絕', async () => {
  const settings = { version: 1, formats: [{ id: 'f1', name: '標準', pattern: '{產品}-{日期}-{流水號}' }], defaultFormatId: 'f1',
    products: [{ id: 'p1', name: '產品甲', formatId: 'f1', formId: 'form-1', fieldId: 'field-1', lower: 1, upper: 5, unit: 'mm' }] };
  const ok = await call('PUT', '/_preview/recipe', { headers: admin, json: { ...recipe(back.kits), productionSettings: settings } });
  const badVersion = await call('PUT', '/_preview/recipe', { headers: admin, json: { ...recipe(back.kits), productionSettings: { ...settings, version: 2 } } });
  const extra = await call('PUT', '/_preview/recipe', { headers: admin, json: { ...recipe(back.kits), productionSettings: { ...settings, unknown: true } } });
  return [ok.status === 200 && badVersion.status === 422 && extra.status === 422, `有效 ${ok.status}；版本錯誤 ${badVersion.status}；多餘欄位 ${extra.status}`];
});

await check('DELETE 回到 all 模式', async () => { const r = await call('DELETE', '/_preview/recipe', { headers: admin }); const f = await call('GET', '/api/forms'); return [r.body?.mode === 'all' && f.status === 200, `mode ${r.body?.mode}, forms ${f.status}`]; });

const failed = rows.filter(r => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} 通過，${failed.length} 項失敗`);
process.exitCode = failed.length ? 1 : 0;
