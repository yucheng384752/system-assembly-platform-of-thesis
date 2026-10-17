# 三代 AOV 合併：推薦修改清單與驗收計畫

日期：2026-10-15
狀態：建議方案，尚未實作；不取代 project-spec.md 與 decision-log.md 的已核定決策。

## 1. 結論與範圍

推薦以 composer-refactor 作為主要產品與整合入口，保留其工廠、生產流程、表單與 Action → capability → Kit 推導；接入 aov-project 的型別、規則、驗證、編譯與模擬核心；從 AOV_generation_system 保留舊文件相容能力與有用的業務描述。

合併的目標是形成一套清楚的資料契約和使用流程，不是將三個專案的原始碼全部搬到同一資料夾，也不是保留三套可各自修改相同內容的編輯器。

第一、二代名稱延用前次討論的暫定對應，尚未由使用者明確確認；實作時以本文件的實際路徑為準。第三代路徑已由使用者確認。FactClaw 因未取得可確認來源，不列入本次三版本合併範圍。

本文件只新增修改建議，不表示已核准改變各專案不變式、安裝依賴或執行正式資料遷移。

## 2. 專案路徑與整合責任

| 代號 | 專案與完整路徑 | 建議責任 | 修改原則 |
|---|---|---|---|
| A：第一代（暫定） | C:\Users\gslab\Desktop\AOV_generation_system | 舊版 Workflow／Dataflow 文件與編輯體驗的參考來源 | 初期唯讀，抽取去識別化測試資料與格式資訊；不持續維護第二套新功能 |
| B：第二代（暫定） | C:\Users\gslab\Desktop\composer-refactor | 合併後的主要產品：工廠、流程、表單、能力推導、設定交付 | 主要修改位置；沿用既有 UI 與驗證模式 |
| C：第三代 | C:\Users\gslab\Desktop\aov-project | AOV 語意核心：artifact、動作庫、規則、驗證、編譯、模擬 | 保留 core 單一來源與零執行期依賴規則；獨立編輯器作為核心驗證工具 |
| D：平台基線（支援來源，不算第四代） | C:\Users\gslab\Documents\New project\form-system-kit-composer | 現有 AOV 客製橋接、Kit、Assembly IR、組裝及部署工具的參考 | 依 B 的規範保持唯讀，需要的能力經審查後移入 B |
| E：本文件 | C:\Users\gslab\Desktop\composer-refactor\docs\aov-three-generation-merge-plan.md | 合併工作拆分、順序與驗收清單 | 決策確認後同步至 B 的正式規格與決策紀錄 |

後續表格使用 A／B／C／D 加相對檔案位置；實際完整路徑由上表展開。「擬新增」代表建議檔案，不表示目前已存在。

## 3. 合併前必須固定的責任與語意

| 議題 | 推薦決策 | 原因／不得直接轉換的部分 |
|---|---|---|
| 主要畫面 | B 保留主要操作流程，逐步接入 C 的驗證與模擬 | 不同 React 與建置環境不宜整包覆蓋；優先接入零 UI 相依的 core |
| 工廠與場域 | B 的工廠保持組織容器；Site Profile 保持獨立 | 工廠不是執行節點，也不等於租戶或部署單位 |
| 業務流程與可執行流程 | B 的草稿可保存業務順序；只有完成 port、artifact、規則與執行綁定的流程才能編譯／執行 | B 的邊只表示先後，C 的邊必須攜帶 artifact；不得把每條順序線直接偽裝成資料流 |
| 動作 | B 的 Action 負責能力選配，C 的 Action 負責原語行為；建立明確映射 | 同名不表示相同契約；Kit 的存在也不表示已具備可執行節點 |
| 表單 | B 維護表單欄位；C 取得版本化 FormDef 快照及流程專用語意 | 避免雙向編輯造成欄位分歧；單位、subject、型別須顯式補齊 |
| 規則 | C 負責執行規則；B 的欄位規則經明確映射後接入 | 自由文字描述不能自動當成已驗證運算式 |
| 子流程 | B 的組織階層保留；C 的可執行子流程引用已發佈版本 | B 的子圖所有權／深度限制與 C 的模板重用不是同一件事 |
| 開始／結束 | B 的 start／end 保持畫面及業務邊界 | 不能一律轉成 C 的 source／sink，後者涉及 artifact 取入與處置 |
| 返回／重工 | 第一代 return 保留原始描述並列為人工遷移項目；正式重工遵循 C 的倉儲邊界與新工單 | 不破壞 C 的 DAG 不變式，不默默刪除 return 邊 |
| 追溯 | 保留表單關聯與 artifact lineage，透過識別碼連接 | 流程連線不自動建立外鍵；不混用表單模板 ID 與紀錄 ID |
| 正式狀態 | 未來由伺服器執行服務唯一管理工單狀態 | 瀏覽器模擬結果不直接寫回正式庫存或工單 |

## 4. 推薦修改清單（依順序）

優先級：P0 是整合前必要；P1 是可用設計／模擬版本必要；P2 是系統產生必要；P3 是正式執行必要；P4 依場景再做。
表格中的測試是未來修改的必要驗收項目，不是本次已執行的結果。

| 順序／優先 | 工作與推薦修改 | 預計觸及的位置 | 相依 | 必要測試與完成條件 |
|---|---|---|---|---|
| M01／P0 | 固定版本對應、主要專案、來源版本與合併範圍；記錄哪些格式只讀、哪些可編譯 | B：docs/project-spec.md、docs/decision-log.md；A／C 的版本資訊唯讀盤點 | 無 | 每個樣本能判斷來源格式；未知版本拒絕；報告可回查來源版本，不用「最新版」作依賴 |
| M02／P0 | 定義版本化整合包：平台 Workflow、AOV 專案、bindings、完整動作庫／子流程依賴及 manifest；Recipe 沿用引用模式 | B：schemas/aov.schema.json、recipe.schema.json、package-manifest.schema.json；擬新增 schemas/aov-bundle.schema.json | M01 | 正常包往返相等；缺欄位、重複 ID、未知版本、壞 checksum、缺依賴皆拒絕；失敗不覆蓋目前草稿 |
| M03／P0 | 為 C 的外部專案／動作庫輸入補完整結構驗證；先驗證候選物件，再替換狀態 | C：packages/core/src/model/types.ts、apps/editor/src/components/Toolbar.tsx、store.ts；擬新增專案 Schema／驗證入口 | M01 | nodes 非陣列、缺 port、錯誤 enum、非法 library、損壞本機草稿不造成半套狀態；既有合法範例全過 |
| M04／P0 | 建立格式轉接與遷移報告；沿用 B 現有 version 1–5 升級路徑；另辨識 A 的 aov 格式與 C 的 formatVersion | B：apps/composer-gui/src/workflowGraph.ts、workflow.ts、WorkflowTransfer.tsx；擬新增 libs/aov-integration/；參考 A 的 domain/schema、D 的橋接格式 | M02、M03 | 各版本代表樣本；return、附件、外部引用、自由文字與多表單資料不得靜默遺失；不支援內容留原件並逐項報告；格式不能只看數字版本 |
| M05／P1 | 以可重現且鎖定版本的方式引用 C core；避免複製規則到 B；初期可使用明確的本機來源接入，交付前須解除絕對路徑依賴 | C：packages/core/package.json、src/index.ts；B：package.json、tsconfig／Vite 設定、擬新增 libs/aov-integration/ | M02、M03 | B 型別檢查與建置通過；乾淨環境可還原依賴；生成物不含個人桌面路徑；C core 不新增執行期依賴 |
| M06／P1 | 表單與欄位映射：B 表單轉 C FormDef，保存來源 ID、版本及欄位對應；不允許模擬端反向偷偷覆寫來源 | B：localData.ts、NodeForm.tsx、relations.ts、擬新增轉接模組；C：model/types.ts、resolve/resolve.ts | M04、M05 | 必填、數字／小數、日期、布林、列舉、單位映射；改名、刪欄、型別變更會標記失效；不支援型別阻擋編譯而非降成文字 |
| M07／P1 | 動作對應及能力綁定：把 C 的業務動作／原語連到 B 的 capability，仍由既有 registry 推導 Kit | B：config/actions.json、config/registry/、libs/ui-runtime/registry.ts、registryData.ts；擬新增 bindings 契約 | M05、M06 | 無實作者、多實作者、未驗證能力、跨 Kit 相依皆有明確結果；既有 deriveKits 行為不退化；僅有 capability 宣告不能標為可執行 |
| M08／P1 | 為流程補明確輸入／輸出與 artifact 型別；將規格完整度和可編譯性分開；處理子流程邊界與版本映射 | B：workflowGraph.ts、WorkflowCanvas.tsx、NodeDetails.tsx、schemas/aov.schema.json；C：compile/subgraph.ts、validate/validator.ts | M06、M07 | 純順序線不被自動當資料流；型別不合、循環、實體重複消耗會阻擋；開始／結束不憑空產生／消耗 artifact；未發佈子流程不能編譯 |
| M09／P1 | 接入規則診斷、編譯與模擬；重用 B 的畫面，結果能定位到原始節點／表單；保持模擬隔離 | B：WorkflowCanvas.tsx、NodeDetails.tsx，擬新增模擬面板；C：resolve、expr、validate、compile、engine | M08 | 填表→判定→合格／異常雙路徑；guard false 為 held、缺值為 error；子流程診斷回到正確節點；模擬不發正式寫入請求、不更動正式庫存 |
| M10／P1 | 整合包完整匯出／匯入，包含遞迴依賴；匯入先在候選區完整驗證後一次提交；敏感資料不進設定包 | B：deliveryPackage.ts、zip.ts、fileTransfer.ts、WorkflowTransfer.tsx、OutputPage.tsx | M02、M04、M09 | 在無原機草稿的環境匯入並模擬成功；缺依賴／重複依賴版本衝突／checksum 不符拒絕；超大壓縮包及不安全檔名拒絕；不帶真實資料列與秘密值 |
| M11／P2 | 讓組裝流程消費 AOV：將鎖定定義、編譯產物與能力 bindings 接到 Assembly IR／等效產生契約 | B：擬新增／接入組裝工具與 schema；唯讀參考 D：tools/generate-assembly-ir.ps1、assemble-system.ps1、schemas/assembly-ir.schema.json | M10 | 非法流程、缺少能力實作不可輸出「可執行包」；相同輸入產生穩定語意結果；原始模板、展開結果及版本可追溯；不能只附 JSON 就稱執行整合完成 |
| M12／P2 | 把流程需要的表單、Kit、API 綁定及部署檔帶進產生系統，沿用現有生成能力 | B：組裝／交付入口、相關 kits 與 registry；唯讀參考 D 的 registry／DB／package 產生工具 | M11 | 最小套件可安裝啟動；表單可用、能力綁定正確；缺選配 Kit 不產生斷裂路由；啟停、設定檢查與現有產生流程回歸通過 |
| M13／P3 | 決定正式執行服務邊界：優先保留 TS core；以薄 Node 服務接 Python Kit，工單狀態由單一服務擁有 | C：packages/core/src/engine/engine.ts；B：擬新增執行服務、API 契約與部署描述 | M12、正式執行需求確認 | 非法狀態轉移拒絕；相同命令重送不重複執行；外部 API 逾時、重試及部分失敗有可查詢結果；不可宣稱外部 API 與 DB 天然同一交易 |
| M14／P3 | 持久化與交易：實作 C backlog B-03，加入租戶範疇、唯一性、併發保留／消耗及重啟恢復 | C：engine、擬新增 store 套件、docs/schema/postgres.sql；B：migration 與執行服務 | M13 | 真實測試資料庫：重啟續跑、兩工單搶同一 artifact 僅一筆成功、完工失敗全部回復、事件與狀態一致；正式上線檢查不得略過 DB 測試 |
| M15／P3 | 實作操作授權與追溯：綁定租戶、使用者、職務及紀錄；銜接表單紀錄與 lineage | B：entry-permission-kit／正式授權層、相關 API；C：工單操作與事件介面 | M14 | 跨租戶讀寫拒絕；未授權開始／完工／override 拒絕；偽造 owner 無效；每個產出可追到表單紀錄、工單、節點、版本與操作者 |
| M16／P4 | 依實際場景補逐件展開、十進位數量、資源排程與效能；最後才移除舊編輯入口 | C：backlog B-02、B-05、B-06、B-07；B：相容入口與遷移說明 | 對應需求及前述驗收 | 逐件品檢混合結果正確；精確數量與單位運算符合約定；目標規模效能達標；既有專案全部可還原或取得遷移報告後才退役舊入口 |

注意：P4 不是固定可延期。若首批場景包含精確配料，十進位數量須提前到上線前；若包含拆分後逐件品檢，逐件展開亦須提前。

## 5. 最小可用版本與交付界線

第一個里程碑建議完成 M01–M10，不碰正式工單資料庫：

1. 在 B 建立工廠及一條「填寫檢驗表 → 判定 → 合格／異常」流程。
2. 從 B 表單生成 C 所需的型別與表單定義，並明確配置 port。
3. 由 B 推導所需 Kit，由 C 驗證、編譯及模擬。
4. 匯出含完整版本依賴的整合包。
5. 在沒有原始 localStorage 的另一工作階段匯入，得到相同定義與模擬結果。

必須以「設定與模擬整合」標示此成果。只有完成 M11–M12 並通過安裝啟動驗證，才能稱為系統產生整合；只有完成 M13–M15 及場景必要項，才能宣稱正式工單執行。

## 6. 必要測試清單

| 測試層 | 必測內容 | 主要位置／工具 | 驗收門檻 |
|---|---|---|---|
| 格式／契約 | 三種格式辨識、未知版本、結構錯誤、缺依賴與版本衝突 | B schema／import tests；C 輸入驗證 tests | 錯誤輸入不改變原工作階段；合法資料往返保真 |
| 舊版遷移 | A Workflow／Dataflow、平台客製整合包、B 舊版、C 專案及動作庫 | 擬新增去識別化 fixtures 和 migration tests | 不靜默丟資料；有損轉換逐項報告且原檔可保留 |
| 表單與能力 | 欄位轉換、來源變更、Action mapping、能力推導缺口 | B localData／registry／workflowGraph tests | 來源引用可定位；未實作能力不能假裝可執行 |
| 核心語意 | DAG、port 相容、線性消耗、guard 三值、判定、子流程版本 | C packages/core/test | 既有核心測試全過，新行為有反例測試 |
| 狀態與 UI | 匯入原子性、復原／重做、診斷定位、發佈唯讀 | B store／DOM tests；C store.test.ts | 不出現畫面成功但模型未更新；已發佈版本不能原地改寫 |
| 瀏覽器整合 | 建流程、選表單、連線、模擬雙分支、匯出再匯入 | 專用隔離瀏覽器／測試資料 | 實際操作完成，不只驗證函式回傳；模擬沒有正式寫入請求 |
| 產生包 | IR、依賴、路由、DB 計畫、部署啟停 | B 組裝測試及最小部署環境 | 乾淨環境可啟動；不依賴作者桌面路徑 |
| 正式 runtime | 併發、交易、重啟、重送、外部 API 失敗、租戶及授權 | 測試 PostgreSQL＋服務整合測試 | 不重複消耗、不跨租戶、失敗可恢復；此層未通過不得上線 |

### 6.1 既有檢查指令

在 B 的根目錄執行：

~~~powershell
Set-Location 'C:\Users\gslab\Desktop\composer-refactor'
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
~~~

若修改 platform-core-kit，另執行 B 現有 npm.cmd run test:kits；其他被修改的 Kit 必須執行其對應測試，不能把這個單一指令當成所有 Python Kit 的覆蓋。

在 C 的根目錄執行：

~~~powershell
Set-Location 'C:\Users\gslab\Desktop\aov-project'
npm.cmd run check
~~~

A 只有在修改其格式或程式碼時才需執行該專案 npm.cmd test、npm.cmd run build。D 基線保持唯讀；移植工具後，在 B 或隔離產物上驗證，不在基線上進行改造。

### 6.2 已驗證與尚未驗證

- 本次僅整理文件、核對現有規格／檔案位置及檢查命令，沒有實作 M01–M16。
- 前次分析曾成功執行 C 的 npm run check：121 項 core 測試、7 項 editor 測試、型別檢查與建置通過。這是歷史檢查結果，不代表 2026-10-15 的最新程式狀態已重新驗證。
- 本次未重跑 A／B／C 全套測試，未做瀏覽器、正式資料庫與部署驗證。
- C 的 backlog 仍將持久化、完整專案 Schema、逐件展開及十進位運算列為待辦；正式執行不得僅依模擬通過判定可用。

## 7. 建議工作包與停止條件

| 工作包 | 包含項目 | 交付物 | 不應繼續下一階段的情況 |
|---|---|---|---|
| WP1 契約與相容性 | M01–M04 | 格式契約、版本對應、遷移報告、fixtures | 第一／二代來源不符、核心語意未決、存在靜默資料損失 |
| WP2 設計與模擬 | M05–M10 | 單一主入口、表單與動作映射、隔離模擬、完整依賴包 | 未知能力被當可執行、純順序線被自動當 artifact、包無法獨立還原 |
| WP3 系統產生 | M11–M12 | 可驗證的組裝輸入、生成物與部署測試 | 只是附帶 JSON、需要作者機器資料、安裝啟動未通過 |
| WP4 正式執行 | M13–M15＋場景必要的 M16 | 執行服務、資料庫 migration、授權、恢復與追溯 | 交易／併發／跨租戶／重送測試失敗，或未明確定義外部副作用失敗處理 |

每個工作包再依 M 編號拆小提交。新增依賴、改變 C 的不變式、擴張 B 的既有流程語意，應先形成具體決策再實作，不把本建議當成既有決議。

## 8. 暫不做的項目

- 不把三代 UI 全部合併成一個大型元件。
- 不另寫一套 Python guard／編譯引擎。
- 不做平台與 AOV 表單的雙向即時同步。
- 不將第一代 return 邊強制改成第三代同工單循環。
- 不把任意 API／程式碼字串當成已授權的執行能力。
- 不因合併順便新增多人協作、自動排程或全面重新設計樣式。
- 不接入未確認來源的 FactClaw。
- 不修改 D 基線，不複製真實製造資料與秘密值作測試。

## 9. 來源索引

- A：README.md、src/domain/types.ts；平台客製格式另見 D：integrations/aov-studio/src/domain/types.ts。
- B：docs/project-spec.md §4.3–4.5、CLAUDE.md、package.json、schemas/aov.schema.json、apps/composer-gui/src/workflowGraph.ts。
- B：apps/composer-gui/src/deliveryPackage.ts、config/actions.json、config/registry/、libs/ui-runtime/。
- C：AGENTS.md、packages/core/src/model/types.ts、compile/compiler.ts、engine/engine.ts、apps/editor/src/store.ts、docs/backlog.md、docs/schema/postgres.sql。
- D：gui/aov-integration.js、gui/app.js、tools/generate-assembly-ir.ps1、tools/assemble-system.ps1、tools/sync-aov-studio.ps1。

本文件的修改位置為實作導引，新增檔名仍可按既有結構調整；所有必要契約與測試責任不可因檔案調整而省略。

## 10. 補充：整合包資料契約草案（Data-First）

2026-10-15 補。第 4 節 M02 只寫「定義版本化整合包」，未列欄位與映射規則；實作任何轉換前須先確定本節。以下為草案，核定後寫入 decision-log 並成為 `schemas/aov-bundle.schema.json` 的依據。型別名稱取自 C 的 `packages/core/src/model/types.ts`（FORMAT_VERSION = 1），B 取自 `schemas/aov.schema.json`（version 5）。

### 10.1 整合包外殼（草案）

| 欄位 | 內容 | 規則 |
|---|---|---|
| format／version | `composer-aov-bundle`／1 | 未知 format 或 version 一律拒絕，不嘗試猜測 |
| platform | B 的 `composer-aov-list` version 5 文件原樣內嵌 | 不改寫；舊版先經 M04 升級並產出遷移報告 |
| aov | C 的專案檔（`formatVersion` 1，含 `meta.id`、`meta.version`、`meta.status`） | 已發佈版本唯讀 |
| libraries | `LibraryRef`（id、version）清單，附各動作庫完整內容 | 缺依賴、同 id 不同版本衝突皆拒絕 |
| bindings | 見 10.2 | 每筆都帶來源 ID 與來源版本 |
| manifest | 每個內含檔案的路徑、sha256、來源專案與版本 | checksum 不符拒絕；不得含絕對路徑、秘密值、資料列 |
| migrationReport | 遷移時逐項損失與人工待辦 | 無損失時仍保留空報告，匯入端不得省略 |

### 10.2 bindings 與 ID 映射

| 對應 | B 側 | C 側 | 規則 |
|---|---|---|---|
| 節點 | graph 內 node id | `NodeDef.id` | 一對一；B 的 id 格式為 `^[a-z0-9-]+$`，C 側 id 規則須在 M01 盤點後確認，不符時產生映射表，不改 B 的 id |
| 表單 | `forms[].id`、欄位 id | `FormDef.id`、`fields` 的鍵 | 保存 `sourceFormId`、`sourceVersion`；FormDef 為快照，不回寫 |
| 動作 | `config/actions.json` 的 action id | `ActionDef.id` | 映射表明確列出；同名不視為同一契約 |
| 能力 | registry 的 capability id | 無（C 不認得 Kit） | 只在 B 推導 Kit，不進 C 檔案 |
| 流程邊 | 順序邊（無 artifact） | `Flow`（port 到 port，必帶 artifact 型別） | 順序邊預設不轉為 Flow，須人工補 port 與型別；未補者標為「僅業務順序」 |
| 開始／結束 | start／end 節點 | 不對應 source／sink | 邊界由使用者另行指定倉儲或外部邊界，未指定不可編譯 |

### 10.3 表單欄位型別映射（草案）

| B 欄位型別 | C `AttrValueType` | 補充要求 |
|---|---|---|
| text | string | 無 |
| integer | number | 單位須由使用者顯式指定，或明確標為「無單位」；兩者皆無則標為「缺單位」並阻擋該欄位，不預設任何單位 |
| decimal | number | 預設為 number；只有使用者指定單位且欄位用於數量時才轉 quantity（D97） |
| boolean | bool | 無 |
| date | datetime | 值保持 ISO 日期（YYYY-MM-DD），不補時間；C 以 Date.parse 讀取可接受。遷移報告固定列「僅日期，無時間」（D97） |
| 無對應的 C 型別（enum、string[]、json） | 不由 B 產生 | B 沒有這些型別，不得由轉接層憑空推測 |

C 的 `FormDef.subject` 在 B 無對應，必須由使用者在整合設定中指定，缺少時不產生 FormDef。

## 11. 補充：責任分工與 Codex 可執行邊界

第 4 節的觸及位置跨 A／B／C／D 四個專案，但依 B 的 CLAUDE.md：Codex 的 cwd 必須是 B 的專案根目錄、沙箱不能寫 `.git`、沒有網路、不裝依賴。因此原清單的下列項目不能直接派給 Codex：

| 項目 | 原因 | 處理 |
|---|---|---|
| M01 版本盤點 | 需讀 A／C／D，位於 B 根目錄之外 | Claude 執行，產出盤點報告與去識別化 fixtures 放入 B |
| M03 C 的輸入驗證 | 修改的是 C 的程式與 C 的不變式 | 先由 user 決定是否授權修改 C；未授權前改在 B 側（`libs/aov-integration/`）做驗證 |
| M05 引用 C core | 需新增依賴或本機路徑連結，須 user 核准；絕對路徑不可進產物 | Claude 提出方案，user 核准後才派工 |
| M13–M16 | 正式執行、資料庫、授權，現階段不在範圍 | 暫不派工 |

可派給 Codex 的只限 B 根目錄內、且有明確契約與測試的項目：M02（schema 與驗證）、M04（B 側格式轉接與遷移報告）；M06–M10 待 M05 核准後再排。

## 12. 補充：待 user 決定事項

以下影響實作方向，未決前不得派工或自行假設：

1. 已確認（2026-10-15）：A＝AOV_generation_system、B＝composer-refactor。
2. 已決定（2026-10-15，D95）：授權修改 C 補完整專案 Schema（M03），由 Claude 執行。
5. 已決定（2026-10-15，D96）：整合包另立格式 `composer-aov-bundle`，不併入設定交付包。
3. 引用 C core 的方式（M05）：本機路徑連結、複製固定版本入 B、或發佈為私有套件。三者皆涉及新增依賴或複製，須擇一核准。
4. 已決定（2026-10-15，D97）：依第 10.3 節的規則，date 保持日期值不補時間，decimal 預設 number、有單位且用於數量才轉 quantity。
5. 整合包副檔名與是否與既有設定交付包（`package-manifest.schema.json`）合併為同一套件，或另立。
6. 已決定（2026-10-15，D97）：未知版本一律拒絕；A 的舊格式若盤點後仍無法轉換，只讀保存原檔並列入遷移報告，不嘗試猜測轉換。

## 13. 補充：給 Codex 的排程

日期以 2026-10-15 為起算；時間為預計完成時間，依 user 規則到期未完成由 Claude 接手。決策編號自 D95 起。

| 順序 | 工作 | 負責 | 預計完成 | 前置 | 交付物 |
|---|---|---|---|---|---|
| S0 | 回覆第 12 節第 1、2、5 項 | user | 2026-10-16 | 無 | 決議寫入 D95 起 |
| S1 | M01 盤點：A／C／D 格式與版本、去識別化 fixtures；同批完成 M03 | Claude | 2026-10-15 完成 | S0 | `docs/aov-merge-inventory.md`、`fixtures/aov-merge/`、C 的結構檢查（D98） |
| S2 | M02 整合包 schema 與驗證入口（B 側） | Codex | 2026-10-17 12:00 | S1、第 10 節核定 | `schemas/aov-bundle.schema.json`、驗證模組與測試 |
| S3 | M04 B 側格式轉接與遷移報告 | Codex | 2026-10-18 18:00 | S2 | `libs/aov-integration/` 轉接模組、遷移報告、測試 |
| S4 | 審閱、瀏覽器驗證、git 提交 | Claude | S3 後 1 日 | S3 | commit、mailbox 更新 |
| S5 | M05 引用方案核准後，再排 M06–M10 | user／Claude | 另訂 | 第 12 節第 3 項 | 下一輪 thread |

S2、S3 的 Codex 工作包、停止條件與驗收項目見 mailbox thread `20261015-aov-merge-contract`。第一個里程碑（M01–M10）預估需 3 至 4 輪派工，不在本批次一次交付。
