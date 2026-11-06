---
kitId: upload-validation-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/upload-validation-kit/manifest.json
  - kits/upload-validation-kit/kit.contract.json
  - kits/upload-validation-kit/src/backend/app/api/routes_upload.py
  - kits/generic-forms-kit/src/backend/app/api/routes_generic_forms.py
  - kits/form-analysis.kit-manifest.json
  - services/frontend/base/src/pages/UploadPage.tsx
---

## 用途

「檔案上傳」頁的後端：先預覽 CSV 檢查結果，再確認寫入。預覽與匯入實際走通用表單的介面，所以本功能需要「通用表單」，後者又需要「稽核與修正」；這兩項相依已在 Kit 目錄宣告，只選必要功能即可組出系統包並安裝。

## 前置條件

相依系統基本功能與入口權限。使用者至少要能讀取表單並匯入資料。使用者要有表單與欄位定義才能上傳。

### 進階
manifest 要求 python，安裝順序為 40。

## 可設定項目

沒有必須設定的項目。

### 進階
宣告環境設定 VALID_MATERIALS_CSV、VALID_SLITTING_MACHINES_CSV；本次沒有驗證它們的作用，允許值與預設值尚未提供。

## 操作步驟

驗收時用一個含三列的小 CSV（一列正常、一列型別錯誤、一列正常）：預覽應顯示「可匯入 2 筆、有錯誤 1 筆」並列出可匯入的兩列；匯入後頁面顯示「新增 2 筆」；再預覽同一檔案應顯示「重複 2 筆、可匯入 0 筆」。實測上述結果完全符合。

## 輸入輸出

預覽為 POST /api/forms/{代號}/import/preview，匯入為 POST /api/forms/{代號}/import/commit。預覽只回傳摘要、錯誤列與最多 10 列可匯入資料，不寫入。

### 進階
consumes 宣告 import.job.create 與 db.tenants.read。

## 常見錯誤與復原

- 只有欄名沒有資料列的檔案：預覽回 0 筆且沒有訊息；真正的二進位檔會回 422。
- 型別錯誤訊息使用「整數、數值、是否、日期」，不是型別代碼。
- 這些匯入不會出現在「資料分析」的「上傳紀錄」清單。
- 日誌位置與整批復原尚未提供。
