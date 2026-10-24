# Composer 兩機版本合併評估與實作計畫

日期：2026-10-24（Asia/Taipei）  
狀態：程式與文件比較完成；以下為建議整合方案，尚未合併產品程式。2026-10-25 起 user 已核定三項取捨並寫入 D134、D135：正式執行採混合型、甘特圖只做基本估算、資源排程不做。其餘內容仍為建議，不取代其他已核定決議。

## 1. 結論

**以本機 composer-refactor 作為主要產品與設定契約，吸收 composer-refactor-2 的生產執行、基本流程甘特圖、版本快照與工程驗證能力（資源排程現階段不做，見 D135）。採分階段移植，不直接整庫覆蓋。**

本機擅長「依流程推導並選配 Kit、保留既有 AoV、彙整設定與來源」；遠端擅長「將工單轉成實際生產步驟、回報與維運」，另有排程能力但現階段不納入。兩者互補，但尚不是可以直接拼接的同一套架構。遠端也有明確未完成項目，不能把其 README 的能力清單當作整合驗收結果。

推薦產品形態：一個 Composer 建模入口、一份版本化的有效設定、一套正式工廠端；保留目前 Kit 選配與資料相容性，將遠端的生產能力與基本甘特圖納入明確的功能模組。避免長期保留兩個 Composer 編輯器、兩套帳號、兩份可各自修改同一流程的資料。

## 2. 比較基準與可信度

| 代號 | 來源 | 固定基準 | 本次使用方式 |
| --- | --- | --- | --- |
| A | 本機 `C:/Users/gslab/Desktop/composer-refactor` | `2e36f800986794bb15500faa904f7d1757d408b4`（原撰寫基準為 `7909521e3100c171089e54ff30d99201a877cb11`，其後 14 個 commit 含 D128 至 D132，已於 2026-10-24 覆核更新） | 讀取工作區程式與文件；撰寫時 `TODO.md` 的未提交修改已隨 `2e36f80` 提交，一併視為待核定需求 |
| B | [composer-refactor-2](https://github.com/yucheng384752/composer-refactor-2) | `4ff7a6a0142172a91d9f1b277c85a206dd21a65d` | 下載完整 Git 歷史，盤點並核對 368 個追蹤檔案的 blob hash，閱讀重點實作 |

本次比較兩個 HEAD 可達的 commit 集合，交集為 0。不能依賴一般共同祖先的三方合併；沒有執行 `merge --allow-unrelated-histories`，也沒有更改本機 remote。

證據分級：

- **實作查證**：本次已讀取對應函式、模型或設定；表示程式存在與靜態行為可確認。
- **歷次報告**：來自 mailbox、TODO、TEST_REPORT；本次未重跑，不提升為本次測試通過。
- **建議**：尚未實作或核定的合併方式，必須經下述驗收才可發佈。

### 2.1 與 2026-10-15 三代 AOV 合併計畫的關係

`docs/aov-three-generation-merge-plan.md`（下稱舊計畫）與 `docs/aov-merge-inventory.md` 處理的是另一組合併：AOV_generation_system、composer-refactor、aov-project 三代。本文件處理的是本機與 composer-refactor-2 兩機版本。閱讀與引用時注意：

- **代號不同。**舊計畫的 A 是 AOV_generation_system、B 是 composer-refactor、C 是 aov-project；本文件的 A 是本機 composer-refactor、B 是遠端 composer-refactor-2。aov-project 的核心在本文件中即 `libs/aov-core` 固定快照。
- **編號不同。**舊計畫 M01 至 M16 與本文件第 6 節 M01 至 M09 互不相干。引用時一律寫「舊 M05」或「本文 M05」。
- **舊計畫已落地的部分不重做。**`libs/aov-integration/`、`fixtures/aov-merge/`、單一 JSON 整合包（D101：上限 10 MB、不用 zip）、整合包 sha256 只防損壞不是簽章、date 與 decimal 的型別映射（D97）。本文件 W1 在其上擴充。
- **一致的原則沿用。**純順序線不預設轉為資料流（舊 10.2 節，對應本文 5.1）；未知版本一律拒絕；無法轉換的內容保存原件並逐項報告。
- **兩處取捨已核定（2026-10-25）。**正式執行採混合型（D134），取代舊 M13 的「保留 TS core、薄 Node 服務」建議；排程不做（D135），舊計畫第 8 節「不新增自動排程」維持有效。舊 M13 至 M15 其餘關於持久化、交易、授權的驗收條件，仍作為 W3、W4 的參考。

B 的 README 指向 repository 外的 `../Composer-PRD-Tests-v1.0/PRD.md` 與 `TEST_PLAN.md`，本次來源未包含這兩份原始需求；不能認定 B 的所有需求已經由本機使用者核准。

## 3. 雙方現況，避免沿用過時判斷

### A：本機已進展超過 10 月 16 日的第一批實作

- `apps/composer-gui/` 已有工廠／多生產邏輯／子 AoV、表單與關聯、產業範本與逐站模擬。
- `libs/aov-integration/` 已提供整合包、來源綁定、checksum 與遷移；`libs/aov-core/VERSION.json` 固定外部核心 commit `6a37dbba7dcf0563e60b1e2eb591966b09deb765`，不是可隨意手改的副本。
- `services/preview/` 已有真實後端組裝、Recipe 閘門、合成資料與煙霧測試；畫面並非全部只剩 mock，但也不是所有功能都完成真實預覽。
- D125 已補齊 station-data-link 與真實相容模型。station-admin 仍缺來源，不應假設已可用。
- D127／`kits/entry-permission-kit/` 已有權限後端。mailbox 記錄 EP2 的 PostgreSQL／HTTP 48 項檢查；其機器金鑰層為替身、EP2 測試用入口目錄只有 4 項。EP4 已於 D128（2026-10-24）完成：22 個入口、涵蓋 9 個有後端 Kit 的 52 條路由，並有 AST 路由覆蓋測試；但這 22 個入口尚未在真實 Kit 端點上做端到端授權驗證。EP5（組裝器彙整為 `permissions/entry_points.json`、`MOD_WEBHOOK_SECRET` 組裝與啟動必填檢查、預覽排除清單改為可自訂）仍未完成。
- `services/package/assemble-system.mjs` 目前仍輸出 `installable: false`，正式入口、前端與部署整合尚未齊全。不能把預覽容器能跑當成正式包已可安裝。

**本機文件有時間差：** preview README／TODO 的部分舊段落仍寫尚無權限後端或較小的最小集合；較新的 D125、D127 與 mailbox 已修正前提。系統包程式目前也仍把 entry-permission 列成「僅契約、無正式後端」。這是實際待整合缺口，不是刪除一行說明便能完成。

### B：已有工廠端，但仍有重要執行與交付缺口

- `composer_core/`、`composer_adapters/`、`composer_api/`、`factory_api/` 分層，提供流程驗證、SDK 解析、流程甘特圖、CP-SAT 排程、工單、庫存、品檢及設定版本。
- `frontend/apps/composer` 與 `frontend/apps/factory` 分離，共用 UI／API 型別；有 Alembic、測試目錄與 CI。
- HEAD 已包含 R03、R06、R24、R25 的核心修補：啟用子集連通性、外部信任根、開工移轉／資源檢查、必填品檢紀錄。
- `TODO.md` 仍列有 SDK 解析回溯、重工 DAG、子圖執行、資料 binding、併發、升級、備份一致性與頁面設計等缺口。不能將四項修補視為整套生產系統已驗收。

## 4. 截長補短：採用矩陣

下表路徑以 A／B 對應第 2 節來源。

| 能力 | 採用方向 | 保留優點／必須補齊 | 主要來源 |
| --- | --- | --- | --- |
| Composer 主介面與視覺 | A 為主 | 保留既有操作脈絡與根目錄 DESIGN.md；B 的工廠端頁面按同一設計規範移植，不直接帶入另一套 tokens | A `DESIGN.md`、`apps/composer-gui/`；B `frontend/packages/shared/` |
| 工廠、多流程、子 AoV、舊文件 | A 為主 | 保留資料與遷移能力；B 的平面 ProcessDefinition 不能覆蓋 A 的多工廠語意 | A `workflowGraph.ts`、`libs/aov-integration/`；B `process/model.py` |
| Kit 選配與流程總表 | A 為主 | 保留 Action→capability→Kit 推導及子功能；B SDK 加入顯式對應，不把 SDK 名稱直接當 kitId | A `config/actions.json`、`config/registry/`、`kitWorkflows.ts`；B `sdk/resolve.py` |
| 真實選配預覽 | A 為主、接入 B 新功能 | 沿用 Recipe 閘門、未選 API 拒絕、reset 與獨立組裝檢查；新增生產頁面同樣受控 | A `services/preview/`、`KitPreview.tsx` |
| 表單設定與資料相容 | A 為主，吸收 B 驗證案例 | 保留既有欄位與關聯、通用／領域表雙路徑；B 自訂表單模型需轉接，不能直接搬資料庫 | A `libs/ui-runtime/`、generic-forms；B `composer_core/tables/` |
| 流程預估／甘特圖 | 只做基本「流程轉甘特圖」（D135），移植 B 算法與測試 | 明確標示不含資源競用；缺少工時不能默認為 0；先轉換資料再計算 | B `gantt/timeline.py`、`gantt_png.py` |
| 資源排程 | 不做（D135） | 視為甘特圖之後的進階功能；現階段不移植 `scheduling/`、`ortools_solver.py`，不引入 `ortools`。B 工廠端的開工檢查（移轉時間、資源互斥，即 R03 修補）屬生產規則，仍隨 W3 保留 | B `scheduling/`、`ortools_solver.py`（暫不移植） |
| 正式執行路線 | 混合型（D134） | TS core 負責設計、驗證、編譯、模擬；編譯產出版本化、發布後不可變的可執行計畫；B 的 Python 工廠端只讀計畫執行。不另寫 Python 的 guard 或編譯引擎 | A `libs/aov-core/`；B `factory_api/` |
| 工單、批次、領料、品檢 | 以 B 作功能來源 | 帶入原有交易、冪等與測試；先修 R05／R29 等缺口，再接既有表單與權限 | B `factory_api/services/`、`repositories/`、`db/models.py` |
| 子圖實際執行 | 兩邊都需補，依 D134 以可執行計畫交接 | A 有 AoV core 的編譯／模擬，但不等於正式 API 編排；B 工單快照未保存子圖。需先定義可執行計畫契約（欄位、動作對應、版本），再讓工單保存計畫版本 | A `libs/aov-core/`；B `work_orders.py` |
| 帳號、角色與入口權限 | A D127 為正式方向 | B 的 session／首次管理員流程可作參考；不可默認將 USER/MIS/ENG 對應 admin/manager/operator | A entry-permission；B `services/auth.py`、`context.py` |
| 設定版本與影響分析 | 移植 B 概念與核心 | 舊工單使用舊快照、新工單使用新發布版；補發布鎖與設定 schema 驗證 | B `composer_core/config/`、`settings_service.py` |
| 組裝與來源追溯 | A 組裝規則＋B 交付資產 | 保留 A 衝突拒絕、匯入／外鍵閉包、checksum；借用 B 前端建置、migration、維運範本，不複製其整包選取規則 | A `services/package/`；B `packager.py`、`packaging/` |
| 安裝引擎 | A D126 契約為主 | 採 Ubuntu 22.04＋Docker Compose＋PostgreSQL 16；B 腳本拆成可驗證步驟，補續跑／升級／還原 | A `docs/install-engine-contract.md`；B install 範本 |
| 測試與工程工具 | 吸收 B，再接 A 回歸 | OpenAPI 型別、分層測試、CI、追溯表值得採用；B CI 尚未真正執行 Playwright，不照抄其註解承諾 | B `.github/workflows/ci.yml`、`frontend/scripts/`、`docs/TRACEABILITY.md` |

## 5. 必須先解決的衝突

### 5.1 AoV 與流程語意不能直接轉換

| A 資料／規則 | B 資料／規則 | 建議轉接規則 |
| --- | --- | --- |
| 工廠→生產邏輯→多層圖 | 一份 ProcessDefinition | 先指定一個生產邏輯作為輸出目標，保留原 factoryId／graphId；不把不同工廠攤平 |
| 系統 start／end | warehouse_out／warehouse_in | 系統邊界與倉儲動作分開；不能把任意開始節點自動變成領料 |
| actionId／capability／Kit | `sdk:function` | 建立版本化且經確認的對應表；找不到時阻擋可執行輸出，不猜名稱 |
| 表單恰屬節點、跨表單關聯 | 產品級 inspection_form、自訂 forms | 保留 formId／版本；補節點級表單綁定，不能把多張品檢表壓成一張 |
| 先後順序連線 | material／data＋transfer_time | 既有邊先保留為 precedence；未經指定不得當物料流，避免改變庫存數量 |
| 子 AoV | form／validate／store／state 子圖 | 無法對應的節點列遷移報告；保存來源且阻擋發布，不丟棄子圖 |
| 未填工時 | latency 預設 setup=0、per_unit=0 | 分開「缺資料」與真正 0；預估時長、單位、數量來源必須明確 |

B 的 Edge 現無 source_port／target_port，不能宣稱已支援完整資料映射。端口、單位、輸入輸出與 dataflow binding 應先形成契約，再增加虛線 UI。A 核心固定快照維持唯一來源，不在兩個 repository 分別修改同一演算法。

### 5.2 技術棧、資料庫與 API

- 兩邊 React 都是 18.3.1，但 A 為 Vite 7／Vitest 4／TS 5.9，B 為 Vite 6／Vitest 2／TS 5.7，且有 npm workspaces。以 A 工具鏈為主，只引入實際使用的依賴；不能覆蓋 lockfile 或一次載入兩套前端依賴。
- A Kit 主要使用 async SQLAlchemy 與 asyncpg；B factory 使用同步 Session 與 psycopg。第一個可執行增量建議讓 B factory 在獨立程序及獨立資料庫邊界運行，再由正式 API 整合；不直接混用 Session 或共用同名資料表（D134 已採用此過渡做法）。此為過渡建議，不能因此形成兩個長期權威資料來源；收斂條件建議為：W6 發布前，factory 的資料表以獨立 schema 併入同一 PostgreSQL 16，並改用與 Kit 一致的連線與交易模式，或明確記錄不併入的理由。
- 每份資料先指定唯一寫入者：A 管理流程／表單設計，factory 管理工單與執行紀錄；發布產生不可變快照。用版本化 API／事件交接，不雙寫同一業務事實。
- 正式部署以較新的 A D126（Docker Compose、PostgreSQL 16）為準；TODO 較早的 PostgreSQL 14／原生 systemd 建議已被後續決議取代。B 的 Windows 安裝列延後範圍，不默認新增本次交付承諾。
- 各自 Alembic revision、舊 Kit schema registry、GenericRecord 不直接互相 stamp 或覆寫。新增資料表與既有資料遷移分開，正式導入前做資料量、外鍵、版本、備份還原驗證。

### 5.3 認證、簽章與授權

- A 使用 D127 的可設定角色、audit 唯讀、入口授權、JWT／bcrypt；B 使用 USER/MIS/ENG、資料庫 session 與 Argon2。定義登入、到期、撤銷、角色／入口對應後，才移植工廠端。不同雜湊不能直接當作同一種密碼驗證，需支援既有格式或強制安全重設。
- A 授權使用 RSA-PSS-SHA256，B 安裝包使用 Ed25519。套件來源簽章與機器授權是兩個目的；新 manifest 必須明示格式與算法，驗證器僅接受核准組合，不能把同樣副檔名當成相容格式。
- A 已於 2026-10-24 核定安裝簽章與授權方案（D129 至 D132）：多硬體特徵指紋、兩層簽發金鑰（根金鑰離線、子金鑰憑證限客戶與有效期）、公鑰信任起點由操作手冊提供雜湊並手動核對、單一 `system-manifest.json`、簽章簽 `tar.gz` 本身且授權綁確切 manifest 雜湊。B 的 ZIP 封裝加 Ed25519 套件簽章與此不同，屬格式與流程的實質衝突：移植 B 維運資產時，打包格式、簽章算法與驗章流程以 A 的 D129 至 D132 為準，B 的 `verify-package` 與「外部信任根」只保留其原則（信任根不得放在安裝包內）。D129 至 D132 的取值權限、容器內取得宿主指紋等未實機驗證項目，仍不視為已完成。
- B R06 的「套件外部信任根」原則應保留，但其本機撤銷清單不等於離線客機會收到最新撤銷資訊。A 的多硬體指紋、兩層簽發金鑰與 USB 信任流程已由 D129 至 D131 核定，但實機驗證（指紋取值、離線客機撤銷）仍未完成，不在本文件默認完成。
- 預覽假管理員標頭與測試種子不得進正式包；B 固定 NAV 也不等於 Kit 選配授權。所有直接 API、背景任務、webhook 均需適用有效選配與權限。

### 5.4 封裝的重現性與完整性

A 組裝追求固定輸入得到相同內容；B package_id 含 `now`、manifest 含發行資訊，即使 ZIP timestamp 固定也不代表完全可重現。建議分開「確定性的 payload manifest」與「包含時間的發行／簽章信封」，保留來源 commit、Kit／SDK lock、檔案 hash 與 builder 版本。A 的 D132 已要求 tar 固定順序、時間戳與擁有者，並以 `system-manifest.json` 收納依賴鎖定檔 sha256，與此建議方向一致；B 的打包需改為遵循 D132。

B `packager.py` 固定帶入 factory_api 與大量 runtime package，並非 A 的「只含所選 Kit」組裝。移植後必須驗證未選功能沒有被無條件註冊／開放，且所有間接匯入與 migration 都在選配閉包內。

## 6. 本次新增發現與整合阻擋項

| ID | 優先序／證據 | 問題 | 合併前必要處理 |
| --- | --- | --- | --- |
| M01 | P0，靜態查證 | B `factory_api/cli.py` 的 verify_package 匯入 `composer_adapters.trust`，但 `packager.py` 的 RUNTIME_PACKAGES 白名單未包含 `trust.py` | 將檔案納入正式 payload；從實際產出 ZIP 解壓到無 repository PYTHONPATH 的乾淨環境執行驗章，不能只在原始碼目錄測試。證據（2026-10-24 對 B `4ff7a6a` 覆核）：`packager.py:28` 的 `composer_adapters` 白名單只有 `__init__.py`、`ortools_solver.py`、`signing.py`、`sdk_store.py`，`cli.py:164` 的 `verify_package` 於函式內 import `composer_adapters.trust`；目前 `factory_api`、`app_common`、`composer_core` 只 import 兩個 adapter（`trust` 與 `ortools_solver`），故 `trust.py` 是唯一缺漏。尚未做產出包實機重現 |
| M02 | P0，B TODO＋實作查證 | SDK resolver 逐次選最高可用版本，沒有完整回溯；build 在 lock 前使用 function_catalog 驗流程 | 修 R15，加入需降版才能解出的組合；所有能力驗證只能使用最終 lock 的 catalog。證據（B `4ff7a6a`）：`resolve.py` 的 `_pick` 對每個 SDK 只取「最新且滿足當前限制」的版本，`resolve()` 以迭代收斂而非回溯，某 SDK 被選高版後新增的相依限制若只有低版可滿足，會直接回傳 `SDK_VERSION_CONFLICT`；`packager.py:76` 以 `store.function_catalog()`（現行 catalog）驗證流程，`:80` 才執行 `resolve` 產生 lock，順序相反。`composer_api/services/projects.py:110` 的驗證路徑同樣使用現行 catalog。B 的 `TODO.md` 記載 R15 以最小重現確認仍存在 |
| M03 | P0，實作查證 | B 工單 route_snapshot 保存外層節點與邊，未保存子圖；執行仍由固定 production 服務處理 | 先保存版本化執行計畫，再接認證動作；證明修改子圖會改變新工單操作，舊工單不受影響 |
| M04 | P0，B TODO＋實作查證 | B 重工仍按清單串接，資料邊無 port binding；數量與合流語意未閉環 | 修 R05／R28；驗證拆批、重工、報廢、入庫守恆，再開放正式資料 |
| M05 | P0，實作查證 | A 權限後端已存在，但 system assembler 仍使用預覽排除清單與「只有契約」原因 | EP4 已由 D128 完成；仍須完成 EP5（入口彙整、移除系統包對 entry-permission 的排除）、替代認證選擇，以及 22 個入口在真實 Kit 端點上的逐項拒絕測試 |
| M06 | P0，B TODO 的靜態風險 | 發布版本、跨子批預留、首次庫存建立、備份快照及還原判空不足 | 移植時同步帶修補與雙連線交易測試；未重現前標示風險，不宣稱已發生資料毀損 |
| M07 | P1，實作查證 | B PagesDesignerPage 排除 ui.form；factory App 使用固定 NAV／路由 | 先接頁面 schema、權限、form binding 與共用 renderer，不能把排列佔位框當完成頁面設計 |
| M08 | P1，實作查證 | B CI 註解承諾 E2E，但 workflow 無 Playwright 執行步驟 | 增加真正的 E2E job、DB／服務啟動及 trace；保留 A 各模組回歸 |
| M09 | P1，A 程式／文件查證 | 部分 README、TODO 與實作狀態不同步 | 以新版決議、實作、指定 commit 測試記錄建立狀態表；舊歷史保留但標示被取代 |

B 已修 R03／R06／R24／R25 的程式與測試應保留，不能因本表另列問題而回退到修補前版本，也不能忽略原 TODO 各項的剩餘範圍。

## 7. 建議整合工作包

每包單獨提交、保留來源 commit 與測試；以下目標目錄為建議，不表示已建立。

| 工作包 | 修改範圍 | 產物及通過條件 | 依賴 |
| --- | --- | --- | --- |
| W0 基準與需求整理 | 本文件、正式 spec／decision-log／TODO、來源追溯 | 固定 A/B commit；標註已決／建議／歷次測試；補 B 缺失 PRD 或列不可驗收範圍 | 無 |
| W1 契約與轉接 | 在既有 `libs/aov-integration/`、`schemas/` 上擴充；Action／Kit／SDK 對應；可執行計畫契約（D134） | 建議拆成兩個 PR：(1) 版本化對應表與拒絕案例、可執行計畫欄位契約，(2) 逐欄遷移報告。舊文件可讀、未知語意阻擋可執行輸出；不破壞原稿，且不重做舊計畫已完成的整合包（D101） | W0 |
| W2 流程預估（基本甘特圖，D135） | 擬 `services/planning/`、Composer 預估介面 | 只做「流程轉甘特圖」：移植 B timeline 與測試；缺工時與 0 要分開，缺資料的節點明確標示；單位／平行路徑有明確結果；PNG 標示估算且不含資源競用；先決定甘特圖歸屬 Composer 端（B 打包時排除 `gantt`，歸屬不可含糊）。不含排程、資源日曆、手動調整 | W1（工時缺值語意） |
| W3 生產核心垂直切片 | 擬 `services/factory/`、擬 `apps/factory-ui/`、migration | 工廠端依 D134 只讀可執行計畫；先修 M03/M04 相關核心範圍；一條「建單→領料→開工→品檢→入庫」真實 DB 路徑，保存計畫版本與稽核；證明改子圖後新工單變、舊工單不變 | W1 |
| W4 權限與選配 | entry-permission、入口彙整、Recipe 閘門、factory API／NAV | 完成 M05；停用功能不可由 API 繞過；audit 不可寫；身份映射不提權；預覽與正式隔離 | W3 |
| W5 排程（不做，D135） | 無 | 現階段不移植 B 的 scheduling core、adapter、排程頁，不新增 `ortools` 依賴。日後若啟動，須先由 user 核准並確認需求場景，驗收條件另訂（至少含：解算與人工調整共用驗證器；移轉時間、資源互斥、日曆、到料及實際開工一致） | 另待核准 |
| W6 發布、升級與回復 | A system assembler、B 維運資產、A install engine | 修 M01/M02/M06；打包與簽章遵循 D129 至 D132；乾淨客機驗包安裝、同包續跑、v1→v2、失敗回復且資料不遺失 | W4 |
| W7 頁面設計與全套驗收 | 共用 UI schema／renderer、CI、測試追溯表 | 自訂頁可導覽、表單可操作、預覽與產物一致；正式 E2E、效能與環境證據齊全 | W4、W6 |

**第一個建議實作 PR：W1 的資料轉接與拒絕案例。** 它影響最小，也會揭露哪些 B 能力可以無損接入。不要先複製全部 factory 資料表或替換整個前端。

W2 可以先完成，提供甘特圖價值；但流程預估不代表 W3 生產引擎完成，也不含排程（W5 不做）。

**執行規範：**
- 每個工作包開專屬分支 `feature/<name>`，完成時留下開發內容、目的、測試方式與結果（commit、mailbox thread 或 docs），並在完成後提醒 `/clear` 與提供承接 prompt。
- 新增依賴須先經 user 核准。目前預期需核准的有：W3 的 Python 資料庫驅動與 Argon2 雜湊（B 使用 `argon2-cffi`、psycopg）；`ortools` 因 W5 不做而不引入。W2 的甘特圖 PNG 若沿用 B 的繪圖實作，亦須確認其依賴。
- 正式部署與資料遷移另按專案規範處理。

## 8. 整合驗收矩陣

| 案例 | 必須看到的結果 |
| --- | --- |
| 舊 AoV／整合包讀回 | factories、graphs、forms、relations、bindings、來源版本不遺失；無法轉換處有路徑與原因 |
| 多工廠／同名節點 | ID 與工廠範圍不混淆；不跨工廠連接資料或執行 |
| 主動作與 side function | 流程推導必需 Kit，選配只增補側功能；仍符合依賴閉包 |
| 所選 Kit 總表 | 與實際有效設定一致，未選子功能不輸出，不把相依當先後順序 |
| 真實預覽 | 每個標示真實的畫面都有 API 與 DB 證據；切換選配後頁面與 API 同步拒絕，重置只影響預覽 |
| 子圖修改 | 同一業務節點從表單 A 改 B 後，新工單強制 B；舊工單保留 A 及原版本 |
| 拆批與重工 | 20 拆 12/8 通過、12/9 拒絕；每次失敗／重工／報廢／入庫數量可核對 |
| 開工檢查 | 尚未滿足移轉時間、資源被占用時拒絕開工（B 的 R03 修補保留）；排程求解與其驗證不在範圍（D135） |
| 流程預估 | 缺工時的節點標示為缺資料而非 0；PNG 與介面皆標示「估算、不含資源競用」 |
| 並發與冪等 | 兩條 DB 連線同時發布／領料／入庫不超領、不雙發布、不回原始唯一鍵 500 |
| 身分與選配 | 未選 Kit、唯讀角色、停用帳號、跨租戶、未知入口均有可驗證拒絕；測試替身另列 |
| 可安裝包閉包 | 解壓後不依賴 repository；trust.py 等所有 runtime 匯入齊全；未選功能與假預覽入口不被帶入 |
| 信任驗證 | 自簽且只附自己的公鑰必須拒絕；來源核准、未篡改、格式／算法相容才可安裝 |
| 備份與升級 | 持續寫入時備份可一致還原；空庫檢查覆蓋全部業務表；失敗回復保留既有資料 |
| 頁面設計 | 新增第二頁與表單後，產出系統可導覽並操作；隱藏必填欄位／不存在 binding 拒絕發布 |
| 視覺一致性 | 移植的工廠端與預估頁面皆符合根目錄 `DESIGN.md`，不帶入 B 的另一套 tokens |

## 9. 來源索引

### 本機 A

- [專案規格](docs/project-spec.md)、[決議紀錄](docs/decision-log.md)、[目前 TODO](TODO.md)、[視覺契約](DESIGN.md)。
- [AoV 整合](libs/aov-integration/index.ts)、[固定核心版本](libs/aov-core/VERSION.json)、[Workflow 模型](apps/composer-gui/src/workflowGraph.ts)。
- [預覽組裝](services/preview/assemble.mjs)、[預覽閘門](services/preview/app/preview_gate.py)、[系統包組裝](services/package/assemble-system.mjs)。
- [安裝引擎契約](docs/install-engine-contract.md)、[權限設計](docs/entry-permission-design.md)、[EP2 實測及 EP4 草案](.codex-claude-mailbox/threads/20261022-entry-permission-kit.md)。

### 遠端 B（固定於比較 commit）

- [README](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/README.md)、[TODO 與修補範圍](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/TODO.md)。
- [流程模型](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/backend/src/composer_core/process/model.py)、[SDK resolver](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/backend/src/composer_core/sdk/resolve.py)。
- [工單快照](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/backend/src/factory_api/services/work_orders.py)、[生產規則執行](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/backend/src/factory_api/services/production.py)。
- [封裝白名單](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/backend/src/composer_adapters/packager.py)、[CLI 驗章入口](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/backend/src/factory_api/cli.py)、[外部信任根](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/backend/src/composer_adapters/trust.py)。
- [獨立排程驗證器](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/backend/src/composer_core/scheduling/verify.py)、[CI 實作](https://github.com/yucheng384752/composer-refactor-2/blob/4ff7a6a0142172a91d9f1b277c85a206dd21a65d/.github/workflows/ci.yml)。

## 10. 對論文的影響

專案成果將撰寫成論文，須能說明相對基線版的差異與改良理由。本次合併可歸納出的論述點如下，皆為待驗證的假設，不是已有的實驗結果：

- **契約先行的混合架構（D134）：**設計期語意由單一 TS core 保證，執行期只讀不可變的可執行計畫。可對照 B「工單快照未含子圖」的缺口，說明為何以版本化計畫交接。
- **選配與生產執行的結合：**A 的 Action 到 capability 到 Kit 推導，加上 B 的工單執行，形成「依流程選配再執行」的完整鏈。
- **範圍取捨有記錄（D135）：**排程刻意不做，論文中須如實列為限制與後續工作，不宣稱涵蓋。
- 此節不含任何尚未取得的測試數據；數據須待 W3 以後的驗收產生。

## 11. 本次交付與未驗證範圍

本次只新增根目錄這份文件，目前它是工作樹中唯一未追蹤的檔案。撰寫時本機 `TODO.md` 與 entry-permission-kit 的 D128 檔案尚未提交，之後已隨 `2a5e790`、`2e36f80` 提交，故第 3 節對 EP4 的描述以提交後狀態為準。比較過程下載 B 快照供唯讀查核，未執行 B 的啟動、安裝或資料庫程式，未匯入其依賴、未套用 migration、未發送正式資料。

已完成：固定 commit、追蹤檔案盤點、無共同歷史確認、重點程式／模型／封裝／CI 與文件交叉比對、採用矩陣、契約差異、阻擋項與逐階段驗收。

未完成：雙方完整測試重跑、B 乾淨安裝包驗證、DB 併發、實機部署、瀏覽器與效能。本機 Python 命令本次無法啟動；未藉此宣稱 B 測試失敗。歷次測試報告僅作參考，合併後必須以新 commit 重驗。此文件不表示已完成任何程式合併或正式部署。
