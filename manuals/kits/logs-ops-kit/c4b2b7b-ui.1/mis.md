---
kitId: logs-ops-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/logs-ops-kit/manifest.json
  - kits/form-analysis.kit-manifest.json
  - kits/logs-ops-kit/src/backend/app/api/routes_logs.py
  - kits/logs-ops-kit/src/backend/app/core/monitoring.py
  - kits/logs-ops-kit/src/backend/app/core/log_client.py
---

## 用途

本機保存操作與警告以上的事件，另提供選配遠端存活回報；操作事件與警告不轉送遠端。

## 前置條件

基線相依為系統基本功能及舊入口權限功能。

### 進階
manifest 要求 python，安裝順序為 90；本機寫入使用 system_logs。

## 可設定項目

未提供遠端位址時不建立存活回報客戶端。預設回報間隔 30 秒，最低 1 秒；畫面設定入口尚未提供。

### 進階
由 init_monitoring(server_url, source) 與 start_heartbeat(interval_seconds) 設定；manifest.runtimeEnv 為空。

## 操作步驟

先核對本機初始化成功，再查詢所屬租戶的事件。沒有租戶歸屬的平台啟動與存活事件不會由查詢介面顯示。

## 輸入輸出

查詢支援時間、動作及層級條件；摘要統計最近 24 小時的類型與層級。遠端存活回報只含來源、主機名稱、狀態及時間。

## 常見錯誤與復原

佇列最多 2000 筆，滿載會丟棄新事件；寫入失敗只記除錯訊息。遠端回報逾時為 5 秒，失敗記警告。清理、下載及遺失日誌復原程序尚未提供。

