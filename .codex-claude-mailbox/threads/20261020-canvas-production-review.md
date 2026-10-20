---
id: "20261020-canvas-production-review"
title: "AoV 正式畫布、參數設定、逐站模擬與產業範本：接手審查與合併"
status: "completed"
owner: "claude"
reviewer: "claude"
priority: "normal"
created_by: "claude"
created_at: "2026-10-20"
updated_at: "2026-10-20"
artifacts:
  - path: "docs/decision-log.md"
    type: "file"
  - path: "DESIGN.md"
    type: "file"
---

# Goal

user 交給另一個 Codex 工作階段的畫布與相關工作留在共用工作樹未提交，該階段因額度中止；user 指示由 Claude 接手、審查並合併。該工作沒有 mailbox thread，也沒有規格紀錄，只有 decision-log 與 DESIGN.md 的畫布規則段落；其餘（參數設定、逐站模擬、產業範本、Recipe schema 變更）以程式行為為準，於審閱時補記為 D111 至 D113。

# Claude Notes

## 範圍（18 個修改檔加 6 個新檔）

- 畫布規則（D110）：`WorkflowCanvas.tsx`、`canvasEditing.ts`、`workflowGraph.ts`（`graphIssues`、`graphPath`）及其測試、`DESIGN.md`。
- 參數設定與生產設定（D111）：`libs/ui-runtime/production.ts`、`recipe.ts`、`types.ts`、`schemas/recipe.schema.json`、`ProductionPage.tsx`、`OutputPage.tsx`、`App.tsx`、`StepShell.tsx`。
- 逐站模擬（D112）：`WorkflowSimulation.tsx`、`simulation.ts`、`KitPreview.tsx`、`FlowPage.tsx`。
- 產業範本（D113）：`industryTemplates.ts`、`industryTemplates.json`（68 個範本）。
- 其他：加入功能的確認區、輸出頁「前往修改」、版面整合（`style.css`）。

## 驗證

- 接手時：typecheck 通過；測試 38 個檔案中 3 個失敗、10 項失敗，原因是步驟由三步改為四步後既有測試仍使用 `03 輸出`，以及輸出頁的「檔案內容」欄位被移除。
- 修正後：typecheck 通過；測試 39 個檔案、475 項通過、1 略過（既有身分授權）；build 通過。
- 新增 `production.test.tsx` 19 項（生產設定驗證、Recipe 往返、逐站模擬規則、產業範本）；以變異測試（移除上下限比較、移除前置站檢查）確認測試會失敗，還原後全過。
- 瀏覽器實測（localhost）：四個步驟列出；建立工廠與生產邏輯後可加入產業範本，連線為單段直線（路徑皆為 M…L…，無曲線），連線端點有重新接線的把手；02 的「逐站模擬」可切換並列出站別；03 參數設定頁有批號格式與產品規格，未填完整時 04 的下載按鈕停用並以 `role="alert"` 說明；04 輸出頁有「檔案內容」欄位並說明不是安裝包。
- 未涵蓋：以滑鼠拖曳重新接線（把手存在，邏輯由單元測試涵蓋，但拖曳本身未在瀏覽器操作）、鍵盤逐步順序、手機寬度版面、`prefers-reduced-motion`。

## Review Findings

| 編號 | 嚴重度 | 內容 | 處理 |
|---|---|---|---|
| R01 | 高 | 步驟改四步後，三個測試檔共 10 項失敗；輸出頁的「檔案內容」欄位（含「設定交付包不是安裝包」與不包含項目的揭露）被移除 | 測試改用 04；欄位恢復，因為它是安全與期望管理的揭露且受既有測試保護（D114） |
| R02 | 中 | 另一個工作階段新增大量功能卻沒有規格、thread、決議，也沒有新模組的測試 | 補記 D110 至 D114、DESIGN.md，補 19 項測試 |
| R03 | 中 | `schemas/recipe.schema.json` 整檔被重新排版（緊湊改展開），diff 約 116 行，掩蓋了實際只新增 `productionSettings` 的事實 | 接受，語意經核對只新增該欄位；日後避免無關的整檔重排 |
| R04 | 低 | 產業範本中 3 個名稱（攪拌混合、調色調黏度、錫膏印刷）與先前專有詞彙清單相符，但它們是各產業通用的製程名詞，68 個範本涵蓋 11 類產業 | 不阻擋；提示 user，若要完全避免可更名 |
| R05 | 低 | 參數設定的錯誤訊息在產品名稱為空時顯示「「」」 | 記錄，可之後改為「未命名產品」 |
| R06 | 低 | `reconnectCanvasEdge` 本身不驗證，依賴 commit 前的 `integrityErrors` 拒絕非法重接；找不到的邊 id 會靜默不變 | 測試已涵蓋自我連線拒絕與輸入不變；維持 |
| R07 | 低 | 製作時 `ProductionPage` 的產品列使用索引作 key，刪除中間列時輸入焦點可能錯位 | 記錄 |
| R08 | 資訊 | 該工作改變了 Recipe 結構，預覽的選配閘門（D108）以 schema 驗證 Recipe | 閘門於建置時複製 schema，下次建置自動包含新欄位；已確認 `productionSettings` 為可選欄位，不影響既有 Recipe |

結論：審閱後可合併。畫面的「模擬資料」標籤不在本次範圍。
