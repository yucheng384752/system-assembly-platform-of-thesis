// 在一個系統上執行全部情境，把正規化後的結果寫成 JSON。
//
// 用法：
//   node tools/thesis-s4/run.mjs --system source --base-url http://127.0.0.1:18000 --out baseline.json
//     [--alt-base-url http://<另一個位址>:18000]   T4 用：同一個服務、但來源位址不同的入口
//     [--phase after-restart --previous baseline.json]   T6 用：服務重啟後補跑
//     [--only <情境編號開頭>]   只跑部分情境（除錯用；結果不可當作基準）
//
// 管理者金鑰只從環境變數 S4_ADMIN_KEY 讀取，不接受命令列參數，也不寫入結果檔。
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createSourceDriver } from './adapters/source.mjs';
import { runScenarios } from './lib/runner.mjs';
import { SCENARIOS, UI_ONLY_STEPS, NOT_COVERED } from './lib/scenarios.mjs';
import { buildManifest } from './generate-inputs.mjs';

const ADAPTERS = { source: createSourceDriver };

const { values } = parseArgs({
  options: {
    system: { type: 'string' },
    'base-url': { type: 'string' },
    'alt-base-url': { type: 'string' },
    out: { type: 'string' },
    phase: { type: 'string', default: 'main' },
    previous: { type: 'string' },
    only: { type: 'string' },
    note: { type: 'string', multiple: true, default: [] },
  },
});

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (!values.system || !ADAPTERS[values.system]) fail(`--system 必須是：${Object.keys(ADAPTERS).join('、')}`);
if (!values['base-url'] || !values.out) fail('必須提供 --base-url 與 --out');
if (!['main', 'after-restart'].includes(values.phase)) fail('--phase 必須是 main 或 after-restart');
if (values.phase === 'after-restart' && !values.previous) fail('--phase after-restart 需要 --previous <主階段的結果檔>');
if (!process.env.S4_ADMIN_KEY) fail('請先設定環境變數 S4_ADMIN_KEY（管理者金鑰）');

const log = (line) => console.log(`[s4] ${line}`);
const driver = ADAPTERS[values.system]({
  baseUrl: values['base-url'],
  altBaseUrl: values['alt-base-url'],
  adminKey: process.env.S4_ADMIN_KEY,
  log,
});

let previous = null;
const shared = {};
if (values.phase === 'after-restart') {
  previous = JSON.parse(readFileSync(values.previous, 'utf8'));
  shared.t6LockedAt = previous.meta?.t6LockedAt;
} else {
  await driver.setup();
}

const selected = values.only ? SCENARIOS.filter((scenario) => scenario.id.startsWith(values.only)) : SCENARIOS;
const startedAt = new Date().toISOString();
const results = await runScenarios(selected, driver, { phase: values.phase, log, shared });

const output = {
  meta: {
    system: values.system,
    label: driver.label,
    phase: values.phase,
    startedAt,
    finishedAt: new Date().toISOString(),
    partial: Boolean(values.only),
    altAddress: Boolean(values['alt-base-url']),
    notes: values.note, // 例如基準執行用的設定值（USE_GENERIC_SCHEMA、AUDIT_EVENTS_ENABLED 等），由操作者填寫
    inputs: buildManifest(),
    uiOnlySteps: UI_ONLY_STEPS,
    notCovered: NOT_COVERED,
    t6LockedAt: shared.t6LockedAt ?? null,
  },
  // 重啟後補跑時，把主階段的結果帶過來，合成一份完整結果
  scenarios: previous ? [...previous.scenarios, ...results] : results,
};
writeFileSync(values.out, `${JSON.stringify(output, null, 2)}\n`);

const errors = results.filter((result) => result.error);
log(`完成 ${results.length} 個情境，其中 ${errors.length} 個執行錯誤；結果寫入 ${values.out}`);
for (const result of errors) log(`  執行錯誤 ${result.id}：${result.error}`);
if (values.phase === 'main' && shared.t6LockedAt) {
  log('T6：請在 55 秒內重啟服務，然後以 --phase after-restart --previous 補跑。');
}
process.exit(errors.length > 0 ? 1 : 0);
