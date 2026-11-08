---
id: "20261108-aov-standalone-canvas"
title: "獨立 AoV 畫布、Kit 範例庫、節點細項與專案檔（三批）"
status: "in_progress"
owner: "claude"
reviewer: "claude"
priority: "normal"
created_by: "claude"
created_at: "2026-11-08"
updated_at: "2026-11-08"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "codex / claude"
  requirements: "user"
artifacts:
  - path: "docs/aov-standalone-canvas.md"
    type: "file"
  - path: "docs/decision-log.md"
    type: "file"
  - path: "DESIGN.md"
    type: "file"
---

# Goal

依 `docs/aov-standalone-canvas.md`（D185 至 D189）做：可單獨啟動的 AoV 畫布；把各 Kit 的流程定義轉成可載入畫布的範例庫；節點細項與專案檔下載，並測試下載的檔案能匯入畫布。分支 `feature/aov-standalone-canvas`（基底 main 7161168）。三批全部完成後才向 user 回報。

# 批次

| 批 | 內容 | 負責 | 預計完成 |
|---|---|---|---|
| 一 | 獨立畫布入口、匯入匯出、`importAny` 骨架 | Codex | 2026-11-09 12:00 |
| 二 | Kit 範例庫與 `kitWorkflowToCanvas` | Codex | 批一審閱後 1 日 |
| 三 | 節點細項、專案檔下載、`projectToCanvas`、往返測試 | Codex | 批二審閱後 1 日 |

到期未完成由 Claude 接手（先確認 Codex 已停止再改檔）。

# 批一 Handoff（Codex）

**預計完成時間：2026-11-09 12:00。** cwd 必須是專案根目錄。Codex 只寫程式與測試，不執行 git、不連網、不裝依賴、不啟動伺服器或瀏覽器。契約唯一來源是 `docs/aov-standalone-canvas.md` 第 4、5 節與 `DESIGN.md` 的「獨立 AoV 畫布頁」；有不明處、與現有程式衝突、或要動範圍外的檔案就停工並寫進 Codex Notes，不自行裁決。

可動的檔案：
- 新增 `apps/composer-gui/aov-canvas.html`（比照 `index.html`，`<title>` 為「AoV 畫布」，載入 `/src/aovCanvasMain.tsx`）、`apps/composer-gui/src/aovCanvasMain.tsx`、`AovCanvasApp.tsx`、`importAny.ts` 與各自的測試。
- 修改 `apps/composer-gui/src/WorkflowTransfer.tsx`（改呼叫 `importAny`，其餘行為與既有測試不變）、`vite.config.ts`（只加 `build.rollupOptions.input` 讓 `vite build` 同時輸出兩個 HTML，`root` 與其他設定不變）。
- 不得動：`scripts/`、`start.cmd`、`package.json`（啟動指令與 cmd 由 Claude 加）、`App.tsx`、`OutputPage.tsx`、`libs/`、`schemas/`、`config/`、`kits/`。

工作：
1. `AovCanvasApp`：持有 `graph`（初始 `emptyGraph`）與 `path` 狀態；渲染 `WorkflowCanvas`（`toolbarExtra` 放 `WorkflowTransfer`）、頂端列與「下載流程規格」（呼叫 `exportAovGraph`，下載用 `fileTransfer.downloadJson`，檔名 `aov-flow.json`）。版面與訊息依 DESIGN.md 該節。
2. `importAny(text)`：簽章 `{ value: AovGraphDocument; notices: string[] }`，失敗丟業務語言 `Error`。批一只辨識 `composer-aov-list` 並委派 `importWorkflow`；`format` 是其他值或無法解析時丟「無法辨識的檔案格式。原流程已保留。」（保留既有「舊版清單」匯入路徑：沒有 `format` 欄位的舊檔仍交給 `importWorkflow`，不得因此退步）。
3. `aovCanvasMain.tsx` 比照 `main.tsx` 用 `bootstrap.mount`；`AovCanvasApp` 以具名匯出 `App` 供 `mount` 使用。
4. 測試（jsdom，沿用 `src/testCanvas.ts` 設定）：渲染後有標題、畫布、兩個按鈕；匯入一份 `exportAovGraph` 產出的檔案後畫布內容相同；匯入錯誤格式顯示 `role="alert"` 且原流程保留；流程不完整時下載不觸發並顯示 `role="alert"`；`importAny` 對三種輸入（v5 檔、舊清單、無法辨識）的行為；靜態檢查 `AovCanvasApp.tsx` 與 `aovCanvasMain.tsx` 的 import 清單不含 `./App`、`./OutputPage`、`./RecipeTransfer`、`./CaseLibraryPage`。每個測試須在對應規則被拿掉時失敗。
5. 不得用 `any`；不得用 `dangerouslySetInnerHTML` 或 `innerHTML`；不用 `window.confirm`。

停止條件：需要新增依賴；`WorkflowCanvas` 無法在沒有 `App` 的情況下渲染；`WorkflowTransfer` 既有測試因改動而無法維持；需要修改範圍外的檔案。

驗收（Codex 須在 Notes 如實列出）：`npm.cmd run typecheck`、`npm.cmd test` 的結果與數字；跳過或失敗的項目與原因（沙箱 EPERM 照實寫）。

# Codex Notes

（待 Codex 填寫）

## 2026-11-08 Codex：批一停止，待處理契約衝突

- 停止原因：契約第 4 節與 DESIGN.md D186 要求「不寫入任何瀏覽器儲存」，但 `WorkflowCanvas.tsx` 內建 `ExampleHintProvider`；`ExampleHintSettings.tsx` 的 `setVisible` 在切換「顯示填寫提示」時呼叫 `localStorage.setItem`。該控制項也出現在獨立頁。修正共用 provider 或畫布介面需要修改允許清單以外的檔案，已觸發「與現有程式衝突／需要修改範圍外檔案」停止條件。不自行改契約、不隱藏控制項或攔截儲存 API。
- 發現衝突時已寫入部分實作，保留供審閱，未宣稱批一完成。新增：`apps/composer-gui/aov-canvas.html`、`apps/composer-gui/src/aovCanvasMain.tsx`、`apps/composer-gui/src/AovCanvasApp.tsx`、`apps/composer-gui/src/importAny.ts`。修改：`apps/composer-gui/src/WorkflowTransfer.tsx`、`vite.config.ts`。另依使用者要求追加本節；未修改其他原始碼、測試或設定檔。
- 已寫內容：獨立 HTML 與 bootstrap 入口；記憶體中的 graph/path、既有畫布與匯入元件、流程下載及結果訊息；格式辨識委派 `importWorkflow`（無 format 欄位也委派）；Vite 雙 HTML build input。頁面樣式放在允許修改的 `AovCanvasApp.tsx`，未修改共用 CSS。
- `npm.cmd run typecheck`：exit code **0**，兩個 TypeScript 檢查通過，**0 個診斷錯誤**。
- `npm.cmd test`：exit code **1**。Vitest：**63 個測試檔，61 passed、2 failed；810 個測試，804 passed、1 failed、5 skipped**；Duration **15.33s**。
  - `src/evaluator.test.ts` 打包程序 suite：esbuild **2 errors**，`Cannot read directory "../..": Access is denied.` 與 `Could not resolve "./services/evaluator/src/main.ts"`；程序測試受沙箱存取限制而未完成。
  - `src/security.test.mjs`：簽章 CLI 讀取暫存私鑰回報 **沙箱 EPERM**（`operation not permitted, open`）；afterAll 刪除暫存目錄也回報 **沙箱 EPERM**（`Permission denied`）。不繞過沙箱、不修改範圍外測試。
  - Vitest 失敗後，npm script 的 `&&` 後續三段（preview、libs/case-store、services/case-store）**未執行**。
- 跳過：因上述停止條件，尚未新增批一要求的 UI、匯入、往返、靜態 import 清單與入口測試，亦未做變異驗證。既有測試結果不代表新功能已驗收。未執行 build；依硬規則未執行 git、連網、安裝依賴、啟動伺服器或瀏覽器，未進行視覺驗證。
- 待 Claude／user 處理：釐清「任何瀏覽器儲存」是否包含填寫提示偏好，或核定擴充可動檔案與 provider 的無儲存行為；確認後再接續剩餘實作及測試。

## 2026-11-08 Codex：依 Claude 裁決完成批一續作

- 已讀取 Claude 的續作裁決、契約第 4 節及 DESIGN.md D186。既有顯示偏好沿用原行為；流程、表單與節點細項不落地。檢查並保留前次六個實作檔案，沒有修改 `ExampleHintProvider` 或其他共用元件。
- 本次新增三個測試檔：`apps/composer-gui/src/AovCanvasApp.test.tsx`、`apps/composer-gui/src/importAny.test.ts`、`apps/composer-gui/src/aovCanvasMain.test.tsx`；另追加本節。批一累計程式／設定檔仍為 `aov-canvas.html`、`aovCanvasMain.tsx`、`AovCanvasApp.tsx`、`importAny.ts`、`WorkflowTransfer.tsx`、根目錄 `vite.config.ts`，加上述三個測試檔。暫時變異的檔案均以原始 bytes 還原，未保留任何變異。
- 測試覆蓋：真實 `WorkflowCanvas` 的空工廠畫面、標題、匯入／下載控制項、建立流程後的工具箱與開始／結束節點；經檔案選擇匯入 `exportAovGraph` 輸出、畫布節點及下載內容完整相同（含表單／關聯／layout）、成功訊息；錯誤格式顯示 alert 且原流程及開啟畫布保留；未完成流程仍可按下載但不產生檔案、顯示原因；重新掛載回到空流程且流程操作不寫入瀏覽器儲存。
- `importAny` 覆蓋 v5、BOM、舊版清單轉換與 notices、七種無法辨識輸入及精確錯誤文字。無 `format` 的輸入確認仍交給 `importWorkflow`；既有 schema 會拒絕缺少 format 的檔案，測試保留該既有驗證結果，沒有自行補欄位或放寬 schema。
- 入口測試覆蓋 HTML 標題／語言／root／module script、`bootstrap.mount` 接收正確 root 與具名 `App` loader、缺 root 的錯誤。以 TypeScript AST 讀取兩個入口檔的靜態及動態 import 清單，禁止 `./App`、`./OutputPage`、`./RecipeTransfer`、`./CaseLibraryPage`；另驗證清單解析能抓到四種靜態及動態依賴。
- 定向檢查：`npm.cmd exec -- vitest run --configLoader native src/AovCanvasApp.test.tsx src/importAny.test.ts src/aovCanvasMain.test.tsx`：exit **0**，**3 files passed、24 tests passed、0 failed、0 skipped**，Duration **2.42s**。最後完整測試也包含還原後的這 24 項測試，全部通過。
- 變異檢查：直接逐項暫改允許檔案並執行上述三個測試檔，**25/25 個變異被測試抓到，0 survived**（每項 exit **1**，均為斷言失敗而非載入／編譯錯誤）。
  - UI／匯出 8 項：改標題、畫布改讀空資料、匯入不存新流程、繞過 export 驗證、錯誤下載檔名、移除 alert 語意、移除成功訊息、匯入後不回工廠清單；各造成 **1、3、2、3、2、1、1、2** 個測試失敗。
  - 格式／儲存／入口 9 項：錯誤格式改為接受空流程、拒絕無 format 委派路徑、丟棄舊版 notices、移除 BOM 處理、將流程寫入 localStorage、移除 mount、移除缺 root 檢查、錯誤 HTML title、錯誤 HTML entry；各造成 **8、1、1、1、1、1、1、1、1** 個測試失敗。
  - 靜態依賴 8 項：兩個入口檔各加入四個禁止依賴之一（type-only import，避免以執行時載入錯誤冒充測試抓到），每項均造成 **1** 個靜態檢查失敗。
  - 第一個變異執行器曾因 PowerShell 將預期的 Vitest stderr 當終止錯誤而中止；finally 已還原檔案。調整該次命令的錯誤收集方式後，完整重跑以上 25 項；未修改專案執行器或設定。
- 最終 `npm.cmd run typecheck`：exit **0**，兩個 TypeScript 檢查通過，**0 個診斷錯誤**。
- 最終 `npm.cmd test`：exit **1**；Vitest **66 files：64 passed、2 failed；834 tests：828 passed、1 failed、5 skipped**；Duration **15.95s**。既有匯入相關測試沒有新增失敗。
  - `evaluator.test.ts`：已知沙箱存取限制，esbuild **2 errors**：`Cannot read directory "../..": Access is denied.`、`Could not resolve "./services/evaluator/src/main.ts"`。
  - `security.test.mjs`：已知**沙箱 EPERM**，簽章 CLI 無法讀取暫存私鑰；afterAll 清除暫存目錄也遇到 **EPERM Permission denied**。未繞過沙箱，待 Claude 在沙箱外複跑。
  - Vitest 失敗使 `&&` 後續 preview、libs/case-store、services/case-store 三段**未執行**；保留原有 **5 skipped**，本次新增測試無 skip。
- 未執行 build、伺服器或瀏覽器視覺驗證；未執行 git、連網或依賴安裝。未新增 any、innerHTML、dangerouslySetInnerHTML 或 window.confirm。批一允許範圍內實作與測試完成，待 Claude 沙箱外檢查與視覺審閱；未開始批二、批三。

# Claude Notes

- 2026-11-08：分支建於 main 7161168。實測事實與限制見契約第 3、9 節。另有 session 提到各 Kit 的 CHANGELOG.md 功能（HMM 訓練）可能與節點修改紀錄重疊，該 session 需求確定後會通知，屆時再對照，避免重複設計。

- 2026-11-08 Claude 裁決（批一續作）：停止條件成立，是契約文字過寬。「不寫入任何瀏覽器儲存」的本意是流程、表單、節點細項不落地；「顯示填寫提示」偏好是既有的每位使用者顯示設定，沿用 `ExampleHintProvider` 原行為，不改共用元件、不隱藏、不攔截儲存。已修正 `docs/aov-standalone-canvas.md` 第 4 節與 `DESIGN.md` 獨立頁一節。Codex 沙箱的 evaluator 與 security 測試失敗屬已知沙箱限制，Claude 在沙箱外複跑。續作範圍不變：補完批一第 4 項測試（UI、匯入、往返、靜態 import 清單、入口）與變異驗證。

- 2026-11-08 批一審閱與實測（Claude）：沙箱外 typecheck 乾淨、`npm test` GUI 66 檔 834 通過 1 項既有跳過、案例庫 38、服務 8，`vite build` 同時輸出 `index.html` 與 `aov-canvas.html`。Codex 沙箱的 evaluator 與 security 失敗在沙箱外不出現。
  - Chrome 實測（Vite 5175，無主控台錯誤）：頁面無導覽列、標題與兩個按鈕在頂端；匯入含不存在動作的檔案，顯示業務語言錯誤並保留原流程；匯入有效檔後顯示成功訊息，開啟生產邏輯後畫布顯示開始、兩個節點、結束與連線。
  - 實測發現並修正一個缺陷（Codex 版本就有）：獨立頁的樣式把 `.workflow-canvas` 設成 `height: auto; flex: 1`，React Flow 以 `height: 100%` 取父層高度，結果高度為 0，節點完全畫不出來，而 jsdom 沒有排版所以測試抓不到。改為沿用主頁面的 `70vh`、最小 `28rem`，並把這段樣式從元件內嵌的 `<style>` 移到 `style.css`；補一條讀樣式表的回歸測試，加回壞規則會失敗（已驗證）。
  - 未在瀏覽器驗證：實際按「下載流程規格」（下載需要使用者許可，以單元測試涵蓋）、`npm run aov-canvas` 的 `--open`（會開預設瀏覽器，改以 vite 直接啟動驗證）、`aov-canvas.cmd` 與 `-Page`。
  - 測試檔另有 `importAny` 目前只認 `composer-aov-list`，Kit 與專案檔格式分別在批二、批三加入。
