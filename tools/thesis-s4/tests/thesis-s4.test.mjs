// 這些測試守住的是 S4 判準的前提，不是實作細節：
// - 凍結清單的每一項都有情境（否則「全部相同」不代表全部比過）
// - 合成資料可重現、不含實際批號樣式
// - 比對不會把執行錯誤或缺少的情境算成通過；排除項目一定要有理由
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import { createSourceDriver } from '../adapters/source.mjs';
import { classifyPdfRequest, createFakePdfServer } from '../fake-pdf-server.mjs';
import { buildManifest } from '../generate-inputs.mjs';
import { compareRuns, renderMarkdown } from '../lib/compare.mjs';
import { buildForm } from '../lib/http.mjs';
import { runScenarios } from '../lib/runner.mjs';
import {
  PERMISSION_ROW_KEYS,
  ROLES,
  SCENARIOS,
  STEP_IDS,
  THROTTLE_IDS,
  UI_ONLY_STEPS,
} from '../lib/scenarios.mjs';
import { HEADERS, inputFiles, pdfConversionOutputs } from '../lib/synthetic.mjs';
import { buildStoredZip } from '../lib/zip.mjs';

// ---- 涵蓋範圍 ----

test('凍結清單的 52 個步驟，每一個都有情境或明列為只在畫面上發生', () => {
  assert.equal(STEP_IDS.length, 52);
  const covered = new Set(SCENARIOS.flatMap((scenario) => scenario.steps));
  const missing = STEP_IDS.filter((step) => !covered.has(step) && !(step in UI_ONLY_STEPS));
  assert.deepEqual(missing, []);
  // 明列為只在畫面上的步驟必須真的在清單內，而且要寫理由
  for (const [step, reason] of Object.entries(UI_ONLY_STEPS)) {
    assert.ok(STEP_IDS.includes(step), `${step} 不在凍結清單內`);
    assert.ok(reason.trim().length > 0);
  }
});

test('權限表 21 列都有情境，T1 至 T10 都有情境', () => {
  assert.equal(PERMISSION_ROW_KEYS.length, 21);
  const rows = SCENARIOS.filter((scenario) => scenario.permissionRow).map((scenario) => scenario.permissionRow);
  assert.deepEqual(rows, PERMISSION_ROW_KEYS);
  const covered = new Set(SCENARIOS.flatMap((scenario) => scenario.steps));
  assert.deepEqual(THROTTLE_IDS.filter((id) => !covered.has(id)), []);
});

// 替身：記下被呼叫的操作，回傳形狀足夠讓情境走完
function stubDriver() {
  const calls = [];
  return {
    calls,
    hasAltAddress: true,
    sleep: async () => {},
    currentToken: () => 'stub-token',
    provision: async () => {},
    async call(role, name, args) {
      calls.push({ role, name, args });
      const created = name.startsWith('create') || name === 'uploadPdf';
      return {
        obs: { status: created ? 201 : 200, state: 'READY', rows: [], files: [{ name: 'P2_x.csv', csv: 'a\n1\n' }], steps: {}, statuses: [], codes: [] },
        ref: 'stub-ref',
      };
    },
  };
}

test('每個情境都跑得完，用到的操作轉接層都有提供，權限表每列都對五種身分各做一次', async () => {
  const provided = new Set(createSourceDriver({ baseUrl: 'http://127.0.0.1:1', adminKey: 'stub' }).operations);
  for (const phase of ['main', 'after-restart']) {
    const driver = stubDriver();
    const results = await runScenarios(SCENARIOS, driver, { phase, shared: { t6LockedAt: Date.now() } });
    assert.deepEqual(results.filter((result) => result.error), []);
    const unknown = [...new Set(driver.calls.map((call) => call.name))].filter((name) => !provided.has(name));
    assert.deepEqual(unknown, []);
    for (const result of results.filter((r) => r.id.startsWith('PERM-') && r.id !== 'PERM-00-準備帳號')) {
      assert.deepEqual(Object.keys(result.observed), ROLES, result.id);
    }
  }
});

test('T4 沒有第二個來源位址、T6 超過時限時記為執行錯誤，不產生可比對的結果', async () => {
  const driver = { ...stubDriver(), hasAltAddress: false };
  const t4 = await runScenarios(SCENARIOS.filter((s) => s.id.startsWith('T4')), driver);
  assert.match(t4[0].error, /未執行/);
  const late = await runScenarios(SCENARIOS, stubDriver(), { phase: 'after-restart', shared: { t6LockedAt: Date.now() - 120_000 } });
  assert.match(late[0].error, /未執行/);
});

// ---- 合成資料 ----

test('合成輸入可重現：兩次產生的清單（含 SHA-256）完全相同', () => {
  assert.deepEqual(buildManifest(), buildManifest());
});

test('合成資料的批號都以 99 開頭，不會與實際批號樣式（年份 2x）相同', () => {
  const texts = [
    ...Object.values(inputFiles()).filter((file) => file.name.endsWith('.csv')).map((file) => file.data.toString('utf8')),
    ...pdfConversionOutputs().map((entry) => String(entry.data)),
  ];
  const lots = texts.flatMap((text) => text.match(/\b\d{7}_\d{2}\b/g) ?? []);
  assert.ok(lots.length > 0);
  assert.deepEqual(lots.filter((lot) => !lot.startsWith('99')), []);
});

test('P2 的 PDF 轉檔輸出刻意沒有收卷機欄（來源會注入），一般 P2 檔則有', () => {
  const converted = pdfConversionOutputs().find((entry) => entry.name.startsWith('P2_'));
  assert.ok(!String(converted.data).split('\n')[0].includes('Winder number'));
  assert.ok(HEADERS.P2.includes('Winder number'));
});

// ---- 假的 PDF 轉檔服務 ----

function readStoredZip(buffer) {
  const entries = [];
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const data = buffer.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    assert.equal(buffer.readUInt32LE(offset + 14), crc32(data) >>> 0, `${name} 的 CRC`);
    entries.push({ name, text: data.toString('utf8') });
    offset += 30 + nameLength + size;
  }
  return entries;
}

test('ZIP 封裝的內容讀得回來，CRC 正確', () => {
  const entries = readStoredZip(buildStoredZip([{ name: 'a.csv', data: 'x,y\n1,2\n' }, { name: 'empty.csv', data: '' }]));
  assert.deepEqual(entries, [{ name: 'a.csv', text: 'x,y\n1,2\n' }, { name: 'empty.csv', text: '' }]);
});

test('假轉檔服務的三種情況：固定回傳、錯誤、不回應', async () => {
  assert.equal(classifyPdfRequest('P2_fail_sample.pdf'), 'fail');
  assert.equal(classifyPdfRequest('P2_hang_sample.pdf'), 'hang');
  assert.equal(classifyPdfRequest('P2_9905055_05.pdf'), 'ok');

  const fake = createFakePdfServer();
  const port = await fake.listen();
  const post = (name, signal) =>
    fetch(`http://127.0.0.1:${port}/process`, {
      method: 'POST',
      body: buildForm({ table: 'P2' }, [{ field: 'files', name, data: Buffer.from('%PDF-'), type: 'application/pdf' }]),
      signal,
    });
  try {
    const ok = await post('P2_9905055_05.pdf');
    assert.equal(ok.status, 200);
    assert.ok(!(ok.headers.get('content-type') || '').includes('json')); // 來源把非 JSON 的回應當作 ZIP
    const names = readStoredZip(Buffer.from(await ok.arrayBuffer())).map((entry) => entry.name);
    assert.deepEqual(names, pdfConversionOutputs().map((entry) => entry.name));

    assert.equal((await post('P2_fail_sample.pdf')).status, 500);
    await assert.rejects(post('P2_hang_sample.pdf', AbortSignal.timeout(300)));
  } finally {
    await fake.close();
  }
});

// ---- 比對 ----

const run = (scenarios) => ({ scenarios });
const scenario = (id, observed, extra = {}) => ({ id, steps: ['U3'], observed, ...extra });

test('相同的結果判為相同；不同的欄位逐一列出路徑', () => {
  const base = run([scenario('a', { status: 201, rows: [{ lot: '9901011_01' }] })]);
  assert.equal(compareRuns(base, structuredClone(base)).summary.same, 1);

  const other = run([scenario('a', { status: 400, rows: [{ lot: '9901011_01' }, { lot: 'extra' }] })]);
  const report = compareRuns(base, other);
  assert.equal(report.results[0].verdict, 'different');
  assert.deepEqual(report.results[0].differences.map((d) => d.path).sort(), ['rows.1', 'status']);
});

test('排除清單：每一筆都要有理由；被排除的差異不計入，但仍列在報告裡', () => {
  const base = run([scenario('a', { status: 401, note: 'x' })]);
  const other = run([scenario('a', { status: 403, note: 'x' })]);
  assert.throws(() => compareRuns(base, other, [{ scenario: 'a', path: 'status', reason: ' ' }]), /reason/);

  const report = compareRuns(base, other, [{ scenario: 'a', path: 'status', reason: '登入機制為刻意差異（清單 3.4）' }]);
  assert.equal(report.results[0].verdict, 'same');
  assert.equal(report.results[0].excluded.length, 1);
  assert.match(renderMarkdown(report, { baselineLabel: 'A', candidateLabel: 'B' }), /登入機制為刻意差異/);
  // 排除規則只對指定的情境生效
  assert.equal(compareRuns(base, other, [{ scenario: 'b', path: 'status', reason: 'r' }]).results[0].verdict, 'different');
});

test('執行錯誤、缺少或多出的情境都不算相同', () => {
  const base = run([scenario('a', { status: 200 }), scenario('b', undefined, { error: '未執行' }), scenario('c', { status: 200 })]);
  const other = run([scenario('a', { status: 200 }), scenario('b', undefined, { error: '未執行' }), scenario('d', { status: 200 })]);
  const report = compareRuns(base, other);
  assert.deepEqual(
    Object.fromEntries(report.results.map((r) => [r.id, r.verdict])),
    { a: 'same', b: 'error', c: 'missing', d: 'extra' },
  );
  assert.equal(report.summary.same, 1);
});

test('情境丟出的錯誤被記錄下來，後面的情境照常執行', async () => {
  const results = await runScenarios(
    [
      { id: 'x', steps: [], run: async () => { throw new Error('壞了'); } },
      { id: 'y', steps: [], run: async () => ({ ok: true }) },
    ],
    {},
  );
  assert.match(results[0].error, /壞了/);
  assert.deepEqual(results[1].observed, { ok: true });
});
