# 案例庫本機服務

D164、D168。契約見 `docs/aov-case-store.md`。只綁 127.0.0.1，需 Node 22.13 以上。

啟動：`npm run case-store`（環境變數 `CASE_STORE_PORT` 預設 18788、`CASE_STORE_DB` 預設 `data/case-store.sqlite3`）。測試：`npm --prefix services/case-store test`，已接進根目錄 `npm test`。

## 路由

| 方法與路徑 | 用途 |
|---|---|
| GET、POST `/cases` | 列出、建立案例 `{ name }` |
| GET `/cases/:id/versions`、`/cases/:id/versions/:n` | 版本摘要、單一版本（讀取時重算雜湊） |
| POST `/cases/:id/versions` | 存版本 `{ expectedParent, content, changeReason, author }`；伺服器自己驗證，驗證不過回 422 與報告 |
| GET `/lifecycle` | 一次取得全部現況。回應 `{ nodes: [{ node_id, state: 'active' \| 'deprecated' \| 'merged', reason, replaced_by: string \| null, at }], combos: [{ combo: string[], state: 'active' \| 'deprecated', reason, at }] }`；每個 node 與組合只回最新一筆事件，沒有紀錄的 node 即為使用中 |
| GET `/nodes/:id` | 解析別名與現況，回應 `{ nodeId, state }`（`nodeId` 為別名終點） |
| POST `/nodes/:id/deprecate`、`/nodes/:id/reactivate` | `{ reason }` |
| POST `/nodes/merge` | `{ keep, drop, reason }` |
| POST `/combos/deprecate`、`/combos/reactivate` | `{ combo, reason }` |
| POST `/usage` | `{ nodeId }` 或 `{ combo }`，列出仍引用的版本 |
| GET、POST `/backup` | 匯出、匯入（只能進空庫） |

## 回應格式

成功時直接回傳資料本體；失敗時回 `{ errors: [{ code, message, ... }] }`，狀態碼對應：400 輸入不合法、404 不存在、409 衝突（版本過期、已淘汰或已合併、空庫限制）、415 非 JSON、422 驗證未通過、503 忙碌、500 其他。

| 路由 | 成功回應 |
|---|---|
| GET `/cases` | `[{ case_id, name, created_at }]` |
| POST `/cases`（201） | `{ case_id, name, created_at }` |
| GET `/cases/:id/versions` | `[{ version, parent_version: number \| null, change_reason, author, created_at }]`，由舊到新 |
| GET `/cases/:id/versions/:n` | 上列欄位加 `case_id`、`content`（整合包 JSON 文字）、`content_hash`、`verified_report`（JSON 文字） |
| POST `/cases/:id/versions`（201） | 同上（單一版本）。驗證未通過回 422：`{ errors: [{ code: 'E-NOT-VERIFIED', message }], report }`，`report` 含 `passed`、`scope`、`steps: [{ name, ok }]`、`diagnostics: [{ severity, code, message }]`、`notRun: string[]`。版本過期回 409 `E-VERSION-CONFLICT`；內容含已淘汰或已合併的 node 或組合回 409 `E-DEPRECATED`，每筆錯誤帶 `graph`，以及 `nodeId`（可再帶 `replacement` 表示應改用的節點）或 `combo` |
| POST `/nodes/:id/deprecate`、`/reactivate`、`/nodes/merge`、`/combos/deprecate`、`/combos/reactivate` | 成功回 `null`；已合併的 node 再操作回 409 `E-DEPRECATED` |
| POST `/usage` | `[{ case_id, version, graph }]`，graph 為流程圖識別碼 |
| GET `/backup` | 備份檔 JSON；POST 成功回 `null` |

`expectedParent` 為畫面最近一次讀到的最新版本號，案例尚無版本時為 `null`。

## 已知限制

- 驗證範圍是整合包契約加核心 `compile`；瀏覽器內的互動模擬與正式執行環境不在其中，報告的 `notRun` 會寫明。
- 沒有身分機制：作者與原因為自填；本機來源檢查只擋網頁跨站，不是授權。
- 備份的 sha256 只偵測損壞，不是簽章。
