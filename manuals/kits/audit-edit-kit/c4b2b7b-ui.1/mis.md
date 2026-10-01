---
kitId: audit-edit-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/audit-edit-kit/manifest.json
  - kits/form-analysis.kit-manifest.json
  - kits/audit-edit-kit/src/frontend/src/pages/EditReasonsPage.tsx
  - kits/audit-edit-kit/src/backend/app/api/routes_edit.py
  - kits/audit-edit-kit/src/backend/app/api/routes_audit_events.py
  - kits/audit-edit-kit/src/backend/app/services/audit_events.py
---

## 用途

維護編輯原因並查核資料修正。一般稽核事件的寫入採盡力保存，失敗不會阻擋呼叫方。

## 前置條件

基線相依為系統基本功能、舊入口權限功能及站點資料串聯；原因新增與修改在現有路由需管理者資格，稽核事件查詢需系統管理者資格。此為基線路由檢查，不能視為 Composer 已接上身分驗證。

### 進階
manifest 要求 python，安裝順序為 85。

## 可設定項目

原因可設定代碼、標籤及是否啟用。既有原因只能改標籤及啟用狀態；停用後不再可作新修正的原因。

## 操作步驟

在「編輯原因管理」輸入代碼與標籤後建立；修改既有原因的標籤或啟用狀態後按「儲存」。必要時按「重新整理」核對結果。

## 輸入輸出

原因清單含代碼、標籤、啟用狀態與建立時間。稽核事件可依租戶、動作與時間範圍查詢。

## 常見錯誤與復原

重複原因代碼、空白標籤或權限不足會被拒絕。一般事件寫入可能失敗而不回報呼叫方，不能僅憑操作成功認定事件已保存。日誌位置及修正復原程序尚未提供。

