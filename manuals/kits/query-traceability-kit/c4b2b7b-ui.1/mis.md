---
kitId: query-traceability-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/query-traceability-kit/manifest.json
  - kits/form-analysis.kit-manifest.json
  - kits/query-traceability-kit/src/backend/app/api/routes_query_v2.py
  - kits/query-traceability-kit/src/frontend/src/pages/QueryPage.tsx
---

## 用途

目前畫面使用批號查詢與追溯介面；追溯結果由站點關聯與同批號紀錄組成。

## 前置條件

基線清單依賴系統基本功能、舊入口權限功能與站點資料串聯。

### 進階
manifest 要求 python，安裝順序為 60；路由需目前租戶與資料庫工作階段。

## 可設定項目

manifest 未宣告環境變數。後端追溯可指定流程代碼，畫面尚未提供此選項。

### 進階
flow_code 預設 default，依 link_config.flowCodes 篩選關聯；MAX_TRACE_DEPTH 為 5，沒有外部設定介面。

## 操作步驟

用批號查詢確認紀錄存在，再切換追溯路徑查閱站點間的連結。後端以批號原值或正規化值比對，並未讀取關聯欄位對應。

## 輸入輸出

畫面輸入批號，顯示站點紀錄與追溯關係；無紀錄回傳空結果。查詢只取目前租戶的站點與紀錄。

## 常見錯誤與復原

畫面顯示服務回傳的錯誤。非批號欄位的追溯對應、日誌位置與資料修復程序尚未提供。

