// 依序執行情境，收集每個情境「正規化後的可觀察結果」。
// 情境之間共用同一個資料庫狀態，所以順序固定、不平行執行。

/**
 * @typedef {object} Scenario
 * @property {string} id            情境編號
 * @property {string[]} steps       對應凍結清單的步驟、權限表或 T 情境編號
 * @property {'main'|'after-restart'} [phase]
 * @property {(driver: object, shared: object) => Promise<unknown>} run
 */

export async function runScenarios(scenarios, driver, { phase = 'main', log = () => {}, shared = {} } = {}) {
  const results = [];
  for (const scenario of scenarios) {
    if ((scenario.phase ?? 'main') !== phase) continue;
    log(`執行 ${scenario.id}`);
    try {
      const observed = await scenario.run(driver, shared);
      results.push({ id: scenario.id, steps: scenario.steps, observed });
    } catch (error) {
      // 嚴禁靜默失敗：情境本身跑不起來時記成 error，比對時不會被當成通過。
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      log(`情境 ${scenario.id} 執行錯誤：${message}`);
      results.push({ id: scenario.id, steps: scenario.steps, error: message });
    }
  }
  return results;
}

/** 輪詢直到條件成立；逾時就丟錯，不回傳半成品。 */
export async function pollUntil(read, isDone, { timeoutMs = 60_000, intervalMs = 250, what = '狀態' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await read();
    if (isDone(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(`等待${what}逾時（${timeoutMs} 毫秒），最後一次讀到：${JSON.stringify(last).slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
