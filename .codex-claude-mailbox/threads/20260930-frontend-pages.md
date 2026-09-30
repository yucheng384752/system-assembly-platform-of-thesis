---
id: "20260930-frontend-pages"
title: "依基線四步驟重做 Composer 前端頁面（真實 Kit、無障礙）"
status: "waiting_for_codex"
owner: "codex"
reviewer: "claude"
priority: "high"
created_by: "claude"
created_at: "2026-09-30"
updated_at: "2026-09-30"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "apps/composer-gui/"
    type: "dir"
  - path: "kits/form-analysis.kit-manifest.json"
    type: "file"
---

# Goal

依基線版 GUI 的四個步驟重做 Composer 前端，讀取真實 Kit，對象是不懂系統的一般使用者，並符合無障礙設計。視覺風格不拘，先產生可用版本再調整。

# User 已確認（2026-09-30）

1. 頁面按基線版重做：01 選擇業務流程、02 資料來源與表單設計、AOV 流程規格、03 輸出部署套件。
2. 使用者是不懂系統的一般人。
3. 視覺風格不拘，先產生後調整；必須加入無障礙設計。
4. 讀取真實 Kit（`kits/form-analysis.kit-manifest.json`，基線副本，來源見 `kits/BASELINE.md`）。

# Current Context

- 分支 `feature/frontend-pages`，自 `main`（HEAD `7645000`）開出。
- 現有 GUI：`apps/composer-gui/` 單頁，含 3 個 mock Kit 的分頁、表格／下拉設定、Recipe 匯入／匯出；共用 `libs/ui-runtime/`（驗證、合併、renderer、recipe）。以上已驗收，須保留並搬入新頁面結構，不得退化。
- 基線 GUI 參考（唯讀）：`C:/Users/gslab/Documents/New project/form-system-kit-composer/gui/index.html`、`gui/app.js`、`gui/aov-integration.js`、`gui/styles.css`。
- 真實 manifest 事實（Claude 已核對）：
  - 檔案開頭有 UTF-8 BOM；直接 `JSON.parse` 或 Vite JSON import 可能失敗，須處理。
  - 12 個 Kit，頂層鍵 `manifestVersion`、`name`、`displayName`、`sourceSystem`、`defaultDatabaseRecommendation`、`kits`。
  - 幾乎沒有可修改項目：只有 `generic-forms-kit` 有 1 個 option；所有 Kit 都沒有 UI definition。
  - `tenant-auth-kit` 標為 `required: true`，但依 D03 已廢除，由 `entry-permission-kit` 取代；後者不在 manifest 中。
- 業務流程定義不在 manifest，而是寫死在基線 `gui/app.js` 的 `const flows`（第 127 行起，含 id、name、description、kits、required、subflows、pages）。

# Claude 決策（暫行，可由 user 調整）

- **manifest 不改原檔**：以程式讀取 `kits/` 副本，並以一份覆蓋檔處理差異（例如 `config/kits/overlay.json`）：隱藏 `tenant-auth-kit`、加入 `entry-permission-kit` 的最小定義，並把原本依賴 `tenant-auth-kit` 的地方改指向它。
- **業務流程**：把基線 `flows` 原樣移植成資料檔（例如 `config/flows.json`），在檔頭或 README 記錄來源 commit `c4b2b7b`；只替換 `tenant-auth-kit` 參照。
- **可修改預覽**：真實 Kit 沒有 UI definition。首期為 2 個有表格畫面的真實 Kit（建議 `query-traceability-kit` 查詢結果表、`upload-validation-kit` 驗證錯誤表）在 `config/ui/` 新增 UI definition 與 mock 資料來源；其他 Kit 分頁顯示白話能力說明並標示「此功能沒有可調整的畫面」。原 mock `records-kit` 可移除或只留在測試 fixture。
- **上傳資料（M01）**：CSV／TSV 只在瀏覽器記憶體解析，用來推測欄位與型別；原始資料列不得寫入 Recipe、匯出檔、localStorage 或任何網路請求。畫面須提醒使用者只上傳已去識別化的資料。
- **AOV 頁**：首期以可用鍵盤操作的清單編輯器實作（步驟、時機、負責人、對應表單；新增／刪除／上下移），不做拖拉畫布。明示「純說明用途，不影響系統組裝」。可匯出／匯入為獨立 JSON，不併入 Recipe。
- **輸出頁**：白話摘要＋客戶名稱＋下載 Recipe JSON（以檔案下載，不只是文字區）；Recipe 匯入也移到這裡。基線的部署 zip 組裝需要基線 PowerShell 工具，本專案尚未移植：畫面須誠實說明「部署套件產生功能尚未提供」，不得做假按鈕。

# 白話與無障礙要求（驗收必查）

- 預設畫面只用業務語言；Kit id、資料表、框架名稱只放在「進階」收合區。自動加入的相依功能要用一句話說明原因（例如「因為選了『資料匯入』，系統會自動加入『檔案上傳與驗證』」）。
- WCAG 2.1 AA：
  - 語意結構：`<html lang="zh-Hant">`、landmark（header、nav、main）、跳到主要內容連結、每頁一個 h1、標題層級不跳級。
  - 所有控制項有可見 label；錯誤訊息以 `aria-describedby` 連結欄位；狀態變化用 `role="status"`／`aria-live`。
  - 全鍵盤可操作、焦點順序合理、焦點外框明顯；步驟切換後焦點移到新頁標題。
  - 文字對比至少 4.5:1、大字 3:1；不能只靠顏色傳達狀態。
  - 可點擊目標至少 24×24 px（建議 44×44）；支援 200% 縮放不破版；`prefers-reduced-motion` 時關閉動畫。
  - 步驟導覽標示目前步驟（`aria-current="step"`）與完成狀態。
- 顏色與間距以 CSS 變數集中管理，方便之後調整風格。

# 工作包

| WP | 內容 | 完成條件 |
|---|---|---|
| FP1 | 資料層：讀取真實 manifest（處理 BOM）並以 `schemas/kit.schema.json` 驗證（必要時以相容方式調整 schema，不能破壞既有測試）；覆蓋檔；移植 flows；依流程與相依自動選 Kit（required 必選、偵測循環與缺漏） | 單元測試涵蓋：BOM、schema 驗證、tenant-auth-kit 隱藏、相依展開、缺漏／循環報錯 |
| FP2 | 外框與導覽：四步驟導覽、跳到主要內容、landmark、步驟切換焦點管理、CSS 變數 | RTL 測試：鍵盤切換步驟、`aria-current`、焦點移到 h1 |
| FP3 | 01 選擇業務流程：流程卡片、自動加入說明、進階 Kit 目錄＋搜尋、既有 Kit 分頁預覽搬入；2 個真實 Kit 的 UI definition 與 mock 資料 | 選流程後 Kit 與分頁正確；既有 WP1–WP6 測試全部保留通過 |
| FP4 | 02 資料來源與表單：CSV／TSV 本機解析、欄位與型別推測、表單欄位清單編輯（名稱、型別、必填） | 測試確認原始資料列不進 Recipe／匯出／storage／網路 |
| FP5 | AOV 流程規格：清單編輯器、鍵盤新增／刪除／移動、獨立 JSON 匯出匯入（驗證失敗整份拒絕） | 測試涵蓋鍵盤操作與匯入失敗不覆寫 |
| FP6 | 03 輸出：白話摘要、客戶名稱、Recipe 檔案下載與匯入、部署套件尚未提供的說明 | 下載內容通過 Recipe schema；不含資料列與秘密值 |

# 限制與停止條件

- 不得執行寫入 `.git` 的 git 指令；npm 一律用 `npm.cmd`；環境無網路，不得 `npm install`。
- 不新增依賴（包括 axe-core、CSS 框架、圖示庫）；需要時依停止條件停下詢問。
- 基線版唯讀；`kits/` 副本內容不修改（差異一律放覆蓋檔）；不使用根目錄 `packages/`。
- 只用 mock 或 user 本機上傳的資料，後者不得持久化。
- 本機 dev server 與真實瀏覽器驗證屬 Claude 分工，無法執行時記為略過，不算停止條件。
- 以下情況停下並記在 Open Questions：需要新依賴、需修改基線或 `kits/` 副本、schema 需要破壞性變更、任一 WP 無法達成完成條件。

# 回報格式

每個 WP 完成後在 Codex Notes 寫：變更摘要 → 檔案清單 → 驗證指令與實際結果（含失敗與略過項目）→ 建議的約定式提交訊息。全部完成後 status 改為 `ready_for_claude`、owner 改為 `claude`，並同步 `.codex-claude-mailbox/index.md`。

# Codex Notes

尚未開始。

# Claude Notes

尚無。

# Decisions

- 2026-09-30，user 已確認：按基線四步驟重做、對象為一般使用者、視覺不拘先產生後調整、必須無障礙、讀取真實 Kit。
- 2026-09-30，Claude 暫行決策：見「Claude 決策（暫行）」一節。

# Open Questions

- owner: user — 首期為哪 2 個真實 Kit 提供可調整畫面？暫定 `query-traceability-kit` 與 `upload-validation-kit`。
- owner: user — AOV 是否之後仍需要拖拉畫布？首期只做清單編輯器。
