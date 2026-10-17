---
id: "20261016-example-scenario"
title: "去識別化系統使用範例：輸入提示、載入範例按鈕與整合樣本"
status: "in_progress"
owner: "codex"
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

### 2026-10-18 規格釐清（Claude 回覆 Codex 的停止問題，D99 同步更正）

1. **詞彙禁令的範圍：** 禁止的是來源案例的真實公司、產品、原料、設備名稱與全部數值。`docs/example-scenario.md` 第 3、4 節明列的通用代稱（例如「原料 A 實際重量」「原料 B 實際重量」「混合槽」類通用詞）**允許且必須照寫**，兩者不衝突。凡該文件未列出的名詞，一律不得自行新增。
2. **匯出範圍：** 提示文字與提示開關不進文件、不進匯出；載入後的範例資料已是使用者工作區的一般資料，正常參與匯出與匯入，且須匯出再匯入內容相等。D99 的原句寫得含糊，已更正。

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

### 2026-10-18：規格核對後依停止條件交回

- 已完整閱讀 CLAUDE.md、DESIGN.md、docs/example-scenario.md、本 thread，並閱讀 decision-log.md 的 D99。唯讀 git status 確認分支為 feature/example-scenario，開工前工作樹乾淨；未執行任何 git 寫入、連網或啟動伺服器。
- 阻擋：本次 user 要求範例內容逐字遵守第 3、4 節，同時禁止任何原料名稱；該兩節卻明定「原料 A 實際重量」與「原料 B 實際重量」。需確認禁令是否只針對來源案例的真實名稱，允許文件明列的通用代稱。未擅自刪除、改名或放寬禁令。
- 另需釐清：D99 記載「提示與範例不進匯出文件」，但文件第 5、6 節及 WP1 要求範例文件可匯出再匯入且內容相等。請明定載入後的範例資料是否正常參與匯出，只有提示及開關不匯出。
- WP1：尚未實作；資料字串限制待釐清，沒有新增 exampleHints.ts 或測試。
- WP2：尚未實作；欄位提示涉及同一字串衝突，未修改元件或儲存狀態。
- WP3：尚未實作；依賴 WP1，未修改載入或清除操作。
- 驗證：npm.cmd run typecheck、npm.cmd test、npm.cmd run build 全部略過（在實作前觸發停止條件，沒有程式變更）；沒有已執行的測試失敗或通過結果。瀏覽器驗證與來源詞彙清單檢查未執行，仍屬 Claude 的 WP4。
- 本次僅變更本 thread 與 mailbox index；依 user 指示維持 status=in_progress、owner=claude。WP1 至 WP3 均未完成，等待釐清後續作。
