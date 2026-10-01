---
kitId: import-pipeline-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/import-pipeline-kit/manifest.json
  - kits/form-analysis.kit-manifest.json
  - kits/import-pipeline-kit/src/backend/app/services/dataflow_orchestrator.py
---

## 用途

現有處理在資料步驟完成後維護追溯鏈；完整匯入作業介面尚未提供。

## 前置條件

基線清單依賴系統基本功能、舊入口權限功能及站點資料串聯。

### 進階
manifest 要求 python，安裝順序為 50。

## 可設定項目

manifest 未宣告執行環境變數。現有步驟對應寫在服務內；可由維護介面調整的方式尚未提供。

## 操作步驟

核對步驟是否能找到既有流程；無對應的非起始步驟回傳等待狀態。人工建立對應與重跑流程尚未提供。

## 輸入輸出

輸入已完成步驟的識別資訊及紀錄摘要，輸出完成或等待對應狀態。

### 進階
結果包含 flow_run_id 與 trace_uuid；等待對應時兩者皆為空。

## 常見錯誤與復原

等待對應不等於追溯鏈已建立。日誌位置、回復匯入資料與重新提交程序尚未提供。

