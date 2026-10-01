---
kitId: mod-subscription-kit
kitVersion: c4b2b7b-ui.1
role: user
status: draft
sources:
  - kits/mod-subscription-kit/src/backend/app/api/routes_mod_subscription.py
  - kits/mod-subscription-kit/src/backend/app/services/mod_subscription.py
---

## 用途

提供訂閱狀態同步與方案權益查詢；一般使用者的操作畫面尚未提供。

## 前置條件

需有外部訂閱識別及已同步的訂閱資料。建立訂閱帳戶的操作尚未提供。

## 可設定項目

一般使用者可調整的訂閱設定尚未提供。

## 操作步驟

尚未提供可核對的訂閱查詢、續訂或方案變更畫面步驟。

## 輸入輸出

查詢結果包含方案、狀態、到期及同步時間。權益依方案及是否啟用決定；未知方案或未啟用狀態回傳空權益。

## 常見錯誤與復原

找不到訂閱時回報不存在。自助修正、重試與復原程序尚未提供；查到權益清單不代表各功能已完成存取控制。

