---
kitId: upload-validation-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/upload-validation-kit/manifest.json
  - kits/upload-validation-kit/kit.contract.json
  - kits/form-analysis.kit-manifest.json
---

## 用途

契約宣告上傳工作、狀態查詢與轉換結果取得；這些介面的可核對實作尚未提供。

## 前置條件

基線清單依賴系統基本功能與舊入口權限功能。完整安裝程序尚未提供。

### 進階
manifest 要求 python，安裝順序為 40。

## 可設定項目

### 進階
宣告環境設定 VALID_MATERIALS_CSV、VALID_SLITTING_MACHINES_CSV；允許值、預設值與風險分級尚未提供。

## 操作步驟

上傳服務的啟用、連線測試及重新驗證程序尚未提供。

## 輸入輸出

契約宣告上傳工作狀態與轉換產物查詢；輸入格式及回傳欄位尚未提供。

### 進階
consumes 宣告 import.job.create 與 db.tenants.read。

## 常見錯誤與復原

可核對的日誌位置、錯誤碼與復原步驟尚未提供。

