---
id: "20261015-aov-merge-contract"
title: "三代 AOV 合併：整合包契約與格式轉接（M02、M04）"
status: "in_progress"
owner: "claude"
reviewer: "claude"
priority: "normal"
created_by: "claude"
created_at: "2026-10-15"
updated_at: "2026-10-18"
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
3. 已滿足（2026-10-18，D101）：第 10 節契約經 user 核定。

# Claude Notes

## WP1（Claude，2026-10-15 完成）

- 成果：`docs/aov-merge-inventory.md`（格式與版本對照、8 項發現、去識別化處理）、`fixtures/aov-merge/`（a／b／c 共 18 份）。B 與 C 的樣本已用真實驗證器驗過；A 的 1.0 樣本與 C 的動作庫樣本未經機器驗證，報告中已標明。
- M03 已完成（D98）：C 新增 `checkProjectShape`／`checkLibraryShape`，`validateProject` 不再因結構錯誤丟例外；`npm.cmd run check` 通過。Codex 的 M02 驗證可參考其錯誤形式（診斷含 code `S0-shape`、位置前綴）。
- 開工條件 3 已滿足（2026-10-18，D101）：第 10 節契約核定，修正為單一 JSON 加 10 MB、`sourceVersion` 用內容 sha256、雜湊非簽章。WP2 的 schema 與驗證須照此實作。
- 排程：Codex 一次只做一個工作；本 thread 排在 `20261016-example-scenario` 之後，該 thread 交回並審閱後才派。
- 原計畫：

- 盤點 A、C、D 的格式、版本與樣本；C 的 id 規則；A 舊格式辨識特徵。
- 產出去識別化 fixtures（M01 安全基準：不含真實製造資料與秘密值），每種來源格式至少：合法一份、未知版本一份、結構損壞一份。
- 將決議寫入 decision-log，核定後把第 10 節定稿。

## 派工給 Codex

**預計完成時間：WP2 為 2026-10-18 12:00（約 8 小時，含額度緩衝）；WP3 待 WP2 審閱後另訂。** 以計畫書第 13 節日期為準，起算點為開工條件全部滿足當日。到期未完成由 Claude 接手。Codex 只寫程式與資料，不執行 git、不連網、不啟動伺服器；cwd 必須是專案根目錄。

### WP2 整合包 schema 與驗證（先做）

1. 新增 `schemas/aov-bundle.schema.json`，依計畫書 10.1 與 10.1.1（單一 JSON、10 MB 上限、`sourceVersion` 為內容 sha256、雜湊非簽章，D101），draft 2020-12，沿用既有 schema 的風格（`additionalProperties: false`、id 與長度限制）。
2. 新增驗證入口於 `libs/aov-integration/`（新目錄；沿用 `libs/ui-runtime/schema.ts` 的 Ajv 用法，不新增依賴）：輸入為未信任文字，輸出為通過的候選物件或逐項錯誤；通過前不得改動任何工作階段狀態（沿用 Recipe 先驗證候選再替換的模式）。
3. 測試（意圖要寫進測試名稱）：
   - 正常包往返相等。
   - 缺欄位、重複 ID、未知 format、未知 version、壞 checksum、缺依賴、同 id 不同版本，各自拒絕且錯誤訊息指出位置。
   - manifest 含絕對路徑、`..` 或不安全檔名時拒絕。
   - 內容含 `secret_ref` 以外的疑似秘密值欄位（連線字串、密碼）時拒絕。
   - 失敗時傳入的目前草稿物件與呼叫前深度相等。

### 2026-10-18 Claude 補充（派工前釐清，避免停止）

本輪只派 **WP2**，WP3 待 WP2 審閱後再派。

1. **不得引用 C（aov-project）程式碼。** C 在專案根目錄之外，且 M05 的引用方式尚未決議。整合包 schema 中，`aov` 欄位（C 的專案檔）與 `libraries` 內的動作庫只做外殼層驗證：`aov` 必須是物件且 `formatVersion` 為 1、有 `meta`（id、name、version、status）、`nodes` 與 `flows` 為陣列；動作庫必須 `formatVersion` 為 1、`kind` 為 `action-library`、有 `meta` 與陣列 `actions`。更細的結構檢查由 C 的 `checkProjectShape`／`checkLibraryShape` 在使用時負責（D98），本 schema 不重複。
2. **bindings 欄位形狀**：依計畫書 10.2 的表格自行定義最小可用結構（例如 nodes 為 `{platformNodeId, aovNodeId}` 陣列、forms 為 `{sourceFormId, sourceVersion, aovFormId, fields:[{sourceFieldId, aovFieldId, aovType, unit?}]}`），並把最終形狀記在 Codex Notes。細節與本說明不同時以可通過 fixtures 與測試為準，不必停止。
3. **平台文件 `platform`**：內嵌 B 的 v5 文件，可用 `$ref` 或在驗證入口先呼叫既有 `schemas.aov` 驗證；兩者擇一並記錄。
4. **fixtures**：`fixtures/aov-merge/` 已備好（b 側已改為去識別化範例情境，a／c 各有合法、未知版本、損壞樣本）。測試請用這些檔案組成整合包，不要自編含專有名詞的資料；整合包測試資料請放在 `fixtures/aov-merge/bundle/`。
5. **checksum**：沿用 `apps/composer-gui/src/workflow.ts` 的 `sha256Hex`；正規化 JSON 為遞迴鍵排序後序列化，由驗證入口導出，不新增依賴。
6. 本 thread 的停止條件仍適用；只有必須改既有 schema、既有測試意圖、新增依賴時才停止。

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

### 2026-10-18 WP2 第一段：規格與範圍核對

- 已核對 cwd、分支 feature/aov-merge-contract、HEAD a1b163f；起始工作區無變更。已讀指定文件與 D95–D98、D101。
- 本段變更：本 thread。typecheck／test／build 略過（規格核對階段，待實作完成執行）。Python 執行器因登入工作階段錯誤不可用，改用現有 Node；PowerShell pipe 初次編碼造成新 schema 說明亂碼，已改 UTF-8 並修復。

### 2026-10-18 WP2 第二段：契約與驗證入口

- 新增 schemas/aov-bundle.schema.json、libs/aov-integration/index.ts、fixtures/aov-merge/bundle/v1.valid.json；libs/ui-runtime/schema.ts 僅新增 schema 登錄。
- bindings 必填 nodes／forms／actions 陣列。nodes：{platformNodeId,aovNodeId,sourceVersion}，sourceVersion 為來源節點內容 sha256；forms：{sourceFormId,sourceVersion,aovFormId,fields:[{sourceFieldId,aovFieldId,aovType,unit?}]}，sourceVersion 為來源完整表單內容 sha256；actions：{platformActionId,aovActionId,sourceVersion,libraryId,libraryVersion}，sourceVersion 為既有 actionCatalog 動作內容 sha256。空陣列表示尚未建立映射，不代表可執行。
- libraries 採 {id,version,dependencies:[{id,version}],content}；所有依賴須在包內且版本一致，content 僅驗外殼，不引用 C 程式。C 內容的細部型別／流程語意留給 C。
- platform 原樣內嵌，入口另以 schemas.aov 驗證且要求 v5，不做 WP3 升級。manifest 為 {path,sha256,sourceProject,sourceVersion} 陣列；path 限 platform.json、aov.json、bindings.json、migration-report.json、libraries/<陣列索引>.json，sha256 對應各區塊（library 包含引用與依賴）。所有區塊必須恰有一筆；manifest 不雜湊自身，避免循環。sourceProject／sourceVersion 為來源聲明，不代表已認證。
- migrationReport 為 {sourcePath,summary,suggestedAction} 陣列，無損仍必填 []。JSON 以遞迴鍵字典排序正規化，陣列順序保留；10 MB 定義為 10,000,000 UTF-8 bytes（含空白）。額外限制巢狀深度 100，防止惡意遞迴耗盡堆疊。
- fixture 由既有 B v5、C project／library 組成；C project 僅留衍生外殼與通用 ID，移除示範製程數值及產品專有內容，library 去除 artifactTypes 與 subject 內容。這是外殼驗證樣本，未宣稱可通過 C 語意驗證。
- 本段 typecheck／test／build：未執行，待補齊測試後執行。新增測試入口將放 apps/composer-gui/src/aovBundle.test.ts（Vitest root 限制），實際測試在 libs/aov-integration/。


### 2026-10-18 WP2 第三段：測試、檢查與交接

- 完成 libs/aov-integration/bundle.test.ts，apps/composer-gui/src/aovBundle.test.ts 僅作既有 Vitest root 的入口；未改任何既有測試意圖。
- 新增 69 項測試：正常包原樣往返與候選隔離、所有頂層必填、未知格式／版本、C 外殼損壞、重複 ID、checksum 與 sourceVersion 失效、缺少與版本衝突的依賴、引用與內容 meta 不一致、映射來源／目標不存在、manifest 完整性／路徑安全、疑似秘密值與 secret_ref、禁止資料列、10 MB 精確邊界與多位元字元、非 JSON／過深／非有限數值。各拒絕案例的共用斷言會驗證傳入草稿與呼叫前深度相等。
- 引用檢查補齊 nodes、forms／fields、actions 的存在性與目標唯一性；只檢查實際 bindings 的端點，不遍歷驗證 C 的 port、規則或型別語意。C 未映射的不透明內容仍保留。
- 公開入口 validateAovBundle(text, currentDraft?) 回傳 {ok:true,value} 或 {ok:false,errors:[{code,path,message}]}；currentDraft 不被讀寫。canonicalJson／contentSha256 導出供後續工作使用；不提供自動安裝到工作階段或 WP3 轉換。

驗證結果：

| 指令 | 結果 |
|---|---|
| npm.cmd run typecheck | 通過（實作初次與最終版皆通過） |
| npm.cmd test -- src/aovBundle.test.ts | 初次 62 passed；補引用檢查後 69 passed，0 failed／skipped |
| npm.cmd test | exit 1；35 files passed、1 failed；402 tests passed、1 failed、1 skipped（共 404） |
| npm.cmd run build | exit 0；包含 typecheck 與 Vite production build，477 modules；有 React Flow use client 忽略及 >500 kB chunk 警告 |
| git diff --check（唯讀） | 通過；僅 LF／CRLF 提示 |

- 全套唯一失敗為既有 security.test.mjs 的 CLI 簽章測試：讀取 C:/Users/gslab/AppData/Local/Temp/composer-security-fUHvl8/keys/signing-private-key.pem 回報 EPERM；afterAll 清理同一 composer-security-fUHvl8 目錄亦 EPERM，故同時顯示 failed suite。未改測試、未遮蔽失敗、未嘗試越權刪除；請 Claude 在沙箱外重跑並處理該暫存目錄。
- 唯一略過為既有 App.test.tsx 身分授權邊界測試（尚無身分機制）。未執行 test:kits、瀏覽器與伺服器驗證：不在本次 WP2 範圍。
- 最終變更共 8 檔：schemas/aov-bundle.schema.json、libs/aov-integration/index.ts、libs/aov-integration/bundle.test.ts、fixtures/aov-merge/bundle/v1.valid.json、apps/composer-gui/src/aovBundle.test.ts、libs/ui-runtime/schema.ts、本 thread、mailbox index。
- 已核對未改既有 schema、libs/ui-runtime 其他檔、package*.json、kits/、config/；未新增依賴、未連網、未啟動伺服器、未執行 Git 寫入。讀取 Git status 有使用者全域 ignore 權限警告，不影響 diff 核對。
- 限制：C 仍只做外殼與映射引用檢查；雜湊不是簽章、不證明來源；疑似秘密值採欄名與常見字串模式拒絕，不宣稱能辨識任意偽裝秘密。發布內容不會被此入口改寫，成功只回傳候選；發布後的編輯鎖定不屬於 WP2。
- 本輪只完成 WP2，WP3 未開始。驗證工具顯示全套測試開始 19:25:17，已晚於原預計 12:00，不宣稱如期完成。交由 Claude 審閱 bindings／dependencies 形狀及外殼邊界，處理沙箱外 security 驗證；status 維持 in_progress、owner 改 claude。

### 2026-10-18 WP3 完成：B 側轉接與遷移報告（21:17，交 Claude 審閱）

- 起始 cwd 為專案根目錄，分支 feature/aov-merge-contract、HEAD d15428c，工作區無既有變更。已完整讀取 CLAUDE.md、DESIGN.md、計畫書 10–13、盤點、D95–D102 與本 thread，依九項 WP3 釐清實作。完成早於指定的 2026-10-19 06:00。
- 新增 `libs/aov-integration/migrate.ts`：`detectSource(text)` 依格式與版本組合辨識五種來源，分開回報 unknown-format／unknown-version／broken-structure。B 用既有 schemas.aov 驗結構，再於 prepareImport 呼叫 importWorkflow 完成完整性驗證與 v1–v5 升級；C 用既有整合包 $defs/project、$defs/library 編譯外殼驗證，不複製或引用 C 程式。A 僅依 fixtures 檢查外殼與圖形基本結構，不宣稱完整 A schema 或語意驗證。
- `prepareImport(text, currentDraft)` 成功回傳 source、originalText、candidate、migrationReport、formDefBlockers；candidate 明確區分 platform 與 readonly，只有 B 是平台候選。函式不讀寫草稿、不安裝狀態，成功候選亦與傳入草稿隔離。A／C 只讀候選仍是解析出的普通物件；readonly 標記表示匯入用途，並非 runtime freeze。originalText 保留原文字內容。
- A 不轉換：return 邊另列完整物件摘要，並遍歷所有非空內容葉節點，包含附件、外部引用、自由文字、多表單及未知擴充；每項均含 sourcePath（JSON Pointer）、summary、suggestedAction。摘要最多取原始序列化內容 1900 字，完整內容保留於 originalText，沒有刪改原件。B 每則既有升級通知逐項轉成同形狀報告，來源位置使用 `/`，不猜測通知字串對應哪個節點。無通知時 migrationReport 為 []。
- `mapFieldType(type, unit)`：unit 接受明確單位字串（含明確的「無單位」），或 `{unit, quantity}`；只有 decimal、實際單位與 quantity:true 同時成立才回傳 quantity。缺單位阻擋；date 每次固定報告「僅日期，無時間」，只映射型別，不改日期值。B 不存在的型別拒絕。未生成任何 FormDef：prepareImport 的 formDefBlockers 逐張指出缺 subject，逐個數值欄位指出缺單位；這是後續語意設定阻擋清單，不混入無損 B 升級的空遷移報告。FormDef 生成與整合設定留給 M06。
- D102 核對：migrate.ts 唯一 apps 值匯入為 importWorkflow；AovGraphDocument 與 AovBundle 皆 import type。未修改 workflowGraph.ts、既有 schemas、既有測試意圖、package*.json、kits/、config/；未新增依賴、未做 git 寫入、未連網、未啟動 dev server。
- 新增 48 項測試，使用既有 a／b／c fixtures，涵蓋三類可區分拒絕、每條拒絕案例草稿 deep-equal、候選隔離、決定性、v1–v5 通知對等、B 多表單保留、A 人工遷移項目、缺單位／subject、日期固定報告與未知型別拒絕。兩份新 fixture 均為通用資料。

變更檔案（7 檔）：

- libs/aov-integration/migrate.ts
- libs/aov-integration/migrate.test.ts
- apps/composer-gui/src/aovMigration.test.ts（沿用既有 Vitest root 的測試入口模式）
- fixtures/aov-merge/migration/legacy-content.json
- fixtures/aov-merge/migration/platform-multiple-forms.json
- .codex-claude-mailbox/threads/20261015-aov-merge-contract.md
- .codex-claude-mailbox/index.md

驗證結果：

| 指令 | 實際結果 |
|---|---|
| npm.cmd run typecheck | exit 0；初版與補完缺 subject／多表單測試後均通過 |
| npm.cmd test -- src/aovMigration.test.ts | 初版 47 passed；最終 48 passed，0 failed／skipped |
| npm.cmd test | exit 1；36 files passed、1 failed；450 tests passed、1 failed、1 skipped（452 total） |
| npm.cmd run build | exit 0；內含 typecheck，478 modules；React Flow use client 忽略與 >500 kB chunk 警告 |
| git diff --check（唯讀） | 通過；Git status 有既有全域 ignore 權限警告 |

- 全套唯一失敗：security.test.mjs CLI 簽章測試讀取 `C:/Users/gslab/AppData/Local/Temp/composer-security-P38e8b/keys/signing-private-key.pem` 發生 EPERM；afterAll 清理 `composer-security-P38e8b` 同樣 EPERM，故亦顯示 failed suite。未遮蔽、未修改測試、未越權清理；請 Claude 在沙箱外重跑與處理暫存目錄。
- 唯一略過：App.test.tsx 既有身分授權邊界測試（尚無身分機制）。未執行 test:kits、瀏覽器、dev server、A／C 語意驗證；不在 WP3 範圍。
- 限制：本輪是格式轉接候選 API，未接 UI 或狀態替換；A 報告可能較長，未自動包成有 1000 項報告上限的整合包。C 仍只驗外殼，不代表可執行。缺 subject／unit 的提示不阻擋保存 B 文件，但禁止將它當成已完成的 FormDef。
- status 維持 in_progress，owner 改 claude，交由 Claude 審閱 WP3 與重跑沙箱外 security 驗證。

### 2026-10-18 WP3b 完成：R01、R02（含 R04），交 Claude 審閱

- 核對分支 `feature/aov-merge-contract`、HEAD `6e8ebec`；先讀 Claude 審閱 WP3 與 WP3b 派工、實作、測試及 migrationReport schema。本輪只處理指定項目。
- R01／R04：報告按單元分組，每個 graph 一筆總覽含節點／邊數，每個節點／邊一筆；return 邊只列一次。摘要列直接欄位名與 JSON 序列化字串長度，不貼來源內容；附件、外部引用、自由文字、多表單和未知擴充保留在所屬單元摘要。完整原文與只讀候選仍原樣保留。
- 報告筆數為 `1 + 文件其他頂層欄位數 + graph 數 + node 數 + edge 數`，不再隨巢狀葉節點數膨脹。新增程式生成的通用文件測試（200 節點、200 return 邊、另含空 graph），結果 407 筆，低於 1000；驗證類別涵蓋、欄位長度、return 無重複、摘要不含原文、決定性及輸入不變。資料僅含通用名稱與測試規模／索引，無來源案例詞彙或數值。
- R02：明確「無單位」或 `none` 回傳 number 且完全省略 unit；真實單位照原值回傳。decimal 的 quantity 仍須指定真實單位與用途，無單位的 quantity 仍拒絕。保留全部既有測試，調整分組及不產生假單位的斷言，補上字串／物件選項覆蓋。
- 修改檔案：`libs/aov-integration/migrate.ts`、`libs/aov-integration/migrate.test.ts`、本 thread、`.codex-claude-mailbox/index.md`。未改 schemas、package*.json、kits、config、fixtures 或 UI；未新增依賴、未 git 寫入、未連網或啟動 server。

| 指令 | 最終結果 |
|---|---|
| npm.cmd run typecheck | exit 0，通過 |
| npm.cmd test | exit 1；36 files passed、1 failed；451 tests passed、1 failed、1 skipped（453 total） |
| npm.cmd run build | exit 0，通過；既有 React Flow use client 忽略與 >500 kB chunk 警告 |
| git diff --check（唯讀） | 通過 |

- 唯一失敗仍為 `security.test.mjs`：私鑰讀取及 afterAll 暫存清理 EPERM。兩次完整測試留下 `C:/Users/gslab/AppData/Local/Temp/composer-security-g8tVEj`、`C:/Users/gslab/AppData/Local/Temp/composer-security-4pyegb` 清理失敗紀錄；未修改或遮蔽測試，請 Claude 在沙箱外重跑並清理。
- 唯一略過為 App.test.tsx 既有身分授權測試（尚無身分機制）；未執行 test:kits 或瀏覽器驗證，本輪無 Kit／UI 改動。
- 限制：407 筆是此通用測試的結果，不代表任意大小文件均可裝入整合包；單元數或欄位名總長極大時仍受既有 1000 筆／2000 字摘要契約限制。本輪沒有截斷或靜默丟棄報告，也沒有調高 schema 上限。
- status 維持 `in_progress`，owner 設為 `claude`，待審閱與沙箱外 security 驗證。

# Open Questions

- 第 1、2、4、5、6 項已決定（D95–D97）；第 3 項（M05 引用 C core 的方式）不影響本 thread，但需決議後才能排 M06 以後。

## 2026-10-18 Claude 審閱 WP2（M02）

- 狀態確認：Codex 任務 task-mvdqg2gt-sffwth 為 completed（7 分 52 秒）；以下為我獨立驗證。
- 重跑：typecheck 通過；`npm.cmd test` 36 個檔案、403 通過、0 失敗、1 略過（既有身分授權）；build 通過。
- 範圍：新增 `schemas/aov-bundle.schema.json`、`libs/aov-integration/`（index.ts、bundle.test.ts）、`apps/composer-gui/src/aovBundle.test.ts`、`fixtures/aov-merge/bundle/v1.valid.json`；唯一動到的既有檔為 `libs/ui-runtime/schema.ts`（只加 aovBundle 登錄，已授權）。未改 package*.json、其他 schema、kits、config；未引用 C 或 A 的程式碼。專有詞彙搜尋命中為零。
- 對照 D101：單一 JSON 與 10,000,000 UTF-8 bytes 上限（以位元組計，含恰好上限接受、多一 byte 拒絕）、sourceVersion 與 manifest 皆為遞迴鍵排序正規化 JSON 的 sha256、雜湊不是簽章的限制已寫入 schema 描述與 checksum 錯誤訊息，均符合。另涵蓋：缺依賴與同 ID 不同版本、manifest 重複／遺漏／不存在路徑、秘密值欄位與字串、資料列夾帶、深層 JSON 與無限大數值、C 外殼只驗外殼。

### Review Findings（WP2）

| 編號 | 嚴重度 | 內容 | 處理 |
|---|---|---|---|
| R01 | 低 | `libs/aov-integration/index.ts` 從 `apps/composer-gui/src/workflow` 匯入 `sha256Hex` 與 `actionCatalog`，libs 反向依賴 apps，與 `libs/ui-runtime` 目前的單向依賴不一致 | 接受於本輪；WP3 或 M05 時把這兩項移到 libs，記為待辦 |
| R02 | 低 | `validateAovBundle(text, _currentDraft)` 的第二參數沒有使用（函式本身純粹，不改任何狀態），參數名稱易讓人誤以為函式會保護草稿 | 保留簽名以對齊計畫書「失敗不覆蓋草稿」的呼叫方式；呼叫端（WP3 匯入流程）才負責替換狀態，須在 WP3 測試中驗證 |
| R03 | 低 | 秘密值字串規則（含 `password=`、`token=`、`Bearer` 的字串一律拒絕）可能誤擋含這些字樣的正常說明文字 | 偏向安全，可接受；若實務誤擋再放寬並補測試 |
| R04 | 資訊 | 測試放在 libs，另由 `apps/composer-gui/src/aovBundle.test.ts` 以 import 轉進，因 vitest 的根目錄是 apps/composer-gui | 屬環境限制，已有註解說明 |

結論：WP2 通過，無阻擋項目。WP3（B 側格式轉接與遷移報告）尚未派工，等 user 指示。

## 2026-10-18 派工 WP3（Claude）

R01 已處理（D102，提交 bdd62d5）：`sha256Hex` 移到 `libs/aov-integration/hash.ts`、動作目錄自行解析；`workflow.ts` 重新匯出 `sha256Hex`。typecheck 通過、403 測試通過。

**預計完成時間：2026-10-19 06:00（約 8 小時）。** 到期未完成由 Claude 接手。

### WP3 範圍釐清（避免停止）

1. **位置：** 新增 `libs/aov-integration/migrate.ts` 與測試；遵守 D102：值層級依賴不得指向 apps，唯一例外是呼叫 B 既有的 `importWorkflow`（升級 version 1 至 5 並產生通知），型別一律 `import type`。不修改 `workflowGraph.ts` 既有升級路徑。
2. **格式辨識：** `detectSource(text)` 回傳來源種類（platform、aov-workflow、aov-dataflow、aov-project、aov-library）與版本，或拒絕。拒絕必須區分三種原因：`unknown-format`、`unknown-version`、`broken-structure`（盤點發現 7：目前 `importWorkflow` 對後兩者訊息相同，請在呼叫前先自行判別，不改 `importWorkflow`）。辨識看 format 與版本欄位組合，不只看數字。A 格式：`format` 為 `aov` 且 `schemaVersion` 為 `1.0`、`1.1`、`1.2`（1.1 有 `documentType`）；C 專案看 `formatVersion` 為 1；C 動作庫另看 `kind` 為 `action-library`。
3. **A 格式只做辨識與報告，不轉成平台文件**（D97：無法轉換的第一代舊格式只讀保存原檔）。報告要逐項列出：return 邊（原始描述保留）、附件、外部引用、自由文字、多表單資料等無法對應的內容，每項含來源位置、內容摘要、建議處理，結構與整合包的 `migrationReport` 一致（`sourcePath`、`summary`、`suggestedAction`）。你讀不到 A 的程式碼，請以 `fixtures/aov-merge/a/` 的樣本為準；樣本中沒有的情形（例如附件）可自造通用最小樣本放 `fixtures/aov-merge/migration/`，不得含任何來源案例詞彙或數值。
4. **B 舊版升級：** 呼叫 `importWorkflow`，把它的通知逐項轉成遷移報告項目；無損失時報告仍存在且為空陣列。
5. **C 專案與動作庫：** 只辨識與外殼檢查（沿用 `libs/aov-integration/index.ts` 對外殼的規則），不引用 C 程式碼。
6. **表單欄位型別映射（D97、計畫書 10.3）：** `mapFieldType(type, unit)`：text 轉 string、boolean 轉 bool、date 轉 datetime 並固定回報「僅日期，無時間」、integer 與 decimal 轉 number，單位須由使用者指定或明確標「無單位」，兩者皆無則該欄位被阻擋並說明「缺單位」；decimal 只在使用者指定單位且用於數量時才可轉 quantity。B 沒有的型別不推測。
7. **匯入原子性（R02）：** 提供 `prepareImport(text, currentDraft)`，只回傳候選物件或錯誤，不修改傳入草稿；在每一條失敗路徑的測試中驗證草稿與呼叫前深度相等。
8. **決定性：** 同一輸入重複轉換結果完全相同；輸入物件不被修改。
9. 停止條件與驗證指令沿用上方；只有必須改既有 schema、既有測試意圖、新增依賴時才停止，其餘衝突以既有模型為準、調整自己的實作並記錄。

## 2026-10-18 Claude 審閱 WP3（M04）

- Codex 任務 task-mvdujb7u-49nut4 為 completed；以下為我獨立驗證。
- 重跑：typecheck 通過；`npm.cmd test` 37 個檔案、451 通過、0 失敗、1 略過（既有身分授權）；build 通過。Codex 回報的 1 項失敗（security.test.mjs 的 EPERM）在我的環境未重現，屬沙箱限制。
- 範圍：新增 `libs/aov-integration/migrate.ts`、`migrate.test.ts`、`apps/composer-gui/src/aovMigration.test.ts`、`fixtures/aov-merge/migration/` 兩份樣本；未改 `package*.json`、schemas、config、kits、`libs/ui-runtime`、apps 既有程式；專有詞彙搜尋命中為零。唯一的 apps 值層級引用為 `importWorkflow`，符合 D102。
- 對照要求：三種拒絕原因可區分、B 升級通知轉為遷移報告、A 只辨識與報告不轉換、date 固定回報「僅日期，無時間」、缺單位阻擋、`prepareImport` 回傳分離的候選物件，均已實作並有測試。

### Review Findings（WP3）

| 編號 | 嚴重度 | 內容 | 處理 |
|---|---|---|---|
| R01 | 中 | `legacyReport` 對 A 文件的每個非空葉節點各產生一筆報告。用 `fixtures/aov-merge/a/v1.0.legacy.valid.json` 估算：4 個節點約 182 筆，每節點約 45 筆。整合包 schema 的 `migrationReport` 上限為 1000 筆，約 22 個節點的 A 文件就無法放進整合包。報告也因此過於瑣碎，不利人工遷移 | 退回 Codex 修正（WP3b） |
| R02 | 中 | `mapFieldType(type, '無單位')` 回傳 `unit: '無單位'`，把標記字串當成真實單位寫進結果，C 側會得到名為「無單位」的單位。計畫書與 D97 的意思是「無單位」代表沒有單位 | 退回 Codex 修正：無單位時不輸出 `unit`（number 型別），並修改對應測試斷言 |
| R03 | 低 | `prepareImport(text, _currentDraft)` 的第二參數同樣未使用；原子性只靠函式不改狀態成立 | 接受；匯入畫面接上時才需要整合測試 |
| R04 | 低 | `return` 邊先被整筆報告，其子欄位又各自被報告一次，重複 | 併入 R01 的重構處理 |
| R05 | 資訊 | A 的 1.1 workflow 與 dataflow 皆未以 A 的 schema 驗證（B 讀不到 A）；僅做必要欄位判斷 | 已知限制，記入遷移報告說明 |

### WP3b 修正派工

**預計完成時間：2026-10-19 02:00。** 只修 R01、R02（含 R04），不擴大範圍：

1. A 文件報告改為按單元分組：每個 graph 一筆總覽（節點數、邊數）、每個有無法對應內容的節點或邊各一筆（同一單元的欄位合併成一筆，摘要列出欄位名與長度，不貼整份內容）、每條 `return` 邊一筆（保留原始描述的必要欄位）。整份報告筆數須有上界且遠小於 1000：另加測試，用程式產生 200 個節點的通用 A 文件，驗證報告筆數不超過 1000，且 `return` 邊、附件、外部引用、自由文字仍都有對應項目。
2. `mapFieldType`：明確「無單位」時回傳 number，不含 `unit` 欄位；有單位仍回傳該單位；quantity 規則不變。修改對應測試斷言（意圖是「不產生假單位」），不得刪除測試。
3. 既有測試意圖其餘不變；不新增依賴；仍不得修改 schema（若必須調高 1000 上限，停止並寫明，不自行改）。

## 2026-10-18 Claude 審閱 WP3b（修正 R01、R02、R04）

- Codex 任務 task-mvdur7qo-7bah0d 為 completed（3 分 6 秒）；以下為我獨立驗證。
- 重跑：typecheck 通過；`npm.cmd test` 37 個檔案、452 通過、0 失敗、1 略過（既有身分授權）；build 通過。只改了 `migrate.ts` 與 `migrate.test.ts`，未動 schema、依賴、其他檔案；專有詞彙搜尋命中為零。
- R01、R04 已修正：報告改為按單元分組（非葉節點）；200 節點、200 條 return 邊的通用文件產生 1 + 4 + 2 + 200 + 200 筆，遠低於 1000；測試逐一確認每個節點單筆報告列出 business、attachments、external、forms 四類欄位，每條 return 邊單筆，sourcePath 無重複，摘要不超過 2000 字。
- R02 已修正：明確「無單位」時回傳 number 且不含 `unit`；quantity 搭配無單位仍阻擋；測試斷言由假單位改為不含 unit，沒有刪除測試。

### 新的低度發現（不阻擋）

| 編號 | 內容 | 處理 |
|---|---|---|
| R06 | 報告摘要只列欄位名與 JSON 長度，不含 return 邊的 `reason` 原文，測試甚至斷言摘要不含原文。我派工寫的是「保留原始描述的必要欄位」，Codex 解讀為原文留在原檔與 `originalText`。原文確實未遺失，但人工遷移時還要回原檔找 | 接受；若實務上不便，再在 return 項目加入截斷的 reason |
| R07 | `none` 也被當成「無單位」標記，派工與 D97 只規定「無單位」，這是未被要求的別名；一個真的叫 `none` 的單位會被誤判 | 低風險，記錄；下次動到此函式時移除 |

結論：WP3 通過，R01、R02、R04 關閉；R06、R07 為低度待辦。
