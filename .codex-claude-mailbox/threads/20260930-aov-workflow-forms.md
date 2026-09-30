---
id: "20260930-aov-workflow-forms"
title: "AoV Workflow 驅動表單設定與多檔上傳（D16–D30）"
status: "completed"
owner: "user"
reviewer: "claude"
priority: "high"
created_by: "claude"
created_at: "2026-09-30"
updated_at: "2026-09-30"
role_priority:
  implementation: "claude"
  review: "user"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "schemas/aov.schema.json"
    type: "file"
  - path: "schemas/recipe.schema.json"
    type: "file"
  - path: "apps/composer-gui/src/"
    type: "dir"
  - path: "docs/project-spec.md"
    type: "file"
  - path: "DESIGN.md"
    type: "file"
---

# Goal

依 spec §4.2 實作 AoV Workflow 驅動的表單設定（D16–D21），包含多檔上傳。分支 `feature/aov-workflow-forms`，由 main 開出。main 已先以 `--no-ff` 合併 `docs/aov-workflow-spec`（93596f1，含 `feature/ui-design`）。

# User 已確認（2026-09-30）

1. 「查詢追溯」綁定「通用表格管理」：需要追溯就需要管理表格，不論是否修改（D26）。
2. 表單預設名稱為原始檔名，並提醒使用者去識別化（D27）。
3. 設定交付包壓縮檔另開 `feature/install-package`（D28）。
4. Recipe schema 新增選填 `workflowRef`（D29）。
5. §4.2 四個待確認項目的建議答案（D22–D25）：user 未提出異議，依建議實作。

# Claude Notes

## 資料契約（Data-First）

- `composer-aov-list` version 2：`steps[].formIds`、`forms[].fields[].isKey`、`relations[]`（`kind: shared-key`、`origin`、`confirmed` 固定為 true）。version 1 仍可匯入：步驟保留，`formId` 清空並逐一列出。
- Recipe `workflowRef { path, sha256 }`：SHA-256 以實際下載的 UTF-8 位元組計算。
- 研究結論（D24）：`StationLink` 是有方向、唯一 `(from, to)`、每流程不成環、`keyMappings` 單一欄位對；D22 的限制使 FormRelation 可一對一轉換。缺口：基線版追溯查詢只比對 `lot_no`，不讀 `keyMappings`，列為未來工作。

## 介面

- 步驟改為 01 流程步驟 → 02 表單 → 03 表單關聯 → 04 功能選配 → 05 輸出，皆必填（D30）。
- 02：依步驟分組；多檔上傳到選定步驟，失敗逐檔列出原因；欄位表格抽成 `FormEditor`，新增「識別欄位」欄。
- 03：候選依 D19 規則推測，一律需按「確認」；手動新增若造成型別不符、重複或循環即拒絕並指出欄位；右欄為 A23 追溯檢視。
- 04：已確認關聯時顯示「加入『查詢追溯』」建議，不自動套用。
- 05：分別下載流程規格與系統設定檔；流程未完成時兩者都停用並說明原因。

## Commits

| commit | 內容 |
|---|---|
| c8d81fe | spec §4.2 待確認項目與 D22–D30 |
| 865d365 | Workflow v2 schema、Recipe `workflowRef` |
| a9fa1ec | `workflow.ts`、`relations.ts`、多檔推測 |
| dfe2feb | `query-trace` 綁定 `generic-forms`（D26） |
| 4025278 | 五步驟介面 |
| （本 commit） | DESIGN.md 與本 thread |

## 驗證

- typecheck、build 通過；測試 41 passed、1 skipped（身分授權「未涵蓋」，沿用）。
- A20–A23、D19、D22、D25、D27 各有單元測試或介面測試；突變檢查：拿掉 isKey 條件、拿掉型別比對，對應測試皆失敗。
- Chrome（1920 寬，dev server 5173）以模擬 CSV 實測：兩步驟各上傳表單、壞檔逐檔列出、候選確認、型別不符被拒並指出兩端欄位、追溯檢視顯示步驟與職務、建議加入後「查詢追溯」與「通用表格管理」皆勾選；攔截下載（未寫入磁碟）確認 `workflowRef.sha256` 與流程規格位元組相符、不含樣本值；console 無錯誤。
- 720×450 同源 iframe（200% 等效）：五頁皆單欄、無水平溢出、可見互動元件高度皆不小於 44px。
- 實測中發現並修正：候選清單的「確認」按鈕被擠成直排（補 `.check-list` 版面規則）。

## 未涵蓋與已知限制

- 表單與流程只存在本次工作階段；重新整理後需匯入流程規格。
- 執行期追溯（產出系統依任意共用欄位查詢）不在範圍（D16、D24）。
- 設定交付包壓縮檔未做（D28）。
- 瀏覽器實測以 JS 驅動原生事件，未以實體鍵盤逐一操作。

# Closure

2026-09-30：user 同意合併；以 `--no-ff` 合併至 main（3e50de4），合併後 build 通過、測試 41 passed、1 skipped。

# Open Questions

- 論文實驗是否需要非批號共用欄位的執行期追溯（D24 缺口）。
