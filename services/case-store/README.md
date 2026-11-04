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

## 已知限制

- 驗證範圍是整合包契約加核心 `compile`；瀏覽器內的互動模擬與正式執行環境不在其中，報告的 `notRun` 會寫明。
- 沒有身分機制：作者與原因為自填；本機來源檢查只擋網頁跨站，不是授權。
- 備份的 sha256 只偵測損壞，不是簽章。
