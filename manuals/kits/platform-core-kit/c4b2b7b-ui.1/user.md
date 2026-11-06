---
kitId: platform-core-kit
kitVersion: c4b2b7b-ui.1
role: user
status: draft
sources:
  - kits/form-analysis.kit-manifest.json
  - kits/platform-core-kit/manifest.json
  - kits/platform-core-kit/kit.contract.json
  - kits/platform-core-kit/src/backend/app/core/kit_broker.py
  - kits/platform-core-kit/src/backend/app/api/routes_kit_broker.py
  - kits/platform-core-kit/src/backend/app/core/license.py
  - services/frontend/base/src/main.tsx
  - services/frontend/base/src/locales/zh-TW/common.json
---

## 用途

提供系統共用的外框：標題、分頁列、語言與字體大小切換、登出，以及其他功能共用的啟動與健康檢查。它本身沒有業務作業頁面。

## 前置條件

系統已安裝並通過授權檢查。授權過期或與安裝的機器不符時授權檢查會失敗；請聯絡提供授權的人員。

## 可設定項目

畫面上方有「語言」切換（繁體中文、英文）與「字體大小」下拉（小、中、大）。分頁列會依所選功能顯示，例如同時選用通用表格、查詢與分析時，會有「資料分析」「編輯原因管理」「通用表格」「資料流管理」「日誌」「資料查詢」「檔案上傳」七個分頁。

## 操作步驟

1. 登入後從分頁列選擇要用的功能。
2. 需要英文介面時按「英文（English）」，需要放大字體時改選「大」。
3. 結束時按右上角「登出」。

## 輸入輸出

本功能沒有自己的輸入與結果畫面；它提供其他功能共用的外框。

## 常見錯誤與復原

- 切換語言後，個別頁面可能仍是原語言；例如「日誌」頁目前只有英文。
- 看不到某個分頁，表示該功能沒有被選入這個系統，需要時請聯絡管理人員重新產出系統。
- 系統無法開啟或一直無回應時，請通知管理人員檢查服務與授權狀態；一般使用者沒有自行復原的操作。
