---
kitId: station-data-link-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/form-analysis.kit-manifest.json
  - kits/station-data-link-kit/manifest.json
  - kits/station-data-link-kit/kit.contract.json
  - kits/generic-forms-kit/src/frontend/src/pages/DataflowPage.tsx
---

## 用途

儲存兩張表單之間以欄位串聯的資料流連結，供「資料查詢」追溯使用。畫面「資料流管理」由通用表單功能提供。

## 前置條件

相依系統基本功能與入口權限。至少兩張表單才能建立連結。

### 進階
manifest 要求 Python，安裝順序為 30。

## 可設定項目

manifest 的執行環境變數清單為空，沒有需要設定的項目。連結以資料流名稱、上游表單代號與下游表單代號識別。

## 操作步驟

驗收時建立兩張表單與一條連結：在「資料流管理」新增（上游表單、下游表單、兩邊的欄位），清單應出現「欄位A → 欄位B」；再用連結查詢介面核對。

## 輸入輸出

連結的新增、列出（可依資料流名稱篩選）與刪除走 /api/dataflows/links；資料流名稱留空時使用 default。

## 常見錯誤與復原

- 下拉清單為空：尚未建立表單。
- 新增成功沒有提示，以清單出現新列為準。
- 本次沒有驗證欄位名稱不存在時的行為，也沒有驗證刪除表單後連結的去向。
