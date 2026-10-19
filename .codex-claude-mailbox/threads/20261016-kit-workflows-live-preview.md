---
id: "20261016-kit-workflows-live-preview"
title: "Kit AoV 彙整與真實選配預覽"
status: "in_progress"
owner: "claude"
reviewer: "claude"
priority: "high"
created_by: "codex"
created_at: "2026-10-16"
updated_at: "2026-10-18"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "schemas/kit-workflow.schema.json"
    type: "file"
  - path: "apps/composer-gui/src/kitWorkflows.ts"
    type: "file"
---

# Goal

依使用者授權開始修改：kit 內保存描述 workflow 的 AoV，選配後輸出總表；後續預覽以實際組裝的全部相容 kit 運行，依有效選配開放頁面與操作。

# Success Criteria

- Kit workflow 有版本、所屬 kit、節點、明確有向邊、子功能引用；錯誤引用與循環可定位。
- 總表只包含有效選配 kit 與其已啟用子功能；未提供或錯誤的定義明確列出；不把相依關係當流程連線。
- 畫面與交付包使用同一彙整函式；JSON 與 Markdown 總表列入 manifest/checksum。
- 最終真實預覽須實測 API、資料寫入及重置；未啟用功能與無權限角色不得繞過頁面直接呼叫 API。
- 全量預覽成功與僅所選 kit 的獨立部署驗證分開報告。

# Current Context

- 現有 KitPreview 已依 enabledKits 篩選 tab，Renderer 仍使用模擬資料。
- deliveryPackage 為 installable:false 的設定交付包。
- kits/BASELINE.md 已記載 station-admin 缺 routes_stations、station-data-link 缺 routes_import，以及 app.core 等共用來源缺口。entry-permission 尚未提供身分驗證。
- 工作區已有使用者／其他工作未提交變更：FactoryPage、WorkflowCanvas、aov.test、decision-log、mailbox index 與 AoV 合併／範例文件；保留不覆寫。

# Codex Notes

## 修改計畫與範圍

1. WP1：新增 schemas/kit-workflow.schema.json、libs/ui-runtime/schema.ts 登錄、kitWorkflows.ts 載入及語意驗證。採 kits/<kit-id>/workflow.aov.json 固定位置，先不擴充 manifest 路徑設定。
2. WP2：先加入 upload-validation-kit 的上傳→查詢狀態草稿流程，引用既有 capability；其餘 kit 如實列為尚未提供，逐份依來源補齊。此首份模板非全功能覆蓋。
3. WP3：OutputPage 顯示總表；deliveryPackage 加入 JSON/Markdown 彙整與驗證狀態，package-manifest schema 與相關測試同步。
4. WP4：盤點並補齊可執行預覽所需共用後端、路由註冊、DB/model/migration、前端套件與權限提供者；先打通上傳→狀態查詢，再擴至全部相容 kit。禁止以模擬資料冒充完成。不得接正式資料或外部訂閱服務。
5. WP5：預覽後端驗證 Recipe，產生有效能力集合；前端頁面與後端 API 共用該選配結果，並保留角色授權。每次選配切換清除失效頁面／資料；背景工作與 webhook 亦需檢查。
6. WP6：啟動、健康檢查、真實 CRUD、直接 API 拒絕、依賴帶入、切換選配、資料重置與獨立選配建置驗收；記錄實測，才可替換「模擬資料」標籤。

本輪交付 WP1–WP3 的首個可驗證增量，WP2 全套模板與 WP4–WP6 保持未完成。無新增依賴，UI 遵循 DESIGN.md；不更改既有使用者業務 AoV 格式或其資料。

## 2026-10-18 WP2：九份模板完成，交 Claude 審閱

- 本輪僅新增下列九份 `workflow.aov.json`、追加 `apps/composer-gui/src/kitWorkflows.test.tsx` 測試並更新本 thread／mailbox index。cwd 為專案根目錄，已讀取 CLAUDE.md、DESIGN.md、本 thread 全文，唯讀確認分支為 `feature/kit-workflows`，開始時工作區無修改。
- 九份皆為 `draft`，`kitVersion` 皆依 catalog 的 manifest／overlay 解析結果為 `c4b2b7b-ui.1`；所有填入的 `subfeatureId` 均為該 Kit 現有項目。共用能力不硬綁單一子功能，已在 scope 說明；所有節點均至少引用一項該 Kit registry 的 `verified: true` 能力。
- 本輪涵蓋九份 registry 的所有已驗證能力；未驗證能力不建立節點並逐項列在 scope。既有 registry 已揭露的跨 Kit 實作歸屬與來源限制原樣保留，沒有發現需要修改 registry／來源才能完成本工作包的新不一致；未修改 schema、config、libs、其他 Kit 檔案或測試原意，未新增依賴、網路請求、dev server 或 Git 寫入。
- 連線只描述來源支持的前置資料／識別碼順序，沒有跨 Kit 邊。以下逐檔記錄所有邊的依據；沒有邊的檔案也說明原因。未將資料模型或共享查詢函式誤當必須依序執行的步驟。

### 逐檔來源與連線依據

1. `kits/generic-forms-kit/workflow.aov.json`（9 節點、3 邊）
   - 路由來源：`kits/generic-forms-kit/src/backend/app/api/routes_generic_forms.py` 的 `list_forms`、`list_records`、`create_form`、`set_schema`、`import_preview`、`import_commit`、`list_dataflow_links`、`upsert_dataflow_link`；模型來源：`kits/generic-forms-kit/src/backend/app/models/station.py` 的 `Station`、`StationSchema`、`StationLink`。
   - `create-form → set-schema`：上述 routes 檔的 `create_form` 建立並回傳站點，`set_schema` 以同一 code 呼叫 `_get_station`，站點不存在即 404；此邊限新建表單路徑，非要求既有表單重建。
   - `set-schema → preview-import`、`set-schema → commit-import`：同一 routes 檔的 `set_schema` 保存 active schema；`import_preview`／`import_commit` 透過 `_active_schema` 取得它，缺少時明確回報先使用 PUT schema。兩條邊分別有這項前置檢查支持。
   - 不建立 preview → commit：提交重新讀取檔案，並未使用預覽 token 或呼叫預覽端點。未登錄的直接上傳、刪除與非同步狀態端點列為未涵蓋。
2. `kits/station-data-link-kit/workflow.aov.json`（4 節點、0 邊）
   - 依 `config/registry/station-data-link-kit.json` 的 implementedBy，實作來源為 `kits/platform-core-kit/src/backend/app/core/db_capabilities.py`：`resolve_table`、`list_forms`、`search_records`、`records_trend` 及 `DB_CAPABILITIES` 映射。這是已登錄的實作歸屬，不新增跨 Kit 邊。
   - 四個獨立函式沒有彼此呼叫順序，因此 edges 為空；Kit 自身缺來源的 routes_import、相容層、正規化等，以及另屬 generic-forms 的串聯均於 scope 排除。
3. `kits/import-pipeline-kit/workflow.aov.json`（6 節點、2 邊）
   - 來源：`kits/import-pipeline-kit/src/backend/app/api/routes_import_v2.py` 的 `create_import_job`、`create_import_job_from_upload_job`、`get_import_job`、`get_import_job_errors`、`commit_import_job`、`cancel_import_job`；持久化來源為 `kits/import-pipeline-kit/src/backend/app/services/import_v2.py` 的 `ImportService.commit_job`。
   - `create-job → get-job`：routes 檔的 `create_import_job` 保存工作並回傳 `ImportJobRead`，`get_import_job` 以其 job_id 加租戶條件查詢；不存在回報 404。
   - `create-from-upload → get-job`：同一 routes 檔的 `create_import_job_from_upload_job` 亦保存工作並回傳 `ImportJobRead`，供相同 `get_import_job` 查詢。兩入口是替代路徑，不代表合流等待。
   - 提交節點合併 `import.job.commit` 與 `db.import.jobs`：`commit_import_job` 直接或經 `process_commit_job_background` 呼叫 `ImportService.commit_job`。保留 READY／COMMITTING 前置狀態說明，未臆造建立後即可提交、必須先讀錯誤或先查狀態的邊；背景暫存驗證沒有獨立登錄能力，不建節點。
4. `kits/analytics-kit/workflow.aov.json`（3 節點、0 邊）
   - 來源：`kits/analytics-kit/src/backend/app/api/routes_analytics.py` 的 `trend`、`upload_history`、`export_upload_history`。
   - 三端點分別查詢 DB 能力；匯出沒有呼叫清單端點，不以操作習慣推導邊。scope 保留 registry 已記錄的舊 status 與 ImportJob 狀態差異，未宣稱已修復；資料摘要未有獨立已驗證能力，排除。
5. `kits/audit-edit-kit/workflow.aov.json`（7 節點、0 邊）
   - 來源：`kits/audit-edit-kit/src/backend/app/api/routes_edit.py` 的 `list_reasons`、`create_reason`、`update_reason`、`edit_record`；`kits/audit-edit-kit/src/backend/app/api/routes_audit_events.py` 的 `list_audit_events`；`kits/audit-edit-kit/src/backend/app/services/audit_events.py` 的 `write_audit_event_best_effort`；外部實作依 registry 指向 `kits/platform-core-kit/src/backend/app/core/db_capabilities.py` 的 `validate_edit_reason`。
   - 不建立編輯 → 稽核事件邊：`edit_record` 寫入的是 RowEdit，未呼叫 AuditEvent 寫入服務；其原因檢查是本地 `_active_reason`，也不假接到 broker 的驗證能力。稽核寫入失敗被吞下的限制保留。未涵蓋獨立前後差異檢視與跨 Kit 稽核呼叫。
6. `kits/mod-subscription-kit/workflow.aov.json`（4 節點、0 邊）
   - 來源：`kits/mod-subscription-kit/src/backend/app/api/routes_mod_subscription.py` 的 `sync_mod_subscription`、`receive_mod_webhook`、`get_subscription`、`get_subscription_entitlements`；`kits/mod-subscription-kit/src/backend/app/services/mod_subscription.py` 的 `sync_subscription`、`process_webhook`、`get_entitlements`。
   - sync／webhook 節點各含服務所做的 `db.subscriptions` 持久化；Webhook 要求已有訂閱，但同步不會自動觸發 Webhook，查詢也不要求當次先同步，因此不強加端點順序。`subscriptions.manage` 為 verified:false 且無對應來源，scope 明列未涵蓋；不建立稽核查詢節點。
7. `kits/logs-ops-kit/workflow.aov.json`（1 節點、0 邊）
   - 來源：`kits/logs-ops-kit/src/backend/app/api/routes_logs.py` 的 `list_logs`，含租戶條件、篩選與分頁。只有 `logs.list` 已登錄並驗證，單節點不連線。雖來源有 `log_summary`，registry 未登錄，故不建節點；清理、下載、心跳也排除。
8. `kits/platform-core-kit/workflow.aov.json`（9 節點、0 邊）
   - 資料能力來源：`kits/platform-core-kit/src/backend/app/core/db_capabilities.py` 的 `list_forms`、`resolve_table`、`search_records`、`records_trend`、`validate_edit_reason`、`list_upload_jobs`；契約來源：`kits/platform-core-kit/src/backend/app/api/routes_kit_broker.py` 的 `get_contracts`；權限來源：`kits/platform-core-kit/src/backend/app/api/routes_admin_permissions.py` 的 `get_endpoint_permissions`、`put_endpoint_permissions`。
   - 各獨立能力沒有強制互相呼叫；PUT 自行驗證與寫入，無必須先 GET 的邊。scope 排除 verified:false／無路由的 `platform.health`，以及未登錄的外殼、建立資料庫連線與通用能力呼叫端點。
9. `kits/query-traceability-kit/workflow.aov.json`（2 節點、0 邊）
   - 來源：`kits/query-traceability-kit/src/backend/app/api/routes_query_v2.py` 的 `search_lot`、`trace_lot` 與共同 helper `_records_by_station_for_lot`。
   - 兩路由各自呼叫 helper，追溯不依賴查詢路由的回傳，因此無邊；trace 回傳的站點圖不轉成此 workflow 的邊。scope 排除 verified:false／無對應來源的 `query.records.search`、產品識別碼查詢、進階篩選及動態欄位查詢。

### 本輪測試與驗證結果

- `apps/composer-gui/src/kitWorkflows.test.tsx` 追加 10 項測試：九份模板逐一經 `parseKitWorkflow` 驗證版本／schema／子功能／能力引用、draft、非空能力引用及每項 capability 的 verified:true，並檢查未驗證能力出現在 scope；另測完整 catalog 的 missing 清單恰為缺少 workflow 檔案的 Kit，且無 invalid、九份新模板均為 draft。原有 13 項測試內容未修改。
- `npm.cmd run typecheck`：exit 0，通過。
- `npm.cmd test`：exit 1，32 個檔案為 31 passed／1 failed；324 tests 為 322 passed／1 failed／1 skipped。新增 10 項均通過。
- 失敗位於既有 `src/security.test.mjs` 的 CLI 簽署測試：讀取 `C:\Users\gslab\AppData\Local\Temp\composer-security-7ypFUo\keys\signing-private-key.pem` 遭 EPERM；afterAll 清理 `C:\Users\gslab\AppData\Local\Temp\composer-security-7ypFUo` 也遭 EPERM，導致 suite failure。未更改測試或私鑰規則來繞過；未手動讀取私鑰，暫存目錄未宣稱已清除，交 Claude 在具權限環境處理與重跑。
- 1 skipped 是既有 `App.test.tsx`「未涵蓋：以 User 身分修改 MIS 項目由授權邊界拒絕（尚無身分機制）」；本輪未新增 skip。
- `npm.cmd run build`：exit 0，內含 typecheck 與 Vite build 均通過。警告：既有 React Flow 模組的 `use client` 被忽略、App bundle 722.33 kB 超過 500 kB 提示；未為此修改打包設定。
- `git diff --check`：通過；Git 提示 LF／CRLF 轉換與全域 ignore 讀取權限限制，未執行 Git 寫入。
- 最後以唯讀 Node assert 核對九份模板能力集合恰等於各 registry 的已驗證集合，並確認 registry functions 的來源檔與符號文字存在：通過。共 45 節點、5 邊；完整 catalog 僅 `station-admin-kit`、`entry-permission-kit` 無 workflow，屬本輪指定九 Kit 之外。最終工作區修改限九份新 JSON、追加測試與兩份 mailbox 檔案。
- 未執行 Python Kit、資料庫、真實 API、身分授權、外部訂閱／Webhook、瀏覽器、dev server 或部署驗證。這些不屬 WP2，不能用 registry verified 或本輪前端測試替代。
- WP2 九份模板、測試、三項指定驗證與紀錄已完成；完整測試仍有上述環境失敗。保持 `status: in_progress`、設 `owner: claude`，請 Claude 審閱模板範圍、無邊的理由與共用能力的子功能歸屬，並重跑安全測試。WP4–WP6 仍暫停，未啟動真實預覽。

# Claude Notes

## 2026-10-18 審閱（首個增量 WP1–WP3）

- 審閱範圍：`schemas/kit-workflow.schema.json`、`kitWorkflows.ts`、`KitWorkflowSummary.tsx`、`deliveryPackage.ts`、`OutputPage.tsx`、`libs/ui-runtime/schema.ts`、`schemas/package-manifest.schema.json`、`kits/upload-validation-kit/workflow.aov.json` 及對應測試。
- 確認 Codex 最後寫入為 2026-10-16 19:01，審閱時 20 分鐘內無任何程式檔被寫入，可安全提交。
- 我重跑：typecheck 通過；`npm.cmd test` 32 個檔案、313 通過、1 略過（既有身分授權）；build 通過。與 Codex 紀錄一致。
- 契約變更範圍：package-manifest 的 artifacts 上限 8 改 10，新增 role `kit-workflow`。最大組合（readme、recipe、workflow、2 份總表、報告、3 份手冊、場域設定）恰為 10，已由測試 `toHaveLength(10)` 涵蓋。這是經使用者授權（thread Decisions 第 1 項）的契約放寬，決議補記為 D100。

# Review Findings

| 編號 | 嚴重度 | 內容 | 處理 |
|---|---|---|---|
| R01 | 中 | 動到 `schemas/` 與 `libs/ui-runtime/` 卻沒有決議編號，違反決策記錄要求 | Claude 已補 D100 |
| R02 | 低 | 上限 10 已無餘裕，下一種新 artifact 會再放寬 | 記為風險；之後新增 role 時改為依 role 分別設上限，不再累加總數 |
| R03 | 低 | upload-validation 的流程只有 2 個節點、狀態 draft，其他 kit 皆為 missing；交付包報告因此恆為 not-provided | 屬預期。WP2 其餘模板補齊後才會改變 |
| R04 | 資訊 | 嚴格依舊 schema 解析新交付包的外部消費端需同步升級 | 本專案內無此消費端；已在 D100 註明 |

結論：WP1–WP3 首個增量通過審閱，無阻擋項目。

## 後續分工（2026-10-18）

**WP2 其餘 kit 流程模板：交 Codex，預計完成 2026-10-18 18:00（約 18 小時，含額度風險緩衝）。** 規則：只為 registry 中 `verified: true` 的能力建立節點；來源找不到的功能不建節點、在 scope 寫明；每份標 draft；不臆造跨 kit 連線；逐份在 Codex Notes 記錄來源路徑。目標 kit：generic-forms-kit、station-data-link-kit、import-pipeline-kit、analytics-kit、audit-edit-kit、mod-subscription-kit、logs-ops-kit、platform-core-kit、query-traceability-kit。到期未完成由 Claude 接手。

**WP4 至 WP6（真實預覽）：暫停，需 user 決定下列事項後才能派工。**
1. 範圍：全部相容 kit，或先只做 upload-validation-kit 的上傳到狀態查詢？（建議後者）
2. 共用後端來源缺口（`app.core`、`app.config.constants`、`csv_field_mapper` 等，記於 `kits/BASELINE.md`）要從基線版複製補齊嗎？這會動 `kits/`，需決議。
3. 預覽用資料庫：使用哪一種（本機 SQLite 或另起 PostgreSQL）？
4. 本機啟動後端與開埠由 Claude 執行（Codex 沙箱不能監聽連接埠），驗證時間需排入 Claude 的工作。

# Test Plan

- Schema／版本、重複節點、懸空邊、循環、無效子功能與 capability 引用。
- 未選 kit 排除、子功能關閉不補接邊、同名節點不同 kit 不衝突、缺檔及錯檔不宣稱有效。
- 畫面表格、交付包內容與 checksum、重複輸出確定性、原有輸出回歸。
- typecheck、目標 Vitest、build；真實預覽整合測試留至 WP4–WP6。

# Decisions

- 使用者 2026-10-16 明確授權寫入根目錄 mailbox 並開始修改；沿用此現有 mailbox，不新增另一個目錄。
- 總表先定義為按 kit 分組的節點／連線清單；不推測跨 kit 的業務先後關係。
- Kit AoV 是描述文件，不執行任意腳本，也不代替 workflow 引擎。
- 不修改唯讀基線來源；本地 kit 可新增描述檔，來源範例保留 draft，來源登錄 verified 不等於執行驗證。

# Session Summary

## 首個增量實作結果

- WP1 完成：新增嚴格 JSON schema 與語意驗證（Kit／版本、節點重複、子功能／capability 引用、懸空邊、循環）。Kit 流程與既有業務 AoV 為不同文件，不修改舊格式。
- WP2 部分完成：新增 upload-validation-kit/workflow.aov.json，兩個節點與上傳→狀態查詢連線；明確 draft 且非全功能覆蓋。其餘 kit 未臆造流程，總表列 missing。
- WP3 完成首期表格：OutputPage 可展開檢視；交付包新增 aov/kit-workflows.json 與 aov/kit-workflows.md，納入 manifest/checksum。含缺漏／草稿時 validation report 的 kit-workflows 為 not-provided；不阻擋既有設定交付。
- 選配後移除未啟用子功能的節點及其連線，不補接鄰居。JSON 內各 kit 分組，節點 ID 不跨 kit 合併。缺漏／錯誤亦保留來源路徑與原因。
- package-manifest 新增 kit-workflow role、檔數上限由 8 改 10；舊交付包仍能讀取。嚴格依舊 schema 解析新交付包的外部消費端需同步升級。
- 未修改使用者原有工作區變更；未改基線目錄、未安裝依賴、未提交 Git、未觸發正式資料請求。
- WP4–WP6 未實作：目前預覽仍為模擬資料，尚未啟動任何真實 kit 系統。全量可執行預覽仍需補來源、權限、資料庫、前後端組裝及執行測試。本 thread 保持 in_progress，不標完成。

## 驗證紀錄

- npm.cmd run typecheck：通過。
- 目標 Vitest（kitWorkflows、deliveryPackage、output、schema、manualFiles）：40 tests 通過；其後補一項跨 kit 同名節點測試，結果追加於下。
- 補測後 kitWorkflows 共 13 tests 全數通過（相較前輪新增 1 項）；本增量累計 41 個不同測試通過。
- npm.cmd run build：通過；Vite 提示現有 React Flow use client 與大於 500 kB chunk 警告。
- 初次新增測試有 8 個斷言因「省略欄位」與「明確 undefined」差異失敗；已改成檢查 status 與缺少 workflow，重跑通過，未為迎合測試修改錯誤處理。
- 未執行全套測試、真實瀏覽器、Python Kit 啟動與部署測試；本次驗證只涵蓋此首期增量。

## 後續審閱重點

請 Claude 審閱流程契約、草稿／缺漏呈現、封裝相容性；確認 upload-validation 範例的流程範圍，再依 WP2 補其餘模板。WP4 開始前以 kits/BASELINE.md 的缺失清單核對實際來源，不能以現有 registry 的 verified 旗標替代啟動測試。

# Open Questions

- 後續「所有 kit」以有效 catalog 為準，排除已廢除 tenant-auth；缺少實作的 kit 必須補齊或明示不可啟動。
- 跨 kit 連線的實際資料綁定與每份流程內容需逐一核對來源；本輪不臆造。

## 2026-10-18 Claude 審閱 WP2

- 我獨立重跑：typecheck 通過；`npm.cmd test` 32 個檔案、323 通過、0 失敗、1 略過（既有身分授權）。Codex 回報的 1 項失敗（安全 CLI 沙箱 EPERM）在我的環境未重現，屬沙箱限制，非程式問題。
- 我以腳本逐份核對九份新模板加既有一份：所有節點引用的能力在 registry 皆為 `verified: true`，全部為 draft；共 45 個新節點、5 條邊（generic-forms 3、import-pipeline 2），其餘 kit 無邊，無跨 kit 連線。
- 邊的依據逐檔記於上方 Codex Notes；內容屬前置識別碼順序，與審閱時抽查一致。邊的語意正確性只靠靜態來源判讀，未經執行驗證，模板維持 draft。
- 結論：WP2 通過。WP4 至 WP6 仍待 user 決定範圍、共用來源補齊、預覽資料庫（見上方後續分工）。
