---
kitId: mod-subscription-kit
kitVersion: c4b2b7b-ui.1
role: developer
status: draft
sources:
  - kits/mod-subscription-kit/kit.contract.json
  - kits/mod-subscription-kit/manifest.json
  - kits/mod-subscription-kit/src/backend/app/api/routes_mod_subscription.py
  - kits/mod-subscription-kit/src/backend/app/services/mod_subscription.py
  - kits/mod-subscription-kit/src/backend/app/models/mod_subscription.py
---

## 用途

### 契約宣告
subscriptions.manage：GET /api/mod-subscription，尚未提供可核對實作；另宣告 db.subscriptions，consumes.db 為 db.tenants.read。

目前路由前綴為 /api/mod，實作 POST /subscriptions/sync、POST /subscriptions/webhook、GET /subscriptions/{external_subscription_id} 及其 /entitlements。

## 前置條件

模型 ModSubscription 以 tenant_id 與 external_subscription_id 組合唯一；ModSubscriptionEvent 保存同步與通知事件。同步服務使用 httpx，逾時 10 秒。

## 可設定項目

原始碼讀取 MOD_API_BASE_URL、MOD_API_KEY、MOD_WEBHOOK_SECRET，manifest 未宣告。_PLAN_ENTITLEMENTS 內嵌 basic、standard、enterprise 對應；外部調整介面尚未提供。

## 操作步驟

同步呼叫外部 /subscriptions/{id} 並新增或更新本機訂閱。webhook 以外部識別查找現有訂閱，不帶 tenant 條件；模型只保證租戶內唯一，多租戶同外部識別的處理尚未提供。通知 event 僅記錄，狀態與方案取自 payload。

## 輸入輸出

SyncRequest 含 external_subscription_id；WebhookPayload 含 event、可選 plan_code／status。回應含外部識別、方案、狀態、到期與同步時間。get_entitlements 只檢查 status 是否為 active，不比較 expires_at。

## 常見錯誤與復原

未設定服務位址回傳 503；有設定通知密鑰但不符回傳 401；訂閱不存在回傳 404。未設定通知密鑰時不做該項核對。契約路徑、通知識別範圍及到期判斷待整理；專用測試與復原程序尚未提供。

