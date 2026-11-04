---
kitId: logs-ops-kit
kitVersion: c4b2b7b-ui.1
role: user
status: draft
sources:
  - kits/logs-ops-kit/src/frontend/src/pages/DeveloperLogsPage.tsx
  - kits/logs-ops-kit/src/backend/app/api/routes_logs.py
  - kits/logs-ops-kit/src/backend/app/core/monitoring.py
---

## 用途

在「日誌」頁查閱目前租戶的運作紀錄，依類型、層級與動作篩選，協助維護人員排查問題。

## 前置條件

須能取得目前租戶的紀錄。未標示租戶的平台事件不會出現在此查詢結果。

## 可設定項目

類型（user_action、system_error、system_warning、system）、層級（INFO、WARNING、ERROR、CRITICAL）、動作關鍵字，以及「Auto-refresh (10s)」自動重新整理。

## 操作步驟

1. 開啟「日誌」。頁首顯示紀錄筆數，例如「0 entries」。
2. 選擇類型與層級，輸入動作關鍵字，按「Search」。按「Clear」清除條件。
3. 以上一頁與下一頁查看其他紀錄，每頁 50 筆。
4. 需要持續更新時勾選「Auto-refresh (10s)」。

## 輸入輸出

結果列出 Timestamp、Type、Level、Action、State、Description。沒有符合的紀錄時顯示「No logs found」。

## 常見錯誤與復原

- 本頁目前的介面文字是英文，不會隨語言切換變成中文。
- 日誌不是所有操作的稽核紀錄：實測在登入、「檔案上傳」預覽與匯入、「通用表格」編輯之後，日誌頁仍是 0 筆。只有程式明確回報的使用者動作與警告以上的系統事件才會寫入，所以全新且運作正常的系統沒有紀錄是正常現象。需要追蹤紀錄修改的人與原因時，請看編輯時另存的修改紀錄（見「稽核與修正」），而不是日誌。
- 查詢失敗會顯示錯誤訊息，可調整條件後再次搜尋。清理、下載與復原操作尚未提供可核對實作。
