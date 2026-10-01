---
kitId: generic-forms-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/generic-forms-kit/manifest.json
  - kits/form-analysis.kit-manifest.json
  - kits/generic-forms-kit/src/frontend/src/pages/FormsPage.tsx
  - kits/generic-forms-kit/src/backend/app/api/routes_generic_forms.py
---

## 用途

維護表單欄位、來源欄名對應與資料匯入；修改欄位定義會建立新版本並停用舊版本。

## 前置條件

基線相依為系統基本功能、舊入口權限功能及站點資料串聯；需有可用編輯原因。

### 進階
manifest 要求 python，安裝順序為 55。

## 可設定項目

欄位名稱、來源欄名、型別、必填與識別鍵可調整。來源欄名留空表示與欄位名稱相同；更動會影響後續匯入。

### 進階
雖然 manifest.runtimeEnv 為空，原始碼讀取 GENERIC_FORMS_ASYNC_THRESHOLD_MB，預設 1，格式錯誤回退至 1048576 bytes。此值用於分段匯入介面，不是畫面直接上傳的限制。

## 操作步驟

在欄位定義頁新增或修改欄位，選擇編輯原因後儲存。確認來源欄名沒有遺失。上傳後核對成功、跳過與錯誤數量；完整部署驗收程序尚未提供。

## 輸入輸出

欄位定義包含型別與來源對應，匯入回傳統計。刪除表單時會刪除其一般紀錄、欄位版本及站點關聯。

## 常見錯誤與復原

沒有編輯原因時先由管理者建立可用原因；重複欄名與缺少識別鍵在畫面會被提示。背景匯入工作狀態只放記憶體，不保證重啟後可查；日誌位置與還原程序尚未提供。

