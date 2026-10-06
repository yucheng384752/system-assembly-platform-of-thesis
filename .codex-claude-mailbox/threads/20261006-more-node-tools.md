---
id: "20261006-more-node-tools"
title: "工具箱擴充：把基線版 Kit 功能轉成節點工具"
status: "ready_for_claude"
owner: "claude"
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

### 2026-10-06 12:45（Asia/Taipei）：WP2 觸發停止條件，交回 Claude

- 已先讀本 thread，確認 `.git/HEAD` 為 `feature/more-node-tools`，並核對 registry/action schema、既有資料、推導邏輯、測試及本輪七個 Kit 的契約。沒有執行 Git 寫入、連網、安裝依賴或啟動伺服器。
- **WP2 未完成、WP3 未開始。** 尚未寫入 registry/actions 或測試；本次只更新本 thread 與 mailbox index。不是逾時停止，而是遵守本 thread「需要改動任何 schema」及「找不到實作且不是契約遺漏」即停止的明文條件。

已確認的阻礙：

1. `audit-edit-kit` 契約的 `records.edit`、`edit-reasons.update` 都是 `PATCH`；實作 `kits/audit-edit-kit/src/backend/app/api/routes_edit.py:127` 與 `:236` 也都是 `@router.patch`。但 `schemas/kit-registry.schema.json:32` 只允許 GET、POST、PUT、DELETE。無法忠實登錄且通過 schema；不能改填 PUT，也不能用 `verified: false` 繞過 method enum。
2. `import-pipeline-kit` 契約明確宣告 `import.job.from_upload`，`routes_import_v2.py:516–527` 有 `/jobs/from-upload-job` 與 `create_import_job_from_upload_job`。但 registry schema 的 capId（第 19 行）只允許 `^[a-z0-9.-]+$`，不接受底線；不能靜默改名。action schema 的 requires 也使用相同限制，但本輪新動作未直接要求此項。
3. `platform-core-kit` 契約宣告 `platform.health` / `GET /healthz`，但搜尋其整個 `src/backend` 沒有 `healthz`、`def health` 或 `platform.health`，檔案清單亦無應用程式入口。此項目前不能聲稱已驗證或上架 `check-health`；若後續記錄，須 `implementedBy: null`、`verified: false` 並附 note，或先由 Claude 補齊真正來源。

另已發現需後續核對的跨 Kit 實作：`db.upload.jobs.list` 的實作者在 `kits/platform-core-kit/src/backend/app/core/db_capabilities.py:286` 的 `list_upload_jobs`，第 352 行有能力對應；不能把它假記成 upload-validation 的本地函式。本 thread 又要求 platform-core 既有 db 項目不動，後續須釐清是否允許新增這個 db 登錄。其餘來源尚未全面核對，不能當成已驗證。

檢查結果（未修改產品資料前的基線）：

- `npm.cmd run typecheck`：通過，exit 0。
- `npm.cmd test`：exit 1；30 個測試檔中 29 通過、1 失敗；282 個測試中 **280 通過、1 失敗、1 略過**。
- 失敗：`security.test.mjs:128` 的 CLI 簽署測試，讀取暫存私鑰時發生 EPERM；`:107` 的 afterAll 清理亦 EPERM。暫存目錄 `C:\Users\gslab\AppData\Local\Temp\composer-security-iYYyyo` 未能清除，請 Claude 在具權限環境檢查與清理；未讀取或輸出私鑰內容。既有 mailbox index 已記錄同類 security CLI EPERM。
- 略過：`App.test.tsx:14`「未涵蓋：以 User 身分修改 MIS 項目由授權邊界拒絕（尚無身分機制）」，屬既有 `test.skip`，本次未新增略過。
- 另以已安裝的 Ajv 和記憶體副本做最小檢查：既有 generic-forms registry 通過；分別把 capability method 設成 PATCH、id 設成 `import.job.from_upload`，確實分別遭 enum 與 pattern 拒絕（檢查 exit 0）。沒有寫入測試資料。首次 Node inline 診斷因 PowerShell 引號傳遞失敗，已改 stdin 執行成功。
- 未執行 build、Python Kit 測試或瀏覽器驗證；本輪要求的兩項 npm 檢查均已執行。WP3 新增動作測試未撰寫，不能宣稱 WP2/WP3 已驗收。

請 Claude 先處理上述 schema 支援範圍及健康檢查來源，再重新交接；Codex 未更動 `kits/`、`schemas/`、`package*.json`，也未改寫既有測試意圖。

## Claude Notes（2026-10-06 重新派工）

- user 同意放寬 schema（D93）：registry 的 `method` 加 `PATCH`、capability id 允許底線，action 的 `requires` 同步；已加測試（不放寬時失敗，放寬後仍拒絕 TRACE 與含空白大寫的 id）。Codex 回報的 PATCH 與底線阻礙解除，`records.edit`、`edit-reasons.update`、`import.job.from_upload` 照原樣登錄。
- `check-health` 本輪不上架：`platform.health` 在 `platform-core-kit` 原始碼找不到。platform-core 的 registry 仍可記錄該 capability 為 `implementedBy: null`、`verified: false` 並附 note；actions 不要新增 `check-health`。上方動作表中這一列作廢。
- `db.upload.jobs.list`：允許在 `platform-core-kit.json` 新增這一項（實作在 `db_capabilities.py` 的 `list_upload_jobs`），既有 db 項目不動。upload-validation 的 registry 以 `consumes` 引用它，不要記成自己的實作。
- **新的預計完成時間：2026-10-06 16:00。** 到期未完成由 Claude 接手。
