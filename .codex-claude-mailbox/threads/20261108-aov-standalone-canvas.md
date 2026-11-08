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

# Claude Notes

- 2026-11-08：分支建於 main 7161168。實測事實與限制見契約第 3、9 節。另有 session 提到各 Kit 的 CHANGELOG.md 功能（HMM 訓練）可能與節點修改紀錄重疊，該 session 需求確定後會通知，屆時再對照，避免重複設計。
