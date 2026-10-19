---
id: "20261016-example-scenario"
title: "去識別化系統使用範例：輸入提示、載入範例按鈕與整合樣本"
status: "waiting_for_user"
owner: "user"
reviewer: "claude"
priority: "normal"
created_by: "claude"
created_at: "2026-10-16"
updated_at: "2026-10-18"
role_priority:
  implementation: "codex (WP1 到 WP3) / claude (WP4、審閱、git)"
  review: "claude"
  tests: "codex / claude"
  requirements: "user"
artifacts:
  - path: "docs/example-scenario.md"
    type: "file"
  - path: "docs/decision-log.md"
    type: "file"
---

# Goal

依 `docs/example-scenario.md` 與 D99，把去識別化的「配料混合產線」做成系統使用範例：輸入框提示文字（可關閉）、「載入範例」按鈕、並作為整合 fixtures 的 B 側通用來源。分支建議 `feature/example-scenario`，由 Claude 建立。

# 開工條件（未滿足前 Codex 不得開始）

1. user 核准建立分支 `feature/example-scenario`（Claude 執行 git）。
2. 工作樹中既有的三個未提交 UI 檔案（FactoryPage.tsx、WorkflowCanvas.tsx、aov.test.tsx）已先處理（提交或還原），避免混入本功能。

# Claude Notes

## 派工給 Codex

**預計完成時間：2026-10-18 01:00 起 6 小時（WP1 至 WP2 約 3 小時，WP3 約 3 小時），即當日加 6 小時。** 到期未完成由 Claude 接手。Codex 只寫程式與資料，不執行 git、不連網、不啟動伺服器；cwd 必須是專案根目錄。UI 須遵守 `DESIGN.md`。

### WP1 範例資料模組（Data-First，先做）

1. 新增 `apps/composer-gui/src/exampleHints.ts`：集中放（a）各輸入位置的提示文字，（b）產生範例文件片段的函式（工廠、生產邏輯、六個節點、五張表單、以批號建立的 shared-key 關聯），內容依 `docs/example-scenario.md` 第 3、4 節，一字不增（特別是不得加入任何數值或產業專有詞彙）。
2. 範例 id 全部以 `example-` 開頭，符合 `^[a-z0-9-]+$`；節點與表單的上限（MAX_GRAPHS、MAX_LOGICS 等）要先檢查，超過時回報原因不載入。
3. 測試：範例片段合併進空文件與已有資料的文件後，皆通過 `integrityErrors` 與 schema；匯出再匯入內容相等；所有 id 唯一且不與既有 id 衝突；再次載入不重複新增。

### WP2 輸入提示與開關

1. 在 `FactoryPage.tsx`（工廠名稱、生產邏輯名稱）、`NodeDetails.tsx`（節點名稱、時機、負責職務）、`NodeForm.tsx`（表單名稱、欄位名稱）加提示。提示文字取自 `exampleHints.ts`，不在元件內硬寫。
2. 提供一個「顯示填寫提示」開關（可見標籤、鍵盤可操作）。狀態存 localStorage，讀寫皆 try/catch，取不到時預設顯示；不進文件與匯出。關閉時輸入框不帶 placeholder。
3. 數值類動作參數的提示只寫「依貴廠規格填寫」，不顯示任何數字。
4. 測試：開關兩種狀態下提示的有無；提示不會被當成輸入值或進入 `exportAovGraph` 的結果；localStorage 不可用時不報錯且預設顯示。既有測試意圖不得改動。

### WP3 載入範例按鈕

1. 在工廠頁加「載入範例」按鈕：只新增範例工廠、不覆蓋；已載入時顯示說明並停用。名稱含「範例」字樣。
2. 另有「清除範例」：只移除 `example-` 開頭的工廠及其生產邏輯、表單、關聯；沿用現有頁內刪除確認並列出將移除的內容，不使用 `window.confirm`。使用者在範例上做的修改也會一併清除，確認文字須說明。
3. 載入或清除後，焦點與狀態播報須符合 DESIGN.md。
4. 測試：載入後工廠、六個節點、五張表單、關聯數量正確；已有使用者資料時完全保留；清除後只剩使用者資料；重複載入與重複清除不出錯。

### 停止條件

需要新增依賴、修改 `schemas/`、修改 `config/` 或 `libs/ui-runtime/`、範例需要任何來源案例的資訊才能完成、既有測試意圖無法保留時，停止並在 Codex Notes 寫下問題，不自行變通。每個工作包完成後記錄：做了什麼、變更檔案、測試結果（含略過與失敗）、未解決的事。

### 驗證指令

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`

## WP4（Claude）

- 以專有詞彙清單在 repo 內搜尋，結果須為零（清單只留本機）。已知既有測試資料使用過產業用語，不屬本功能，另行處理。
- 瀏覽器實際操作：提示可見與關閉、載入、清除、匯出再匯入。
- 以範例匯出重做 `fixtures/aov-merge/b/` 的 v5 樣本，v1 至 v4 改以同一情境表達。

## Codex Notes

（Codex 在此續寫）
