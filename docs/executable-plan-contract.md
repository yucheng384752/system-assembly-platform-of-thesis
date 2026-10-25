# 可執行計畫契約（草案）

日期：2026-10-25
狀態：草案，待 user 審閱；尚未實作，不取代已核定決議。
對應：D134（混合型執行）、`MERGE-PLAN-20261024.md` 的 W1、W3、M03。

## 1. 目的與邊界

D134 規定：設計、驗證、編譯由 `libs/aov-core`（TS）負責；工單、庫存、品檢與交易由 composer-refactor-2（下稱 B）的 Python 工廠端負責；兩者以「可執行計畫」交接，工廠端只讀計畫、不重新解讀 AoV 圖。本文件定義該計畫的資料結構（Data-First），先於任何實作。

**此契約解決的問題：**

- B 的工單 `route_snapshot` 只保存外層節點、邊與工時，沒有子圖，也沒有表單版本，因此無法證明「改子圖後新工單變、舊工單不變」。
- A 的 `compile()` 已產生 `ExecutionPlan`（`templateId`、`templateVersion`、`order`、`stages`、`nodes[].inputs/outputs`），但沒有工時、資源、表單快照、能力綁定與內容雜湊，工廠端無法單靠它執行。

**不在本契約範圍：**資源排程（D135）、瀏覽器模擬結果、工單與庫存的資料表結構（屬 W3 的工廠端資料模型）、授權與簽章（屬 D129 至 D132，計畫雜湊只用於完整性與版本識別，不是簽章）。

## 2. 設計原則

1. **唯一寫入者。**計畫只由 Composer 端的編譯器產生。工廠端只能儲存計畫的副本（以 `planId` 為鍵）並讀取，不修改、不補欄位。
2. **不可變、內容定址。**`planId` 為正規化內容的 sha256；內容一變，`planId` 必變。已發布的計畫不原地改寫。
3. **確定性。**相同輸入得到相同位元組。計畫本體不含時間、機器路徑、使用者名稱；時間等發行資訊放在外層信封，不納入 `planId` 計算（與合併計畫 5.4 節一致）。
4. **缺資料不等於 0。**工時、單位、綁定缺少時以明確的 `missing` 狀態表示，不填預設值。
5. **不猜。**無法對應到可執行動作的節點，編譯標為不可執行並阻擋發布，不由工廠端臆測。
6. **順序線不是物料流。**只表示先後的連線不進入計畫的 `flows`，保存在 `businessOnly`（見 4.5），避免改變庫存數量。

## 3. 外層結構

```text
ExecutablePlan
  format            "composer-executable-plan"
  formatVersion     1
  planId            sha256（見第 5 節）
  source            來源資訊（4.1）
  scope             工廠與生產邏輯範圍（4.2）
  nodes[]           可執行節點（4.3）
  flows[]           物料或資料流（4.4）
  businessOnly      僅業務順序的邊（4.5）
  artifactTypes[]   guard 與判定求值所需的 artifact 型別定義（4.6）
  params[]          參數定義（4.6）
  rules[]           具名規則（4.6）
  stages[][]        可並行的階段（沿用 A 的 compile 輸出）
  order[]           拓撲排序（沿用 A 的 compile 輸出）
```

發行信封（不納入 `planId`）：

```text
PlanEnvelope
  plan              ExecutablePlan
  publishedAt       ISO 8601 時間（UTC）
  publishedBy       發布者識別（不放秘密值）
  builder           { name, version }
```

## 4. 欄位定義

### 4.1 `source`

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| templateId | string | 是 | 沿用 A 的 `ProjectFile.meta.id` |
| templateVersion | integer | 是 | 沿用 A 的 `meta.version`；僅已發布（唯讀）版本可編譯成計畫 |
| projectSha256 | string | 是 | 來源專案檔的正規化 JSON 雜湊，可回查 |
| aovCoreCommit | string | 是 | 取自 `libs/aov-core/VERSION.json` 的 `commit`，目前為 `6a37dbba7dcf0563e60b1e2eb591966b09deb765` |
| libraries | `{id, version, sha256}[]` | 是 | 鎖定的動作庫；缺依賴、同 id 不同版本衝突皆拒絕 |
| subgraphs | `{id, version, sha256}[]` | 是 | 展開時引用的子 AoV（已發布版本）；無引用時為空陣列 |
| mapping | `{version, sha256}` | 是 | 使用的「動作到能力與 Kit」對應表版本（對應表本身是 W1 第一個 PR 的產出） |

### 4.2 `scope`

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| factoryId | string | 是 | 保留 A 的工廠識別，不跨工廠攤平 |
| graphId | string | 是 | 指定的生產邏輯；一份計畫只輸出一個生產邏輯 |

### 4.3 `nodes[]`

沿用 A 的 `PlanNode` 欄位（`nodeId`、`name`、`category`、`stage`、`inputs`、`outputs`），新增下列欄位。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| nodeId | string | 是 | 在同一份計畫內唯一；跨工廠不混用，由 `scope` 區分 |
| category | string | 是 | 沿用 A 的 `NodeCategory` |
| executor | `manual`/`auto`/`system` | 是 | 沿用 A 的 `Executor`；未設定時編譯端填入 A 動作庫的預設值 |
| role | string | 否 | 預期填寫者提示；僅顯示，不作授權（專案規範：角色只是提示） |
| actionId | string | 是 | 引用的業務動作 id |
| executable | boolean | 是 | `true` 才可被工廠端執行；`false` 的節點必須帶 `reason` |
| reason | string | 條件 | `executable` 為 `false` 時必填，例如「找不到能力對應」 |
| binding | 物件 | 條件 | `executable` 為 `true` 時必填，見下 |
| guard | string 或陣列 | 否 | 原樣保留 A 的 guard 原文；只在工廠端求值（8.1 第 3 項），求值器實作見 8.2 第 1 項 |
| form | `{formId, contentSha256}` | 條件 | 節點使用表單時必填；`contentSha256` 為表單內容的 sha256（沿用 D101 規則）；內容一變，舊工單仍指向原雜湊 |
| timing | 物件 | 否 | 見下 |
| resource | `{capability?, operatorSkill?}` | 否 | 開工檢查用的資源需求（B 的 R03 修補需要） |
| expandedFrom | string | 否 | 子 AoV 展開後的節點才有，值為上層子流程節點 id 與其引用（`<子流程節點 id>@<專案 id>@<版本>`）；A 的展開規則是內部節點 id 加前綴 `<子流程節點 id>/`，工廠端不需知道子流程，此欄位只供追溯與顯示 |

`binding`：

| 欄位 | 型別 | 說明 |
|---|---|---|
| capability | string | 對應表指定的能力 id |
| kitId | string | 實作該能力的 Kit；不從 SDK 名稱或動作名稱推測 |

`timing`：

| 欄位 | 型別 | 說明 |
|---|---|---|
| state | `specified`/`missing` | `missing` 表示來源沒有填，與真正的 0 分開 |
| setupMin | number | `state` 為 `specified` 時必填，分鐘，不得為負 |
| perUnitMin | number | 同上，每單位分鐘 |
| quantityUnit | string | 數量單位；缺少時 `state` 視為 `missing` |

### 4.4 `flows[]`

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| id | string | 是 | 沿用 A 的 `Flow.id` |
| from / to | `{node, port}` | 是 | 沿用 A 的 `PortRef`，必須指向存在的節點與埠位 |
| artifactType | string | 是 | A 的連線必帶 artifact 型別 |
| kind | `material`/`data` | 是 | 物料流會影響庫存守恆；資料流不會 |
| transferMin | `{state, minutes?}` | 否 | 移轉時間；`state` 同 `timing`，缺少不得視為 0 |

### 4.5 `businessOnly`

保存只表示先後順序的邊，格式為 `{id, from: nodeId, to: nodeId}` 的陣列。工廠端可顯示，但不得作為物料流、不得影響數量。

### 4.6 `artifactTypes`、`params`、`rules`

guard、判定節點的決策表與檢驗項目，在工廠端求值時需要下列資料，因此必須隨計畫一併保存，工廠端不得另向 Composer 取得：

| 欄位 | 說明 |
|---|---|
| artifactTypes | 沿用 A 的 `ArtifactType`（屬性、身分、守恆規則）；解析 `in.<埠位>.<屬性>` 所需 |
| params | 沿用 A 的 `ParamDef`；只含定義與預設值，不含秘密值 |
| rules | 沿用 A 的 `RuleDef`（具名規則）；已通過 Composer 端的語法與遞迴檢查 |

### 4.7 子 AoV 展開

計畫一律是展開後的平面圖，不含子計畫。引用的子 AoV 必須是已發布版本；缺少、未發布、深度超過 core 上限（`MAX_SUBGRAPH_DEPTH = 5`）或形成循環時，編譯失敗。展開前的階層資訊保存在節點的 `expandedFrom`。

### 4.8 系統邏輯 AoV 疊層（不在計畫本體內）

「系統邏輯 AoV」是給工程師檢視的另一層圖，預設不疊上，需完整連接才可疊上。為避免工程圖的修改使 `planId` 無謂改變而影響工單版本，疊層**不放進計畫**，而是另立一個以 `basePlanId` 引用計畫的疊層文件（格式另訂，見第 8 節）。計畫本體不依賴疊層，工廠端建立工單不需要疊層。第一版疊層只做顯示，且在產品中標記「公司需要，待開發」；疊層與計畫節點的 input/output 未對齊處以缺口標示（8.1 第 5 項）。

## 5. `planId` 計算

1. 取 `ExecutablePlan`，但將 `planId` 欄位本身排除。
2. 物件鍵遞迴排序，陣列保持原順序；數字以最短十進位字串表示；字串以 UTF-8 正規化 NFC。
3. 序列化為不含多餘空白的 JSON，計算 sha256，取小寫十六進位。
4. `subplans` 內每個子計畫先各自算出 `planId`，再參與外層計算。

信封欄位（發行時間、發布者、builder）不參與計算。

## 6. 工廠端的義務與拒絕條件

工廠端接收計畫時必須驗證，任一失敗即拒絕並回傳可定位的錯誤，不得部分接收：

| 條件 | 結果 |
|---|---|
| `format` 或 `formatVersion` 未知 | 拒絕，不嘗試猜測 |
| 重新計算的 `planId` 與宣告不符 | 拒絕 |
| 任一節點 `executable` 為 `false` | 計畫可儲存供檢視，但不得用於建立工單 |
| `binding.kitId` 不在目前有效的 Kit 選配內 | 拒絕建立工單（受選配閘門限制） |
| 表單 `contentSha256` 與工廠端實際取得的表單內容不符 | 拒絕 |
| 工廠端內建求值器的 commit 與 `source.aovCoreCommit` 不一致，且計畫含 guard 或判定節點 | 拒絕建立工單，避免同一條 guard 在設計期與執行期語意不同（暫定，求值器實作未決，見 8.2 第 1 項） |
| `flows` 引用不存在的節點或埠位 | 拒絕 |

建立工單時，工單必須保存 `planId`，不複製也不改寫計畫內容。新工單使用目前已發布的計畫；已建立的工單永遠指向建立當時的 `planId`。

## 7. 與既有程式的對應

| 本契約 | A（`libs/aov-core`） | B（`composer-refactor-2`） |
|---|---|---|
| `nodes[].nodeId/name/category/stage/inputs/outputs` | `compile/compiler.ts` 的 `PlanNode`，原樣沿用 | `route_snapshot` 的 `nodes`（欄位名不同，需轉接） |
| `nodes[].timing` | 無，需由 W1 補來源（缺值狀態） | `Latency.setup/per_unit`，預設 0，需轉為缺值判定 |
| `nodes[].resource` | 無 | `BusinessNode.resource` |
| `nodes[].form` | `NodeDef.form` 只存 id，快照另存 | 產品級 `inspection_form`，需改為節點級 |
| `flows[]` | `Flow`（port 到 port，帶 artifact 型別） | `Edge`（無 port），不可直接對應 |
| 子 AoV 展開（`expandedFrom`） | `compile/subgraph.ts` 編譯期展開為平面圖 | `Subgraph`（form/validate/store/state 步驟），工單快照未保存；B 的子圖相當於「系統邏輯」，見 4.8 |
| `rework` | 倉儲邊界加新工單 | `rework_rules`（同單內重工） |

## 8. 已決定事項與開放問題

### 8.1 已決定（2026-10-25，user）

1. **重工。**計畫不含重工規則；重工由工廠端以「建立新工單」處理，遵循舊計畫第 3 節的倉儲邊界原則。B 的 `rework_rules` 不移植。
2. **不做產品啟用子集（變體）。**B 的 `activate(process, product_id)`（`enabled_nodes`、`branch_choices`）不移植；一份計畫對應一個生產邏輯的完整展開圖。「系統邏輯」不是子集，而是 4.8 的工程師疊層。
3. **guard 只在工廠端求值，工廠端不得連回 Composer。**因此不採用「Composer 端求值服務」。設計期的語法與型別檢查仍在 Composer 端（`expr/checker.ts`），執行期的求值只在工廠端，兩者用同一個 `aovCoreCommit` 對齊（見第 6 節最後一條拒絕條件）。

4. **系統邏輯疊層第一版只做顯示**，不影響工單執行與計畫雜湊。該功能於產品中標記為「公司需要，待開發」，不得讓使用者誤以為已可執行。
5. **疊層「完整連接」的定義。**系統邏輯疊層在 input/output 要與基礎計畫節點的埠位一一對應；未對齊者**標示缺口**（列出缺少或多出的埠位），而不是整個拒絕。缺口存在時疊層仍可顯示，但缺口須在畫面上可見。
6. **產品需求：工廠可修改生產參數。**工廠端必須能在不重新編譯、不重新發布計畫的前提下修改生產參數。此需求與「求值器固定版本」互相牴觸（user 於 2026-10-25 指出，固定版本求值器不符合此開發要求），故固定版本方案不採用。

### 8.2 開放問題

1. **「生產參數」的範圍，以及它與不可變計畫的關係。**這決定求值器怎麼放進工廠端，需先釐清：
   - (i) 只是 `params` 的**值**（例如核准供應商清單、保存期限天數）：計畫只保存 `params` 的定義與預設值，工廠端另存「參數覆寫」（有版本、操作者、時間的稽核紀錄），求值時以覆寫值代入。計畫保持不可變，求值器程式本身不必隨參數變動。
   - (ii) 還包含 guard **運算式本身**（例如門檻寫在運算式中）：工廠端須能編輯並檢查運算式，因此工廠端除了求值也要有語法與型別檢查；計畫不可變的假設被打破，需要定義「工廠修改」如何版本化，以及已建立的工單是否受影響。
   - (iii) 還包含工時、資源需求、移轉時間等 `timing`、`resource` 欄位：同 (ii)，需定義覆寫與稽核方式。
   
   範圍確定前，不選定求值器實作（Python 另寫、Node sidecar 或其他），因為不同範圍的需求差異很大。
2. **參數修改的治理。**誰能改、是否需要核准、是否即時生效、已開工的工單是否沿用修改前的值。角色目前只是顯示提示（專案規範），需說明在無身分機制的環境下如何處理。
3. **B 的子步驟（form、validate、store、state）對應 A 的什麼。**B 的子步驟屬於疊層內容，不屬於計畫本體；具體對應表待 W1，與疊層的埠位對齊規則（8.1 第 5 項）一起決定。

## 9. 驗收條件（契約層）

- 相同專案檔、相同動作庫、相同對應表，兩次編譯得到相同 `planId`。
- 改動任一節點的表單內容，新計畫的 `planId` 改變，舊 `planId` 的計畫仍可讀取且不變。
- 任一節點缺工時時，`timing.state` 為 `missing`，而不是 0。
- 對應不到能力的節點，`executable` 為 `false` 且有 `reason`，計畫不得用於建立工單。
- 順序線不出現在 `flows`，只出現在 `businessOnly`。
- 引用子 AoV 的專案，展開後的計畫不含子流程節點，內部節點 id 帶 `<子流程節點 id>/` 前綴並有 `expandedFrom`；修改子 AoV 並發布新版本後，重新編譯得到新的 `planId`，舊工單仍指向舊 `planId`。
- 計畫本體不含系統邏輯疊層；修改疊層不改變 `planId`。
- 工廠端對第 6 節每一種拒絕條件各有一個反例測試。

## 10. 下一步

1. user 審閱本草案並回覆 8.2 的三項開放問題（優先回覆第 1 項「生產參數的範圍」）。
2. 依回覆撰寫 `schemas/executable-plan.schema.json`（JSON Schema 2020-12）與 fixtures（合法、缺工時、無能力對應、`planId` 不符、未知版本）。
3. 在 `libs/aov-integration/` 擴充編譯端產生計畫的轉接，並加入確定性測試。
4. 工廠端的接收與驗證留待 W3。
