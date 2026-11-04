# AoV 案例庫儲存層（批一）

唯一契約：[`docs/aov-case-store.md`](../../docs/aov-case-store.md)。使用 Node 內建 `node:sqlite`，需要 Node >= 22.13；本次在 Node 24.15.0 驗證。不新增依賴，沒有服務、連接埠或 UI。

## 使用方式

由 TypeScript 消費端匯入 `libs/case-store/index.ts`（與專案其他 libs 一樣，由消費端的建置流程處理 TypeScript）。`content` 是整合包 JSON **文字**，不是物件；儲存前經既有 `validateAovBundle` 驗證、`canonicalJson` 正規化。讀取回傳當時存入的文字，之後不因淘汰、合併或 migration 重新序列化。

```ts
import { openCaseStore } from './libs/case-store';

const store = openCaseStore('./cases.sqlite'); // 測試可用 :memory:
try {
  const created = store.createCase('配料流程');
  if (!created.ok) console.error(created.errors);
  else {
    const saved = await store.saveVersion({
      caseId: created.value.case_id,
      expectedParent: null, // 後續更新帶入讀取到的最新版本號
      content: bundleJsonText,
      verifiedReport: verificationAndSimulationReport,
      changeReason: '初版',
      author: '填寫者',
    });
    if (!saved.ok) console.error(saved.errors);
    else console.log(store.getVersion(saved.value.case_id, saved.value.version));
  }
} finally {
  store.close(); // 所有 saveVersion 都 await 完成後才關閉
}
```

`bundleJsonText` 與 `verificationAndSimulationReport` 由呼叫端提供。批二須自行在服務端執行驗證與模擬後產生報告。

## 回傳與查詢

- 操作回傳 `Result<T>`：`{ ok: true, value }` 或 `{ ok: false, errors }`；`saveVersion` 為非同步，其餘操作同步。`close()` 釋放連線。
- 案例與版本資料使用契約的 snake_case 欄位。`getVersion` 的 `content`、`verified_report` 都是 JSON 文字；`listVersions` 只包含版本、父版本、原因、作者、時間。
- `createCase(name)` 產生 UUID；`listCases()` 列出案例。`getVersion(caseId, version)` 每次核對原文 SHA-256。`listVersions(caseId)` 按版本遞增排列。
- `deprecateNode`、`reactivateNode`、`deprecateCombo`、`reactivateCombo` 成功回傳 `null`。原因必填。已合併的 id 不再接受狀態操作，請使用別名終點。
- `mergeNodes({ keep, drop, reason })` 在同一交易追加別名與 merged 事件，成功回傳 `null`。原因須由使用者寫明兩者差異；程式不判斷自然語言是否充分。
- `resolveNode(nodeId)` 回傳 `{ nodeId: 終點, state: 終點現況 }`。沒有事件的 id 為 active，不依賴 registry 外鍵。
- `scanUsage(nodeIdOrCombo)` 回傳每個命中版本的 `{ case_id, version, graph }`。查詢的是歷史內的原始 id，沒有重寫或解析成新 id；每個 graph 只列一次。組合需同圖、同方向、每一步直接相連。
- 組合最新狀態以原始 JSON 文字分組；儲存時比對組合才解析兩側別名。要重新啟用舊 id 記錄的組合，須傳入那個原始組合。

`E-NOT-VERIFIED`、`E-BAD-CONTENT`、`E-DEPRECATED`、`E-VERSION-CONFLICT`、`E-CORRUPT` 對應契約。另以 `E-INVALID-INPUT`、`E-NOT-FOUND`、`E-ALIAS-CYCLE`、`E-BUSY` 區分其他操作錯誤。淘汰錯誤含 `graph`、`nodeId` 或 `combo`；merged 錯誤另含 `replacement` 與替代訊息。

開啟失敗（檔案不可用、schema_meta 損壞或未知較新 schema）會關閉連線並拋出錯誤；較新 schema 的訊息帶 `E-SCHEMA-NEWER`。執行中非預期的 SQLite 錯誤也會拋出，交易先回復。呼叫端應在啟動邊界處理開啟失敗。

## 交易與 migration

正式 schema 為 1。`migrations.ts` 的每個步驟連同 schema_meta 更新都在自己的交易內，失敗回復該步。沒有資料庫時建立最新版；不嘗試降版。資料表以觸發器拒絕 UPDATE、DELETE，也擋以 INSERT OR REPLACE 覆蓋同一筆歷史。

驗證整合包時不持鎖；驗證完成後 `BEGIN IMMEDIATE`，在同一交易查淘汰現況、比對 `expectedParent`、插入新版本。沒有交易內的 await。兩方帶相同父版本時只會成功一方；失敗不消耗版本號。SQLite 等待鎖最多 5 秒；儲存版本的鎖競爭回 `E-VERSION-CONFLICT`，其他寫入回 `E-BUSY`，請重新讀取後重試。

測試在自身目錄下的暫存資料夾用 SQL 建立 v1 fixture，模擬 v1→v2 新增測試用表，確認原文位元組不變；也注入中途失敗，確認 DDL、資料、版本均回復。虛構 migration 不進正式清單。所有暫存檔於測試後清除。

## 驗證指令（專案根目錄）

```powershell
npm.cmd run typecheck
npm.cmd test --prefix libs/case-store
npm.cmd test
node libs/case-store/check-mutations.mjs
```

根目錄 Vitest 設定只搜尋 GUI，**不會自動收集本目錄測試**；故案例庫須另外執行上列 `--prefix` 指令。未為接入根測試而修改範圍外檔案。案例庫測試包含兩個 worker／兩條獨立 SQLite 連線的同時儲存；測試 worker 使用已安裝的 TypeScript 載入相同 API，不啟動伺服器。

變異檢查逐一暫時移除規則、執行測試、在 finally 恢復原始碼；請勿與其他測試或編輯同時執行。只有規則對應的測試失敗才算覆蓋，不計不相關的初始化失敗。結果存於 `mutation-results.json`；任何存活變異、未涵蓋測試或未恢復原文都會使指令失敗。

## 已知限制

- 作者與原因是自填文字，無法證明是誰修改；沒有身分驗證。
- `content_hash` 只偵測損壞，不是簽章；有權移除觸發器及修改檔案者仍可竄改資料庫。
- 儲存層只確認報告 `passed` 為 true，不自己跑模擬；是否真的驗證與模擬，須由批二服務端保證，不信任瀏覽器報告。
- 既有 `validateAovBundle` 對 C 內部內容有其自身驗證邊界；此層沿用它，不聲稱新增完整執行語意驗證。
- `scanUsage` 逐版本讀取與核對雜湊，尚未建立大型案例庫的效能證據。
- 本批不含備份匯出匯入、多人同步、服務 API 或 UI。
