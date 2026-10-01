---
kitId: generic-forms-kit
kitVersion: c4b2b7b-ui.1
role: developer
status: draft
sources:
  - kits/generic-forms-kit/kit.contract.json
  - kits/generic-forms-kit/manifest.json
  - kits/generic-forms-kit/src/backend/app/models/station.py
  - kits/generic-forms-kit/src/backend/app/api/routes_generic_forms.py
  - kits/generic-forms-kit/src/frontend/src/pages/FormsPage.tsx
---

## 用途

### 契約宣告
forms.list：GET /api/forms；forms.records.list：GET /api/forms/{code}/records；另宣告 db.forms.list、db.records.search。API 與現有來源相符；資料 capability 的 adapter 在本 Kit 尚未提供可核對實作。

目前原始碼另實作建立／刪除表單、儲存 schema、上傳、匯入預覽／提交、背景工作查詢及 dataflow links，未全部列於 kit.contract.json。

## 前置條件

consumes.db 宣告 db.tenants.read、db.edit-reasons.validate；set_schema 直接呼叫後者。模型 Station、StationSchema、StationLink 分別保存站點、版本及關聯；路由另引用 GenericRecord。

## 可設定項目

FieldDef 包含 name、type、label、required、is_key、sourceName。SchemaIn 要求 fields 與 reason_id。原始碼另讀 GENERIC_FORMS_ASYNC_THRESHOLD_MB（預設 1），manifest.runtimeEnv 未列出。

## 操作步驟

FormsPage 呼叫 POST /api/forms/{code}/upload。後端另有 /forms/{code}/import/preview、/import/commit 與 /import-jobs/{job_id}；後者工作狀態為單一程序記憶體字典。儲存 schema 保留 sourceName 別名並建立遞增版本。關聯 API 禁止自連及同流程循環。

## 輸入輸出

一般上傳回傳 total、imported、skipped、errors；預覽回傳 preview_rows、duplicate_count、valid_count；提交回傳 error_count 與可選 job_id。紀錄查詢回傳 total、page、page_size、records。

## 常見錯誤與復原

表單不存在回傳 404、重複代號回傳 409、無欄位定義或 CSV 無法解析回傳 422。刪除表單實際執行資料刪除，還原尚未提供；擴充需核對版本與來源欄位對應。專用測試程序尚未提供。

