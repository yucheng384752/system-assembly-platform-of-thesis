---
kitId: logs-ops-kit
kitVersion: c4b2b7b-ui.1
role: developer
status: draft
sources:
  - kits/logs-ops-kit/kit.contract.json
  - kits/form-analysis.kit-manifest.json
  - kits/logs-ops-kit/src/backend/app/api/routes_logs.py
  - kits/logs-ops-kit/src/backend/app/core/monitoring.py
  - kits/logs-ops-kit/src/backend/app/core/log_client.py
  - kits/logs-ops-kit/src/frontend/src/pages/DeveloperLogsPage.tsx
---

## 用途

### 契約宣告
logs.list：GET /api/logs；consumes 與 provides.db 皆空。現有前端使用 /api/logs/，路由另實作 /summary。

manifest 宣告清理與下載子功能，目前尚未提供可核對實作。

## 前置條件

路由依賴 get_current_tenant 與 get_db，直接查詢 system_logs。monitoring 以背景執行緒及有界佇列寫入本機，取代平台的空操作介面。

## 可設定項目

list_logs 支援 log_type、level、action、since、until、limit（1 至 500，預設 50）、offset。遠端 heartbeat 為明確提供 server_url 後才啟用；log_client 的 HTTP 逾時為 5 秒。

## 操作步驟

以 report_user_action 傳入 action、state、describe 及 metadata；tenant_id 會抽出保存為獨立欄位。make_structlog_processor 預設保存 WARNING 以上事件。start_heartbeat 不會轉送使用者事件。

## 輸入輸出

日誌 API 回傳 total、offset、limit、items；summary 回傳 since 與類型／層級筆數。LogCollectClient.send_heartbeat 回傳成功布林值，不拋出 HTTPError。

## 常見錯誤與復原

metadata 解析失敗時回傳空物件；本機佇列滿會丟棄事件，寫入錯誤不阻擋呼叫方。未歸屬租戶的事件無法經此 API 取得；來源沒有清理／下載路由。擴充需維持平台 monitoring 呼叫介面；正式復原程序尚未提供。

