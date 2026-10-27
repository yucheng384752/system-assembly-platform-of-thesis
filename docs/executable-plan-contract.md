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
  paramTables[]     參數表定義（4.6）
  alarmRules[]      警報規則（4.6、4.10）
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

### 4.6 `artifactTypes`、`params`、`paramTables`、`rules`、`alarmRules`

guard、判定節點的決策表與檢驗項目，在工廠端求值時需要下列資料，因此必須隨計畫一併保存，工廠端不得另向 Composer 取得：

| 欄位 | 說明 |
|---|---|
| artifactTypes | 沿用 A 的 `ArtifactType`（屬性、身分、守恆規則）；解析 `in.<埠位>.<屬性>` 所需 |
| params | 沿用 A 的 `ParamDef`，並標示是否可由工廠修改（`tunable`）、預設值、單位與允許範圍（防呆用）；不含秘密值 |
| paramTables | 可由工廠修改或上傳的參數表定義：表代號、欄位（代號、型別、單位、必填）、預設列、被哪個節點如何使用（例如作為判定節點的檢驗項目）。表的**內容**不在計畫內，見 4.9 |
| alarmRules | 警報規則：規則代號、節點、觸發運算式（可引用 `params`）、通知的最低角色等級；運算式在 Composer 端撰寫與檢查，工廠端只求值與發送，見 4.10 |
| rules | 沿用 A 的 `RuleDef`（具名規則）；已通過 Composer 端的語法與遞迴檢查 |

### 4.7 子 AoV 展開

計畫一律是展開後的平面圖，不含子計畫。引用的子 AoV 必須是已發布版本；缺少、未發布、深度超過 core 上限（`MAX_SUBGRAPH_DEPTH = 5`）或形成循環時，編譯失敗。展開前的階層資訊保存在節點的 `expandedFrom`。

### 4.8 系統邏輯 AoV 疊層（不在計畫本體內）

「系統邏輯 AoV」是給工程師檢視的另一層圖，預設不疊上，需完整連接才可疊上。為避免工程圖的修改使 `planId` 無謂改變而影響工單版本，疊層**不放進計畫**，而是另立一個以 `basePlanId` 引用計畫的疊層文件（格式另訂，見第 8 節）。計畫本體不依賴疊層，工廠端建立工單不需要疊層。第一版疊層只做顯示，且在產品中標記「公司需要，待開發」；疊層與計畫節點的 input/output 未對齊處以缺口標示（8.1 第 5 項）。

### 4.9 參數集（ParameterSet，不在計畫內）

生產參數的實際值由工廠端持有，計畫保持不可變。參數集只增不改（append-only），每次修改產生新版本。

| 欄位 | 型別 | 說明 |
|---|---|---|
| planId | string | 此參數集適用的計畫 |
| setVersion | integer | 同一 `planId` 下單調遞增 |
| contentSha256 | string | `values` 與 `tables` 的正規化雜湊 |
| values | `{paramId: value}` | 各 `tunable` 參數的值；須符合計畫宣告的型別、單位與允許範圍，否則拒絕 |
| tables | `{tableId: {rows}}` | 各參數表的資料列；須符合計畫宣告的欄位 |
| alarmIntervals | `{ruleId: minutes}` | 各警報規則未確認時的重送間隔（8.1 第 23 項）；與 `values` 一同核准、一同鎖定 |
| source | `manual` 或 `upload` | 上傳時另記檔案的 sha256 |
| status | `pending`/`approved`/`rejected` | 只有 `approved` 才會被工單使用 |
| proposedBy / proposedAt / reason | | 提出者、時間、修改理由 |
| approvedBy / approvedAt | | 核准者與時間；核准後即時生效 |

規則：

1. 誰能提出、誰能核准，由 entry-permission-kit 設定（8.1 第 7 項）。`manager` 與 `admin` 角色的提出者與核准者可為同一人；其他角色須為不同人（8.1 第 20 項）。
2. 工單**在開工時**鎖定當時最新的 `approved` 參數集，保存 `{planId, setVersion}`，之後不再變動。尚未開工的工單於開工時取最新核准版；已開工的工單沿用舊值。
3. 修改紀錄不可刪除；駁回的版本保留。
4. 上傳表格的內容須通過與手動輸入相同的欄位驗證，驗證失敗整份拒絕，不得部分套用。

### 4.10 警報

- 警報規則由計畫宣告（`alarmRules`），觸發條件可引用 `params`，因此門檻改為 25±5 時警報範圍隨參數集同步改變，不需重新發布計畫。
- 觸發時，向**角色為 `manager` 或 `admin`**的使用者發送警報，收件人由 entry-permission-kit 的角色設定決定，工廠端不自行維護名單。
- 警報本身是新功能（現有程式碼中沒有警報機制）。第一版只做畫面與紀錄（8.1 第 15 項）；收件角色含 `admin` 與 `manager`；須人工確認才解除，未確認時依設定間隔重複發送。超出範圍且未確認時，節點 `held`：阻擋該節點開工與完工（8.1 第 21 項）；有人確認警報即解除（8.1 第 22 項）。

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
| 參數集的值或表格不符合計畫宣告的型別、單位、允許範圍或欄位 | 整份拒絕，不得部分套用 |
| 工單開工時沒有任何 `approved` 的參數集，且計畫含 `tunable` 參數 | 以計畫的預設值開工，並在工單上標示「使用預設值」；不得靜默套用 `pending` 或 `rejected` 的版本 |
| 工廠端內建求值器的 commit 與 `source.aovCoreCommit` 不一致，且計畫含 guard 或判定節點 | 拒絕建立工單，避免同一條 guard 在設計期與執行期語意不同 |
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
6. **產品需求：工廠可修改生產參數。**工廠端必須能在不重新編譯、不重新發布計畫的前提下修改生產參數。user 於 2026-10-25 指出，固定版本的求值器不符合此要求；後續釐清（第 9 項）後，衝突的實際來源是「工廠自行撰寫運算式」，而非求值器版本固定本身。

7. **生產參數的治理（2026-10-25，user）。**誰能改，在權限管理 Kit（entry-permission-kit）設定；修改需要核准；核准後即時生效；**已開工的工單沿用舊的值**。現場例：溫度由 20±5 度改為 25±5 度，超出範圍要有警報。
8. **參數的來源可為上傳的表格。**表格內容可自動帶入（例如攪拌時間預設 10 分鐘改為 12 分鐘；檢驗項目由 5 項改為 6 項）。

9. **工廠端不撰寫新的運算式文字**（2026-10-25，user）。運算式一律在 Composer 端撰寫、檢查、發布；工廠端只修改參數值與參數表資料列。因此求值器只是執行引擎，固定版本與「工廠可修改生產參數」不衝突（8.1 第 6 項據此修正：衝突來自工廠自行撰寫運算式，而非固定求值器本身）。
10. **檢驗項目由參數表驅動**（2026-10-25，user：要做）。判定節點的檢驗項目改為由參數表的資料列提供，工廠端可增減項目（例如 5 項改 6 項）。這需要修改 `libs/aov-core` 的來源專案 aov-project，再以 `scripts/sync-aov-core.mjs` 同步固定快照（D103）。實際修改前須再確認授權範圍，見 8.2 第 1 項。
11. **警報**（2026-10-25，user）：超出設定參數時，向 manager 等級的角色發送警報，並綁定權限 Kit。
12. **核准流程**（2026-10-25，user）：先嘗試以現有機制組合（entry-permission-kit 的角色與入口授權，加上 audit-edit-kit 的修改理由與稽核事件）；無法組合的部分再開發新功能。manager 角色可由同一人提出並核准。
13. **參數版本鎖定時點**（2026-10-25，user）：工單開工時鎖定參數集版本（4.9 規則 2）。

14. **同意修改 aov-project**（2026-10-25，user）：範圍為判定節點的資料模型與求值，使檢驗項目可由參數表資料列驅動。修改前先備份（該專案沒有 git，沿用 D95 的做法），其測試通過後才以 `scripts/sync-aov-core.mjs` 同步到本專案，不直接手改 `libs/aov-core`。
15. **警報的呈現與處理**（2026-10-25，user）：第一版只做畫面與紀錄，不做外部通知；收件角色含 `admin` 與 `manager`；須人工確認才解除；未確認時依設定的時間間隔重複發送。
16. **求值器採方案 (a)**（2026-10-25，user 同意建議）：工廠部署內含與 `source.aovCoreCommit` 相同版本的 TS 求值器，以僅限本機的程序供 Python 工廠端呼叫；部署時須驗證 Node 執行環境能放進 D126 的映像。
17. **B 的子步驟對應不了就捨棄**（2026-10-25，user）：B 的子圖步驟（form、validate、store、state）無法對應到 A 的內容時直接捨棄，不阻擋發布。捨棄項目仍須列入遷移報告，不得靜默丟失（專案規範：嚴禁靜默失敗）。此項取代 `MERGE-PLAN-20261024.md` 5.1 節「保存來源且阻擋發布」的建議。
18. **核准流程先做測試再評估**（2026-10-25，user）：先驗證現有機制能否組合（見 8.2 第 1 項），結果出來後再決定是否新開發。

19. **縮小的核准流程新開發範圍**（2026-10-27，user 同意）：只在參數集服務內實作提案狀態與「提出者不得等於核准者」規則，不做通用核准引擎。
20. **`admin` 可自己提出並核准**（2026-10-27，user）：與 `manager` 相同，提出者與核准者可為同一人；其他角色須為不同人。
21. **警報使節點 `held`**（2026-10-27，user）：參數超出範圍且警報未確認時，阻擋該節點的開工與完工。工廠端需有 `held` 狀態與對應的拒絕回應；此為新增的工單行為，須有測試。

22. **`held` 的解除條件**（2026-10-27，user）：有人確認警報即解除。
23. **警報重送間隔放在參數集**（2026-10-27，user）：以 `alarmIntervals` 保存，受 4.9 的核准與版本鎖定規則約束。

### 8.2 開放問題

1. **核准流程的現有機制檢查結果（2026-10-25，靜態閱讀設計文件與資料模型，尚未執行測試）。**
   - entry-permission-kit：可表達「提出」與「核准」兩個入口，各自設定可用角色與使用者覆寫（`docs/entry-permission-design.md` 第 3、4 節）。**不能**表達「提出者與核准者是否同一人」，因為它只做每次請求的角色判定，沒有提案資料。
   - audit-edit-kit：`RowEdit` 只記錄**已發生**的修改（`before_json`、`after_json`、`reason`、`created_by`），沒有待核准狀態，且綁定 generic-forms 的資料列修改路由。無法承載「待核准」的提案。
   - 結論：授權部分可用現有機制；提案狀態與「提出者不得等於核准者（manager 除外）」須由參數集服務自己實作。這已包含在 4.9 的 `status`、`proposedBy`、`approvedBy` 欄位中，不需要通用的核准引擎。待 user 確認這個縮小的新開發範圍。
   - 實測（2026-10-27，Claude 執行）：沿用 `kits/entry-permission-kit/tests/e2e` 的組裝方式（真實 PostgreSQL 16.6、真實 HTTP、真實 entry-permission 中介層），加入 `params.propose`、`params.approve` 兩個入口與兩條測試用替身路由，共 19 項檢查全數通過。涵蓋：預設角色放行與拒絕（operator 可提出不可核准、manager 皆可、audit 皆不可）、使用者覆寫（授權單一 operator 核准、另一人仍被拒；拒絕單一 manager 核准、仍可提出）、角色層授權、`/api/entry-points/me` 可見性。測試檔在暫存目錄、未入 repo；路由是替身，**不是**工廠端實作。
   - 實測發現 1：已知入口即使對 `admin` 也依「覆寫 > 角色 > 預設」判定。工廠入口若未在 `defaultRoles` 明列 `admin`，`admin` 會得到 403（第一輪實測即如此）。依 8.1 第 20 項，兩個入口的 `defaultRoles` 須含 `admin`。
   - 實測發現 2：中介層把 `actor_user_id` 與 `actor_role` 放進 `request.state`，服務可據此實作「提出者不得等於核准者（manager、admin 除外）」。同一使用者同時提出與核准能通過入口層，證實此規則須在參數集服務內。
   - 限制：未測工廠端真實路由、跨 worker、與正式部署；`entry_points.json` 為測試目錄。
2. 無（原第 2、3 項已於 2026-10-27 決定，見 8.1 第 22、23 項）。
3. **正規化與現有雜湊函式不一致。**第 5 節要求字串以 UTF-8 NFC 正規化，但 `libs/aov-integration` 的 `canonicalJson` 不做 NFC。目前 fixtures 全為 ASCII，兩者結果相同。W1 產生計畫時須擇一：在 `canonicalJson` 加 NFC（會影響既有整合包雜湊），或另寫計畫專用的正規化。待決定。
4. **`alarmRules` 與 `paramTables` 的欄位細節。**第 4.6 節只寫概要，schema（`schemas/executable-plan.schema.json`）已依概要定出欄位（`alarmRules`: `ruleId`、`nodeId`、`expr`、`minRole`；`paramTables`: `tableId`、`columns`、`defaultRows`、`usedBy`）。`alarmIntervals` 的預設間隔尚未定義，schema 未含。


## 9. 驗收條件（契約層）

- 相同專案檔、相同動作庫、相同對應表，兩次編譯得到相同 `planId`。
- 改動任一節點的表單內容，新計畫的 `planId` 改變，舊 `planId` 的計畫仍可讀取且不變。
- 任一節點缺工時時，`timing.state` 為 `missing`，而不是 0。
- 對應不到能力的節點，`executable` 為 `false` 且有 `reason`，計畫不得用於建立工單。
- 順序線不出現在 `flows`，只出現在 `businessOnly`。
- 引用子 AoV 的專案，展開後的計畫不含子流程節點，內部節點 id 帶 `<子流程節點 id>/` 前綴並有 `expandedFrom`；修改子 AoV 並發布新版本後，重新編譯得到新的 `planId`，舊工單仍指向舊 `planId`。
- 計畫本體不含系統邏輯疊層；修改疊層不改變 `planId`。
- 修改並核准參數後，新開工的工單使用新的 `setVersion`，已開工的工單仍指向舊的 `setVersion`；兩者的 `planId` 相同。
- 溫度由 20±5 改為 25±5 並核准後，警報範圍隨之改變，計畫與 `planId` 不變。
- 檢驗項目由 5 項增為 6 項只需新增參數表的一列並核准，不需重新發布計畫（待 8.2 第 1 項授權並完成 aov-core 修改後才可驗收）。
- 被駁回或待核准的參數集不影響任何工單。
- 工廠端對第 6 節每一種拒絕條件各有一個反例測試。

## 10. 下一步

1. 完成 8.2 第 1 項的核准入口實測，。
2. 已完成（`feature/executable-plan-schema`）：`schemas/executable-plan.schema.json`、`fixtures/executable-plan/`（合法、缺工時、不可執行、`planId` 不符、內容被改、未知版本）與 `libs/aov-integration/executablePlan.test.ts`。
3. 在 `libs/aov-integration/` 擴充編譯端產生計畫的轉接，並加入確定性測試。
4. 工廠端的接收與驗證留待 W3。
