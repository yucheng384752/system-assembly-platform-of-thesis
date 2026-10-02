---
id: "20261002-workflow-graph"
title: "畫布式 AoV Workflow：圖形文件模型（功能 1）與畫布編輯器（功能 2）"
status: "in_progress"
owner: "claude"
reviewer: "user"
priority: "high"
created_by: "claude"
created_at: "2026-10-02"
updated_at: "2026-10-02"
role_priority:
  implementation: "claude (功能 1) / codex (功能 2)"
  review: "claude"
  tests: "claude / codex"
  requirements: "user"
artifacts:
  - path: "docs/decision-log.md"
    type: "file"
  - path: "docs/project-spec.md"
    type: "file"
---

# Goal

把 Workflow 從「步驟列表」改為畫布：左側工具箱、中間 React 畫布、右側節點細項。User 在畫布建立完整 workflow 後，才由所選節點推導 Kit／mService／Function（D62、`deriveKits`）。節點可再往下建立子 AoV。節點細項在建立時即驗證必填、表格上傳、數值設定等。

拆成兩個功能，各自一個分支與一次 `/clear`：

1. 功能 1 `feature/workflow-graph-model`（Claude）：資料模型、驗證、與現有列表格式的轉換。不動畫面。
2. 功能 2 `feature/workflow-canvas`（Codex，由 Claude 在其分支安裝 `@xyflow/react`）：畫布與節點細項。

# User 已確認（2026-10-02）

1. 拆成兩個功能；核准安裝 `@xyflow/react`（基線版 AoV Studio 已使用；支援 React 18，不需升級現有 React）。
2. 每個節點都可再建立子 AoV；層數需明訂規範，避免解析困難（規範見下，待審）。
3. 表單上傳與欄位確認的預期行為：選擇節點後，上傳一份作為標準的欄位，並對這些欄位設定「關聯」「必填」「驗證」等細項。
4. 其餘依 Claude 的建議。

# 已有的基礎（main 已合併，9bf6b9b）

- `config/actions.json`（4 個業務動作，含 `requiresKits`）、`config/registry/*.json`（4 個 Kit）、`libs/ui-runtime/registry.ts`、`actions.ts`（`deriveKits`）。
- Workflow 文件 `composer-aov-list` version 3：`steps[].actions[]`（D66）。
- 現有列表式頁面：`AovPage`、`FormsPage`、`RelationsPage`（步驟 01 到 03）；`relations.ts`、`localData.ts` 的推測與驗證邏輯。

# 設計提案（Claude 提議，待 user 審閱；審閱後再寫入 decision-log）

下列每一項若與 user 的想法不同，以 user 為準。標「推定」者是我依原始碼或既有決議推出，不是 user 說過的。

## 1. 文件形狀：`composer-aov-list` version 4

沿用基線版 AoV 的名稱（D02）：`rootGraphId`、`graphs`、`nodes`、`edges`、`childGraphId`、`layout`。

```
{ format: 'composer-aov-list', version: 4, rootGraphId,
  graphs: [{ id, name, nodes: [Node], edges: [{ id, from, to }] }],
  layout: { <graphId>: { <nodeId>: { x, y } } },
  forms: [FormDefinition],      // 與 version 3 相同，欄位新增選填 validation
  relations: [FormRelation] }   // 與 version 3 相同
Node: { id, name, when, owner, actionId | null, params: { <paramId>: string|number|boolean },
        formId | null, childGraphId | null }
```

- 一個節點最多一個 Action（取代 D66 的「步驟含 0..N 個 Action」；畫布上節點就是動作）。`actionId` 為空表示純業務節點，不產生任何 Kit。
- 推導 Kit 的輸入是所有 graph 內 `actionId` 的聯集（任何深度）。
- 連線只表示先後順序，無條件、無迴圈（D18：AoV 不執行條件與迴圈）。同一節點可有多條出線，語意為平行，不是分支。

## 2. 子 AoV 層數規範（推定，待審）

- 最多 3 層：第 1 層為根（整體流程），第 2 層為子流程，第 3 層為作業細項；第 3 層的節點不可再有子 AoV。
- graphs 構成一棵樹：除根以外，每個 graph 恰好被一個節點的 `childGraphId` 引用；不可共用、不可循環。
- 上限：每個 graph 最多 100 個節點；整份文件最多 30 個 graph、50 張表單（D25 不變）。
- 超出一律拒絕匯入並指出位置，不截斷、不自動攤平。
- 理由：基線版四層規範（System、Kit、mService、Function）的最底層不可再有子圖，同樣是為了讓解析有界；業務視角取 3 層，足以表達「流程、工站、操作」而樹狀結構與深度上限使解析、驗證與畫面導覽都是有界遞迴。基線規範的「共用定義需要明確契約」在此保守地不開放共用。

## 3. 節點表單與欄位細項（依 user 第 3 點）

- 節點最多一張「標準表單」：上傳樣本（沿用 D25 的推測與 M01 去識別化）→ 確認欄位。表單仍放在文件頂層 `forms`，節點以 `formId` 引用；每張表單恰屬一個節點（D23 的對應）。
- 欄位設定：現有 `required`、`isKey`；新增選填 `validation`：
  - integer、decimal：`minimum`、`maximum`
  - text：`maxLength`、`allowedValues`
  - date、boolean：首版無驗證（推定，待審）
- 「關聯」沿用現有 `relations`（共用識別欄位、需 user 確認、D19、D22）；端點仍為 `{ formId, fieldId }`，因此跨節點、跨 graph 皆可，限制不變（同一對表單最多一條、不得自連、整體不成環）。

## 4. Action 的參數與節點驗證（推定，待審）

`config/actions.json` 的每個 ActionType 新增：

- `parameters`：`{ id, name, type: 'number'|'text'|'boolean', required, default?, minimum?, maximum? }`。
- `needs`：節點完成前必須具備的條件，值為 `form`（節點有一張欄位完整的表單）或 `relation`（節點的表單至少有一條已確認的關聯）。

初稿（依原始碼可查到的參數，其餘不虛構）：

| 動作 | 參數 | needs |
|---|---|---|
| 建立表單 | 無 | form |
| 匯入紀錄 | `allowDuplicate`（boolean，預設否；對應 `upload_csv` 的 `allow_duplicate`） | form |
| 串聯表單 | `flowCode`（text，必填，預設 `default`；對應 `flow_code`） | form、relation |
| 查詢追溯 | `flowCode`（text，必填，預設 `default`） | form、relation |

節點完成條件：名稱必填；`actionId` 非空時，必填參數齊全、型別與範圍正確、`needs` 滿足；表單欄位通過既有的 `formError`；`validation` 範圍自洽（minimum 不大於 maximum）。

## 5. 與現有列表格式的關係

- 功能 1 期間主畫面仍編輯 version 3（避免 GUI 中斷）；新增 `workflowGraph.ts` 提供：version 4 的型別、驗證、匯出、匯入，以及 version 1 到 3 轉換為 version 4（每個步驟變成根 graph 的一個節點，依序連線；原本多個 Action 的步驟拆成同 graph 內依序的多個節點，無資料遺失）。
- `importAov` 遇 version 4 先回「需要新版編輯器」；功能 2 把主畫面切到 version 4 後，列表頁面（`AovPage`、`FormsPage`、`RelationsPage`）整批退役，這是兩套模型並存期間已知的重複，須在功能 2 清除。

# 計畫

## 功能 1（Claude）

1. user 審閱上列設計；寫入 decision-log（預計 D70 起）與 spec §4.3 更新。
2. `schemas/aov.schema.json` 加 version 4；`schemas/action-catalog.schema.json` 加 `parameters`、`needs`；`config/actions.json` 補資料。
3. `apps/composer-gui/src/workflowGraph.ts`：型別、結構驗證（樹、深度、DAG、上限）、節點完成條件、匯入匯出、v1 到 v3 轉 v4、由圖取得 `actionId` 聯集。
4. 測試：每條規範各一個會失敗的案例（超過 3 層、共用子圖、循環、連線跨圖、表單歸屬、參數越界、needs 不滿足、轉換不遺失）。
5. 驗證：`npm.cmd run typecheck`、`npm.cmd test`。

## 功能 2（Codex，另開 thread 的 Handoff）

左側工具箱（4 個動作加純業務節點）、中間畫布（`@xyflow/react`）、右側節點細項（基本欄位、參數、標準表單上傳與欄位設定、關聯、子 AoV 入口與麵包屑）；節點未完成時顯示業務語言的原因；步驟 04 顯示推導的 Kit 與原因，缺口與待決以業務語言呈現（不顯示 capability 名稱）；`suggestFlows` 是否保留待決。

# Open Questions

1. 層數 3、節點最多一個 Action、純業務節點可無 Action，是否同意？
2. 欄位 `validation` 的種類是否足夠？date 與 boolean 是否需要規則？
3. 四個動作的 `parameters` 與 `needs` 初稿是否正確？是否有你預期要設定、但原始碼看不出來的參數？
4. `suggestFlows`（有關聯就建議查詢追溯）在畫布版本要保留、改為建議加入「查詢追溯」節點，還是移除？
5. 連線是否需要標示（例如文字說明）？目前假設只表示先後。

# Claude Notes

- 2026-10-02：功能 `feature/workflow-action-registry` 已合併到 main（9bf6b9b）。本 thread 由此開始；功能 1 在 user 審閱前不寫程式。

- 2026-10-02：user 回覆「按提案」，並補充：日期驗證採 ISO 格式、連線不要文字標示、節點一律圓形且只顯示名稱。決議已寫入 D70–D75（d817086）；ISO 的解讀（日期規則的邊界值與格式皆為 ISO 8601 的 `YYYY-MM-DD`，並檢查日期是否真實存在）待 user 確認。
- 2026-10-02：功能 1 完成。`schemas/aov.schema.json`（version 4）、`schemas/action-catalog.schema.json`（`parameters`、`needs`）、`config/actions.json`、`libs/ui-runtime/registry.ts`（參數語意檢查）、`apps/composer-gui/src/workflowGraph.ts`（型別、結構與完成度驗證、匯入匯出、v1 到 v3 轉換）、`workflow.ts`（輔助函式放寬為只需 `forms`、`relations`；`importAov` 遇 version 4 回報尚未支援）、`localData.ts`（`FieldValidation`）。測試 209 項：208 通過、1 項既有略過（授權「未涵蓋」）；新增 `workflowGraph.test.ts` 54 項。以暫時把 `MAX_DEPTH` 改成 4 驗證測試會失敗後已還原。
- 與提案的差異：v3 轉 v4 並非完全無損。一個節點只能有一張表單，Action 原本作用於多張表單時會拆節點並逐項提示（D75）；thread 原稿寫「無資料遺失」是錯的，已更正。
- 功能 2 開始前仍待 user 回答：Open Question 4（`suggestFlows` 保留、改為建議加入「查詢追溯」節點，或移除）。

# 功能 2 Handoff（草稿，user 回答 Open Question 4 後補完）

- 新分支 `feature/workflow-canvas`（由 main 開出，功能 1 合併後）；依賴 `@xyflow/react` 由 Claude 安裝，Codex 不得自行新增依賴。
- 必讀：`CLAUDE.md`、`DESIGN.md`、本 thread、`docs/decision-log.md` D62、D66 到 D75、`docs/project-spec.md` §4.3 與 §4.4、`apps/composer-gui/src/workflowGraph.ts`、`workflow.ts`、`localData.ts`、`libs/ui-runtime/actions.ts`、`registry.ts`、`config/actions.json`、`config/registry/*.json`、`App.tsx`、`StepShell.tsx`、`FlowPage.tsx`。
- 資料契約已定，需要改動請停止並提問：不得修改 `schemas/`、`workflowGraph.ts` 的驗證規則與 `config/`；畫面只呼叫 `integrityErrors`、`graphErrors`、`nodeErrors`、`importWorkflow`、`exportAovGraph`、`graphActionIds`、`deriveKits`。
- 畫面：左側工具箱（4 個動作加純業務節點）、中間畫布、右側節點細項；節點一律圓形只顯示名稱；連線無文字；子 AoV 以麵包屑進出且最多 3 層；節點細項含名稱、時機、職務、動作參數、標準表單上傳與欄位設定（必填、識別欄位、驗證規則、關聯）；日期規則以 `YYYY-MM-DD` 輸入並即時驗證。
- 推導：畫布完成後才顯示「依流程動作帶出的功能」，每個 Kit 附業務語言的原因；缺口與待決以業務語言呈現，不顯示 capability 名稱、程式術語或路徑。必帶 Kit 鎖定不可取消。
- 退役：`AovPage`、`FormsPage`、`RelationsPage` 與 version 3 的編輯狀態，同時移除 `workflow.ts` 內只服務它們的函式（保留 `importAov` 與 `listToGraph` 所需部分）。
- 驗證：`npm.cmd run typecheck`、`npm.cmd test`；畫布與子 AoV 進出須由 Claude 在瀏覽器實測（Codex 無法監聽連接埠）。
