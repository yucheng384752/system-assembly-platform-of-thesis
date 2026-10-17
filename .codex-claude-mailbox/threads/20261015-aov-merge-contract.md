---
id: "20261015-aov-merge-contract"
title: "三代 AOV 合併：整合包契約與格式轉接（M02、M04）"
status: "waiting_for_user"
owner: "user"
reviewer: "claude"
priority: "normal"
created_by: "claude"
created_at: "2026-10-15"
updated_at: "2026-10-15"
role_priority:
  implementation: "codex (WP2、WP3) / claude (WP1、審閱、git)"
  review: "claude"
  tests: "codex / claude"
  requirements: "user"
artifacts:
  - path: "docs/aov-three-generation-merge-plan.md"
    type: "file"
  - path: "docs/decision-log.md"
    type: "file"
---

# Goal

依 `docs/aov-three-generation-merge-plan.md` 第 10 至 13 節，先完成合併的資料契約與 B 側格式轉接：M02 整合包 schema 與驗證、M04 舊格式升級與遷移報告。不碰 C（aov-project）、不新增依賴、不做模擬與組裝。成果標示為「設定與模擬整合」的前置，不宣稱任何可執行能力。分支建議 `feature/aov-merge-contract`，由 Claude 建立。

# 開工條件（未滿足前 Codex 不得開始）

1. 計畫書第 12 節第 1、2、4、5、6 項已決議（D95–D97），本條件已滿足。
2. 已滿足（2026-10-15）：盤點報告 `docs/aov-merge-inventory.md` 與去識別化 fixtures `fixtures/aov-merge/` 已完成。
3. 計畫書第 10 節契約草案經 user 核定。

# Claude Notes

## WP1（Claude，2026-10-15 完成）

- 成果：`docs/aov-merge-inventory.md`（格式與版本對照、8 項發現、去識別化處理）、`fixtures/aov-merge/`（a／b／c 共 18 份）。B 與 C 的樣本已用真實驗證器驗過；A 的 1.0 樣本與 C 的動作庫樣本未經機器驗證，報告中已標明。
- M03 已完成（D98）：C 新增 `checkProjectShape`／`checkLibraryShape`，`validateProject` 不再因結構錯誤丟例外；`npm.cmd run check` 通過。Codex 的 M02 驗證可參考其錯誤形式（診斷含 code `S0-shape`、位置前綴）。
- 開工條件 3（第 10 節契約定稿）：待 user 核定，見計畫書第 10 節。
- 原計畫：

- 盤點 A、C、D 的格式、版本與樣本；C 的 id 規則；A 舊格式辨識特徵。
- 產出去識別化 fixtures（M01 安全基準：不含真實製造資料與秘密值），每種來源格式至少：合法一份、未知版本一份、結構損壞一份。
- 將決議寫入 decision-log，核定後把第 10 節定稿。

## 派工給 Codex

**預計完成時間：WP2 為開工後次日 12:00（約 4 小時）；WP3 為 WP2 完成後次日 18:00（約 6 小時）。** 以計畫書第 13 節日期為準，起算點為開工條件全部滿足當日。到期未完成由 Claude 接手。Codex 只寫程式與資料，不執行 git、不連網、不啟動伺服器；cwd 必須是專案根目錄。

### WP2 整合包 schema 與驗證（先做）

1. 新增 `schemas/aov-bundle.schema.json`，依計畫書 10.1，draft 2020-12，沿用既有 schema 的風格（`additionalProperties: false`、id 與長度限制）。
2. 新增驗證入口於 `libs/aov-integration/`（新目錄；沿用 `libs/ui-runtime/schema.ts` 的 Ajv 用法，不新增依賴）：輸入為未信任文字，輸出為通過的候選物件或逐項錯誤；通過前不得改動任何工作階段狀態（沿用 Recipe 先驗證候選再替換的模式）。
3. 測試（意圖要寫進測試名稱）：
   - 正常包往返相等。
   - 缺欄位、重複 ID、未知 format、未知 version、壞 checksum、缺依賴、同 id 不同版本，各自拒絕且錯誤訊息指出位置。
   - manifest 含絕對路徑、`..` 或不安全檔名時拒絕。
   - 內容含 `secret_ref` 以外的疑似秘密值欄位（連線字串、密碼）時拒絕。
   - 失敗時傳入的目前草稿物件與呼叫前深度相等。

### WP3 B 側格式轉接與遷移報告

1. 轉接模組位於 `libs/aov-integration/`，不修改 `workflowGraph.ts` 既有升級路徑（version 1 至 5）；只在其上呼叫。
2. 依 fixtures 辨識來源格式：B 的 `composer-aov-list`（看 format 與 version，不只看數字）、A 的舊格式、C 的專案檔與動作庫（看 `formatVersion` 與 `kind`）。無法辨識或版本未知：拒絕並回報原因，不嘗試轉換。
3. 遷移報告：每項損失列來源位置、內容摘要與建議處理；`return` 邊、附件、外部引用、自由文字、多表單資料不得靜默遺失；無法轉換者保留原件並列為人工遷移項目。
4. 表單欄位型別映射依計畫書 10.3；缺單位、缺 subject 時標示並阻擋產生 FormDef，不補預設值。
5. 測試：每種來源各一份代表樣本；有損轉換必有報告項目；報告在無損時仍存在且為空；同一輸入重複轉換結果相同（決定性）。

### 停止條件

需要新增依賴、修改 `schemas/` 內既有檔案、修改 C 或 A 或 D 的任何檔案、第 10 節契約與 fixtures 不一致、必須猜測格式語意時，停止並在 Codex Notes 寫下問題，不自行變通。既有測試意圖不得改動；`security.test.mjs` 的 EPERM 為已知沙箱問題，需如實回報而不遮蔽。每個工作包完成後記錄：做了什麼、變更檔案、測試結果（含略過與失敗項目）、未解決的事。

### 驗證指令

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`（WP3 完成後）

## Codex Notes

（Codex 在此續寫）

# Open Questions

- 第 1、2、4、5、6 項已決定（D95–D97）；第 3 項（M05 引用 C core 的方式）不影響本 thread，但需決議後才能排 M06 以後。
