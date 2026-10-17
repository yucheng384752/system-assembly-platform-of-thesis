# 三代 AOV 合併：M01 格式與版本盤點

日期：2026-10-15
對應：`docs/aov-three-generation-merge-plan.md` M01；決議 D95–D97。
性質：盤點報告。A、C、D 只讀取；未修改任何來源專案。

## 1. 格式與版本對照

| 來源 | 辨識特徵 | 版本 | 結構要點 | 驗證權威 |
|---|---|---|---|---|
| B（composer-refactor） | `format: "composer-aov-list"`，數字 `version` | 1 至 5（5 為現行） | 5：factories、graphs、layout、forms、relations；1 至 3 為線性 steps；4 為圖形無工廠 | `schemas/aov.schema.json`、`workflowGraph.ts` 的 `importWorkflow`（升級並回報損失） |
| A（AOV_generation_system） | `format: "aov"`，字串 `schemaVersion` | 1.0（舊，僅升級）、1.1（documentType 為 workflow 或 dataflow）、1.2（workflow，增加 categories、attachments） | graphs／nodes／edges；邊有 `kind: forward / return`；節點有 inputs／outputs 連接埠與 JSON Schema | `src/domain/validate.ts` 的 `decode`；1.0 先 `migrateLegacy` 升為 1.1 dataflow |
| C（aov-project） | 頂層 `formatVersion: 1`；動作庫另有 `kind: "action-library"` | 專案與動作庫皆為 1 | 專案：meta、artifactTypes、params、nodes、flows、layout、settings；邊連 port 且帶 artifact 型別 | `packages/core` 的 `validateProject`（需 formatVersion 為 1） |
| D（form-system-kit-composer） | `integrations/aov-studio` 與 A 同格式 | 同 A | `types.ts`、`documents.ts`、`validate.ts` 與 A 位元組相同；`schema.ts` 僅型別標註與換行不同 | 同 A |

結論：D 內的 AOV 客製橋接沿用 A 的格式，不是獨立的第四種格式。辨識只需 B、A、C 三種，以 `format` 與版本欄位組合判斷，不能只看數字。

## 2. 盤點發現（影響後續設計）

1. **A 的版本標示不一致。** README 寫「JSON 檔案格式仍為 1.1」，但 `public/workflow.schema.json` 的 `$id` 為 `urn:aov:workflow:1.2`，`public/aov.schema.json` 的 `$id` 為 `urn:aov:schema:1.2`，而 `types.ts` 允許 `1.1 | 1.2`。範例檔皆為 1.1。轉接以 `decode` 的實際行為為準：接受 1.0（升級）、1.1、1.2，其餘拒絕。
2. **A 的 `src/domain/schema.ts` 內 1.0 schema 為內部使用**，未輸出到 `public`，無法用公開 schema 驗證 1.0。1.0 fixture 因此標為「未經機器驗證」。
3. **C 的 `validateProject` 對 `nodes` 非陣列直接丟出例外**（`(p.nodes ?? []).map is not a function`），不是回傳錯誤。這證實計畫書 M03 的缺口，D95 授權修改的理由成立。
4. **C 的 `formatVersion` 錯誤由驗證器回報（`S0-format`）而非丟出例外**，但編輯器 `Toolbar.tsx` 與 `store.ts` 另有各自的 `formatVersion` 檢查，檢查分散在三處，且都只看版本號，不檢查結構。
5. **C 沒有 git 紀錄。** 修改前須先備份。
6. **B 的 id 格式為 `^[a-z0-9-]+$`；C 的 id 規則未在驗證器中找到明確的格式限制**，範例使用 `lot.flour`、`src_flour` 等含點與底線的形式。B 到 C 的映射必須保存來源 id，不可假設可直接沿用。
7. **B 的 `importWorkflow` 對未知版本與結構錯誤給出相同訊息**（「流程規格格式不正確」），未區分原因。M04 的遷移報告需要區分「未知版本」與「結構損壞」。
8. **A 的範例含 `return` 邊**，確認第一代 return 需列為人工遷移項目。

## 3. 去識別化處理（M01 安全基準）

- **未複製**：A 的 `public` 下以客戶案例命名的 2 份檔案（workflow 與 dataflow）、C 的 `examples` 下 3 份同一案例的專案檔，以及 C 的 `examples/libraries` 下對應的 2 個版本動作庫。內容疑似來自實際客戶案例，未經確認去識別化前不進 repo；檔名不寫入本文件。
- **已使用**：A 的 `example.*.aov.json`（通用示範）、C 的 `bakery.aov.json`（通用範例）、B 以測試資料風格自行合成的文件、C 動作庫以通用名稱自行合成。
- 待 user 確認：上述被排除的檔案是否確為客戶資料；若為通用資料可再加入。

## 4. Fixtures 清單（`fixtures/aov-merge/`）

| 檔案 | 用途 | 驗證結果 |
|---|---|---|
| b/v1 至 v5 `.valid.json` | 各版本合法樣本 | 以 `importWorkflow` 驗證：全部接受並升為 v5；v1、v4 各有 1 項升級通知 |
| b/v6.unknown-version.json | 未知版本 | `importWorkflow` 拒絕 |
| b/v5.broken-structure.json | graphs 非陣列 | `importWorkflow` 拒絕 |
| a/v1.1.workflow.valid.json、a/v1.1.dataflow.valid.json | A 範例原檔 | 對 A 的 `public` schema 通過 |
| a/v1.2.workflow.derived.json | 由 1.1 workflow 改版本號衍生 | 對 A 的 1.2 schema 通過；衍生樣本，不含 categories／attachments |
| a/v1.0.legacy.valid.json | 由 1.1 dataflow 去除 1.1 欄位衍生 | **未經機器驗證**（見發現 2） |
| a/v9.9.unknown-version.json、a/v1.1.broken-structure.json | 未知版本、結構損壞 | 對所有 A schema 皆不通過 |
| c/project.valid.json | C 通用範例原檔 | `validateProject` 回傳 ok（含 R2-terminate 提示） |
| c/project.unknown-formatVersion.json | formatVersion 為 2 | `validateProject` 回傳 ok 為 false，S0-format |
| c/project.broken-nodes.json | nodes 非陣列 | M03 前 `validateProject` 丟出例外（發現 3）；M03 後回傳 `S0-shape` 錯誤 |
| c/library.valid.json、c/library.broken-actions.json | 動作庫合法與損壞 | 以 M03 新增的 `checkLibraryShape` 驗證：合法通過、損壞被拒絕 |

## 5. 未完成與限制

- 本報告為靜態盤點加上述驗證，未重跑 A、C 的全套測試，未驗證第一代 1.0 樣本。
- C 的 id 規則仍未盤點到明確格式限制；M03 的結構檢查只要求 id 為非空字串，不限制字元。
- A 與 C 的 fixtures 為衍生或精簡樣本，不代表使用者真實檔案的全部變化；遷移報告測試（M04）應另請使用者提供實際舊檔，經去識別化後加入。

## 6. M03 完成紀錄（D95 授權，由 Claude 執行）

修改前已備份被改的檔案到暫存區（C 無 git）。變更範圍：

| 檔案 | 變更 |
|---|---|
| `packages/core/src/model/shape.ts`（新） | `checkProjectShape`、`checkLibraryShape`：只回報診斷、不丟例外、不改輸入；無新增依賴 |
| `packages/core/src/index.ts` | 匯出 shape |
| `packages/core/src/validate/validator.ts` | `validateProject` 開頭先做結構檢查，形狀錯誤即回傳 `ok: false`，不再丟例外 |
| `apps/editor/src/components/Toolbar.tsx` | 開啟專案前先檢查結構，失敗時保留原專案 |
| `apps/editor/src/store.ts` | 讀取本機草稿與匯入動作庫前先檢查結構，損壞草稿不進入狀態 |
| `packages/core/test/shape.test.ts`（新） | 8 項測試：既有範例全數通過、nodes 非陣列不丟例外、缺 port／錯誤 enum 指出位置、非物件輸入、輸入不被修改、動作庫三種拒絕情形 |

驗證：`npm.cmd run check` 在 C 通過（core 148 項、editor 13 項測試，型別檢查與建置成功）。未涵蓋：port 型別是否存在於 artifactTypes、flows 端點是否指向存在的節點，這些仍由既有驗證規則處理；結構檢查不取代它們。
