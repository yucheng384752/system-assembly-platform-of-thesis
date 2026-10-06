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

### 2026-10-06 12:52（Asia/Taipei）：重新派工核對，發現新的來源阻礙

- 已重讀完整 thread（含重新派工段落），確認分支 `feature/more-node-tools`、HEAD `5c21e2a`。D93 的 PATCH 與底線支援已存在；本次不再把它們當成阻礙。接受不新增 `check-health`、健康能力保留 null／false／note、上傳工作查詢由 platform-core 提供並由 upload-validation consumes 引用的修正。
- **精確進度：WP2 未完成，WP3 未開始；尚未新增或修改任何 registry、actions 或測試。** 本次僅更新 thread 與 mailbox index。這次不是截止時間到期，而是在來源核對時觸發既定停止條件。
- 已讀七個目標 Kit 的契約，以及上傳／驗證、分析、稽核／修正、訂閱、日誌、平台契約與權限路由；確認 `db_capabilities.py:286` 的 `list_upload_jobs` 與對應表。上傳大型路由讀取輸出曾截斷，匯入路由與服務尚未完成逐項核對，不能宣稱所有來源均已驗證。尚未作出各新動作的 needs／requiresKits 最終決定。

新的阻礙與可重現證據：

1. **`subscriptions.manage` 契約端點沒有對應實作。** `kits/mod-subscription-kit/kit.contract.json:5` 宣告 `GET /api/mod-subscription`；實際 `src/backend/app/api/routes_mod_subscription.py:16` 的 prefix 是 `/api/mod`，`:88–89` 是 `GET /subscriptions/{external_subscription_id}`／`get_subscription`，另外只有同步、webhook 與權益路由（`:48`、`:65`、`:107`）。`services/mod_subscription.py` 提供同步、webhook 與權益服務，沒有契約宣告的清單端點。不能把不同路徑與必要輸入的實作靜默當成相同契約。
2. 依 WP2，契約與來源不一致須記 `verified: false`；但 `libs/ui-runtime/actions.ts:19` 明確排除未驗證實作，`:51` 會對指定的 `manage-subscription` 產生 `missing-provider`。因此如實記錄差異與 WP3「每個新動作不產生契約未完整缺口」無法同時完成。遵守本 thread「找不到實作且不是契約遺漏」即停止的要求；未自行改 Kit、schema、推導規則或刪除指定動作。需 Claude／user 決定補齊來源、明確授權重新對應實際訂閱端點，或將此動作排除後重新派工。
3. **WP3 零缺口驗收另有既有規則衝突。** `apps/composer-gui/src/actions.test.ts:48–51` 明確要求保留 generic-forms 與 station-data-link 消費 `db.tenants.read` 的缺口；新表格動作依 D69 必帶這兩個 Kit，而 `deriveKits` 會遞迴檢查其 consumes（`actions.ts:65`）。若「不產生缺口」意指完全零缺口，便不能同時保留既有測試意圖。建議明確訂為「不新增缺口，既有 db.tenants.read 缺口逐項斷言」，但本次未擅自更改驗收標準。
4. 另記來源差異供續作：`logs.list` 契約為 `/api/logs`，`routes_logs.py` 的清單 decorator 是 `/`（組裝前綴下有尾端斜線）；應保留說明，不能直接宣稱字面完全一致。這項不是本次停止的主要原因。

本次驗證（產品資料未改的基線）：

- `npm.cmd run typecheck`：**通過，exit 0**。
- `npm.cmd test`：**exit 1**；30 個檔案中 **29 通過、1 失敗**；284 個測試中 **282 通過、1 失敗、1 略過**。
- 失敗：`security.test.mjs:128` 的 CLI 簽署測試讀取暫存私鑰遭 EPERM；同檔 `:107` 的 afterAll 清理也遭 EPERM。暫存目錄為 `C:\Users\gslab\AppData\Local\Temp\composer-security-0OEgDH`，未能清除，需具權限環境處理。未讀取或輸出私鑰內容，未更改測試來隱藏失敗。
- 略過：`App.test.tsx:14` 既有「未涵蓋：以 User 身分修改 MIS 項目由授權邊界拒絕（尚無身分機制）」；沒有新增 skip。
- 未執行 build、Python Kit 測試或瀏覽器驗證；沒有新動作驗收結果。未修改 `kits/`、`schemas/`、`package*.json`，未新增依賴、連網、啟動伺服器或執行 git 寫入。

交接狀態維持 `ready_for_claude`／owner `claude`；WP2／WP3 均未完成，待上述來源與驗收衝突解除後續作。

## Claude Notes（2026-10-06 重新派工）

- user 同意放寬 schema（D93）：registry 的 `method` 加 `PATCH`、capability id 允許底線，action 的 `requires` 同步；已加測試（不放寬時失敗，放寬後仍拒絕 TRACE 與含空白大寫的 id）。Codex 回報的 PATCH 與底線阻礙解除，`records.edit`、`edit-reasons.update`、`import.job.from_upload` 照原樣登錄。
- `check-health` 本輪不上架：`platform.health` 在 `platform-core-kit` 原始碼找不到。platform-core 的 registry 仍可記錄該 capability 為 `implementedBy: null`、`verified: false` 並附 note；actions 不要新增 `check-health`。上方動作表中這一列作廢。
- `db.upload.jobs.list`：允許在 `platform-core-kit.json` 新增這一項（實作在 `db_capabilities.py` 的 `list_upload_jobs`），既有 db 項目不動。upload-validation 的 registry 以 `consumes` 引用它，不要記成自己的實作。
- **新的預計完成時間：2026-10-06 16:00。** 到期未完成由 Claude 接手。

## Claude Notes（2026-10-06 第三次派工，裁決 D94）

Codex 前兩次在核對來源時停工，所回報的差異都屬於 Claude 的判斷範圍，已裁決如下（決議 D94）。**遇到同類差異請依 D94 處理並在 Codex Notes 記錄，不要停工**；只有需要改 schema、新增依賴、改 `kits/` 或推導規則時才停。

1. **mod-subscription**：`subscriptions.manage` 照契約登錄為 `declared: true`、`verified: false`、附 note；另登錄 `routes_mod_subscription.py` 實際的四個端點（同步 POST、webhook POST、查詢 GET、權益 GET，前綴 `/api/mod`）為 `declared: false`、`verified: true`，id 自訂（如 `subscriptions.sync`、`subscriptions.webhook`、`subscriptions.get`、`subscriptions.entitlements.get`），note 註明與契約的對應。`manage-subscription` 動作改為 `requires` 這些已驗證的 id（建議 sync、get、entitlements.get；webhook 屬外部呼叫，不放入動作），名稱與描述寫「同步與查詢訂閱權益」，不寫「管理」。
2. **logs.list**：契約 `/api/logs`、路由 `/`（組裝前綴 `/api/logs`）視為一致，`verified: true`，note 寫明前綴來源（`backend_router_registry.py`）。其他僅前綴不同的情形同樣處理。
3. **驗收**：新動作推導「不新增缺口」，只可帶出既有的 `db.tenants.read` 缺口；測試逐項斷言這個缺口集合，既有 `actions.test.ts` 的缺口斷言保留。
4. **未讀完的來源**：匯入與上傳路由請分段讀（`sed -n`），不要一次讀整檔；逐項核對 `kits/<kit>/src/backend`。
5. **新的預計完成時間：2026-10-06 16:15。** 到期未完成由 Claude 接手。

## Codex Notes（2026-10-06 12:59，第三次派工實作完成）

本次已實際完成 WP2／WP3 檔案寫入，未因來源差異停工；於 16:15 截止前交回 Claude 審閱。cwd 全程為 `C:\Users\gslab\Desktop\composer-refactor`，讀取 `.git/HEAD` 確認 `feature/more-node-tools`。未執行任何 git 命令、連網、安裝依賴或啟動伺服器；未修改 `kits/`、schema、package 檔或 `libs/ui-runtime` 推導規則。

### WP2：已寫入的 registry

- 新增 `config/registry/upload-validation-kit.json`、`import-pipeline-kit.json`、`analytics-kit.json`、`audit-edit-kit.json`、`mod-subscription-kit.json`、`logs-ops-kit.json`。
- 增補 `config/registry/platform-core-kit.json` 的 scope、上傳工作清單、健康檢查宣告、功能契約與端點權限。以修改前記憶體副本比較，既有五項 capabilities、mServices、functions 全部保持原樣；`query-traceability-kit.json` 未修改。
- 每項已驗證能力均可追到 mService、Function、來源檔案與函式。上傳與匯入大型路由依端點分段讀取；沒有修改基線原始碼。環境變數只記名稱，沒有複製值、範例資料或金鑰。

### D94 與來源差異的處理

1. `subscriptions.manage` 保留契約路徑、declared=true、verified=false、implementedBy=null 與說明；另登錄四個實際端點為 declared=false、verified=true。動作只引用 sync、get、entitlements.get，不包含外部 webhook。
2. `platform.health` 保留未驗證宣告；不新增 `check-health`。`kit.capability.call` 依 D89 不登錄。
3. `db.upload.jobs.list` 僅由 platform-core 提供，upload-validation 依派工改用 consumes 引用，並記明契約原列 provides。`db.edit-reasons.validate` 在 audit-edit 保留跨 Kit 提供者，指向 platform-core 既有服務，沒有複製或杜撰本地實作。
4. logs 的 `/` 加 `/api/logs` 視為一致。note 保留 Claude 指定的 `backend_router_registry.py` 來源名稱；本 repo 找不到該檔，實際另以 `kits/form-analysis.kit-manifest.json` 的 routerRegistrations 核對前綴。上傳、匯入、修正及契約清單也以這份 manifest 的組裝前綴對照，不把字面路徑差異當阻礙。
5. `db.import.jobs`、`db.audit.events`、`db.subscriptions` 是服務直接操作資料庫，沒有同名 broker 對應表；note 如實記錄。稽核寫入原始碼是 best-effort，失敗會返回，沒有誤標成保證保存。
6. analytics 的 status 仍使用舊上傳狀態，但平台 `list_upload_jobs` 已讀取 ImportJob；此來源內部差異寫入兩項歷史能力 note，不改來源，也不新增易誤導的 status 動作參數。其他日期與分頁條件照來源登錄。
7. 舊上傳端點在多租戶模式回報 410、PDF 轉檔未配置服務回報 503，均記在失敗條件；verified 表示來源可核對，不代表所有部署環境已可執行。
8. audit-edit 直接使用通用表單模型與 `_coerce`，新增未宣告的 `forms.station-model` consumes 與來源證據。因此稽核與原因維護也會透過整個 Kit 的相依帶入 generic-forms；測試如實斷言衍生的租戶缺口，不修改推導規則。

### WP3：動作與逐項輸入判斷

已修改 `config/actions.json`：新增 13 個動作，共 17 個；`import-records.name` 改成「匯入資料列」。與修改前副本比較，原四個動作除該名稱外完全相同。新動作參數沒有 default，沒有新增 mock。

| 動作 | needs | requiresKits 與原因 |
| --- | --- | --- |
| browse-forms | form | 瀏覽所選表單的紀錄，依 D69 必帶 generic-forms 與 station-data-link |
| upload-file | form | 依派工以目標表單描述上傳資料，必帶上述兩 Kit |
| convert-pdf | form | 依派工保留目標表單，另需 PDF 上傳工作編號，必帶上述兩 Kit |
| import-job-track | form | 匯入目標與驗證欄位屬於表單，必帶上述兩 Kit |
| view-upload-history | 空 | 來源只依日期、狀態、分頁查詢整體歷史，不接受表單輸入，無固定必帶 Kit；由能力推導 analytics 與 platform-core |
| analyze-trend | form | 來源必填表單代碼，必帶上述兩表格 Kit |
| view-audit-events | 空 | 稽核事件篩選不需要表單，無固定必帶 Kit；audit-edit 的來源相依仍照常推導 |
| edit-record | form | 指定表單、紀錄與原因，必帶上述兩表格 Kit |
| manage-edit-reasons | 空 | 維護租戶原因清單，不依特定表單；無固定必帶 Kit，保留來源相依推導 |
| manage-subscription | 空 | 只需外部訂閱編號，不帶表格 Kit；名稱與描述為同步與查詢訂閱權益 |
| view-logs | 空 | 依日誌篩選條件查詢，不帶表格 Kit |
| view-kit-contracts | 空 | 契約查詢無表單輸入，不帶表格 Kit |
| manage-endpoint-permissions | 空 | 部署端點角色設定，不帶表格 Kit |

parameters 是流程節點設定，未把檔案、紀錄變更物件或完整權限 JSON 假裝成目前 schema 不支援的輸入型別；本次不新增執行器或改 schema。現有工具箱會依 catalog 自動載入工具，未修改 UI 排版。

### 測試檔案與結果

- 新增 `apps/composer-gui/src/moreNodeTools.test.ts`：13 個動作逐一驗證完整 Kit 集合、無歧義與精確的 `db.tenants.read` 缺口集合；另驗證所有 action requires 有已驗證服務／實際來源、所有 registry 可解析及 Function 來源存在、服務鏈一致、新參數無 default、業務文案與 D94 保留差異。共 17 項新增測試，全數通過。
- 修改 `apps/composer-gui/src/registry.test.ts`：action 檢查改用與產品相同的完整 registry loader，既有四 Kit 範例差異斷言加入 platform.health；原本缺口斷言保留。
- 修改 `apps/composer-gui/src/WorkflowCanvas.test.tsx` 與 `workflowGraph.test.ts`：只將舊工具名稱斷言改為「匯入資料列」，保留參數切換、表單不遺失等測試意圖。`actions.test.ts` 原有缺口斷言完全未改。
- 最終 `npm.cmd run typecheck`：通過，exit 0。
- 最終 `npm.cmd test`：exit 1；31 個測試檔中 30 通過、1 失敗；301 個測試中 **299 通過、1 失敗、1 略過**。
- 唯一失敗仍為 `security.test.mjs:128` 的 CLI 簽署測試讀取暫存私鑰 EPERM，`:107` afterAll 清理亦 EPERM。最後一次暫存目錄為 `C:\Users\gslab\AppData\Local\Temp\composer-security-cMsxkt`；第一次本輪完整測試的目錄為 `C:\Users\gslab\AppData\Local\Temp\composer-security-jphvZM`。未讀取或輸出私鑰內容，未修改安全測試，這兩個目錄待具權限環境清理。
- 首次完整測試另有兩個舊名稱斷言失敗；修正名稱後重跑已通過，沒有掩蓋或略過。
- 唯一略過為 `App.test.tsx:14` 既有「以 User 身分修改 MIS 項目由授權邊界拒絕（尚無身分機制）」；本次沒有新增 skip。
- 未執行 build、Python Kit 測試或真實瀏覽器驗證；本輪指定的兩項 npm 檢查均已執行。產品資料與測試寫入已完成，待 Claude 審閱、具權限環境驗證 security CLI 與後續 git 操作；狀態維持 ready_for_claude／owner claude。
