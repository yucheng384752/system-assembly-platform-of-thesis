---
kitId: platform-core-kit
kitVersion: c4b2b7b-ui.1
role: developer
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

公開 capability 包含 platform.health、kit.contracts.list、kit.capability.call、admin.endpoint-permissions.get／put，以及 db.tables.resolve、db.forms.list、db.records.search。

## 前置條件

manifest 要求 python。契約 consumes.api 與 consumes.db 皆為空；執行 broker 需要 AsyncSession 與請求中的租戶識別。

## 可設定項目

CapabilityCall.payload 為可省略的字典。broker 呼叫資料能力時會排除 payload 的 db 與 tenant_id，避免取代服務傳入的上下文。

## 操作步驟

以 GET /api/kit/contracts 取得契約，再以 POST /api/kit/call/{capability} 傳入 payload。資料能力會呼叫對應 adapter；API 類能力只回傳 method／path 指引，不會由 broker 代為執行。

## 輸入輸出

契約清單回傳 contracts 與 capabilities。資料能力回傳 capability、kind 與 data；API 類能力回傳 kit、method、path 與提示訊息。

## 常見錯誤與復原

未知 capability 回傳 404；缺少 runtime adapter 回傳 501。擴充需提供 adapter；跨 Kit 呼叫應使用公開契約。broker 的專用測試程序尚未提供。

