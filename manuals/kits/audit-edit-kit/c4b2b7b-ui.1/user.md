---
kitId: audit-edit-kit
kitVersion: c4b2b7b-ui.1
role: user
status: draft
sources:
  - kits/audit-edit-kit/src/frontend/src/components/EditRecordModal.tsx
  - kits/audit-edit-kit/src/backend/app/api/routes_edit.py
---

## 用途

修正紀錄時選擇編輯原因，保存修改前後的差異。

## 前置條件

需要已有紀錄、欄位定義與至少一個啟用中的編輯原因。沒有原因時，畫面提示先由管理者建立。

## 可設定項目

依紀錄欄位型別填入新值，並選擇編輯原因；必填值不可留空。

## 操作步驟

1. 在「編輯紀錄」視窗修改欄位。
2. 選擇編輯原因。
3. 有實際變更且必填值完整時，按「儲存」。
4. 成功後顯示「紀錄已更新」並關閉視窗；尚未儲存時可按「取消」。

## 輸入輸出

輸入變更欄位與編輯原因；成功後更新紀錄並保留前後差異。

## 常見錯誤與復原

沒有原因、沒有變更或必填值缺漏時不能儲存。失敗訊息顯示於視窗中；原因失效時需重新選用可用原因。已儲存變更的自動復原尚未提供。

