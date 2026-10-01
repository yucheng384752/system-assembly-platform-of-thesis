---
kitId: upload-validation-kit
kitVersion: c4b2b7b-ui.1
role: developer
status: draft
sources:
  - kits/upload-validation-kit/kit.contract.json
  - kits/upload-validation-kit/manifest.json
  - kits/form-analysis.kit-manifest.json
---

## 用途

### 契約宣告
upload.file.create：POST /api/upload；upload.status.get：GET /api/upload/{process_id}/status；upload.pdf.status：GET /api/upload/pdf/{process_id}/convert/status；upload.pdf.convert：POST /api/upload/pdf/{process_id}/convert；upload.pdf.outputs：GET /api/upload/pdf/{process_id}/convert/outputs。另宣告 db.upload.jobs.list。

上述 API 與資料 capability 尚未提供可核對實作。

## 前置條件

consumes.api 為 import.job.create，consumes.db 為 db.tenants.read。manifest 要求 python；所需套件版本尚未提供。

## 可設定項目

manifest.runtimeEnv 宣告 VALID_MATERIALS_CSV 與 VALID_SLITTING_MACHINES_CSV；讀取與驗證邏輯尚未提供。

## 操作步驟

本 Kit 的 src 僅有上傳頁樣式；manifest 列出的上傳路由、服務與頁面尚未提供可核對實作，無法給出可執行呼叫流程。

## 輸入輸出

契約列出 capability 與路徑，但請求模型、回應模型與資料結構尚未提供。

## 常見錯誤與復原

錯誤處理、擴充點的執行驗證與專用測試程序尚未提供。

