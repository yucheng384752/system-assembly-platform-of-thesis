---
id: "20261002-workflow-graph"
title: "畫布式 AoV Workflow：圖形文件模型（功能 1）與畫布編輯器（功能 2）"
status: "waiting_for_user"
owner: "user"
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
- 2026-10-02：Open Question 4 已回答：`suggestFlows` 改用 toast 或畫布右下提示「可加入 XX 節點」。Claude 選畫布右下的靜態提示（D76，因 DESIGN.md 不使用動畫）；若 user 偏好 toast 再調整。功能 1 已合併到 main（b62abbd），功能 2 在 `feature/workflow-canvas` 開始；依賴 `@xyflow/react` 12.12.0 已安裝（ee9c847），`orderedNodes`、`nodeOfForm`、`suggestActions` 已補（1df2206）。

# 功能 2 Claude Handoff（畫布編輯器，分支 `feature/workflow-canvas`）

## User 已確認（2026-10-02）

1. 版面：左側工具箱、中間 React 畫布、右側節點細項。節點一律圓形、只顯示名稱；連線不顯示文字（D74）。
2. 節點可建立子 AoV，最多 3 層（D71）。
3. 選擇節點後上傳一份標準欄位，並設定欄位的「關聯」「必填」「驗證」（D72）。日期驗證用 ISO 8601 `YYYY-MM-DD`。
4. 建議加入功能：畫布右下角提示「可加入『查詢追溯』節點」，或 toast；Claude 選右下角靜態提示（D76）。
5. `@xyflow/react` 12.12.0 已核准並由 Claude 安裝（`ee9c847`）。

Claude 的推論（待 user 確認，已寫入決議）：步驟由 5 個改為 3 個（D77）；日期驗證的 ISO 解讀。

## 角色分工

- Codex：寫程式與測試。
- Claude：git 寫入、依賴、瀏覽器驗證（畫布、拖放、子 AoV 進出）、審閱。
- Codex 沙箱不能寫 `.git`、沒有網路、不能監聽連接埠；不得新增依賴；不得修改 `kits/`；啟動 cwd 必須是專案根目錄。
- 已知沙箱限制：`security.test.mjs` 的 CLI 測試會因暫存目錄不可寫而 EPERM，`npm.cmd run test:kits` 找不到 Python。由 Claude 在沙箱外驗證，不要繞過，也不要回報為程式失敗。

## 必讀

`CLAUDE.md`、`DESIGN.md`、本 thread、`docs/decision-log.md` D62、D66 到 D77、`docs/project-spec.md` §4.3 與 §4.4、`apps/composer-gui/src/`：`workflowGraph.ts`（全部）、`workflow.ts`、`localData.ts`、`relations.ts`、`catalog.ts`、`App.tsx`、`AppShell.tsx`、`StepShell.tsx`、`FlowPage.tsx`、`OutputPage.tsx`、`deliveryPackage.ts`、`AovPage.tsx`、`FormsPage.tsx`、`FormEditor.tsx`、`RelationsPage.tsx`、`style.css`，以及 `libs/ui-runtime/actions.ts`、`registry.ts`、`schema.ts`，`config/actions.json`、`config/registry/*.json`。

## 資料契約（已定；需要改動請停止並提問）

- 不得修改：`schemas/`、`config/`、`libs/ui-runtime/`、`workflowGraph.ts` 內的驗證與規則函式。新增畫面所需的純函式可以放在新檔案，不可放寬既有規則。
- 畫面只透過這些函式讀寫文件：`integrityErrors`、`graphErrors`、`nodeErrors`、`validationError`、`isIsoDate`、`orderedNodes`、`nodeOfForm`、`graphDepths`、`graphActionIds`、`suggestActions`、`importWorkflow`、`exportAovGraph`，以及 `deriveKits`。
- 文件以不可變方式更新（`onChange(next)`），每次更新後呼叫 `integrityErrors`；有結構錯誤的狀態不得存入工作階段。
- 動作清單來自 `actionCatalog`（`workflow.ts`），參數表單由 `ActionType.parameters` 產生，不得寫死四個動作。

## 硬性規範

- `DESIGN.md`：不使用陰影、不使用動畫（含 React Flow 的轉場；`fitView` 的 duration 為 0，且 `prefers-reduced-motion` 下關閉）、控制項高度至少 44px、對比至少 4.6:1、圖示用手寫內嵌 SVG（`Icons.tsx`）且 `aria-hidden` 旁有文字，不使用圖示庫與 emoji。不使用 React Flow 內建的 Controls 與 MiniMap（內建圖示）；縮放與「適合畫面」用自己的按鈕。保留 React Flow 預設的 attribution，不使用 `proOptions` 隱藏。
- 使用者只看得到業務語言：不顯示 capability 名稱、路徑、`mService`、`Function`、Kit 的 id、程式或資料表名稱。Kit 以 `displayName` 呈現。
- 全部介面文字為繁體中文；不使用 `any`；使用者輸入一律純文字呈現，不用 `dangerouslySetInnerHTML`。
- 預覽無副作用；不發出任何網路請求。M01：上傳的樣本只推測欄位，原始資料列不保留（沿用 `inferForms`）。
- 鍵盤與輔助技術：畫布上的所有操作都要有鍵盤可用的替代方式。尤其「連線」不能只靠拖曳：節點細項提供「接續在哪些節點之後」的核取清單（同一 graph 的其他節點），勾選即建立或刪除連線。工具箱的每個項目除了拖放，也有「加入到畫布」按鈕。節點要有可聚焦與完整名稱（`aria-label`，名稱過長時圓形內截短、完整名稱在 `title` 與右側細項）。
- 刪除前在頁面內確認（不得使用 `window.confirm`）：刪除節點會一併刪除其子流程（遞迴）、該節點擁有的表單，以及牽涉該表單的關聯；確認文字要列出將被刪除的內容。
- 每個工作包結束時 `npm.cmd run typecheck` 與 `npm.cmd test` 必須通過，不得刪減或放寬既有測試的意圖；既有測試需要改寫時，保留它驗證的規則（D19、D22、D61、A21、A23、D23 的對應）。

## 工作包

### WP1 畫布骨架（先並存，不動既有步驟）

- 新增 `WorkflowCanvas.tsx` 與相關元件，暫時由 App 內的獨立狀態 `graph`（初值 `emptyGraph`）驅動，既有的 v3 頁面保持運作。
- 圓形節點（自訂 node type）、無文字連線、工具箱（4 個動作加「業務節點」，各附一句說明；加入按鈕與拖放）、節點選取、連線（拖曳與細項核取清單兩種）、節點與連線的位置寫入 `layout`。
- 子 AoV：節點細項的「建立子流程」「進入子流程」，畫布上方的麵包屑（主流程 > 子流程 > ...），深度 3 時停用「建立子流程」並說明原因。
- 測試：jsdom 需要的 React Flow 環境（`ResizeObserver`、元素尺寸）放在測試輔助檔，不修改正式碼來配合。
- 驗收：A-C1 可加入節點並出現在 `graph`；A-C2 無滑鼠也能建立連線並被 `integrityErrors` 擋下成環；A-C3 第 3 層沒有建立子流程；A-C4 節點只顯示名稱。

### WP2 節點細項

- 基本：名稱、時機、負責職務、動作（選單；選項附說明，可選「無（純業務節點）」）。
- 參數：依所選動作的 `parameters` 產生控制項（number、text、boolean；預設值、最小與最大值）；切換動作時清掉不屬於新動作的參數；顯示 `nodeErrors` 的完成度問題（業務語言、不只靠顏色）。
- 標準表單：上傳 CSV 以 `inferForms` 推測欄位（單檔，因為一個節點最多一張表單）或建立空白表單；欄位列表可改名、型別、必填、識別欄位；每個欄位的「驗證」依型別顯示可用規則（整數與小數：最小、最大；文字：最大長度、允許值；日期：最早與最晚日期，輸入 `YYYY-MM-DD`；是／否：無），用 `validationError` 即時驗證。沿用 D25、D27 的限制與提示（去識別化提醒、2 MB／100 欄／10000 筆）。
- 驗收：A-C5 參數越界與缺值即時顯示原因；A-C6 日期 `2026-02-30` 被指出；A-C7 切換動作不留下殘餘參數；A-C8 原始資料列不進入狀態（沿用既有斷言）。

### WP3 關聯

- 將 `relations.ts` 移植為操作 `AovGraphDocument`：「上游」改為在 `orderedNodes` 中較前的表單，追溯顯示節點名稱與負責職務（`nodeOfForm`）。D19 的候選規則、D22 的限制、D61 的原因說明完全不變。
- 節點細項的「關聯」：列出此節點表單的欄位與其候選（確認才生效）、已確認的關聯可移除；原因說明（`explainMissedCandidates`）以業務語言顯示。
- 驗收：A-C9 既有 `relationReasons.test.tsx` 與 `workflow.test.ts` 中關聯相關的斷言以圖形文件改寫後全部成立；A-C10 在節點細項確認關聯後，另一端節點的細項同步出現。

### WP4 串接步驟、功能選配與輸出

- `StepShell`：3 個步驟（D77）：01 流程畫布、02 功能選配、03 輸出；`stepError` 對應 `integrityErrors`、`graphErrors`、客戶代稱與場域衝突。
- 功能選配：以 `deriveKits(graphActionIds(graph), actionCatalog, registry)` 計算；顯示每個推導出的功能（Kit `displayName`）與業務語言的原因（例如「因為『收料』要做『建立表單』」「因為使用『查詢與追溯』，系統會自動加入『通用表格』」），必帶功能鎖定不可取消。推導結果與手動選配合併成 `enabledKits`（擴充 `selectKits`，保持舊簽名可用）。
- 待決（多個實作者）：列出候選功能名稱請使用者選擇，選擇後以手動選配記錄。缺口：只顯示業務語言的數量與說明，不顯示 id。
- 畫布右下角建議（D76）：用 `suggestActions`，靜態提示加「加入『查詢追溯』節點」按鈕（加入到目前的 graph），`role="status"`；加入後提示消失。移除 `suggestFlows` 與其在 `FlowPage` 的呈現。
- 輸出：流程規格輸出 `exportAovGraph`（檔名沿用 `workflow.aov.json`），`workflowRef` 與設定交付包使用新文字；匯入走 `importWorkflow`，舊版轉換的 `notices` 逐項顯示，匯入失敗時保留原流程。`AppShell` 的計數改為節點數、表單數、已確認關聯數、已啟用功能數。
- Registry 資料：新增 `registryData.ts`，匯入 `config/registry/*.json` 並以 `parseRegistry` 解析（登錄檔格式見 `kit-registry.schema.json`）；Kit 的顯示名稱來自 `catalog.kits`。
- 驗收：A-C11 只含「查詢追溯」節點的流程推導出 4 個功能且 `generic-forms-kit`、`station-data-link-kit` 鎖定；A-C12 匯入 version 2 文件顯示轉換提示並得到可用的畫布；A-C13 匯出的檔案 SHA-256 與 Recipe 的 `workflowRef` 一致；A-C14 畫面任何位置不出現 `forms.create` 之類的 capability 字串。

### WP5 退役舊頁面

- 移除 `AovPage`、`FormsPage`、`RelationsPage`、`FormEditor`（若畫布已不使用）與 App 內的 v3 狀態；`workflow.ts` 只保留 `importAov`（供 `importWorkflow` 轉換）、型別、`actionCatalog`、關聯輔助函式與 `sha256Hex` 所需部分，移除只服務舊頁面的函式與其測試，移除時在 Codex Notes 逐項列出。
- 更新 `DESIGN.md` 的步驟與畫布規範（步驟條、右下角提示、節點外觀），並更新 `Frontend.test.tsx` 等端到端測試。
- 驗收：A-C15 沒有未使用的匯出；`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build` 通過。

## 停止條件

需要改動資料契約或驗證規則、需要新增依賴、與 `DESIGN.md` 衝突、既有測試的意圖無法保留時，立即停止並在 Codex Notes 寫下問題，不要自行變通。每個工作包完成後在 Codex Notes 記錄：做了什麼、變更的檔案、測試結果（含略過項目）、尚未解決的事。

## Codex Notes

（Codex 在此續寫）

### 2026-10-02 WP1 完成

- 新增獨立畫布與工具箱：加入／拖放、圓形名稱節點、位置儲存、鍵盤連線替代操作、成環拒絕、三層子流程及麵包屑；刪除前列出節點、子流程、表單與關聯並於頁內確認。App 暫存獨立 graph，原五步驟保持運作。
- 變更：新增 apps/composer-gui/src/WorkflowCanvas.tsx、canvasEditing.ts、WorkflowCanvas.test.tsx、testCanvas.ts；修改 App.tsx、style.css、vite.config.ts（測試環境）。
- npm.cmd run typecheck：通過。npm.cmd test：215 passed、1 skipped（既有身分授權未涵蓋）、1 failed（security CLI 既知暫存路徑 EPERM，另清理 hook 同樣受限）；沒有其他程式測試失敗。未執行 test:kits（已知 Python 限制），未啟動伺服器，真實瀏覽器與拖放由 Claude 驗證。
- 尚待後續工作包：完整細項、關聯、推導／匯入匯出及舊頁面退役。

### 2026-10-02 WP2 完成

- 節點細項新增名稱、時機、負責職務、資料驅動的動作與參數控制項；切換動作只保留新動作預設參數，即時顯示 nodeErrors。
- 標準表單支援單檔 CSV 推測、空白表單、欄位名稱／型別／必填／識別欄位、各型別驗證規則與有效日期提示；刪除表單或欄位先於頁內列出相關關聯並確認。非同步上傳只加入仍存在且沒有表單的原節點，樣本資料列不進入文件。
- 變更：新增 apps/composer-gui/src/NodeDetails.tsx、NodeForm.tsx；修改 WorkflowCanvas.tsx、WorkflowCanvas.test.tsx。
- npm.cmd run typecheck：通過。npm.cmd test：218 passed、1 skipped（既有身分授權）、1 failed（已知 security CLI EPERM；清理 hook 同樣受限）。test:kits 未執行（已知 Python 限制）；真實瀏覽器驗證留給 Claude。
- 尚待 WP3 關聯與 WP4／WP5 整合，沒有新增契約或依賴。

### 2026-10-02 WP3 完成

- relations.ts 支援圖形文件，上游依 orderedNodes，追溯以 nodeOfForm 取得節點與職務；暫留舊列表型別相容至 WP5。候選、名稱近似原因、同型別／每對表單唯一／不得自連或成環規則維持不變。
- 新增 NodeRelations.tsx，節點細項可確認候選、手動建立、頁內確認移除、查看兩端關聯與追溯。relationReasons.test.tsx 全部改用圖形文件；workflow.test.ts 的 D19、D22／A21、A23 斷言改用圖形文件，原規則皆保留。新增兩端同步 UI 測試。
- 變更：新增 apps/composer-gui/src/NodeRelations.tsx；修改 relations.ts、NodeDetails.tsx、relationReasons.test.tsx、workflow.test.ts、WorkflowCanvas.test.tsx。
- npm.cmd run typecheck：通過。npm.cmd test：219 passed、1 skipped（既有身分授權）、1 failed（已知 security CLI EPERM；清理 hook 同樣受限）。test:kits 未執行（已知 Python 限制），瀏覽器由 Claude 驗證。
- 尚待 WP4 整合與 WP5 退役；無契約變更。

### 2026-10-02 WP4 完成

- App 主流程接上圖形狀態、三步驟驗證與首頁節點計數。新增 registryData.ts 載入並驗證登錄資料，以 deriveKits(graphActionIds(...)) 推導；selectKits 增加相容的第五參數，合併必帶與手動功能。畫面列出業務原因、鎖定功能、候選選擇、缺口數量及未納入推導功能。
- 新增 WorkflowTransfer.tsx，匯入舊版列出轉換提示、失敗保留原流程。畫布以 suggestActions 顯示右下靜態提示；suggestFlows 已移除，其測試改驗相同「僅已確認關聯才建議」規則。輸出改用 exportAovGraph，交付包使用相同下載原文与 SHA-256。
- 變更：新增 registryData.ts、WorkflowTransfer.tsx；修改 App.tsx、AppShell.tsx、StepShell.tsx、WorkflowCanvas.tsx、FlowPage.tsx、catalog.ts、OutputPage.tsx、deliveryPackage.ts、style.css；測試修改 Frontend.test.tsx、StepShell.test.tsx、shell.test.tsx、aov.test.tsx、localData.test.tsx、output.test.tsx、siteUi.test.tsx、catalog.test.ts。
- 原 UI 測試逐項移植：鍵盤與焦點／失敗匯入保留、欄位推測失敗原因與資料不外送、必填與未指派表單、候選確認與型別限制／追溯職務、Recipe 匯入原子性、場域鎖定及兩份下載與交付包位元組一致。舊多檔推測的函式規則仍由 workflow.test.ts 驗證；畫布入口改為確認的一節點一檔規則。
- npm.cmd run typecheck：通過。npm.cmd test：220 passed、1 skipped（既有身分授權）、1 failed（已知 security CLI EPERM；清理 hook 同樣受限）。test:kits 未執行（已知 Python 限制），未啟動伺服器。
- WP5 尚待舊頁面與專用函式清除、DESIGN.md 更新及 build。

### 2026-10-05 Claude 接手 WP5

- Codex 任務 `task-muqpgv6j-j8hst6` 於 WP5 中途失敗：`You've hit your usage limit`（約 30 分鐘後中止，10 月 2 日 17:02 之後沒有任何檔案異動）。依 user 的指示（Codex 未在預期時間內完成就由 Claude 接手），由 Claude 完成 WP5。Codex 未動任何資料契約檔：`schemas/`、`config/`、`libs/`、`kits/`、`package*.json` 與 `workflowGraph.ts` 皆無異動。
- 接手時的狀態：`workflow.ts` 已被精簡，四個舊頁面已刪除，但 `workflow.test.ts`、`deliveryPackage.test.ts`、`relationReasons.test.tsx`、`security.test.mjs` 仍引用被移除的 API，`npm.cmd run typecheck` 失敗。
- Claude 做了：
  - 測試移植而非刪除：`workflow.test.ts` 的 A20、D19、A21、D22、A22、A23 以圖形文件改寫，保留各自的規則與斷言；舊版匯入的原子性、版本 1 提示、版本 2 轉 3、D66 三種拒絕情形改為驗證 `importAov`。`deliveryPackage.test.ts`、`security.test.mjs`、`relationReasons.test.tsx` 的 fixture 改為舊格式轉圖形後匯出。
  - 移除三個只屬於 version 3 列表編輯狀態的測試，意圖已由圖形測試涵蓋或因 D70 而不存在：「動作隨匯出匯入往返並不寫入 Kit 資料」（`workflowGraph.test.ts` 的往返測試涵蓋）、「動作引用的表單離開步驟」（節點直接擁有表單，這種狀態不存在）、「使用的動作依序列出」（`graphActionIds` 已有測試）。
  - `relations.ts` 與 `NodeRelations.tsx` 的追溯欄位由 `step` 改名為 `node`，因為步驟已不存在。
  - 更新 `DESIGN.md`：3 個步驟、畫布外觀、鍵盤替代操作、右下角建議、節點細項、功能選配。
- 驗證（沙箱外）：`npm.cmd run typecheck` 通過；`npm.cmd test` 27 個檔案、218 通過、1 略過（既有授權「未涵蓋」），包含 Codex 一直無法執行的 `security.test.mjs` CLI 測試；`npm.cmd run build` 通過（主 chunk 約 640 kB，超過 500 kB 警告，因加入 React Flow；`@xyflow/react` 的 `use client` 指令警告無害）。沒有留下無人使用的匯出函式。
- 真實瀏覽器驗證（Chrome，開發伺服器）：
  - 通過：首頁計數改為節點數；流程頁為三欄（工具箱、畫布、節點細項）與 3 步驟；工具箱按鈕的無障礙名稱含動作名稱；加入節點後右側細項自動聚焦並選取名稱；動作切換顯示參數（允許重複紀錄、流程代碼）；子流程 1、2、3 層與麵包屑，第 3 層「建立子流程」停用並以 `aria-describedby` 說明；空白表單、欄位、日期規則輸入框帶 `YYYY-MM-DD` 提示，`2026-02-30` 與「最早晚於最晚」即時指出，合法值無訊息；兩張表單各有識別欄位「批號」時出現候選關聯，需按「確認關聯」才生效；確認後右下角出現 `role="status"` 的建議，按下加入「查詢追溯」節點且提示消失；功能選配依節點推導出通用表單、系統基本功能、查詢與追溯、站點資料串聯，附業務語言原因並鎖定，缺口顯示為「有 2 項功能需求尚無完整驗證資料」，頁面沒有任何 capability、路徑或 id 字串。
  - 未能驗證：視覺外觀（圓形大小、裁切、縮放、窄螢幕）。測試用的 Chrome 分頁 `document.hidden` 為 true，截圖是舊畫面且 React Flow 量到的畫布尺寸不可靠（縮放 0.5、位移為負），因此不能憑截圖判斷。第一個節點看起來被裁在左上角、自動置中是否有效，都無法在此環境證實，Claude 曾嘗試加入自動「適合畫面」的修正，因無法驗證而全部還原。需要 user 在可見的 Chrome 視窗目視確認一次（含 400px 寬度）。
  - 觀察（不修）：同一個事件迴圈內連續觸發三次「加入到畫布」只會保留最後一個，因為 `add` 以閉包內舊的 `value` 整份覆寫；真人逐次點擊不會發生，列為低風險。
- 尚待：user 目視確認畫布外觀與窄螢幕；步驟 03 輸出與匯入的瀏覽器實測（單元與整合測試已涵蓋位元組與校驗碼一致）。

### 2026-10-05 工廠層（D78 到 D83）

- user 審閱畫布後提出八點：先命名工廠並提供「建立生產邏輯」按鈕、側欄移除專案與場域、工具箱移除說明、節點縮小一倍、自動產生開始與結束節點、匯入流程規格改為層級列旁的按鈕、側欄收合改為右緣中央圖示、工廠層其餘依 Claude 建議。前述畫面調整已先提交於 `feature/workflow-canvas`（a1d5a90）；工廠層與開始、結束節點改動資料模型，另開 `feature/factory-layer`（由該分支開出，尚未合併）。
- 未由 user 明講、由 Claude 解讀的兩處：工廠不等於場域（Site Profile 不動）；開始與結束的範圍是每一張圖並要成為連續路徑。已寫進 D78、D80 並標示待確認。
- 接手方式：Codex 額度到 2026-10-05 17:05 才恢復，且此功能與畫布程式緊密相連，由 Claude 直接完成，未派給 Codex。
- 變更：`schemas/aov.schema.json`（version 5）；`workflowGraph.ts`（工廠、`kind`、開始結束規則、跨工廠限制、`upgradeV4`、`listToGraph` 輸出 version 5）；`canvasEditing.ts`（自動接線、刪除時橋接、工廠與生產邏輯的新增改名刪除）；新增 `FactoryPage.tsx`；`WorkflowCanvas.tsx`（工廠清單為起點、工具列提到整頁共用位置、開始結束節點的外觀與限制、路徑由 App 保存）；`relations.ts`、`NodeRelations.tsx`（只提供同工廠的表單）；`FlowPage.tsx`（原因帶工廠與生產邏輯名稱）；`AppShell.tsx`、`WorkflowTransfer.tsx`、`style.css`、`DESIGN.md`、`docs/project-spec.md` §4.5。
- 測試：完整套件 27 個檔案以上全數通過；新增 `canvasEditing.test.ts`（16 項）、`FactoryPage.test.tsx`（8 項），`workflowGraph.test.ts` 改寫為 77 項。以暫時關掉同工廠限制驗證測試會失敗後已還原。
- 瀏覽器（Chrome）實測：工廠首頁、命名後建立生產邏輯並開啟畫布、層級列、開始與結束節點（64px，相距 240px）、自動接線、畫布與工具箱與細項都收在固定操作列之上。視覺外觀仍需 user 在可見視窗目視確認（測試分頁為隱藏，截圖不可靠）。

### 2026-10-05 審閱後調整（D84）

- user 確認 D78（工廠不等於場域）與 D80（開始與結束適用每一張圖）兩個解讀，並回覆 Codex 額度已恢復。
- 新要求：節點預設不連接線；連線與節點之間有空隙，要補上有向箭頭並確實連接；工具箱的「加入到畫布」改為圖示並放在工具名稱右側；節點添加要改為「階梯式的展開」。
- 已完成：新增節點不自動接線、刪除節點不再橋接（取代 D80 的自動接線，完成度規則不變）；連線加實心箭頭；連接點縮為 12px 圓點加 44px 透明觸控環，在 Chrome 量到三條線的線端與圓點距離皆為 0（原本約 22px，原因是 React Flow 把線接在 44px 方塊的外緣）；工具箱改為名稱加右側圖示按鈕。測試：完整套件 267 項，266 通過、1 項既有略過；新增圖示按鈕、箭頭、不連線、刪除只移除自己的線等測試。
- 待 user 說明：「階梯式的展開」的具體樣子。Claude 的幾種讀法與提問已列在回覆中，未猜測實作。節點的預設位置暫為開始與結束下方一列（每列六個）。
- 這一輪沒有派給 Codex：改動集中在畫布與編輯函式的少數檔案，派工的成本高於直接修改；「階梯式展開」的設計定案後再評估是否派工。
