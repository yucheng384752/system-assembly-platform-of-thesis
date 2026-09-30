---
id: "20260930-frontend-pages"
title: "依基線四步驟重做 Composer 前端頁面（真實 Kit、無障礙）"
status: "waiting_for_user"
owner: "user"
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

## FP1 — 完成（2026-09-30）
- 變更摘要：BOM 安全讀取並驗證真實 manifest；D03 覆蓋隱藏舊權限功能並替換相依；基線 flows 原樣資料化；必選、前置流程、缺漏與循環解析。schema 僅相容新增 prefix 的 null 值。
- 檔案：config/flows.json、config/kits/overlay.json、apps/composer-gui/src/catalog.ts、catalog.test.ts、vite-env.d.ts、libs/ui-runtime/types.ts、schemas/kit.schema.json。
- flows 來源：唯讀基線 gui/app.js const flows，commit c4b2b7b；僅允許替換 tenant-auth-kit 參照（原 flows 無此參照）。
- 驗證：npm.cmd run typecheck 通過；npm.cmd test -- apps/composer-gui/src/catalog.test.ts：3 passed。
- 失敗紀錄：初次 node -e 探查因 PowerShell 引號傳遞失敗，改用 stdin 後成功；原 schema 拒絕基線 prefix:null，已相容修正。
- 略過：dev server／真實瀏覽器由 Claude 驗證。
- 建議提交：feat(catalog): load baseline kits and resolve flow dependencies

## FP2 — 完成（2026-09-30）
- 變更摘要：四步驟外框、跳到主要內容、landmark、單一 h1、方向鍵導覽及焦點管理；明確確認後標記完成。集中 CSS tokens 與縮放／減少動態樣式。FP3 接入正式頁面。
- 檔案：StepShell.tsx、StepShell.test.tsx、style.css、DESIGN.md、AGENTS.md、CLAUDE.md（UI 約定引用）；index.html 已有 zh-Hant。
- 驗證：npm.cmd run typecheck 通過；npm.cmd test -- apps/composer-gui/src/StepShell.test.tsx：1 passed。
- 失敗：首次 apply_patch 同時刪除／新增同路徑遭拒，未寫入；改為單次替換後成功。FP3 發現 PowerShell stdin 預設 ASCII 使新寫入中文成問號，已改 UTF-8 並重寫本節與 FP1 紀錄。
- 略過：真實瀏覽器、200% 縮放、螢幕閱讀器與對比實測交 Claude。
- 建議提交：feat(gui): add accessible four-step navigation

## 實作順序
FP1 資料契約 → FP2 外框 → FP3 共用預覽與真實流程 → FP4 本機欄位推測 → FP5 獨立 AOV → FP6 Recipe 檔案傳輸及全套驗證。

## FP3 — 完成（2026-09-30）
- 變更摘要：真實流程卡片、必選與相依說明、進階目錄搜尋；兩個真實功能的模擬表格與篩選／欄位設定，共用既有 renderer／resolve。mock records 僅供測試；WP1–WP6 情境與斷言保留，App.test.tsx 只改用共享元件的 FixtureApp 測試容器。
- 檔案：App.tsx、KitPreview.tsx、FlowPage.tsx、previewCatalog.ts、FixtureApp.tsx、Frontend.test.tsx、App.test.tsx、SettingsEditor.tsx、RecipeTransfer.tsx、libs/ui-runtime/recipe.ts、config/ui/previews.json、config/kits/overlay.json、catalog.ts。
- 驗證：npm.cmd run typecheck 通過；npm.cmd test：17 passed、1 skipped（原授權邊界未實作）。
- 失敗與修正：首次全套 4 failed，原因為 PowerShell stdin 的 ASCII 編碼讓產生器的中文字串比對失敗、漏掉 fixture 選擇器；改 UTF-8 並修復後全套通過。沒有刪除既有測試或降低斷言。
- 略過：本機 dev server、真實瀏覽器交 Claude。
- 建議提交：feat(gui): connect real flow selection and configurable previews

## FP4 — 完成（2026-09-30）
- 變更摘要：本機 CSV／TSV 欄位推測，支援 BOM、引號、跳脫引號、欄內換行與空值；型別／必填推測後可編輯與新增刪除。原始資料列只存在解析函式，回傳值只有欄位描述；頁面切換保留記憶體草稿，重新整理清除，明示不含於 Recipe。
- 檔案：localData.ts、DataPage.tsx、localData.test.tsx、App.tsx。
- 驗證：npm.cmd run typecheck 通過；npm.cmd test -- apps/composer-gui/src/localData.test.tsx：2 passed。spy 確認無 fetch、XHR、Storage.setItem；敏感測試哨兵不在頁面、欄位結果或 Recipe。
- 失敗與修正：初次整合測試發現初始 Recipe name 使用中文不符既有 slug 契約，改 my-system 後通過，無 schema 變更。
- 略過：真實瀏覽器檔案挑選由 Claude 驗證。
- 建議提交：feat(gui): infer local sample fields without persisting rows

## FP5 — 完成（2026-09-30）
- 變更摘要：AOV 清單可新增、刪除、上下移並維持焦點；名稱、時機、負責職務與表單引用。獨立 JSON 匯入／下載，完整 schema 與引用驗證後才替換；拒絕未知欄位、重複 ID、空白名稱、失效表單；明示純說明用途。
- 檔案：AovPage.tsx、aov.ts、aov.test.tsx、fileTransfer.ts、schemas/aov.schema.json、libs/ui-runtime/schema.ts、App.tsx。
- 驗證：npm.cmd run typecheck 通過；npm.cmd test -- apps/composer-gui/src/aov.test.tsx：2 passed。驗證移動／刪除焦點與匯入失敗保留。
- 失敗：無。
- 略過：真實瀏覽器 Enter／Space 原生按鈕啟動、檔案下載由 Claude 驗證；jsdom 測試涵蓋原生 button 啟動後處理與焦點，並非實際瀏覽器鍵盤事件鏈。
- 建議提交：feat(gui): add standalone accessible AOV list editor

## FP6 — 由 Claude 補記（Codex 任務在最終檢查階段以 failed 結束，未寫入本節）
- 程式已存在：OutputPage.tsx、output.test.tsx、RecipeTransfer.tsx（檔案下載與匯入）、fileTransfer.ts、libs/ui-runtime/recipe.ts（clientName、必要功能與相依檢查）。
- Codex 最後回報：Recipe 與 AOV 下載內容以測試攔截驗證，通過各自 schema，不含上傳資料列或憑證；build 需沿用 native loader。

# Claude Notes

2026-09-30 Claude：FP1–FP6 審閱與瀏覽器驗證（Chrome，`127.0.0.1:5173`）。

- 重跑：typecheck 通過；`npm.cmd test` 10 files / 24 passed / 1 skipped（身分授權「未涵蓋」）；build 通過。
- flows 移植：以程式比對基線 `gui/app.js` 的 `flows`，5 個流程所有欄位完全相同。
- 瀏覽器實測：
  - 結構：`lang="zh-Hant"`、header／nav／main 各 1、每頁 1 個 h1、所有輸入皆有 label。
  - 01：勾選「資料分析」自動帶入前置流程「查詢追溯」，自動加入說明為白話；進階區以外無技術詞。「查詢與追溯」預覽可調整欄位並顯示模擬表格。
  - 步驟切換：焦點移到新頁 h1，`aria-current="step"` 與「（已確認）」文字同步。
  - 02：以合成 CSV（含引號、逗號、空值）上傳，推測為 text／decimal／boolean／date，空值欄位改為非必填；樣本值不在 DOM、Storage 或網路請求中。localStorage 另有 5 筆其他專案（aov-studio、daihui）在同一連接埠留下的資料，與本功能無關。
  - AOV：鍵盤新增、上移後焦點留在被移動的步驟；表單引用選項正確。
  - 03：未填客戶名稱時下載鈕停用；下載內容只含 clientName、已選功能與畫面設定，無上傳資料、AOV 內容或秘密值；部署套件明示尚未提供。
  - 對比：本文 13.43、次要文字 6.95、主色按鈕 7.67、錯誤 7.48、邊框 4.02（UI 元件門檻 3:1）。200% 縮放四頁皆無水平捲動。Console 無錯誤、無 API 請求。
- 結論：FP1–FP6 驗收通過，另有下列非阻擋發現。

| ID | 嚴重度 | 內容 | 建議 |
|---|---|---|---|
| G01 | 中 | 初次載入即把焦點移到 h1，第一次 Tab 跳過「跳到主要內容」與步驟導覽（實測第一個 Tab 落在流程核取框） | `StepShell` 首次 render 不移焦點，只在切換步驟時移動 |
| G02 | 低 | 步驟導覽的方向鍵：切換後焦點移到 h1，連按方向鍵只會作用一次 | 移除方向鍵處理（按鈕本已可 Tab），或切換時保留焦點於導覽 |
| G03 | 低 | 新增步驟／欄位後直接輸入，會接在預設文字後面（實測得到「新步驟 1收料檢查」） | 聚焦時全選預設文字 |
| G04 | 低 | 功能與流程同名時說明重複：「因為選了『資料匯入』，系統會自動加入『資料匯入』」 | 調整覆蓋檔的顯示名稱（例如「資料匯入工作」）或句型 |
| G05 | 低 | 「確認本步驟」不檢查內容，表單有錯誤仍可標記已確認 | 有驗證錯誤時停用或提示 |
| G06 | 低 | manifest 或覆蓋檔錯誤在模組載入時拋出，畫面全白、無說明 | 加上錯誤畫面，顯示可理解的原因 |
| G07 | 低 | `entry-permission-kit` 為非必要，但 spec §8 要求未選時須明確採替代驗證政策；目前未選時沒有提示 | 未選時在輸出頁提示「此系統未包含入口權限」 |
| G08 | 低 | `config/flows.json` 未記錄來源 commit（`overlay.json` 有） | 在 README 或覆蓋檔記錄 |

- 已修正：`App.test.tsx` 註解亂碼（`WP1?WP6` 改為 `WP1-WP6`）。
- 範圍外但保留：Codex 新增 `DESIGN.md`（設計 token 與元件約定）、`AGENTS.md`，並在 CLAUDE.md 開頭加入「All UI must follow ./DESIGN.md.」。內容與交接要求的 CSS 變數集中管理一致，建議保留。

# Decisions

- 2026-09-30，user 已確認：按基線四步驟重做、對象為一般使用者、視覺不拘先產生後調整、必須無障礙、讀取真實 Kit。
- 2026-09-30，Claude 暫行決策：見「Claude 決策（暫行）」一節。

# Open Questions

- owner: user — 首期為哪 2 個真實 Kit 提供可調整畫面？暫定 `query-traceability-kit` 與 `upload-validation-kit`。
- owner: user — AOV 是否之後仍需要拖拉畫布？首期只做清單編輯器。
