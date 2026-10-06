---
id: "20261006-more-node-tools"
title: "工具箱擴充：把基線版 Kit 功能轉成節點工具"
status: "in_progress"
owner: "codex"
reviewer: "claude"
priority: "normal"
created_by: "claude"
created_at: "2026-10-06"
updated_at: "2026-10-06"
role_priority:
  implementation: "codex (WP2 到 WP3) / claude (WP1、決議、驗證)"
  review: "claude"
  tests: "codex / claude"
  requirements: "user"
artifacts:
  - path: "docs/decision-log.md"
    type: "file"
  - path: "kits/BASELINE.md"
    type: "file"
---

# Goal

user 要求「加入更多 node 功能」，範圍是工具箱的動作：把基線版 Kit 中可轉成節點工具（Action）的功能都轉換，並補上必要資料（registry 與 actions）。user 已明定：平台與維運也要轉換（D89）；原始碼補齊後才上架（D90）；不含範例 mock 與預設參數（D92）。分支 `feature/more-node-tools`。

# Claude Notes

## WP1（Claude，已完成）

- 補齊來源：`upload-validation-kit` 11 個檔案、`import-pipeline-kit` 4 個檔案，自基線版組裝後端複製（D90，細節在 `kits/BASELINE.md`）。
- `station-admin-kit` 排除：`routes_stations.py` 在基線版任何位置都不存在。
- 決議 D89 到 D92 已寫入 `docs/decision-log.md`。
- 已確認：`apps/composer-gui/src/registryData.ts` 以 `import.meta.glob('config/registry/*.json')` 載入，新增 registry 檔不需改程式。

## 派工給 Codex

**預計完成時間：2026-10-06 15:45（約 3 小時）。** 到期未完成由 Claude 接手（Codex 只寫程式與資料，不執行 git、不啟動伺服器；cwd 必須是專案根目錄）。

### WP2 registry（先做）

格式與規則依 `schemas/kit-registry.schema.json` 與 D67、既有 `config/registry/generic-forms-kit.json`。每個 capability 記 `declared`（契約是否宣告）與 `implementedBy`（原始碼實際位置），兩者不一致、找不到實作時標 `verified: false` 並寫 `note`，不悄悄修正。基線版 `kits/` 不得修改。

新增檔案（路由與服務請讀 `kits/<kit>/src/backend/` 確認，路徑以原始碼為準）：

1. `upload-validation-kit.json`：契約 `upload.file.create`、`upload.status.get`、`upload.pdf.status`、`upload.pdf.convert`、`upload.pdf.outputs`、`db.upload.jobs.list`；原始碼另有 `GET /api/validate`（`routes_validate.py`）與 `GET /api/upload/pdf/service-status`，契約未宣告者標 `declared: false`。環境變數 `VALID_MATERIALS_CSV`、`VALID_SLITTING_MACHINES_CSV` 只記名稱，不寫值。
2. `import-pipeline-kit.json`：`import.job.create`、`from_upload`、`get`、`errors`、`commit`、`db.import.jobs`；原始碼另有 `POST /jobs/{job_id}/cancel`（契約未宣告）。前綴為 `/api/v2/import`。
3. `analytics-kit.json`：`analytics.upload-history.list`、`export`、`analytics.trend`。
4. `audit-edit-kit.json`：`audit.events.list`、`records.edit`、`edit-reasons.list`、`create`、`update`，`db.audit.events`、`db.edit-reasons.validate`。
5. `mod-subscription-kit.json`：`subscriptions.manage`、`db.subscriptions`。
6. `logs-ops-kit.json`：`logs.list`。
7. 擴充 `platform-core-kit.json`：加入 `platform.health`、`kit.contracts.list`、`admin.endpoint-permissions.get`、`put`（`kit.capability.call` 不登錄，D89）；更新 `scope` 文字，既有 `db.*` 項目不動。

注意：`query-traceability-kit` 既有 registry 不動。

### WP3 actions 與測試

編輯 `config/actions.json`（格式依 `schemas/action-catalog.schema.json`，`requires` 的每個 capability 必須在 registry 找得到實作者）。`parameters` 只寫 id、name、type、required、minimum、maximum，不寫 `default`（D92）；不加 mock 資料。既有 4 個動作的內容不動，只把 `import-records` 的 `name` 改為「匯入資料列」（D91）。

| 動作 id | 名稱 | 類別 | requires |
|---|---|---|---|
| browse-forms | 瀏覽表單與紀錄 | 表單 | forms.list、forms.records.list |
| upload-file | 上傳檔案並驗證 | 資料上傳 | upload.file.create、upload.status.get |
| convert-pdf | PDF 轉檔 | 資料上傳 | upload.pdf.convert、upload.pdf.status、upload.pdf.outputs |
| import-job-track | 匯入工作追蹤 | 資料匯入 | import.job.create、import.job.get、import.job.errors、import.job.commit |
| view-upload-history | 上傳歷史查詢 | 分析 | analytics.upload-history.list、analytics.upload-history.export |
| analyze-trend | 趨勢分析 | 分析 | analytics.trend |
| view-audit-events | 稽核事件檢視 | 稽核與修正 | audit.events.list |
| edit-record | 修正紀錄 | 稽核與修正 | records.edit、edit-reasons.list |
| manage-edit-reasons | 修正原因管理 | 稽核與修正 | edit-reasons.list、create、update |
| manage-subscription | MOD 訂閱管理 | 訂閱 | subscriptions.manage |
| view-logs | 檢視系統日誌 | 平台與維運 | logs.list |
| check-health | 系統健康檢查 | 平台與維運 | platform.health |
| view-kit-contracts | 功能契約清單 | 平台與維運 | kit.contracts.list |
| manage-endpoint-permissions | 端點權限設定 | 平台與維運 | admin.endpoint-permissions.get、put |

- `needs`：需要表單者填 `["form"]`，其餘空陣列。`edit-record`、`import-job-track`、`upload-file`、`convert-pdf` 需要 `form`，是否需要其他請依工具實際輸入判斷並在 Codex Notes 說明。
- `requiresKits`：沿用 D69 的做法，使用表格的動作帶 `generic-forms-kit` 與 `station-data-link-kit`（附原因）。`browse-forms`、`upload-file`、`convert-pdf`、`import-job-track`、`edit-record`、`view-upload-history`、`analyze-trend` 依此判斷；平台與維運、訂閱類不帶，除非原始碼證明相依，請逐項在 Codex Notes 說明。
- 描述與名稱用業務語言，不出現 capability、路徑或 Kit 名稱（A-C14）。
- 測試（`apps/composer-gui/src/catalog.test.ts`、`registry.test.ts` 或對應檔，沿用現有風格，測試要編碼意圖）：
  1. 每個 action 的 `requires` 在已載入的 registry 中都有實作者（防止上架沒有來源的工具）。
  2. `actions.json` 通過 schema，id 不重複，所有 `parameters` 沒有 `default`（新增動作）。
  3. 選用每個新動作時，`deriveKits` 推導出預期 Kit，不產生「契約未完整」缺口。
  4. 所有動作名稱與描述不含 capability 字串。
  5. 各 registry 檔通過 `parseRegistry`，且不含環境變數值。

### 停止條件

需要改動任何 schema、需要新增依賴、registry 與原始碼無法對應（找不到實作且不是契約遺漏）、既有測試意圖無法保留時，停止並在 Codex Notes 寫下問題，不要自行變通。每個工作包完成後在下方記錄：做了什麼、變更的檔案、測試結果（含略過項目）、未解決的事。

## Codex Notes

（Codex 在此續寫）
