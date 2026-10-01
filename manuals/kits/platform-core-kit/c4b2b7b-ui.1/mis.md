---
kitId: platform-core-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/form-analysis.kit-manifest.json
  - kits/platform-core-kit/manifest.json
  - kits/platform-core-kit/kit.contract.json
  - kits/platform-core-kit/src/backend/app/core/kit_broker.py
  - kits/platform-core-kit/src/backend/app/api/routes_kit_broker.py
  - kits/platform-core-kit/src/backend/app/core/license.py
---

## 用途

支援系統啟動、健康檢查及功能介面查詢。

## 前置條件

基線清單沒有宣告相依功能。安裝環境與完整部署流程尚未提供。

### 進階
安裝宣告要求 Python，安裝順序為 10；環境變數清單為空。

## 可設定項目

授權驗證需要組裝時嵌入發行者公鑰；保留佔位值時所有授權都會被拒絕。現場設定程序尚未提供。

## 操作步驟

先核對授權檢查結果。缺少公鑰、授權過期或機器識別不符均不能視為驗證成功；重新發行與安裝授權的維護流程尚未提供。

## 輸入輸出

輸入授權文件，驗證結果含有效狀態、客戶代稱、到期時間與失敗原因。

### 進階
契約宣告健康檢查為 GET /healthz。

## 常見錯誤與復原

授權檢查會回報缺少授權檔、缺少密碼學套件、簽章錯誤、到期或機器識別不符。自動修復與回復舊授權程序尚未提供。

