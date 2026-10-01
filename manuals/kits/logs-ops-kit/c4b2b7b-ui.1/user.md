---
kitId: logs-ops-kit
kitVersion: c4b2b7b-ui.1
role: user
status: draft
sources:
  - kits/logs-ops-kit/src/frontend/src/pages/DeveloperLogsPage.tsx
  - kits/logs-ops-kit/src/backend/app/api/routes_logs.py
---

## 用途

查閱目前租戶的運作紀錄，依類型、層級與動作篩選。

## 前置條件

須能取得目前租戶的紀錄。未標示租戶的平台事件不會出現在此查詢結果。

## 可設定項目

可調整類型、層級及動作關鍵字；可開啟每 10 秒自動重新整理。

## 操作步驟

1. 在運作日誌畫面選擇類型與層級，輸入動作關鍵字。
2. 按搜尋按鈕查看結果；可清除條件重新查詢。
3. 使用上一頁與下一頁查看其他紀錄，每頁 50 筆。
4. 需要持續更新時開啟自動重新整理。

## 輸入輸出

結果列出時間、類型、層級、動作、狀態與說明。查無結果時顯示無日誌提示。

## 常見錯誤與復原

查詢失敗會顯示錯誤訊息，可調整條件後再次搜尋。清理、下載與復原操作尚未提供可核對實作。

