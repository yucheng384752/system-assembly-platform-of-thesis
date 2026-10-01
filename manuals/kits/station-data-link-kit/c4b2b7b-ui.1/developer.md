---
kitId: station-data-link-kit
kitVersion: c4b2b7b-ui.1
role: developer
status: draft
sources:
  - kits/form-analysis.kit-manifest.json
  - kits/station-data-link-kit/manifest.json
  - kits/station-data-link-kit/kit.contract.json
---

## 用途

provides.db 宣告 db.tables.resolve、db.forms.list、db.records.search、db.records.trend；provides.api 為空。

## 前置條件

consumes.db 為 db.tenants.read。基線套件清單依賴 platform-core-kit 與 tenant-auth-kit；不得將舊權限相依視為已完成替代串接。

## 可設定項目

manifest.runtimeEnv 為空。功能清單有站點模型及相容層宣告；本 Kit 未提供 src，無法由此確認設定的執行行為。

## 操作步驟

契約未提供 API 路由。模型與服務實作、擴充與測試步驟尚未提供；其他 Kit 應依公開 capability 契約接續。

## 輸入輸出

資料 capability 的參數及回傳結構尚未提供。

## 常見錯誤與復原

錯誤碼、復原及測試程序尚未提供。

