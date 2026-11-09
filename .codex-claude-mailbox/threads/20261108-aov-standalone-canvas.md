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

## 2026-11-08 Codex：批二停止，待釐清待補項契約

- 已先讀 CLAUDE.md、AGENTS.md、批二 Handoff、契約第 5、6 節、DESIGN.md D187，以及批一的 importAny.ts、AovCanvasApp.tsx、style.css 獨立頁規則。本次尚未修改任何程式或測試；唯一變更檔案為本 thread，追加此 Codex Notes。
- 停止原因：契約第 6.7 點寫「範例載入後一定有待補項」，但現有 `workflowGraph.ts` 的 `nodeErrors` 對無動作的業務節點直接回傳空清單；`graphIssues` 不要求這類節點填寫 when、owner、表單或參數。依第 6.3、6.4 點轉成 actionId: null 並補上起終點連線後，全部無動作的範例可有 0 項待補。這與「一定有待補項」無法同時成立，已觸發「契約與現有畫布行為衝突」停止條件，不自行新增驗證、虛構待補項或改寫契約。
- 唯讀資料核對：以現有 `config/actions.json` 的 requires 與 `kits/analytical-four-kit/workflow.aov.json` 的 capabilityIds 比對，該流程有 **23 個節點、22 條連線、0 個可對應動作的節點**。這是實際存在的情況，不只是合成邊界案例。尚未實作轉換器，因此未宣稱已執行轉換驗證。
- 待 Claude／user 裁決：第 6.7 點是否應為「範例可能有待補項，依 graphErrors 的實際數量顯示，允許尚有 0 項待補」？若確實要求每份範例都必須有待補項，請明定額外業務規則與允許修改範圍。裁決前停止批二實作。
- 本次 `npm.cmd run typecheck`：exit **0**；兩個 TypeScript 檢查通過，**0 個診斷錯誤**。
- 本次 `npm.cmd test`：exit **1**；Vitest **66 files：64 passed、2 failed；835 tests：829 passed、1 failed、5 skipped**；Duration **15.87s**。
  - evaluator 打包程序 suite：esbuild **2 errors**，`Cannot read directory "../..": Access is denied.`、`Could not resolve "./services/evaluator/src/main.ts"`，屬已知沙箱存取限制。
  - security：簽章 CLI 讀取暫存私鑰遇到 **EPERM operation not permitted**；afterAll 清除暫存目錄也遇到 **EPERM Permission denied**，屬已知沙箱限制。未繞過沙箱或修改測試。
  - 因 Vitest 失敗，`&&` 後續 preview、libs/case-store、services/case-store 三段 **未執行**。上述為現有程式的檢查結果，不代表批二驗收通過。
- 變異檢查：**0 項執行**；因停止條件成立，尚未寫入批二實作與測試，沒有進行暫時變異，沒有留下變異內容。
- 跳過：批二轉換器、草稿匯出、Kit 格式匯入、範例庫 UI、兩入口整合及全部新增測試與變異驗證，均待契約裁決後續作。未執行 build、git、網路、依賴安裝、伺服器、瀏覽器或視覺驗證；未修改 mailbox index 或任何其他檔案。

## 2026-11-09 Codex：依裁決完成批二實作與測試

- 已重讀最後的 Claude 裁決、契約第 6.7／6.8 點與 DESIGN.md D187；待補數量完全取 `graphErrors`，0 項使用裁決指定的不代表可執行提示，沒有新增完整性規則或預填表單／參數。下載按鈕為「下載範例流程規格（草稿）」。
- 新增檔案：`apps/composer-gui/src/kitExamples.ts`、`ExampleLibrary.tsx`、`kitExamples.test.ts`、`ExampleLibrary.test.tsx`。修改檔案：同目錄 `importAny.ts`、`workflowGraph.ts`、`AovCanvasApp.tsx`、`App.tsx`、`style.css`；另依要求追加本 thread 的 Codex Notes。未修改其他原始碼、設定、既有測試或 mailbox index。
- 轉換：使用既有 actionCatalog，交集最大者勝、平手保留目錄先序，無交集為業務節點；保留來源節點名稱／識別碼與連線，補起終點，依最長前置深度分層，同層依來源順序排列，沿用 canvasEditing 的 100／120 像素間距。系統產生識別碼避免與來源節點衝突，驗證 schema 與 integrityErrors；提示依固定順序列出狀態、逐個無對應步驟、無連線與實際待補數量。
- 範例清單：讀取 workflowFiles，逐份 parseKitWorkflow 後轉換，依功能名稱排序；失敗保留該列與業務語言原因，不影響其他列。下載不改畫布；載入使用深層複本，有工廠時先確認、可取消；兩個入口都清空 path 並遞增畫布 resetKey。樣式只在 style.css 尾端追加範例庫規則。
- 匯入／匯出：importAny 支援 Kit 原檔與 BOM，未知功能、版本不符、內容不合法各以業務語言拒絕並保留原流程；其他格式維持原處理。exportAovGraphDraft 與 exportAovGraph 共用唯一欄位投影與 schema 檢查；正式匯出的完整性檢查與錯誤文字未變，草稿只略過 graphErrors，仍拒絕 integrityErrors。
- 新增測試 **2 檔、27 項**：合成動作目錄的交集／平手／空交集；起終點、分層座標、無連線並列、確定性、草稿／已審閱文字、逐項無對應提示、實際待補數量；循環與不存在端點拒絕、識別碼碰撞；**13 份現有 Kit 原檔**全部轉換、schema／integrityErrors、草稿匯出後 importAny 內容相同、原檔直接匯入與 BOM；清單單列失敗／排序／空狀態；正式與草稿匯出相同行為或預期差異與共用投影；UI 開合、計數、確認／取消、純文字、不可載入列、下載檔名／往返／失敗訊息；兩入口真實畫布整合及 path／resetKey 重設。沒有寫死可對應步驟總數。
- 定向檢查 `npm.cmd exec -- vitest run --configLoader native src/kitExamples.test.ts src/ExampleLibrary.test.tsx`：exit **0**，**2 files passed、27 tests passed、0 failed、0 skipped**；Duration **4.12s**。最終完整測試亦包含還原後這 27 項，全部通過。
- 變異檢查：**20 種關鍵變異最終全被抓到，0 survived**。逐項修改允許檔案後執行對應測試，finally 以原始 bytes 還原，沒有保留變異。
  - 交集改取首個、平手改取末個、空交集也選動作：各 **1** 項失敗。
  - 移除起點連線、移除終點連線：各 **4** 項失敗。
  - 移除無先後提示、移除 0 項非可執行警語、待補數量固定為 0、取消分層：分別 **2、2、7、3** 項失敗。
  - 跳過載入確認、不複製載入資料、錯誤下載檔名、草稿略過 integrityErrors：分別 **3、1、1、1** 項失敗。
  - 刪除逐個無對應提示、草稿誤用完整性門檻、移除版本專用拒絕訊息：分別 **1、7、1** 項失敗。
  - 兩入口各移除 path 重設：各 **1** 項失敗；各移除 resetKey 遞增：補強後各 **1** 項失敗。
  - resetKey 的兩個變異第一次存活：清空 path 本身也會清除選取，原整合情境未能區別。已在仍渲染真實 WorkflowCanvas 的整合測試中觀察 resetKey，驗證每次載入都遞增，再跑兩個變異均為斷言失敗。其餘變異均為斷言／UI 查詢失敗，或草稿匯出不應拋出的業務錯誤，不以編譯／載入失敗冒充抓到。
- 最終 `npm.cmd run typecheck`：exit **0**；兩個 TypeScript 檢查通過，**0 個診斷錯誤**。
- 最終 `npm.cmd test`：exit **1**；Vitest **68 files：66 passed、2 failed；862 tests：856 passed、1 failed、5 skipped**；Duration **16.73s**。
  - evaluator 打包程序 suite：esbuild **2 errors**，`Cannot read directory "../..": Access is denied.`、`Could not resolve "./services/evaluator/src/main.ts"`，屬已知沙箱存取限制。
  - security：簽章 CLI 讀取暫存私鑰遇到 **EPERM operation not permitted**，afterAll 清除暫存目錄遇到 **EPERM Permission denied**，屬已知沙箱限制。未繞過或修改該測試。
  - Vitest 失敗使 `&&` 後續 preview、libs/case-store、services/case-store 三段 **未執行**。保留既有 **5 skipped**；新增測試沒有 skip。
- 過程中已解決的檢查失敗：初次 typecheck 發現測試 mock 用了 error 而非 errors；兩條整合測試把同名工廠／生產邏輯當成單一輸入，已改為驗證兩個。最初變異命令的 Python 無法啟動（登入工作階段錯誤，尚未寫檔），改用 Node；第一輪 Node 的中文字串因 PowerShell 管線編碼無法比對而停止，finally 已還原，指定 UTF-8 後重跑完成。未安裝任何工具或更改專案執行設定。
- 未執行 build、瀏覽器／視覺驗證、git、網路、依賴安裝或伺服器；未開始批三。新增程式／測試經文字掃描無 any、innerHTML、dangerouslySetInnerHTML 或 window.confirm。批二允許範圍的實作與測試完成，待 Claude 沙箱外複跑及視覺審閱；範例仍不代表執行驗證通過。

# Claude Notes

- 2026-11-08：分支建於 main 7161168。實測事實與限制見契約第 3、9 節。另有 session 提到各 Kit 的 CHANGELOG.md 功能（HMM 訓練）可能與節點修改紀錄重疊，該 session 需求確定後會通知，屆時再對照，避免重複設計。

- 2026-11-08 Claude 裁決（批一續作）：停止條件成立，是契約文字過寬。「不寫入任何瀏覽器儲存」的本意是流程、表單、節點細項不落地；「顯示填寫提示」偏好是既有的每位使用者顯示設定，沿用 `ExampleHintProvider` 原行為，不改共用元件、不隱藏、不攔截儲存。已修正 `docs/aov-standalone-canvas.md` 第 4 節與 `DESIGN.md` 獨立頁一節。Codex 沙箱的 evaluator 與 security 測試失敗屬已知沙箱限制，Claude 在沙箱外複跑。續作範圍不變：補完批一第 4 項測試（UI、匯入、往返、靜態 import 清單、入口）與變異驗證。

- 2026-11-08 批一審閱與實測（Claude）：沙箱外 typecheck 乾淨、`npm test` GUI 66 檔 834 通過 1 項既有跳過、案例庫 38、服務 8，`vite build` 同時輸出 `index.html` 與 `aov-canvas.html`。Codex 沙箱的 evaluator 與 security 失敗在沙箱外不出現。
  - Chrome 實測（Vite 5175，無主控台錯誤）：頁面無導覽列、標題與兩個按鈕在頂端；匯入含不存在動作的檔案，顯示業務語言錯誤並保留原流程；匯入有效檔後顯示成功訊息，開啟生產邏輯後畫布顯示開始、兩個節點、結束與連線。
  - 實測發現並修正一個缺陷（Codex 版本就有）：獨立頁的樣式把 `.workflow-canvas` 設成 `height: auto; flex: 1`，React Flow 以 `height: 100%` 取父層高度，結果高度為 0，節點完全畫不出來，而 jsdom 沒有排版所以測試抓不到。改為沿用主頁面的 `70vh`、最小 `28rem`，並把這段樣式從元件內嵌的 `<style>` 移到 `style.css`；補一條讀樣式表的回歸測試，加回壞規則會失敗（已驗證）。
  - 未在瀏覽器驗證：實際按「下載流程規格」（下載需要使用者許可，以單元測試涵蓋）、`npm run aov-canvas` 的 `--open`（會開預設瀏覽器，改以 vite 直接啟動驗證）、`aov-canvas.cmd` 與 `-Page`。
  - 測試檔另有 `importAny` 目前只認 `composer-aov-list`，Kit 與專案檔格式分別在批二、批三加入。

# 批二 Handoff（Codex）

**預計完成時間：2026-11-09 18:00。** cwd 為專案根目錄。Codex 只寫程式與測試，不執行 git、不連網、不裝依賴、不啟動伺服器或瀏覽器。契約唯一來源是 `docs/aov-standalone-canvas.md` 第 5、6 節與 `DESIGN.md`「範例庫（D187）」一節；有不明處、與現有程式衝突、或要動範圍外檔案就停工並寫進 Codex Notes，不自行裁決。新測試一律放 `apps/composer-gui/src/`（`libs/` 下的測試不在 `npm test` 範圍）。批一已完成並提交（`importAny`、`AovCanvasApp`、`style.css` 中獨立頁樣式），先讀過再動手。

可動的檔案：
- 新增 `apps/composer-gui/src/kitExamples.ts`、`ExampleLibrary.tsx` 與各自測試。
- 修改 `importAny.ts`（加辨識 `composer-kit-workflow`）、`workflowGraph.ts`（只加 `exportAovGraphDraft`，並與 `exportAovGraph` 共用同一個欄位投影函式；`exportAovGraph` 的行為與錯誤訊息一字不改）、`AovCanvasApp.tsx` 與 `App.tsx`（只在畫布的 `toolbarExtra` 加 `ExampleLibrary`，其餘不動）、`style.css`（只追加範例庫所需規則）、`vite-env.d.ts`（若需要）。
- 不得動：`kits/`、`libs/`、`schemas/`、`config/`、`scripts/`、`package.json`、`WorkflowCanvas.tsx`、`WorkflowTransfer.tsx`。

工作：
1. `kitWorkflowToCanvas(workflow, kit)`：依契約第 6 節第 1 至 7 點；輸出 `{ value: AovGraphDocument; notices: string[] }`，結果須通過 `validateSchema('aov', …)` 與 `integrityErrors`。確定性：同輸入同輸出（id、座標、提示順序）。動作對應取交集最大者，平手取 `actionCatalog` 順序在前者，交集為空為 `actionId: null` 的業務節點；不得為通過 `graphErrors` 而預填表單或參數。
2. 載入所有 Kit 範例：以 `kitWorkflows.ts` 的 `workflowFiles` 取得原文，用 `parseKitWorkflow` 驗證後轉換；任何一份失敗只影響該列（顯示「無法載入」與原因）。範例清單依 Kit 顯示名稱排序。
3. `exportAovGraphDraft(doc)`：契約第 6 節第 8 點。
4. `importAny` 加辨識 `composer-kit-workflow`：以檔內 `kitId` 找已登錄 Kit，找不到或版本不符丟業務語言錯誤（不洩漏檔案路徑或欄位名），成功回傳轉換結果與提示；其他格式行為不變。
5. `ExampleLibrary.tsx`：依 DESIGN.md；props 至少 `current: AovGraphDocument` 與 `onLoad(doc: AovGraphDocument): void`；載入前的確認、無範例時的空狀態、`role="status"` 提示、下載走 `exportAovGraphDraft` 與 `fileTransfer.downloadJson`，檔名 `<kitId>-example.json`。載入後獨立畫布與 `App` 要像匯入流程規格一樣清空開啟路徑並重設畫布（比照 `WorkflowTransfer` 的 `onChange` 處理）。
6. 測試（每個須在對應規則被拿掉時失敗，規則 9）：
   - 轉換規則以合成的小型 workflow 與 catalog 驗證：交集最大者勝、平手取目錄順序、無交集為業務節點、起點終點連線、整份無連線時並列且有提示、狀態文字（草稿與已審閱）、無法對應步驟的提示逐一列出、同輸入兩次輸出相同。
   - 真實資料：現有每一份 `kits/*/workflow.aov.json` 都能轉換（全部通過 schema 與 `integrityErrors`），`exportAovGraphDraft` 後再 `importAny` 得到相同內容，且 `importAny` 直接讀 Kit 原檔也成功。不得把「30/101 可對應」寫死成預期值（Kit 檔會變）。
   - `exportAovGraphDraft`：待補項存在時 `exportAovGraph` 仍拒絕、Draft 可匯出；欄位投影只有一份（兩者對完整流程輸出相同位元組）。
   - `ExampleLibrary`：開合面板、狀態與計數文字、載入前確認（有內容才出現確認區、取消不改變、確認才替換、空畫布直接載入）、無法載入的列、空狀態、下載內容可被 `importAny` 還原。
   - `App` 與 `AovCanvasApp` 各一條整合測試：點「範例庫」載入一份範例後畫布出現該流程。
7. 不得用 `any`、`dangerouslySetInnerHTML`、`innerHTML`、`window.confirm`；使用者可編輯文字一律純文字；Kit 檔的文字也當純文字。

停止條件：需要新增依賴；需要修改範圍外的檔案；`parseKitWorkflow` 或 `kitWorkflows` 無法在範例清單中使用；契約與 DESIGN.md 互相衝突或與現有畫布行為衝突。

驗收（Codex 須在 Notes 如實列出）：`npm.cmd run typecheck`、`npm.cmd test` 結果與數字（evaluator 與 security 的沙箱失敗照實寫成沙箱限制）；關鍵規則的變異檢查結果；跳過或失敗的項目。

- 2026-11-09 Claude 裁決（批二停工）：Codex 判斷正確。`workflowGraph.ts` 的 `nodeErrors` 對 `actionId: null` 的業務節點回傳空清單，契約 6.7「一定有待補項」不成立，是我寫錯。已改契約 6.7：待補項可為 0，提示顯示 `graphErrors` 的實際數量，0 時明說不代表可執行；不新增驗證、不虛構待補。按鈕文字由「下載範例流程規格（尚待補齊）」改為「下載範例流程規格（草稿）」（待補為 0 時前者不符實），契約 6.8 與 DESIGN.md 已同步。批二續作，允許範圍不變。

- 2026-11-09 Claude 批二審查：沙箱外 typecheck 乾淨；GUI 68 檔 861 通過、1 skipped（既有）；案例庫 38、服務 8；vite build 產出 index.html 與 aov-canvas.html。審閱程式碼：複用既有 `kitWorkflows`，`projectAovGraph` 只有一份欄位投影，未預填表單或參數。Chrome 驗證（獨立頁與主程式）：範例庫面板列出 13 個功能與狀態；載入 0 個可對應的 Kit（入口與使用權限）後畫布有畫出節點，提示逐一列出 16 個無法對應的步驟並寫明「待補為 0 不代表可執行」；畫布有內容時先出現確認區（按鈕高 44px），確認後替換；有對應功能的 Kit（查詢與追溯）顯示「尚有 2 項待補」與「未定義步驟先後」；console 無錯誤；主程式畫布工具列同樣有「範例庫」。未驗證：實際點擊下載（需使用者允許下載，單元測試涵蓋內容）。已知限制：沒有連線的 Kit（共 7 個）所有步驟並列在同一欄，步驟多時（16、23 個）縮得很小；載入提示逐步驟列出，步驟多時把畫布往下推。兩者不影響正確性，留待批三或後續視使用者意見調整。
