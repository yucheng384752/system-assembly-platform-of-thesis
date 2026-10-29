---
kitId: factory-core-kit
kitVersion: 0.1.0
role: developer
status: draft
sources:
  - kits/factory-core-kit/kit.contract.json
  - kits/factory-core-kit/src/backend/app/api/routes_factory.py
---

## 用途

實作 docs/executable-plan-contract.md 的工廠端：計畫接收與驗證、參數集服務、工單鎖定、警報與暫停狀態、SQL 儲存與 15 條路由（含表單登錄）。

## 前置條件

來源在 services/factory，本 Kit 的後端是由 services/factory/tools/sync_kit.py 產生的副本；請改來源並重新同步，不要直接改 Kit 內的副本。測試會檢查兩者一致。

## 可設定項目

kit.contract.json 宣告 8 個入口與其路由；新增路由必須同時宣告入口，套件測試會逐條比對。

## 操作步驟

路由只信入口權限中介層設定的使用者與角色，沒有時回 401；身分與時間不取自請求本文。資料表定義見 services/factory/docs/data-model.md。

## 輸入輸出

計畫以原始文字讀入（上限 8 MiB），維持與 planId 相同的數字讀法。錯誤以 {errors:[{code,path,message}]} 回傳。

## 常見錯誤與復原

工廠核心不求值運算式，所以含 guard 或判定節點的計畫不能建立工單。表單以內容雜湊為鍵登錄，建單時檢查計畫指名的每一份都已登錄。警報由已求值的呼叫端觸發。
