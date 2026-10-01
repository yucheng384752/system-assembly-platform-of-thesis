---
kitId: mod-subscription-kit
kitVersion: c4b2b7b-ui.1
role: mis
status: draft
sources:
  - kits/mod-subscription-kit/manifest.json
  - kits/form-analysis.kit-manifest.json
  - kits/mod-subscription-kit/src/backend/app/api/routes_mod_subscription.py
  - kits/mod-subscription-kit/src/backend/app/services/mod_subscription.py
---

## 用途

同步外部訂閱狀態並保存同步、通知事件。原始碼提供服務介面，管理畫面尚未提供。

## 前置條件

基線相依為系統基本功能及舊入口權限功能。

### 進階
manifest 要求 python，安裝順序為 95。同步前需要 MOD_API_BASE_URL。

## 可設定項目

### 進階
原始碼讀取 MOD_API_BASE_URL、MOD_API_KEY、MOD_WEBHOOK_SECRET，但 manifest.runtimeEnv 為空。秘密值由外部環境提供，本手冊不包含值。通知密鑰未設定時，現有路由不檢查該標頭；不得視為已驗證通知來源。

## 操作步驟

核對外部訂閱識別後執行同步，再查詢狀態與權益。通知只更新已存在訂閱；完整部署與維護工具操作尚未提供。

## 輸入輸出

同步取得方案、狀態與到期時間，保存原始回應及同步事件；通知更新方案、狀態與同步時間，不更新到期時間。

## 常見錯誤與復原

外部服務位址未設定時無法同步；訂閱不存在時無法套用通知。權益查詢只判斷啟用狀態與方案，未以到期時間自行判斷失效。日誌位置、補償與復原程序尚未提供。

