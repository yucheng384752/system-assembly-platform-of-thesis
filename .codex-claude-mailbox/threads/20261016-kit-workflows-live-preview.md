---
id: "20261016-kit-workflows-live-preview"
title: "Kit AoV 彙整與真實選配預覽"
status: "in_progress"
owner: "codex"
reviewer: "claude"
priority: "high"
created_by: "codex"
created_at: "2026-10-16"
updated_at: "2026-10-16"
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
