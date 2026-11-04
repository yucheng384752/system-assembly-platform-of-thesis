import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const dir = dirname(fileURLToPath(import.meta.url));
const files = ['index.ts', 'migrations.ts', 'graph.ts'];
const originals = new Map(files.map(file => [file, readFileSync(join(dir, file), 'utf8')]));
function run() {
  const result = spawnSync(process.execPath, [join(dir, '../../node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'vitest.config.ts', '--configLoader', 'native', '--reporter=json'],
  { cwd: dir, encoding: 'utf8', timeout: 45000, maxBuffer: 8_000_000, windowsHide: true });
  assert.ifError(result.error);
  const report = JSON.parse(result.stdout);
  assert(report.testResults.length > 0, result.stderr);
  const tests = report.testResults.flatMap(suite => suite.assertionResults);
  assert(tests.length > 0, '不能把載入失敗當作變異被測試攔截');
  return { status: result.status, tests };
}
function replace(source, from, to) {
  assert.equal(source.split(from).length, 2, `變異錨點須恰好一處：${from}`);
  return source.replace(from, to);
}
const reportStart = originals.get('index.ts').indexOf('    if (verifiedReport ===');
const reportEnd = originals.get('index.ts').indexOf('    if (typeof content', reportStart);
assert(reportStart > 0 && reportEnd > reportStart);
const mutations = [
  ['JSON 正規化', 'index.ts', s => replace(s, 'const stored = canonicalJson(validated.value);', 'const stored = content;')],
  ['不可 UPDATE／DELETE', 'migrations.ts', s => replace(s, "['UPDATE', 'DELETE']", '[]')],
  ['不可 REPLACE', 'migrations.ts', s => replace(s, "${keys.map(key => `${key} = NEW.${key}`).join(' AND ')}", '0')],
  ['執行 migration', 'migrations.ts', s => replace(s, 'steps[current](db);', 'if (current === 0) steps[current](db);')],
  ['未知較新 schema', 'migrations.ts', s => replace(s, 'if (current > steps.length)', 'if (false)')],
  ['migration 回復', 'migrations.ts', s => replace(s, "db.exec('ROLLBACK');", "db.exec('COMMIT');")],
  ['損壞偵測', 'index.ts', s => replace(s, 'if (hash(row.content) !== row.content_hash)', 'if (false)')],
  ['報告必須通過', 'index.ts', s => s.slice(0, reportStart) + `    const report = '{"passed":true}';\n` + s.slice(reportEnd)],
  ['完整整合包驗證與格式版本', 'index.ts', s => replace(s,
    "if (!validated.ok) return { ok: false, errors: validated.errors.map(e => ({ code: 'E-BAD-CONTENT', message: `${e.path}: ${e.message}` })) };",
    'if (!validated.ok) return ok({} as FlowVersion);')],
  ['原始 UTF-8 大小', 'index.ts', s => replace(replace(s, "Buffer.byteLength(content, 'utf8') > MAX_BUNDLE_BYTES", 'false'),
    'await validateAovBundle(content)', 'await validateAovBundle(content.trim())')],
  ['node 自身淘汰與合併狀態', 'index.ts', s => replace(s, "if (state === 'active') continue;", 'if (true) continue;')],
  ['合併循環', 'index.ts', s => replace(s, 'if (keep === drop || this.endpoint(keep) === drop)', 'if (false)')],
  ['合併雙方現況', 'index.ts', s => replace(s,
    "if (this.state(keep) !== 'active' || this.state(drop) === 'merged' || this.endpoint(drop) !== drop || this.endpoint(keep) !== keep)", 'if (false)')],
  ['合併原子性', 'index.ts', s => replace(s, "if (started) this.db.exec('ROLLBACK');", "if (started) this.db.exec('COMMIT');")],
  ['SQL 別名循環', 'migrations.ts', s => replace(s, 'WHERE NEW.old_id IN (', 'WHERE 0 AND NEW.old_id IN (')],
  ['組合直接相連', 'graph.ts', s => replace(s, 'candidates.has(edge.from) && ', '')],
  ['組合別名解析', 'index.ts', s => replace(s, 'const resolved = combo.map(value => this.endpoint(value));', 'const resolved = combo;')],
  ['父版本與並行衝突', 'index.ts', s => replace(s, 'if (expectedParent !== latest)', 'if (false)')],
  ['全部歷史使用處', 'index.ts', s => replace(s, 'if (hit) usages.push', 'if (false) usages.push')],
  ['輸入非空', 'index.ts', s => replace(s, 'value.trim().length > 0', 'true')],
  ['SQL 報告 passed', 'migrations.ts', s => replace(s, "COALESCE(json_type(verified_report, '$.passed') = 'true', 0)", '1')],
];

// Only failures of the rule's own tests count; unrelated setup failures are not coverage.
const targets = {
  'JSON 正規化': ['建立案例產生唯一 id'],
  '不可 UPDATE／DELETE': ['直接 SQL UPDATE 與 DELETE'],
  '不可 REPLACE': ['直接 SQL UPDATE 與 DELETE'],
  '執行 migration': ['舊版檔經測試'],
  '未知較新 schema': ['未知較新資料庫'],
  'migration 回復': ['migration 中途失敗', 'migration 每一步獨立提交'],
  '損壞偵測': ['content 損壞'],
  '報告必須通過': ['未通過時優先拒絕', '報告必須是可持久化'],
  '完整整合包驗證與格式版本': ['完整語意驗證必須執行', '拒絕未知內嵌或外殼版本'],
  '原始 UTF-8 大小': ['UTF-8 原始內容'],
  'node 自身淘汰與合併狀態': ['淘汰只擋新版本', '每個命中的 node', '多段合併解析終點'],
  '合併循環': ['多段合併解析終點'],
  '合併雙方現況': ['合併拒絕已 merged'],
  '合併原子性': ['合併第二筆寫入失敗'],
  'SQL 別名循環': ['直接 SQL 寫入間接循環'],
  '組合直接相連': ['組合只比有向直接連線', '三節點組合不能用分支湊成'],
  '組合別名解析': ['三節點組合不能用分支湊成', '組合每個命中 graph'],
  '父版本與並行衝突': ['拒絕過期父版本', '兩個 worker 的連線同時儲存'],
  '全部歷史使用處': ['scanUsage 列出全部案例'],
  '輸入非空': ['欄位長度、空值與找不到資料'],
  'SQL 報告 passed': ['資料庫同樣拒絕缺 passed'],
};

const baseline = run();
assert.equal(baseline.status, 0, '原版測試須先全數通過');
assert(baseline.tests.every(test => test.status === 'passed'));
const killedTests = new Set();
const results = [];
try {
  for (const [rule, file, mutate] of mutations) {
    try {
      writeFileSync(join(dir, file), mutate(originals.get(file)));
      const result = run();
      const failed = result.tests.filter(test => test.status === 'failed').map(test => test.fullName);
      assert(result.status !== 0 && failed.length > 0, `規則移除後未攔截：${rule}`);
      const expected = baseline.tests.filter(test => targets[rule].some(part => test.fullName.includes(part))).map(test => test.fullName);
      assert(expected.length > 0, `未找到規則對應測試：${rule}`);
      assert(expected.every(name => failed.includes(name)), `規則對應測試須全部失敗：${rule}`);
      expected.forEach(name => killedTests.add(name));
      results.push({ rule, failedTests: failed, coveredTests: expected });
      process.stdout.write(`${rule}：${expected.length} 項對應測試失敗（符合預期）\n`);
    } finally { writeFileSync(join(dir, file), originals.get(file)); }
  }
} finally {
  for (const [file, original] of originals) assert.equal(readFileSync(join(dir, file), 'utf8'), original, `${file} 必須恢復原文`);
}
const uncovered = baseline.tests.filter(test => !killedTests.has(test.fullName)).map(test => test.fullName);
writeFileSync(join(dir, 'mutation-results.json'), JSON.stringify({ baselineTests: baseline.tests.length,
  mutations: results.length, coveredTests: killedTests.size, uncovered, results }, null, 2) + '\n');
assert.deepEqual(uncovered, [], '每個測試都必須被至少一項相關規則移除觸發失敗');
process.stdout.write(`共 ${results.length} 項變異被攔截，涵蓋 ${killedTests.size}/${baseline.tests.length} 項測試。\n`);
