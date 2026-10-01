---
kitId: query-traceability-kit
kitVersion: c4b2b7b-ui.1
role: developer
status: draft
sources:
  - kits/query-traceability-kit/kit.contract.json
  - kits/query-traceability-kit/src/backend/app/api/routes_query_v2.py
  - kits/query-traceability-kit/src/frontend/src/pages/QueryPage.tsx
---

## 用途

目前 routes_query_v2.py 實作 /lot/{lot_no} 與 /trace/{lot_no}，QueryPage 呼叫 /api/v2/query 下的對應路徑。

### 契約宣告
query.records.search：GET /api/v2/query/records，尚未提供可核對實作。consumes.db 宣告 db.records.search 與 db.forms.list；目前路由直接查詢模型，不透過這兩個 capability。

## 前置條件

路由依賴 get_current_tenant、get_db、Station、StationLink、GenericRecord 與 normalize_lot_no。完整組裝啟動程序尚未提供。

## 可設定項目

trace_lot 的 flow_code 預設 default；MAX_TRACE_DEPTH 為 5。關聯以 link_config.flowCodes 篩選，但紀錄比對依 lot_no_raw 或 lot_no_norm，不使用 keyMappings。

## 操作步驟

GET /api/v2/query/lot/{lot_no} 查詢同批號紀錄；GET /api/v2/query/trace/{lot_no} 組出 nodes／edges。遞迴以路徑集合避免循環，節點識別為站點與紀錄組合，同一節點只輸出一次。

## 輸入輸出

一般查詢回傳 station_code、station_name、records；紀錄含 id、lot_no_raw、data、created_at。追溯回傳 nodes 與 edges，無紀錄時兩者皆空。

## 常見錯誤與復原

批號正規化失敗時保留原值比對；循環關聯仍會有限度遍歷。QueryPage 對非成功回應顯示 detail 或 HTTP 狀態。/records 宣告與現行路由整合、非批號映射及專用測試程序尚未提供。

