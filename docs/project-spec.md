---
title: Composer Platform 重構專案規格
version: 0.1.1
status: draft
date: 2026-09-24
source_conversation: 6ab37f74-8ec0-83e8-881b-b59310b07a1e
---

# Composer Platform 重構專案規格

## 1. 文件範圍與決策狀態

Composer 定位為：以 Kit 組裝功能、以 Function 作為最小能力與參數描述單位，透過 Configuration、UI Schema、Permission、Migration 與 Site Profile 產生 System Package 的平台。

**需求（2026-09-24 決議）：**本專案是既有 Form System Kit Composer（下稱「基線版」）的改良版，並將撰寫成論文。因此每項設計須能說明相對基線版的差異與改良理由；與基線版概念相同者沿用既有名稱，不以改名充當改良。論文章節架構與評估方法待確認。

本文件整合原對話的十項需求、後續 UI Canvas 與通用分析需求，以及當前使用者指定的整理範圍。標記方式：

- **需求**：使用者明確提出的方向，應保留於後續實作。
- **建議**：原助理提案或本次補足的可落地規則，尚不是已核定決策。
- **待確認**：需要既有程式、資料、使用情境或負責人才能決定。

本次未讀取 Composer、`daihui_project`、`analytical_four` 原始碼，也未驗證其實際演算法、API、DB 或部署方式。既有 Obsidian 筆記提及 analytics-kit 曾經存在及調整，因此未來必須先盤點名稱與相容性，不能直接覆蓋。文中的資料欄位、命名、框架及優先序皆為建議契約；AoV 不擅自展開縮寫。

## 2. 需求追溯

| ID | 原始需求／本次整理範圍 | 對應章節 |
|---|---|---|
| R01 | Developer、MIS、一般 User 三級使用者 | 3 |
| R02 | GUI、專業工具、修改程式碼三種修改層級 | 3 |
| R03 | 業務可調參數抽離為多份設定檔，排除基礎設施運作參數 | 5 |
| R04 | DB 物件具有可操作的遷移腳本 | 7 |
| R05 | 表格、下拉與圖表採統一輸入格式及解析 | 6 |
| R06 | daihui_project 入口權限成為可選 Kit，並取代基線版 tenant-auth-kit | 8 |
| R07 | Kit／mService／Function／System 與最精簡 AoV | 4 |
| R08 | 按所選 Kit 動態組合操作手冊 | 11 |
| R09 | 每個可修改項目標示可設定的人及風險 | 3、5 |
| R10 | 根據現場規格調整產物 | 9、12 |
| R11 | 以畫布設定使用者指定的表格樣式 | 6 |
| R12 | analytical_four 依場域與輸入自動選擇及執行演算法 | 10 |
| R13 | Site Profile、System Package 與新專案目錄、README | 9、12、14 |
| R14 | 以 AoV Workflow 指定各步驟填寫的表單，並定義表單關聯與可追溯性 | 4.2、12、13 |

## 3. 使用者、修改方式與風險

角色表示操作資格，修改層級表示完成修改的方法；兩者是獨立維度，不能把 GUI 等同於低風險，也不能讓 Developer 自動取得所有正式環境資料權限。

**首期實作限制（2026-09-29，WP6）：**Composer 尚無身分機制，User／MIS／Developer 與 `allowed_roles` 僅作顯示提示；現有驗證檢查契約與值，不代表拒絕未授權使用者。身分授權測試明列「未涵蓋」，待串接可信身分來源及授權邊界後驗收。

| 使用者 | 預期能力 | 邊界（建議） |
|---|---|---|
| L1 User | 選取被授權 Kit、操作系統、調整允許的顯示與低風險參數 | 不直接修改 DB schema 或來源程式 |
| L2 MIS | 場域 mapping、進階設定、依程序執行遷移與維護 | 不要求理解底層程式；仍須具體資源授權 |
| L3 Developer | 建立 Kit、mService、Function、renderer 與 migration 策略 | 透過版本、審查及部署流程交付程式變更 |

| 修改層級 | 定義 | 例子 | Composer 責任 |
|---|---|---|---|
| A GUI | 現有介面可完成 | 欄位順序、名稱、允許的閾值 | 驗證、預覽、權限檢查、異動紀錄 |
| B Technical | 使用專業工具完成 | DBeaver 執行核定遷移、大量資料轉換 | 產出步驟、前置條件、腳本、驗證與復原方法 |
| C Code | 現有抽象無法描述，需改程式 | 新 renderer、新 protocol、新 Function 類型 | 明確顯示 Requires Developer Extension |

**需求：**每個可修改項目標示角色與風險。**建議 metadata：**`editable`、`allowed_roles`、`change_level`、`risk`、`impact`、`restart_required`、`migration_required`、`breaking_change`、`rollback_strategy`。風險暫分 low／medium／high／critical，具體分級門檻待確認。

顯示名稱可以是 A／User／low；權限規則即使在 GUI 修改，也可能是 A／MIS／high；破壞性欄位轉換可以是 B／MIS 或 Developer／critical。介面顯示與後端授權使用同一政策來源，API 必須重新驗證，不能只隱藏按鈕。

## 4. 核心單位、資料契約與 AoV

**需求階層：System → Kit → mService → Function。**

| 物件 | 定義 | 建議必要資料 |
|---|---|---|
| Function | 最小能力描述單位，參數定義在此 | id、version、input/output contract、parameters、permission、risk、dependencies、runtime requirements、primitives |
| mService | 組合 Functions 完成一項能力 | id、version、function references、執行順序或依賴、輸入輸出、失敗策略 |
| Kit | 可單獨選取並執行的功能單元，由一或多個 mService 組成 | id、version、入口、service references、provides／consumes capabilities、依賴、相容性、預設設定、手冊 references |
| System | 一或多個 Kit 組成的最終系統 | id、version、kit versions、bindings、site reference、有效設定、AoV reference |
| Site Profile | 場域差異與約束 | id、version、設備／欄位 mapping、單位、業務限制、分析偏好 |
| Artifact | 組裝輸出物件 | id、type、path、version、來源、checksum、相容性與驗證狀態 |

Kit 可單獨執行表示具有明確入口、可驗證的相依條件與最小運行方式，不代表零依賴。mService 是邏輯能力集合，不預設為獨立網路微服務。共用 Function 以穩定 id 與版本引用，不複製多份定義。

### 4.1 Capability 與 Primitive（2026-09-24 決議）

**需求：**一個 Kit 由多個 Function 協調完成一項完整功能。能力分兩層命名：

| 層級 | 名稱 | 意義 | 可引用者 |
|---|---|---|---|
| Kit | capability（沿用基線版） | 經 mService 協調後對外保證的完整功能 | 其他 Kit，經 `provides`／`consumes` 公開契約 |
| Function | primitive（原子能力；名稱暫定） | 單一 Function 能完成的一件事 | 僅限同 Kit 內的 mService |

關係：Kit capability = mService 協調 × 多個 Function primitive。其他 Kit 不得直接引用 primitive，維持基線版「不得跨圖直連內部 Function」規則。

**完整性檢查（相對基線版的新增機制）：**Kit 宣告的每個 capability，其所需 primitive 均須有 Function 提供，且 input/output 可依 mService 順序串接；缺少或無法串接時組裝失敗並指出缺口。基線版僅檢查 consumes 是否有 provider，不檢查功能完整性。

**AoV 需求：**Function 是最小單位，System 描述要精簡。建議 Function 只暴露 `function_id`、`input_ref`、`output_ref`、`primitive`；Kit 以 capability 彙整並保留可回查 Function 的 reference。參數完整規格仍位於 Function definition，AoV 只引用。不得只列 capability 而失去組成來源。

**待確認：**AoV 正式語意、既有格式與消費端；primitive 正式名稱、capability 與 primitive 的版本規則；「最小可執行單位」與既有流程是否一致。

### 4.2 AoV Workflow 驅動表單設定（2026-09-30 決議：D16–D21）

> 決策已核定（D16–D30），實作於分支 `feature/aov-workflow-forms`。

**需求：**一套系統通常需要多張表單，且表單在不同工作步驟填寫、彼此有關聯。使用者希望以 AoV 指定「哪個步驟填寫哪張表單」，並保留表單之間的關聯與可追溯性。

**名詞釐清（依基線版 `docs/kit-development-standard.md`）：**基線版 AoV 有兩種文件：

| 文件 | 視角 | 內容 | 本節是否使用 |
|---|---|---|---|
| Workflow | 業務 | 工作步驟、時機、負責職務 | 是（本節主體） |
| Dataflow | 技術 | System／Kit／mService／Function 四層（§4、§4.1） | 否；維持 §4 定義 |

基線版規範：Workflow 步驟與 Kit／mService 不必一對一；AoV 定義架構，不執行 API、Function、條件或迴圈。本節沿用此界線（D02、D18）。

**需求（D16）：驅動範圍只到「設定期」。**

| 層次 | 意義 | 本節範圍 |
|---|---|---|
| 設定期驅動 | 在 Composer 內以 Workflow 組織表單、關聯與功能建議 | 納入 |
| 執行期驅動 | 產出系統依 Workflow 派工、控管步驟狀態 | 不納入；列為未來工作。需流程執行引擎、權限（§8）與 migration（§7） |

**需求（D17）：AoV 為設定入口、必填、排最前。建議 Composer 流程：**

1. 流程步驟：建立 Workflow 步驟（名稱、時機、負責職務）。
2. 表單：於各步驟上傳去識別化樣本或手動建立表單，推測欄位後逐一確認型別、必填與驗證。
3. 表單關聯：指定表單之間以哪些欄位相連（例如批號），系統可提出候選，由使用者確認。
4. 功能選配：依表單與關聯以固定規則建議 Kit（例如存在關聯時建議「站點資料串聯」與「查詢與追溯」），使用者可調整；規則由程式判斷，不交給 LLM。
5. 輸出：Recipe 與 Workflow 文件，交付包內容見 §12。

**建議資料模型（Data-First；名稱暫定）：**

| 物件 | 建議欄位 | 說明 |
|---|---|---|
| WorkflowStep | id、name、when、owner（職務名稱）、formIds | 沿用現行 `composer-aov-list` 步驟欄位；`formId` 由單值改為陣列屬契約變更，需升版 |
| FormDefinition | id、name、fields[]（id、name、type、required、isKey） | 只含欄位定義，不含資料列或樣本內容（M01）；上傳建立時 name 預設為原始檔名（去副檔名），畫面提醒使用者去識別化（D27） |
| FormRelation | id、from（formId、fieldId）、to（formId、fieldId）、kind、origin、confirmed | kind 首期只有「共用識別欄位」；origin 為 inferred 或 user；未確認的關聯不得輸出 |

**Workflow 文件（`composer-aov-list` version 2）：**`steps`（`formIds` 陣列）、`forms`、`relations` 三個陣列；檔案中的關聯 `confirmed` 固定為 `true`。version 1 仍可匯入：步驟保留，`formId` 因無表單定義而清空並逐一列出。Recipe 以選填 `workflowRef { path, sha256 }` 記錄 Workflow 文件的檔名與 SHA-256（D29）。

**建議可追溯性定義：**任一表單紀錄可回答：在哪個 Workflow 步驟填寫、由哪個職務負責、經哪些已確認的 FormRelation 連到前後步驟的紀錄。關聯鍵須在兩端表單型別一致；型別不符時阻擋並指出欄位。

**需求（D19）：關聯首期只支援共用識別欄位，推測規則為確定性：**兩張表單中欄位名稱去除空白後相同、型別相同、且至少一端標為 isKey，列為候選；候選一律需使用者確認，推測不得自動生效。找不到伴侶欄位的識別欄位，畫面列出原因（名稱相同但型別不同、名稱相近但不相同），只提示不生效（D61）。

**需求（D20、D29）：**表單定義與關聯存於 Workflow 文件；Recipe 只記錄 Workflow 的 reference 與 checksum，Recipe schema 僅新增選填欄位 `workflowRef`，向後相容。

**已確認（2026-09-30，原待確認四項）：**

1. 關聯基數（D22）：不記錄基數，紀錄層級以值相同連結，天然支援一對多與多對多。表單層級限制：同一對表單最多一條、不得自連、整體不成環、單一欄位對。
2. 步驟與表單（D23）：一個步驟含 0..N 張表單；每張表單恰屬一個步驟，且必須指派。
3. 「站點資料串聯」關聯模型（D24）：`Station`＋`StationSchema`（`unique_key_fields` 對應 isKey）對應 FormDefinition；`StationLink`（有方向、唯一 `(from, to)`、每流程禁止成環、`link_config.keyMappings` 單一欄位對）對應 FormRelation，D22 的限制使兩者可一對一轉換。模型與建立關聯的 API 位於 `generic-forms-kit`，追溯查詢位於 `query-traceability-kit`。缺口：基線版追溯查詢只比對 `GenericRecord.lot_no`、不讀 `keyMappings`，非批號的共用欄位在執行期不生效，列為未來工作（D16）。
4. 多檔上傳（D25）：單檔 2 MB／100 欄／10000 筆；一次最多 10 檔、合計 20 MB；Workflow 最多 50 張表單；各檔獨立推測，失敗逐檔列出原因。

**功能建議規則（首期）：**存在已確認的表單關聯時，建議「查詢追溯」流程；「查詢追溯」綁定「通用表格管理」（D26）。建議不自動套用，由使用者加入。

### 4.3 Workflow Action 與 Kit Registry（2026-10-02 決議：D62、D66–D69）

> 實作於分支 `feature/workflow-action-registry`。資料與推導已完成；畫面由後續功能處理。

**方向（D62）：**組裝由 Workflow 驅動。步驟內的 Action 決定所需 capability，再由 Registry 找出實作它的 Kit；使用者不再從固定清單選配，可檢視推導結果並調整。Kit 仍是 capability 的封裝單位（D04）。

**資料模型（Data-First）：**

| 物件 | 位置 | 內容 |
|---|---|---|
| ActionType | `config/actions.json`、`schemas/action-catalog.schema.json` | `id`、`name`、`description`、`requires`（capability，沿用基線名稱）、`requiresKits`（必帶 Kit，每項附原因）。依業務動作分類：建立表單、匯入紀錄、串聯表單、查詢追溯 |
| 步驟內 Action | `schemas/aov.schema.json` version 3 | `steps[].actions[]`，每項只存 `actionId` 與 `formIds`；Kit 與 capability 一律推導，不寫入文件。version 1、2 匯入時升為 3，version 2 無資料遺失 |
| KitRegistry | `config/registry/<kit-id>.json`、`schemas/kit-registry.schema.json` | capability → mService → Function 三層。每個 capability 記錄 `declared`（基線契約是否宣告）、`implementedBy`（原始碼實際所在）、`verified`，差異必須附說明 |

**驗證與推導：**

- `checkRegistry`：引用是否斷裂、每個 mService 的 Function 能否依序由輸入串接到輸出（§4.1 完整性檢查）；結果分為 error（自相矛盾）、gap（無法證實）、note（基線契約與原始碼的差異）。
- `deriveKits`：Kit 的來源有三種並逐項記錄原因：Action 所需 capability 的實作者、Action 的必帶 Kit、已選 Kit 的 consumes 所需的實作者（含契約未宣告的原始碼相依）。多個實作者時不自動選，列為待決；無法證實的 capability 與未登錄的 Kit 列為缺口。
- 與表格相關的四個 Action 一律帶出通用表格管理與站點資料串聯（D69）。
- Workflow 驗證：不存在的動作、同一步驟重複動作、動作引用不存在的表單會拒絕匯入；動作引用的表單已不在該步驟時顯示為步驟錯誤並擋下匯出。

**第一版範圍（D68）：**只登錄 `generic-forms-kit`、`station-data-link-kit`、`query-traceability-kit` 與 `platform-core-kit` 的 `db.*`；其餘 Kit 視為契約未完整，不參與推導。`flows.json` 暫時保留，測試證明查詢追溯的推導結果涵蓋其選配後再退役。

**基線版契約與原始碼的差異（登錄資料如實保留，不修正）：**

1. `station-data-link-kit` 沒有原始碼，其 `db.*` 能力實作在 `platform-core-kit`；`platform-core-kit` 的契約也宣告其中三項。
2. `query-traceability-kit` 契約的 `query.records.search` 在原始碼找不到對應路由。
3. `query-traceability-kit` 直接 import `generic-forms-kit` 的 `Station`、`StationLink`，契約未宣告；這是 D26 的實際原因。
4. `generic-forms-kit` 契約只宣告兩條端點，建立表單、設定 schema、匯入、站點串聯等實際端點未宣告。
5. `db.tenants.read` 只由已廢除的 `tenant-auth-kit` 提供（D03），仍被多個 Kit 使用。

**待後續：**畫面（在步驟內選擇 Action、檢視推導原因、處理待決與缺口）；其餘 Kit 的登錄；`flows.json` 退役；mService 與 Function 的版本規則。

### 4.4 畫布式 Workflow 文件 version 4（2026-10-02 決議：D70–D75）

> 資料模型、驗證與轉換已實作於分支 `feature/workflow-graph-model`；畫布畫面由功能 2 處理。

**方向：**Workflow 由畫布建立，完整建立後才由所選節點推導 Kit、mService 與 Function（§4.3）。節點可再往下建立子 AoV。

**文件（`composer-aov-list` version 4，沿用基線版 AoV 名稱）：**`rootGraphId`、`graphs[]`（`nodes[]`、`edges[]`）、`layout`、頂層 `forms` 與 `relations`。節點：`id`、`name`、`when`、`owner`、`actionId`（可為空）、`params`、`formId`（可為空）、`childGraphId`（可為空）。

| 規範 | 內容 |
|---|---|
| 節點與動作 | 一個節點最多一個 Action，取代 version 3 的「步驟含 0..N 個 Action」；無 Action 的節點是純業務節點，不產生 Kit。推導輸入為所有 graph 的 `actionId` 聯集 |
| 連線 | 只表示先後順序；無文字、無條件、不得成環、不得自連、不得重複、不得跨 graph；多條出線視為平行（D18） |
| 子 AoV（D71） | 最多 3 層，第 3 層節點不可再有子流程；graphs 為一棵樹，子流程不可共用；每個 graph 最多 100 節點，整份文件最多 30 個 graph、50 張表單。超出即拒絕匯入，不截斷 |
| 節點表單（D72） | 節點最多一張標準表單，每張表單恰屬一個節點；欄位 `validation`：整數與小數 `minimum`／`maximum`，文字 `maxLength`／`allowedValues`，日期 `minimumDate`／`maximumDate`（ISO 8601 `YYYY-MM-DD`，須為有效日期），是／否無規則。關聯沿用 `relations` |
| 動作參數（D73） | ActionType 的 `parameters`（number、text、boolean，可有預設與範圍）與 `needs`（`form`、`relation`）。首批只含原始碼可查證的參數：`allowDuplicate`、`flowCode` |

**驗證分兩類（同 version 3 的作法）：**結構錯誤（重複識別碼、斷裂引用、超過層數、成環、共用子流程、表單歸屬、未知參數與型別錯誤）拒絕匯入並保留原流程；完成度錯誤（未命名、必填參數缺值、數值超出範圍、動作所需的表單與關聯缺少、欄位規則自相矛盾、表單未指派節點）在畫面顯示並擋下匯出。

**舊格式轉換（D75）：**`importWorkflow` 可讀 version 1 到 4，一律回傳 version 4。步驟依序展開為根 graph 的節點並串接；Action 作用於多張表單時屬有損轉換，逐項提示。`importAov`（目前的列表畫面）遇 version 4 回報尚未支援；列表頁面於功能 2 退役。

**畫布外觀（D74，功能 2）：**所有節點皆為圓形、只顯示名稱，細項在右側節點細項；連線不顯示文字。

### 4.5 工廠層、開始與結束（2026-10-05 決議：D78–D83）

> 實作於分支 `feature/factory-layer`。文件升為 `composer-aov-list` version 5；§4.4 的 version 4 規範仍適用於每一張圖。

| 規範 | 內容 |
|---|---|
| 工廠（D78） | `factories[]`（`id`、`name`、`logicGraphIds[]`）取代 `rootGraphId`。工廠只是容器，沒有自己的節點與連線，用清單管理而不是畫在畫布上。最多 20 個工廠、每個工廠最多 20 個生產邏輯、整份文件最多 100 張圖 |
| 生產邏輯（D79） | 工廠底下最上層的一張圖（原「主流程」）。D71 的 3 層上限不變，由生產邏輯算第 1 層，工廠不算層。建立流程時先為工廠命名，再按「建立生產邏輯」 |
| 開始與結束（D80） | 節點新增 `kind`：`start`、`end`、`node`。每張圖（生產邏輯與子流程）建立時自動各有一個開始與結束，不可刪除、改名，不可有動作、參數、表單、子流程；開始無入線、結束無出線。每個一般節點都必須在開始到結束的路徑上，每張圖至少一個一般節點，否則為完成度錯誤。連線只在使用者畫出時存在：新增節點不自動接線，刪除節點也不自動接起前後節點（D84）；連線有方向箭頭並確實接到連接點 |
| 關聯與推導（D81） | 表單關聯只允許在同一個工廠內（跨工廠為結構錯誤，畫面也不提供候選）。功能推導取所有圖的聯集，原因文字帶上工廠與生產邏輯名稱 |
| 舊文件升級（D82） | version 4 放入「預設工廠」，原主流程成為它的第一個生產邏輯，每張圖補上開始與結束並接線；version 1 到 3 先轉成圖形再升級。`importWorkflow` 一律回傳 version 5 |
| 畫面（D83 到 D85） | 側欄不顯示專案與場域，以右緣圖示按鈕收合；工具箱先列類別、點開才列工具（類別由動作的 `category` 決定），新增為工具名稱右側的圖示按鈕；節點直徑 64px；連線有箭頭；匯入為工具列上的按鈕；細項只在選取節點時出現 |

**已確認的解讀（2026-10-05）：**工廠與場域（Site Profile，D54）是不同概念，場域設定不變；開始與結束的範圍為每一張圖。

## 5. Configuration-first 與參數解析

**需求：**可調整的業務參數抽出程式碼，依責任拆檔；基礎設施正常運作參數不納入本次業務設定治理。連線憑證與秘密值使用外部秘密來源引用，不寫入一般設定、UI Schema、手冊或套件。

| 設定範圍 | 目錄／預期檔案 | 責任 |
|---|---|---|
| System | 未來的 config/system.json | Kit 選擇、連接與 System 級設定 |
| Kit | config/kits/ | Kit 預設值或覆寫 |
| UI | config/ui/ | 元件、版面與資料綁定實例 |
| Permission | config/permissions/ | 主體、資源、操作政策 |
| Database | config/database/ | 期望資料模型；不是直接執行 SQL |
| Runtime | config/runtime/ | Function 業務參數 |
| Site | config/site/ | 現場差異與限制 |

建議先以 JSON 統一機器契約，是否提供 YAML 編輯入口待確認。UI definition 是資料實例；`schemas/` 的 JSON Schema 是驗證資料實例的契約，兩者不可混淆。

**建議優先序（低 → 高）：**Function default → Kit default → System configuration → Site profile → 授權的 Runtime override。

合併規則建議：物件依已知欄位遞迴合併、純量取較高層值、陣列整體取代；缺省代表繼承，null 只有契約允許時才是有效值。未知欄位、型別錯誤、越界與禁止覆寫欄位均拒絕。Site 的硬性限制是最終驗證條件，Runtime override 不能繞過；政策、風險與可修改角色也不能由一般值覆寫升權。

每個參數定義至少包含型別、單位、必填／預設、範圍或枚舉、用途及修改 metadata。解析結果必須能顯示「有效值來自哪份檔案／哪一層」，並記錄設定版本與修改者。執行期覆寫需限定有效期間與記錄實際值；不自動回寫永久設定。

## 6. UI Canvas／UI Schema Builder

**需求：**使用者在組裝時以畫布設定表格樣式，並讓表格、下拉選單、圖表等使用一致 JSON 輸入與解析方式。

建議分三層：Layout（row、column、panel、tabs）、Component（table、form、select、button、chart）、Data binding（source、field mapping、filter、sort、permission）。首期先完成表格與下拉；圖表延至後續階段（2026-09-27 決議），R05 的圖表需求保留，其餘元件按真實需求擴充。

操作流程：選資料來源 → 放置元件 → 選欄位 → 調整排列與尺寸 → 設定顯示、事件與權限 → 驗證 → 預覽 → 儲存 UI definition。User 調整被允許的外觀，MIS 設定來源與 mapping，Developer 擴充元件類型。

首期已實作 `schemas/ui-definition.schema.json`（1.0.0）、共用 `libs/ui-runtime/` 解析與 React renderer，以及三個 mock Kit 的分頁、表格／下拉設定與 Recipe JSON 匯入／匯出。正式系統整合、完整 Canvas 及真實資料來源尚未實作。以下為**早期建議資料形狀，不是現行 validator 的輸入範例**：

```json
{
  "schema_version": "0.1.0",
  "id": "production_table",
  "type": "table",
  "title": "生產紀錄",
  "source_ref": "production_records",
  "layout": {"width": "100%"},
  "columns": [
    {"field": "lot_no", "label": "Lot No", "width": 180},
    {"field": "status", "label": "Status", "renderer": "badge"},
    {"field": "weight", "label": "Weight", "unit": "kg"}
  ]
}
```

建議處理流程：JSON 驗證 → 正規化 → 依 type 對應 renderer → 綁定授權資料 → 顯示。Component Registry 初期可只是名稱到 renderer 的對照，不需要先建立外掛框架。**決議（2026-09-27）：**Composer 預覽與產出系統前端皆採 React 18 + TypeScript，共用同一套解析與 renderer，與基線版 Target System 技術棧一致。

拒絕不存在的欄位與未知 renderer；事件只引用核准 action，禁止任意 JavaScript／SQL 字串執行。拖拉須提供鍵盤或表單替代操作；預覽與正式顯示共用解析邏輯。排序、分頁及篩選保留後端權限限制。UI 欄位順序不觸發 DB migration；修改實際資料型別才進入資料模型流程。

首期 Recipe 0.3.0 的 `selectedSubfeatureOptions` 保存覆寫值，`uiOverrides` 只保存 Kit／UI 版本。0.2.0 匯入時以目前定義補版本並顯示遷移來源，重新驗證全部引用；失敗整份拒絕，不部分覆寫工作階段。匯入／匯出僅處理 UI 設定範圍，其他欄位不保留並顯示提示；不包含資料列或連線憑證。取消 Kit／subfeature 暫留草稿，匯出只取已選項目（暫行政策）。自由文字不得填入秘密值；此功能不取代 M01 去識別化程序。

## 7. DB Migration

**需求：**涉及資料庫結構的物件須能產生可操作的遷移腳本。建立規格或拖拉畫布不直接修改正式 DB。

建議流程：取得實際 schema／migration history → 比對期望模型 → 產生差異與風險 → 產生遷移包 → 測試環境驗證 → 授權人員依維護程序套用 → 驗證 → 寫入歷史。

每個遷移包包含：`up.sql`、`validate.sql`、`metadata.json`、操作 README；可逆時附 `down.sql`，不可逆時明確提供備份／還原或前向修復程序，不製造虛假的 rollback。

Metadata 建議包含 migration id、來源 Kit/version、DB 方言/version、起訖 schema version、前置 migration、checksum、影響物件、資料量假設、風險、操作角色、鎖表／停機需求與可逆性。

執行前檢查實際版本及漂移，失配即停止；用 history 與鎖避免同時或重複套用。依 DB 能力採交易；不支援交易的 DDL 必須提供中斷後恢復步驟。刪欄、縮型別、重新編碼等需獨立標示資料損失風險，不能靠 down.sql 假裝復原。驗證包含 row count、null、唯一性、FK 與關鍵業務不變量。

**待確認：**目標 DB、既有 migration 工具、備份責任、可接受停機時間。確認前不產出可執行 SQL。

## 8. daihui_project 入口權限 Kit 化

**需求：**將入口權限加入 Composer 可選 Kit。暫名 `entry-permission-kit`。

**需求（2026-09-24 決議）：**`entry-permission-kit` 取代基線版的 `tenant-auth-kit`，後者廢除。權限模型為**單租戶、多使用者**：隔離單位是使用者／角色對資源與操作的存取權，不再有租戶間資料隔離。

**決議（2026-10-22，D127，設計見 `docs/entry-permission-design.md`）：**租戶固定為單一預設租戶；角色為資料表可設定；入口目錄由各 Kit 宣告並於組裝時彙整；以共用中介層取代對終端使用者的 API key 驗證；SSO、MFA 不做。下列原待確認項目除上述外仍需在實作中逐項核對。

**待確認（廢除 tenant 的連帶影響）：**基線版的 tenant key（StationSchema 的 tenant／business key 規則）、multi-tenant API key auth、`/api/auth/*` 現有端點、其他 Kit 對 tenant-auth-kit capability 的 consumes 宣告，以及既有資料的 tenant 欄位要移除或固定為單一值。

先盤點現有 login、session、入口／路由／API permission 及角色模型，建立相容契約後抽離，避免直接複製專案耦合。RBAC、audit 等為候選範圍；SSO、MFA 是擴充建議，非已確認需求。

Kit 宣告權限資源與操作、所需 identity provider/session 接口、預設拒絕行為與手冊。入口可見性與 API 存取須一致。未選此 Kit 的 System 必須明確採既有外部驗證、其他安全提供者或受限制公開模式；不得把「沒選 Kit」解讀成全權開放。

組裝時檢查其他 Kit 是否依賴權限能力；停用前提示影響並驗證替代提供者。Composer 自身的建置管理權限與產出 System 的使用者權限需分開建模。

## 9. Site Profile

**需求：**按現場規格動態調整產物，而不是為工廠 A/B 複製 Kit。

建議內容：場域 id/version、業務 domain、站點與設備 mapping、欄位語意／單位、格式與閾值、可用資料來源、分析偏好及硬性約束。以 `source_ref`／`secret_ref` 連接外部設定，不內嵌憑證。

分析偏好例：偏好可解釋模型、是否允許 GPU、最長執行時間、記憶體預算。欄位別名如 temp/temperature 不代表可以未經確認直接換算；單位與語意需驗證，多重映射歧義須回報。

同一份產品定義與 Kit 版本，搭配不同 Site Profile 可產生不同設定、UI、mapping、分析流程與手冊。

**首期契約（2026-10-01，D54–D60）：**

- 形式：匯入式 JSON（`schemas/site-profile.schema.json`）；一個設定交付包對應一個 Site Profile；Recipe 以選填 `siteRef { path, sha256 }` 記錄，交付包放 `config/site/site.profile.json`。
- 內容：場域識別、Site 層選項值（`optionOverrides`）、硬性限制（`optionLimits`）、欄位別名與單位語意（`fieldSemantics`）、資料來源引用（`dataSources`）。分析偏好與站點對應 Workflow 表單暫不做。
- 解析：Kit 預設 < System（Recipe）< Site；Site 設定的選項在 GUI 為「由場域鎖定」；有效值來源可追溯到 Site。
- 限制：`optionLimits` 套用到所有層的值，超出即報錯，不截斷；Runtime 覆寫待可執行組裝時設計。
- 語意：別名須唯一，歧義時回報；不自動換算單位；`confirmed: true` 才生效。
- 秘密值：只可引用，整份拒絕連線字串、帳密、金鑰與憑證。場域調整仍須通過完整型別、相依、權限與 migration 驗證。Site Profile 不能放任意業務程式來繞過 Function 契約。

## 10. analytical_four → analytics-kit／analytics-engine

### 10.1 定位與界線

**需求：**根據場域／輸入參數與資料，自動套用並執行合適演算法。**建議命名：**`analytics-kit` 是 Composer 可選功能入口；`analytics-engine` 是底層 mService 集合。名稱需與既有 analytics-kit 整合，並非宣告建立另一份重複 Kit。

「通用」表示在明確支援的任務與資料契約內跨場域重用，不保證處理所有資料。不能只由欄位型別推論使用者的業務目的；Auto 需有預先授權的任務政策或可確認的分析目標，歧義時回報待選目標。

### 10.2 資料流與職責

Input Adapter → Data Profiler → Task + Site constraints → Eligibility Filter → Candidate Ranking → Parameter Resolver → Feature Processing／Executor → Evaluator → Result Adapter。

| mService（建議） | Function 範例 | 責任 |
|---|---|---|
| Data Understanding | detect_schema、profile_data、infer_semantics | 取得資料型別、缺值、樣本量、時間結構與語意候選 |
| Algorithm Selection | filter_algorithms、rank_candidates、resolve_pipeline | 篩選合格演算法、依成本與偏好排序並回報理由 |
| Data Processing | clean_data、encode_data、scale_data | 執行已宣告的資料處理並保存轉換版本 |
| Algorithm Execution | train、predict、evaluate | 執行受控流程；不是每個任務都需要訓練 |
| Result Generation | generate_metrics、generate_visualization、generate_report | 統一結果供 UI 與手冊／報告使用 |

上述為邏輯分工，不要求每個 Function 建成獨立模組或服務。

### 10.3 Algorithm Registry 與選擇

每筆演算法定義建議包含 id/version、實作 reference、任務類型、輸入型別、target 要求、樣本／特徵限制、時間假設、參數範圍／預設、資源需求、相容版本、輸出契約與評估方式。

原對話的 Random Forest、Isolation Forest、LOF、One-Class SVM、PCA 是示例，不代表 analytical_four 已有這些實作；示例樣本門檻也不能直接當成通用統計規則。

先排除不合格演算法，再依任務、場域偏好和執行預算排序。無 target 不使用需要監督標籤的訓練流程；有 timestamp 不足以證明資料適合 forecasting，仍須檢查時間順序、頻率、缺口及目標。多個數值欄位也不代表 clustering 一定有業務意義。

沒有候選時回傳原因及修正方向，不強行執行。候選同分時依固定政策處理並記錄。超時、資源不足、執行失敗應回報明確狀態，不把失敗包裝成低可信度成功。

### 10.4 操作模式與結果契約

| 模式 | 行為 | 建議使用者 |
|---|---|---|
| Auto | 依已授權任務與政策自動選擇並執行 | User |
| Guided | 顯示候選、原因、成本，由操作者選擇 | MIS |
| Expert | 指定 algorithm／pipeline／parameters | Developer 或獲授權專業人員 |

模式不等於角色授權；Expert 不能繞過資料存取、參數範圍或 Site 硬性限制。自動調參與特徵選擇是後續可選能力，首期先做可重現的規則選擇。

執行輸入建議為 dataset reference、task、site version、mode、parameter overrides；輸出包含 run id、status、dataset fingerprint、選擇理由／排除原因、pipeline 與 algorithm versions、effective parameters、資料處理記錄、seed（適用時）、metrics、結果 reference、warnings、錯誤及耗時。結果交給 UI schema renderer，不讓演算法耦合特定頁面。

訓練與評估分離：分割資料後才在訓練集估計轉換；時間序列採時間順序評估，禁止未來資料洩漏。沒有 labels 時不得宣稱分類準確率。相同版本、輸入與 seed 應在記錄的環境與容差內可重現。

### 10.5 既有專案遷移建議

1. 盤點 analytical_four 的真實輸入、演算法、硬編碼現場條件、輸出與依賴。
2. 建立代表性資料與既有結果基準；敏感資料使用脫敏副本。
3. 先包裝一條既有流程為 Function/mService 契約，保持計算語意。
4. 將場域分支轉成 Site Profile，增加 registry 與資格篩選。
5. 用兩個場域設定驗證同一流程可重用，再接入 Composer、UI 與手冊。
6. 對照數值結果／容差與舊接口，保留必要相容入口；完成切換後再移除舊耦合。

## 11. 動態操作手冊

**需求：**每個 Kit 撰寫手冊片段，依所選 Kit 動態組裝。建議唯一來源放在 `manuals/kits/<kit-id>/<version>/`，以 user／mis／developer 分檔；Kit manifest 引用這些片段，避免兩份手冊來源漂移。

組裝依據為鎖定的 Kit/version、啟用功能、角色、Site Profile 與有效設定。產出目錄放 `manuals/generated/`，交付時複製進 System Package 的 docs。

每份 Kit 手冊至少包含用途、前置條件、可設定項目／角色／風險、操作步驟、輸入輸出、常見錯誤與復原。

**手冊片段契約（2026-10-01，D48–D52）：**

- 位置：`manuals/kits/<kit-id>/<kit-version>/{user,mis,developer}.md`。`<kit-version>` 為 Kit 在 Composer 目錄中的版本（基線 Kit 為覆蓋層版本 `c4b2b7b-ui.1`，`entry-permission-kit` 為 `0.1.0`）。
- frontmatter（`schemas/manual.schema.json`）：`kitId`、`kitVersion`、`role`（user／mis／developer）、`status`（draft／reviewed）、`sources`（內容所依據的 Kit 檔案）。正文須含六節：用途、前置條件、可設定項目、操作步驟、輸入輸出、常見錯誤與復原。
- 範圍：Composer 目錄的 12 個 Kit 各三份，共 36 份。`tenant-auth-kit` 已廢除（D03）；`entry-permission-kit` 尚無程式，手冊只寫現況。內容只依 Kit 的 manifest、contract 與原始碼，查不到者寫「尚未提供」。
- 不一致：Kit 契約宣告與原始碼實作不一致時，以原始碼描述目前行為，另分列契約宣告並標示無可核對實作者為「尚未提供」（D53）。
- 狀態：初稿為 `draft`；正式發佈只接受 `reviewed`；設定交付包接受 `draft` 並在手冊首頁標示草稿。
- 組裝：只含已啟用的 Kit 與子功能，依相依排序；「可設定項目」表格取自選項定義；跨 Kit 路徑由所選流程的頁面清單組出；缺片段、版本不符、缺必備章節或 frontmatter 不合契約時，列出 Kit、角色與路徑並阻擋正式發佈。設定交付包的處理見 §12。只包含已啟用功能，依依賴排序，補上跨 Kit 的完整操作路徑；不能僅串接片段造成流程斷裂。缺少必要手冊、reference 失效或版本不符時阻擋正式套件發佈。手冊列示設定來源與版本，不輸出秘密值。

## 12. System Package 與組裝流程

**需求：**Composer 的主要輸出是可交付的 System Package。

建議組裝步驟：選 Kit → 解析相依及固定版本 → 套用 Site 與設定 → 驗證資料契約／權限／相容性 → 產生 UI、migration plan、AoV、手冊 → 產生驗證報告 → 封裝。

**需求（2026-09-30，D16–D21，見 §4.2）：**組裝步驟前加上「Workflow 步驟 → 表單 → 已確認的表單關聯」，且 System Package 須包含 Workflow 文件及其 checksum。可執行組裝（P2）完成前，Composer 產出的壓縮檔稱「設定交付包」，不得稱為可安裝系統（D21）。壓縮檔另於 `feature/install-package` 處理；目前 Workflow 文件與 Recipe 分別下載（D28）。

**設定交付包（2026-09-30，D31–D36；2026-10-05 D86）：**在輸出步驟下載單一 zip，內容只含實際產物，是交付時的主要檔案；Workflow 與 Recipe 仍可分別下載，收在輸出頁的「進階：個別檔案與載入設定」，用來重新載入設定（zip 本期不支援匯入）。可執行組裝（P2）完成後，交付包與安裝包合併為單一下載。

```text
<recipe-name>-delivery-<sha12>.zip
├─ package-manifest.json   格式、客戶代稱、Kit id／版本、各產物 path／role／sha256／bytes、notProvided
├─ README.md               說明「是設定、不能安裝」及包含／不包含項目
├─ config/system.recipe.json
├─ aov/workflow.aov.json
└─ validation/report.json  靜態檢查結果；測試環境演練與現場驗證標為「未執行」
```

所選 Kit 的手冊齊全時，交付包另含 `docs/manual-user.md`、`docs/manual-mis.md`、`docs/manual-developer.md`；不齊全時 `docs/` 列於 `notProvided` 並列出缺少的 Kit（D52）。zip 為 store 格式、固定順序與時間戳，相同設定產出相同位元組；manifest 不記錄產生時間。`kits/`、`frontend/`、`database/migrations/`、`permissions/`、`docs/`（手冊）、`deployment/` 未提供，列於 `notProvided`，不建立空目錄，也不附安裝腳本。靜態檢查任一未通過即不產生交付包。

### 12.2 防篡改、單機授權與通訊安全（2026-10-01，D37–D45）

**流程：**

```text
目標機器：get-machine-fingerprint（.ps1／.sh）→ { machineFingerprint, fingerprintSource }
簽章端（離線，私鑰在 repo 外）：generate-keys → sign-package <交付包.zip> → <交付包>.sig.json、license.lic
安裝前：verify-package → zip 簽章、授權簽章、授權的 packageManifestSha256、manifest 列出的各產物 SHA-256
產出系統啟動：license.py → 授權簽章 → 到期日 → 本機指紋（依 fingerprintSource）；任一失敗即拒絕啟動
```

**授權檔（`schemas/license.schema.json`）：**`{ payload, signature, algorithm: "RSA-PSS-SHA256" }`，`payload` 為簽章的原始 JSON 字串，內容為 `schemaVersion: "2.0"`、`issuedAt`、`expiresAt`、`licensee.name`（客戶代稱）、`recipe`、`enabledKits`、`machineFingerprint`、`fingerprintSource`（`windows-machine-guid`／`linux-machine-id`）、`packageManifestSha256`。zip 簽章沿用基線版 `schemaVersion: "1.0"`、`zipFile`、`sha256`、`recipe`。

**威脅模型（D44）：**可防一般使用者修改設定或交付包內容、把系統搬到另一台機器；無法防止具本機管理員權限並能改程式、或複製整機映像者。機器識別會隨 VM／磁碟映像複製（D38）。

**修訂（2026-10-25，D129 至 D134、D126；尚未實作，上方 D38、D39 的流程與欄位以此段為準）：**

- 機器綁定改為多硬體特徵指紋（系統 UUID、主機板序號、磁碟序號、網卡 MAC，符合 2 項以上通過），取代 `/etc/machine-id`；不使用 TPM。換硬體在容許範圍內自動處理，整機更換由客戶產生重新綁定申請檔，交回發行端換發。
- 簽發為兩層金鑰：根金鑰離線，只簽安裝包與子金鑰憑證；工程師的 USB 帶加密子金鑰與憑證（限客戶識別碼與有效期），在客機的安裝精靈輸入密碼後於記憶體中簽出授權。授權帶 `issuerCertificate`，驗證鏈為根公鑰、子金鑰憑證、授權簽章。
- 公鑰信任起點為操作手冊提供的 `install.sh` 與根公鑰 sha256，由工程師手動核對；通過後公鑰存入客機信任庫，升級包改對信任庫驗證。
- 安裝包與設定交付包合併為單一 `system-manifest.json`；簽章簽 `tar.gz`，授權綁確切 manifest 雜湊，啟動時核對已安裝 manifest 雜湊。
- 部署為 Docker Compose；執行中的指紋檢查由獨立 guard 容器負責，後端維持非 root。
- 威脅模型補充：根金鑰輪替需工程師到場；USB 被調包不列入；子金鑰遺失只能靠短有效期降低風險；有本機管理員權限者可改程式與驗證碼。

**通訊（D45）：**資料庫與後端同機時只監聽 127.0.0.1，不啟用資料庫 TLS；資料庫在他機時必須 TLS 並 `sslmode=verify-full`。後端不得直接對外開 port，只經反向代理。產出系統預設只供內網使用者連入、不對外網開放（D46）；瀏覽器到伺服器是否改用 HTTPS 及憑證來源待確認，方案比較見 decision-log「HTTPS 憑證來源」（§15）。秘密值沿用 `.env` 與檔案權限；前後端認證屬 §8。部署檔於 P2 產生，屆時列入組裝檢查。

```text
<system-id>-<version>/
├─ system-manifest.json
├─ kits/
├─ config/
├─ frontend/
├─ database/migrations/
├─ permissions/
├─ docs/
├─ aov/
├─ validation/
└─ deployment/
```

Manifest 建議記錄 system/build id、契約版本、Kit/Function 實際版本、Site 版本、有效設定來源、artifact 清單及 checksum、最低 runtime requirements、migration 起訖版本。外部程式或執行環境需以可解析的固定 reference 交付，不能宣稱套件自包含卻缺失依賴。

build 不等於部署成功。驗證報告分別列出靜態檢查、測試環境演練及現場待驗證項目。組裝期不得默默執行正式 migration。套件切換前檢查現場版本；migration 完成且驗證通過後再啟用對應程式／設定。若資料已不可逆變更，不可只回退程式包。

版本與相容性檢查包含 Kit 依賴、循環依賴、id 衝突、Function input/output binding、UI source/field、schema version、DB migration 順序、permission references 及手冊版本。所有缺失都應指出具體物件與修正位置。

## 13. 驗收情境

以下是未來實作的驗收標準，**不是本次已執行的測試**。

| ID | 情境 | 通過條件 |
|---|---|---|
| A01 | User 呼叫未授權的設定 API | 後端拒絕且保留稽核事件，繞過 GUI 亦無法成功 |
| A02 | 同一參數跨五層覆寫 | 有效值及來源可追溯；非法型別、未知欄位被拒絕 |
| A03 | Runtime override 超出 Site 限制 | 拒絕執行並指出限制 |
| A04 | 畫布改欄寬／順序後儲存再載入 | 版面一致，不產生 DB migration；鍵盤可操作 |
| A05 | UI 指向未知欄位或未授權資料 | 檢查失敗或依明確政策拒絕存取，不洩漏資料 |
| A06 | Kit 缺依賴、循環或版本衝突 | build 阻擋並列出完整衝突路徑 |
| A07 | DB 起始版本不符或重複執行 migration | 安全停止／識別已套用，不重複破壞資料 |
| A08 | 破壞性 migration 與中途中斷 | 提供且演練有效復原方法，不承諾不存在的 down |
| A09 | 兩個 Site 使用相同 Kit | 只變更宣告的設定／mapping，不需改 Kit 程式 |
| A10 | 無 labels 卻要求需標籤的訓練任務 | 清楚回報不合格原因，不切換成無關任務 |
| A11 | 分析無候選／超時／資源不足 | 回傳明確失敗狀態與已記錄的執行資訊 |
| A12 | 同資料與版本重跑分析 | 結果符合已定義容差，保留 seed、參數及環境 |
| A13 | 選兩個 Kit 及不同角色產生手冊 | 僅含啟用且授權內容，跨 Kit 步驟完整、版本一致 |
| A14 | 取消入口權限 Kit | 依賴驗證要求替代政策，不形成意外匿名全權 |
| A15 | 比對 System Package manifest | 必要產物存在、checksum 相符、秘密值未被打包 |
| A16 | analytical_four 相容性回歸 | 代表性既有輸入輸出在核定容差與接口範圍內相容 |
| A17 | Kit 單獨執行與 AoV 追溯 | 最小運行條件可驗證，Kit capability 可回查組成的 Function primitive |
| A18 | Kit capability 缺少 primitive 或 I/O 無法串接 | 組裝失敗並指出缺少的 primitive 或斷開的 binding |
| A19 | 其他 Kit 直接引用內部 primitive | 驗證拒絕，要求改經 capability 公開契約 |
| A20 | （§4.2）Workflow 步驟引用不存在或未完成的表單 | 阻擋確認並指出步驟與表單；不輸出引用失效的 Workflow |
| A21 | （§4.2）關聯鍵兩端型別不同 | 阻擋並指出兩端欄位；未確認的推測關聯不輸出 |
| A22 | （§4.2）匯出 Workflow 與表單定義 | 不含資料列或樣本內容；表單名稱預設為檔名並提示去識別化（D27）；Recipe 記錄的 reference 與 checksum 相符 |
| A23 | （§4.2）任一表單紀錄的追溯查詢 | 可回查所屬步驟、負責職務與經已確認關聯相連的前後表單 |

## 14. 分階段計畫與目錄責任

| 階段 | 工作 | 預期檔案／目錄 | 完成門檻 |
|---|---|---|---|
| P0 現況盤點 | 盤點三個既有專案、決定待確認事項 | docs/project-spec.md | 明確來源與相容性基準 |
| P1 契約 | 六種核心物件、修改 metadata、版本與設定合併 | schemas/、config/ | 正反例與 reference 檢查可執行 |
| P2 最小組裝 | 一 Kit、一 Site、一表格、manifest、AoV、手冊 | kits/、manuals/、packages/ | 完整產物可追溯且最小運行成功 |
| P3 資料與權限 | 指定 DB migration、入口權限抽離 | migrations/、kits/entry-permission-kit/ | 遷移／復原與拒絕存取驗證通過 |
| P4 分析通用化 | 包裝一條既有流程、registry、Auto/Guided/Expert | kits/analytics-kit/、services/analytics-engine/ | 兩場域共用與舊結果回歸通過 |
| P5 擴充 | 更多 UI、演算法、必要的調參與部署支援 | 依實際功能增加 | 成本與驗收清楚後才擴充 |

此排序是建議，P3／P4 可依真實依賴調整。初始資料夾詳見根 README；`.gitkeep` 僅用於保留空目錄。本次不添加框架、套件管理器或假實作。

## 15. 待確認與風險

1. AoV 的正式語意、現有讀取端與不可破壞的相容欄位。（部分已知：基線版分 Workflow 與 Dataflow 兩種文件，見 §4.2、D18）
2. Composer、daihui_project、analytical_four 儲存庫位置、版本及授權；既有 analytics-kit 如何合併。
3. 目標 DB、migration 工具、資料量與停機／復原條件。
4. 首期分析任務、實際演算法、評估指標、代表性資料與容差。
5. Runtime override 的可修改清單、期限、Site 硬性限制與角色授權。
6. 資料來源接口及 renderer 相容要求（UI 框架已定為 React 18 + TypeScript；首期元件為表格與下拉）。
7. System Package 的目標 OS／runtime、離線需求及部署責任。
8. Kit 單獨運行的最低環境、共享依賴與失敗隔離需求。
9. 內網前提下（D46），瀏覽器到伺服器是否改用 HTTPS 及憑證來源（維持 HTTP、每台自簽、內部 CA、公開 CA）（§12.2；比較表見 decision-log）。

主要風險：設定檔分散導致來源不明（以來源追蹤處理）、資料模型與 UI 變更混淆（分離契約）、假 rollback（明確不可逆性）、通用分析過度承諾（限定 registry 支援範圍）、文件與版本漂移（由固定 manifest 組裝）。

## 16. 本次交付與驗證邊界

本次交付為整合 Markdown 規格、根 README 與實體資料夾骨架。文件依完整來源對話整理，補充設計均以建議或待確認處理。未改動既有產品程式、未執行資料庫遷移、未宣稱演算法與部署已可使用。後續核定設計應修改本規格並更新版本，避免另建互相矛盾的完整規格。
