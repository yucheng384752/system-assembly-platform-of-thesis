---
id: "20261016-kit-workflows-live-preview"
title: "Kit AoV 彙整與真實選配預覽"
status: "in_progress"
owner: "claude"
reviewer: "claude"
priority: "high"
created_by: "codex"
created_at: "2026-10-16"
updated_at: "2026-10-20"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "schemas/kit-workflow.schema.json"
    type: "file"
  - path: "apps/composer-gui/src/kitWorkflows.ts"
    type: "file"
---

# Goal

依使用者授權開始修改：kit 內保存描述 workflow 的 AoV，選配後輸出總表；後續預覽以實際組裝的全部相容 kit 運行，依有效選配開放頁面與操作。

# Success Criteria

- Kit workflow 有版本、所屬 kit、節點、明確有向邊、子功能引用；錯誤引用與循環可定位。
- 總表只包含有效選配 kit 與其已啟用子功能；未提供或錯誤的定義明確列出；不把相依關係當流程連線。
- 畫面與交付包使用同一彙整函式；JSON 與 Markdown 總表列入 manifest/checksum。
- 最終真實預覽須實測 API、資料寫入及重置；未啟用功能與無權限角色不得繞過頁面直接呼叫 API。
- 全量預覽成功與僅所選 kit 的獨立部署驗證分開報告。

# Current Context

- 現有 KitPreview 已依 enabledKits 篩選 tab，Renderer 仍使用模擬資料。
- deliveryPackage 為 installable:false 的設定交付包。
- kits/BASELINE.md 已記載 station-admin 缺 routes_stations、station-data-link 缺 routes_import，以及 app.core 等共用來源缺口。entry-permission 尚未提供身分驗證。
- 工作區已有使用者／其他工作未提交變更：FactoryPage、WorkflowCanvas、aov.test、decision-log、mailbox index 與 AoV 合併／範例文件；保留不覆寫。

# Codex Notes

## 2026-10-20 WP4c T1 與最終驗證

### 變更與範圍

- 新增 `services/preview/app/models/{p1_record,p2_record,p2_item_v2,p3_record,p3_item_v2}.py`，類別分別為 P1Record、P2Record、P2ItemV2、P3Record、P3ItemV2。只有實際使用的欄位，沒有額外 created_at、關聯集合或業務規則。屬性名稱保留呼叫端相容性，不在 seed/CSV 複製來源案例的業務欄位與值。
- 修改 `assemble.mjs`：移除 import 路由／服務的拒絕補丁及五個 fallback，模型納入自動產生的 models/__init__.py；main.py:19,27 既有流程會先載入再 create_all。來源衝突檢查仍拒絕 Kit 覆蓋。
- 修改 `app/preview_support.py`：只移除 reject_table_code/reject_job 與不再使用的匯入；require_preview、固定 DB／MOD、外部服務限制、tenant_api_keys 外鍵目標原樣保留。組裝後 import 路由／服務與基線僅換行差異，租戶、路徑、重複檔、狀態檢查均保留。
- 修改 `app/preview_seed.py`：加入 P1/P2/P3 三列 TableRegistry；不建立同名 Station，避免 schema_driven 繞過相容分支。只建立 T9 通用表的 schema；P1/P2/P3 不需要猜造 schema，job.schema_version_id 可空。
- 修改 `smoke.mjs`：三種分支都必須建立 201、有 id、READY、錯誤清單空、提交 200、COMPLETED、total_rows=1、error_count=0。合成資料只有 lot_no=`9000001_01`，P3 加 date=`2099-01-01`；P3 缺日期會在 import_v2.py:1758–1762 拒絕，因此提供可解析的通用 date，不改規則。
- 修改 `tests/preview.test.mjs`：註冊與基線保留測試；實際煙霧 helper 的成功及無 id、501、READY 前失敗、有驗證錯誤、提交失敗、提交後 FAILED 測試（請求替身，並非容器實測）。
- 修改 `tests/test_static.py`：實際 require_preview 防護、AST 比對模型欄位與建構參數／動態賦值、以查詢替身執行實際 seed 驗證重跑不增列與 schema 漂移拒絕。此 Python 測試尚未成功執行。
- 更新 `services/preview/README.md` 與本 thread／index 的交接資訊。未改 kits/、schemas/、config/、libs/、package*.json，無新增依賴、git 寫入、Docker、伺服器或連網。

### 逐欄依據

以下行號均指 `kits/import-pipeline-kit/src/backend/app/services/import_v2.py`。已以 rg 掃描所有 kits 的 Python：五個類別的實際使用者只有此檔，routes_import_v2.py 沒有額外模型屬性要求。Text 不推定字串長度；Float 對應 float()；UUID 對應 uuid4／既有 FK；JSONB 對應 dict。表名依類別與檔案及服務的 p3_records/p3_items_v2 註解（948）；不承諾復原來源案例的資料表契約。

| 模型 | 每個欄位與型別 | 程式依據 |
| --- | --- | --- |
| P1Record | id: UUID；tenant_id: UUID；lot_no_raw: Text；lot_no_norm: BigInteger；schema_version_id: nullable UUID；extras: JSONB | 1222–1229 建構；1210–1211 租戶／整數正規化 key 查詢；1217–1218 更新 raw 與 dict |
| P1Record | updated_at: nullable DateTime(timezone=True) | 1219 func.now()；新建時未傳，因此不臆造初始時間 |
| P2Record | id: UUID；tenant_id: UUID；lot_no_raw: Text；lot_no_norm: BigInteger；schema_version_id: nullable UUID；winder_number: Integer；extras: JSONB | 1260–1268 建構；1252–1254 查詢與 int()；1272–1273 更新 |
| P2Record | updated_at: nullable DateTime(timezone=True) | 1274 func.now()；新建未傳 |
| P3Record | id: UUID；tenant_id: UUID；lot_no_raw: Text；lot_no_norm: BigInteger；schema_version_id: nullable UUID；production_date_yyyymmdd: Integer；machine_no: Text；mold_no: Text；product_id: Text；extras: JSONB | 1041–1054 建構、1002–1007 查詢；1013–1038 日期轉 int 與字串組合；1668–1764 提取（缺日期拒絕，machine/mold 缺值使用基線 UNKNOWN） |
| P3Record | updated_at: nullable DateTime(timezone=True) | 1059 func.now()；新建未傳 |
| P2ItemV2 | id: UUID；p2_record_id: UUID；tenant_id: UUID；winder_number: Integer；production_date_yyyymmdd: nullable Integer；trace_lot_no: nullable Text；row_data: JSONB | 1282–1294 建構；1277 record 外鍵刪除；1560–1620 日期提取回 int 或 None；154–169 trace 組合可回 None |
| P2ItemV2 | slitting_result: nullable Float | 1297–1299 賦值，1622–1666 提取可回 float/int 或 None |
| P2ItemV2 | sheet_width、thickness1、thickness2、thickness3、thickness4、thickness5、thickness6、thickness7、appearance、rough_edge：各為 nullable Float | 1301–1315 明列欄位並 setattr(..., float(...))；未提供不賦值 |
| P3ItemV2 | id: UUID；p3_record_id: UUID；tenant_id: UUID；row_no: Integer；row_data: JSONB | 1170–1185 建構；1071 enumerate(start=1)；1063–1064 record 外鍵刪除 |
| P3ItemV2 | product_id: nullable Text；lot_no: Text；machine_no: Text；mold_no: Text | 1073–1078 初值；1086–1094、1115–1123 str().strip()；1145–1149 product id 組合；1175–1180 建構 |
| P3ItemV2 | production_date: nullable Date | 1075 None；1097–1110 datetime.date(...)；1177 傳入 |
| P3ItemV2 | production_lot: nullable Integer；source_winder: nullable Integer | 1079–1080 None；1126–1129、1152–1155 int(float(...))；1181–1182 傳入 |
| P3ItemV2 | specification: nullable Text；bottom_tape_lot: nullable Text | 1081–1082 None；1160–1166 str().strip()；1183–1184 傳入 |

UUID 外鍵目標：tenant_id 來自 job.tenant_id（`models/import_job.py:31–33` → tenants.id）；schema_version_id 來自 job.schema_version_id（同檔 37–39 → schema_versions.id，nullable）；兩個 item 的 record_id 直接來自已 flush 的 record.id。主鍵由各建構式明確傳 uuid4，不另加預設生成器。未新增唯一約束或推測商業欄位限制。

### 驗證結果與 Claude 待辦

- `npm.cmd run typecheck`：通過。
- `npm.cmd run build`：通過；既有 React Flow use client 與大於 500 kB chunk 警告。
- `npm.cmd test`：38 檔，37 通過、1 失敗；453 tests 通過、1 失敗、1 略過。失敗為 security.test.mjs:128 私鑰 open EPERM，afterAll:107 清理也 EPERM。暫存目錄 `C:\Users\gslab\AppData\Local\Temp\composer-security-w6F5TQ` 未宣稱清除；未讀取或輸出金鑰內容，未修改安全測試。
- `node --test services/preview/tests/preview.test.mjs`：7/7 通過。
- `python -I services/preview/tests/test_static.py`：已嘗試兩次，python.exe 都無法啟動「指定的登入工作階段不存在。可能已被終止。」因此 Python 語法／AST／seed 測試及 ORM mapper 未驗證。
- 額外 assemble/preview checkJs 與 smoke `node --check`：通過。初次 diff --check 發現 README 混合換行，後續發現 preview_support 尾端空行；兩者已修正，最終 diff --check 通過（只有 Git 換行提示）。最終工作樹僅列 services/preview 與 mailbox，五個新增模型均已核對。
- Claude：先補 Python 檢查與模型 mapper/DDL 驗證，重建容器，seed 兩次核對 TableRegistry=4、SchemaVersion=1、Station=1、StationSchema=1（全新預覽 DB）。執行 smoke；直接查 p1_records/p2_records/p3_records 與 p2_items_v2/p3_items_v2 的合成資料，重匯後確認更新／替換不增筆；T9 經 records API 核對 generic_records。再驗 reset 全空與重新 seed。
- T1/T9 程式交接完成，實際 DB／容器結果仍待 Claude；thread 維持 in_progress、owner=claude。

## 2026-10-20 WP4c T9

- 起點已核對：feature/preview-gaps、20f5ae6，工作樹乾淨。完整閱讀 CLAUDE.md、D104–D107、preview-todo、preview README、末尾派工與 Claude WP4a/WP4b 審閱。
- 變更 `services/preview/app/preview_seed.py`：明確 seed 命令建立 `preview_entries` 的 TableRegistry、SchemaVersion、同租戶 Station 與 StationSchema；啟動仍不種資料。既有 seed 資料重跑不新增版本，不覆蓋變更過的 schema，衝突報錯。欄位只有合成 `entry_key`、`value`。
- fingerprint 依 `routes_import_v2.py:86–88` 的排序、管線分隔、SHA256；schema 依 `import_v2.py:36–62`。Station/StationSchema 必須同時存在，依 `import_v2.py:833–867,1343–1398,1471–1503` 才會進 schema_driven 並寫 generic_records。
- 變更 `services/preview/smoke.mjs`：T9 不再列 GAP，省略 table_code 測 fingerprint 解析，建立後輪詢 READY、查錯誤為空、提交、輪詢 COMPLETED、經表單 records API 核對合成 key/value；無 ID、HTTP 失敗或終止狀態均失敗。
- 本段驗證：Node 預覽測試 6/6；smoke 語法檢查通過。`python -I services/preview/tests/test_static.py` 無法啟動（指定的登入工作階段不存在），未宣稱 Python 通過。根目錄 typecheck/test/build 將於本批完成後執行，結果另記。
- 真實 API、DB 寫入、重跑 seed 的資料庫冪等性尚未實測，交由 Claude；本段不執行 Docker、伺服器或網路。

## 2026-10-19 WP4a：組裝器與容器設定交接

- cwd 確認為 `C:\Users\gslab\Desktop\composer-refactor`，分支 `feature/real-preview-sources`、HEAD `f00c23a`，開始時工作區乾淨。完整讀取 CLAUDE.md、DESIGN.md、本 thread、preview-todo、BASELINE，以及 decision-log 的 D89–D94／D104／D105。只做 WP4a，沒有執行 Docker、啟動伺服器、連網或 Git 寫入。
- 新增 Node 組裝器，僅用標準庫，適合目前可執行的 Node 環境。全部 `app` 檔案合併為實體套件樹，補套件標記，固定排序／LF／SHA-256 報告，不含時間或機器絕對路徑；要求新輸出目錄，不刪除既有產物。納入 9 Kit、排除 entry-permission（無 backend）、tenant-auth（廢除）、station-admin／station-data-link（缺來源），逐項附原因。管理 scripts 不作為 app 或容器入口。未知檔案衝突、未知路由或補丁定位不符直接失敗。
- 依 reference 與實際來源註冊 12 router，補入 reference 未列的 generic-forms、mod-subscription、admin-permissions；缺來源的 routes_ut／traceability 不虛構。`/healthz` 為新預覽入口提供，不修改既有 capability verified。只把納入 Kit 契約複製至產物供 broker 查詢。
- 組裝衝突明確採 logs-ops 的 monitoring 覆蓋 platform-core no-op（符合來源說明），本機 writer 需 psycopg2-binary；不開外部 heartbeat。重建模型 __init__ 僅載入現有模型，避免基線匯出不存在的 analytics_mapping、validation_rule、tenant_user、tenant_api_key。另在 preview_support 定義只有 UUID 主鍵的空 tenant_api_keys 表，解決既有可空稽核外鍵；不是身分驗證模型，不製造使用者／金鑰。
- T1 採組裝版來源補丁：兩種 table registry resolver 在明確 table_code 及 fingerprint 結果都檢查；commit 路由在更改狀態／排背景任務前查同租戶 job，服務 commit_job 亦在任何狀態修改前檢查。P1/P2/P3（含空白及大小寫）回 501 與可讀 T1 訊息。五個缺失模型另提供拒絕匯出的 fallback，避免漏網路徑變 ModuleNotFoundError。未修改任何 kits 來源。保留的三個名稱即使設為通用表單，import-pipeline 仍暫拒絕，等待 user 決定。
- 入口啟動以模型 create_all，logs 表用 Kit 自帶 DDL；不自動 seed，初始／重置後租戶及業務資料均空白。另提供 `python -m app.preview_seed`，只透過 compose exec 建立固定合成租戶供 Claude 實測。重置使用 Node 腳本呼叫固定 project 的 compose down --volumes，再 up --wait，先終止背景工作再刪具名 DB/files volumes，沒有網頁重置入口。
- Compose 的 PostgreSQL／backend 只發布 127.0.0.1:55432／58000，internal network 禁止連外；固定本機假帳密、secret 與 webhook secret。MOD 同步只連同一容器的 `/_preview/mod` 假服務（basic/active），PDF 與遠端監控關閉。app.main 檢查預覽旗標與固定連線設定。管理員權限／audit events 原始 403 保留，未偽造管理員。WP5 的有效能力與授權未實作。
- Docker 固定 Python 3.12.8、Node 22.14.0 組裝階段與 PostgreSQL 16.6；requirements 固定直接／間接版本。相對 baseline 移除 SQLite aiosqlite、uvicorn standard extras，下限套件改固定版，新增同步日誌 driver psycopg2-binary。Dockerfile 專用 ignore 限縮建置內容，不送 .git、宿主 .env、mailbox 或本機產物。依賴候選未經安裝／resolver 實測，不宣稱已驗證。

### 新增／變更檔案

- `services/preview/assemble.mjs`、`preview.mjs`：組裝及跨平台 up/down/reset/status。
- `services/preview/app/main.py`、`preview_support.py`、`preview_seed.py`：預覽入口、隔離／501／外鍵補足、明確合成租戶命令。
- `services/preview/Dockerfile`、`Dockerfile.dockerignore`、`docker-compose.yml`、`requirements.txt`：容器與固定依賴。
- `services/preview/check_tree.py`、`tests/preview.test.mjs`、`tests/test_static.py`：標準庫 Python 語法／AST 匯入閉合檢查與 guard 測試；Node 組裝、來源保留、確定性、缺來源、衝突、501 補丁位置、命令失敗及隔離設定測試。
- `services/preview/README.md`、`.gitignore`：繁中操作／預期結果／限制／Claude 驗收步驟，忽略本機產物。
- 本 thread 與 mailbox index。未修改 kits、schemas、config、libs/ui-runtime、package*.json 或唯讀 reference；沒有 npm 新依賴。

### 驗證結果與未執行項目

- `node --test services/preview/tests/preview.test.mjs`：exit 0，5 passed、0 failed、0 skipped；最後重跑仍通過。兩次組裝每個檔案逐位元組相同，前後 Kit 來源 bytes 相同。
- 兩個新 .mjs 的 `node --check` 與額外 `tsc --allowJs --checkJs --strict ...`：exit 0。既有 tsconfig 未納 services，故額外檢查，不更改專案設定。
- `npm.cmd run typecheck`：exit 0，通過。
- `npm.cmd test`：exit 1，38 files = 37 passed／1 failed；455 tests = 453 passed／1 failed／1 skipped。失敗為既有 `src/security.test.mjs` CLI 簽署時開啟 `C:\Users\gslab\AppData\Local\Temp\composer-security-73Ib7q\keys\signing-private-key.pem` 遭 EPERM；afterAll 清理同一暫存目錄也遭 EPERM（suite failure）。沒有改測試或私鑰規則，沒有手動讀取私鑰，暫存目錄未宣稱清除，請 Claude 處理與重跑。
- 1 skipped 是既有 App.test.tsx「未涵蓋：以 User 身分修改 MIS 項目由授權邊界拒絕（尚無身分機制）」，本輪未新增 skip。
- `npm.cmd run build`：exit 0，內含 typecheck／Vite build 通過；既有 React Flow use client 忽略與 App bundle 732.41 kB 超過 500 kB 警告保留。
- `git diff --check`：exit 0（新檔尚未追蹤，不把此命令當新檔完整驗證）。Git 唯讀狀態查詢有全域 ignore 權限警告。
- Python **未執行**：`python --version` 的 WindowsApps 入口無法執行，回 logon session 不存在；`.venv/Scripts/python.exe --version` 指向不可用的 Python313。未安裝／下載 Python，也未用 Docker 繞過。`check_tree.py` 與 Python unittest 已備妥，需 Claude 用可用 Python 補跑；Dockerfile 建置亦會執行語法／匯入閉合檢查。Node import 掃描已通過，但不代表 Python compile／執行通過。
- Docker build、pip resolver、PostgreSQL 建表、SQLAlchemy mapper、真實 API／背景寫入、重置、連外隔離與 Windows/Linux 實際容器相容性均**未實測**。README 明列啟動命令、預期輸出與逐 Kit／501／重置檢查清單，不宣稱真實預覽已驗證。
- 實際驗證日誌時間已晚於原定 18:00，未回填為準時完成。WP4a 程式與設定交 Claude 審閱及 WP4b 實測；thread 維持 `in_progress`，owner 改 `claude`，未把 WP4–WP6 標完成。

## 修改計畫與範圍

1. WP1：新增 schemas/kit-workflow.schema.json、libs/ui-runtime/schema.ts 登錄、kitWorkflows.ts 載入及語意驗證。採 kits/<kit-id>/workflow.aov.json 固定位置，先不擴充 manifest 路徑設定。
2. WP2：先加入 upload-validation-kit 的上傳→查詢狀態草稿流程，引用既有 capability；其餘 kit 如實列為尚未提供，逐份依來源補齊。此首份模板非全功能覆蓋。
3. WP3：OutputPage 顯示總表；deliveryPackage 加入 JSON/Markdown 彙整與驗證狀態，package-manifest schema 與相關測試同步。
4. WP4：盤點並補齊可執行預覽所需共用後端、路由註冊、DB/model/migration、前端套件與權限提供者；先打通上傳→狀態查詢，再擴至全部相容 kit。禁止以模擬資料冒充完成。不得接正式資料或外部訂閱服務。
5. WP5：預覽後端驗證 Recipe，產生有效能力集合；前端頁面與後端 API 共用該選配結果，並保留角色授權。每次選配切換清除失效頁面／資料；背景工作與 webhook 亦需檢查。
6. WP6：啟動、健康檢查、真實 CRUD、直接 API 拒絕、依賴帶入、切換選配、資料重置與獨立選配建置驗收；記錄實測，才可替換「模擬資料」標籤。

本輪交付 WP1–WP3 的首個可驗證增量，WP2 全套模板與 WP4–WP6 保持未完成。無新增依賴，UI 遵循 DESIGN.md；不更改既有使用者業務 AoV 格式或其資料。

## 2026-10-18 WP2：九份模板完成，交 Claude 審閱

- 本輪僅新增下列九份 `workflow.aov.json`、追加 `apps/composer-gui/src/kitWorkflows.test.tsx` 測試並更新本 thread／mailbox index。cwd 為專案根目錄，已讀取 CLAUDE.md、DESIGN.md、本 thread 全文，唯讀確認分支為 `feature/kit-workflows`，開始時工作區無修改。
- 九份皆為 `draft`，`kitVersion` 皆依 catalog 的 manifest／overlay 解析結果為 `c4b2b7b-ui.1`；所有填入的 `subfeatureId` 均為該 Kit 現有項目。共用能力不硬綁單一子功能，已在 scope 說明；所有節點均至少引用一項該 Kit registry 的 `verified: true` 能力。
- 本輪涵蓋九份 registry 的所有已驗證能力；未驗證能力不建立節點並逐項列在 scope。既有 registry 已揭露的跨 Kit 實作歸屬與來源限制原樣保留，沒有發現需要修改 registry／來源才能完成本工作包的新不一致；未修改 schema、config、libs、其他 Kit 檔案或測試原意，未新增依賴、網路請求、dev server 或 Git 寫入。
- 連線只描述來源支持的前置資料／識別碼順序，沒有跨 Kit 邊。以下逐檔記錄所有邊的依據；沒有邊的檔案也說明原因。未將資料模型或共享查詢函式誤當必須依序執行的步驟。

### 逐檔來源與連線依據

1. `kits/generic-forms-kit/workflow.aov.json`（9 節點、3 邊）
   - 路由來源：`kits/generic-forms-kit/src/backend/app/api/routes_generic_forms.py` 的 `list_forms`、`list_records`、`create_form`、`set_schema`、`import_preview`、`import_commit`、`list_dataflow_links`、`upsert_dataflow_link`；模型來源：`kits/generic-forms-kit/src/backend/app/models/station.py` 的 `Station`、`StationSchema`、`StationLink`。
   - `create-form → set-schema`：上述 routes 檔的 `create_form` 建立並回傳站點，`set_schema` 以同一 code 呼叫 `_get_station`，站點不存在即 404；此邊限新建表單路徑，非要求既有表單重建。
   - `set-schema → preview-import`、`set-schema → commit-import`：同一 routes 檔的 `set_schema` 保存 active schema；`import_preview`／`import_commit` 透過 `_active_schema` 取得它，缺少時明確回報先使用 PUT schema。兩條邊分別有這項前置檢查支持。
   - 不建立 preview → commit：提交重新讀取檔案，並未使用預覽 token 或呼叫預覽端點。未登錄的直接上傳、刪除與非同步狀態端點列為未涵蓋。
2. `kits/station-data-link-kit/workflow.aov.json`（4 節點、0 邊）
   - 依 `config/registry/station-data-link-kit.json` 的 implementedBy，實作來源為 `kits/platform-core-kit/src/backend/app/core/db_capabilities.py`：`resolve_table`、`list_forms`、`search_records`、`records_trend` 及 `DB_CAPABILITIES` 映射。這是已登錄的實作歸屬，不新增跨 Kit 邊。
   - 四個獨立函式沒有彼此呼叫順序，因此 edges 為空；Kit 自身缺來源的 routes_import、相容層、正規化等，以及另屬 generic-forms 的串聯均於 scope 排除。
3. `kits/import-pipeline-kit/workflow.aov.json`（6 節點、2 邊）
   - 來源：`kits/import-pipeline-kit/src/backend/app/api/routes_import_v2.py` 的 `create_import_job`、`create_import_job_from_upload_job`、`get_import_job`、`get_import_job_errors`、`commit_import_job`、`cancel_import_job`；持久化來源為 `kits/import-pipeline-kit/src/backend/app/services/import_v2.py` 的 `ImportService.commit_job`。
   - `create-job → get-job`：routes 檔的 `create_import_job` 保存工作並回傳 `ImportJobRead`，`get_import_job` 以其 job_id 加租戶條件查詢；不存在回報 404。
   - `create-from-upload → get-job`：同一 routes 檔的 `create_import_job_from_upload_job` 亦保存工作並回傳 `ImportJobRead`，供相同 `get_import_job` 查詢。兩入口是替代路徑，不代表合流等待。
   - 提交節點合併 `import.job.commit` 與 `db.import.jobs`：`commit_import_job` 直接或經 `process_commit_job_background` 呼叫 `ImportService.commit_job`。保留 READY／COMMITTING 前置狀態說明，未臆造建立後即可提交、必須先讀錯誤或先查狀態的邊；背景暫存驗證沒有獨立登錄能力，不建節點。
4. `kits/analytics-kit/workflow.aov.json`（3 節點、0 邊）
   - 來源：`kits/analytics-kit/src/backend/app/api/routes_analytics.py` 的 `trend`、`upload_history`、`export_upload_history`。
   - 三端點分別查詢 DB 能力；匯出沒有呼叫清單端點，不以操作習慣推導邊。scope 保留 registry 已記錄的舊 status 與 ImportJob 狀態差異，未宣稱已修復；資料摘要未有獨立已驗證能力，排除。
5. `kits/audit-edit-kit/workflow.aov.json`（7 節點、0 邊）
   - 來源：`kits/audit-edit-kit/src/backend/app/api/routes_edit.py` 的 `list_reasons`、`create_reason`、`update_reason`、`edit_record`；`kits/audit-edit-kit/src/backend/app/api/routes_audit_events.py` 的 `list_audit_events`；`kits/audit-edit-kit/src/backend/app/services/audit_events.py` 的 `write_audit_event_best_effort`；外部實作依 registry 指向 `kits/platform-core-kit/src/backend/app/core/db_capabilities.py` 的 `validate_edit_reason`。
   - 不建立編輯 → 稽核事件邊：`edit_record` 寫入的是 RowEdit，未呼叫 AuditEvent 寫入服務；其原因檢查是本地 `_active_reason`，也不假接到 broker 的驗證能力。稽核寫入失敗被吞下的限制保留。未涵蓋獨立前後差異檢視與跨 Kit 稽核呼叫。
6. `kits/mod-subscription-kit/workflow.aov.json`（4 節點、0 邊）
   - 來源：`kits/mod-subscription-kit/src/backend/app/api/routes_mod_subscription.py` 的 `sync_mod_subscription`、`receive_mod_webhook`、`get_subscription`、`get_subscription_entitlements`；`kits/mod-subscription-kit/src/backend/app/services/mod_subscription.py` 的 `sync_subscription`、`process_webhook`、`get_entitlements`。
   - sync／webhook 節點各含服務所做的 `db.subscriptions` 持久化；Webhook 要求已有訂閱，但同步不會自動觸發 Webhook，查詢也不要求當次先同步，因此不強加端點順序。`subscriptions.manage` 為 verified:false 且無對應來源，scope 明列未涵蓋；不建立稽核查詢節點。
7. `kits/logs-ops-kit/workflow.aov.json`（1 節點、0 邊）
   - 來源：`kits/logs-ops-kit/src/backend/app/api/routes_logs.py` 的 `list_logs`，含租戶條件、篩選與分頁。只有 `logs.list` 已登錄並驗證，單節點不連線。雖來源有 `log_summary`，registry 未登錄，故不建節點；清理、下載、心跳也排除。
8. `kits/platform-core-kit/workflow.aov.json`（9 節點、0 邊）
   - 資料能力來源：`kits/platform-core-kit/src/backend/app/core/db_capabilities.py` 的 `list_forms`、`resolve_table`、`search_records`、`records_trend`、`validate_edit_reason`、`list_upload_jobs`；契約來源：`kits/platform-core-kit/src/backend/app/api/routes_kit_broker.py` 的 `get_contracts`；權限來源：`kits/platform-core-kit/src/backend/app/api/routes_admin_permissions.py` 的 `get_endpoint_permissions`、`put_endpoint_permissions`。
   - 各獨立能力沒有強制互相呼叫；PUT 自行驗證與寫入，無必須先 GET 的邊。scope 排除 verified:false／無路由的 `platform.health`，以及未登錄的外殼、建立資料庫連線與通用能力呼叫端點。
9. `kits/query-traceability-kit/workflow.aov.json`（2 節點、0 邊）
   - 來源：`kits/query-traceability-kit/src/backend/app/api/routes_query_v2.py` 的 `search_lot`、`trace_lot` 與共同 helper `_records_by_station_for_lot`。
   - 兩路由各自呼叫 helper，追溯不依賴查詢路由的回傳，因此無邊；trace 回傳的站點圖不轉成此 workflow 的邊。scope 排除 verified:false／無對應來源的 `query.records.search`、產品識別碼查詢、進階篩選及動態欄位查詢。

### 本輪測試與驗證結果

- `apps/composer-gui/src/kitWorkflows.test.tsx` 追加 10 項測試：九份模板逐一經 `parseKitWorkflow` 驗證版本／schema／子功能／能力引用、draft、非空能力引用及每項 capability 的 verified:true，並檢查未驗證能力出現在 scope；另測完整 catalog 的 missing 清單恰為缺少 workflow 檔案的 Kit，且無 invalid、九份新模板均為 draft。原有 13 項測試內容未修改。
- `npm.cmd run typecheck`：exit 0，通過。
- `npm.cmd test`：exit 1，32 個檔案為 31 passed／1 failed；324 tests 為 322 passed／1 failed／1 skipped。新增 10 項均通過。
- 失敗位於既有 `src/security.test.mjs` 的 CLI 簽署測試：讀取 `C:\Users\gslab\AppData\Local\Temp\composer-security-7ypFUo\keys\signing-private-key.pem` 遭 EPERM；afterAll 清理 `C:\Users\gslab\AppData\Local\Temp\composer-security-7ypFUo` 也遭 EPERM，導致 suite failure。未更改測試或私鑰規則來繞過；未手動讀取私鑰，暫存目錄未宣稱已清除，交 Claude 在具權限環境處理與重跑。
- 1 skipped 是既有 `App.test.tsx`「未涵蓋：以 User 身分修改 MIS 項目由授權邊界拒絕（尚無身分機制）」；本輪未新增 skip。
- `npm.cmd run build`：exit 0，內含 typecheck 與 Vite build 均通過。警告：既有 React Flow 模組的 `use client` 被忽略、App bundle 722.33 kB 超過 500 kB 提示；未為此修改打包設定。
- `git diff --check`：通過；Git 提示 LF／CRLF 轉換與全域 ignore 讀取權限限制，未執行 Git 寫入。
- 最後以唯讀 Node assert 核對九份模板能力集合恰等於各 registry 的已驗證集合，並確認 registry functions 的來源檔與符號文字存在：通過。共 45 節點、5 邊；完整 catalog 僅 `station-admin-kit`、`entry-permission-kit` 無 workflow，屬本輪指定九 Kit 之外。最終工作區修改限九份新 JSON、追加測試與兩份 mailbox 檔案。
- 未執行 Python Kit、資料庫、真實 API、身分授權、外部訂閱／Webhook、瀏覽器、dev server 或部署驗證。這些不屬 WP2，不能用 registry verified 或本輪前端測試替代。
- WP2 九份模板、測試、三項指定驗證與紀錄已完成；完整測試仍有上述環境失敗。保持 `status: in_progress`、設 `owner: claude`，請 Claude 審閱模板範圍、無邊的理由與共用能力的子功能歸屬，並重跑安全測試。WP4–WP6 仍暫停，未啟動真實預覽。

# Claude Notes

## 2026-10-18 審閱（首個增量 WP1–WP3）

- 審閱範圍：`schemas/kit-workflow.schema.json`、`kitWorkflows.ts`、`KitWorkflowSummary.tsx`、`deliveryPackage.ts`、`OutputPage.tsx`、`libs/ui-runtime/schema.ts`、`schemas/package-manifest.schema.json`、`kits/upload-validation-kit/workflow.aov.json` 及對應測試。
- 確認 Codex 最後寫入為 2026-10-16 19:01，審閱時 20 分鐘內無任何程式檔被寫入，可安全提交。
- 我重跑：typecheck 通過；`npm.cmd test` 32 個檔案、313 通過、1 略過（既有身分授權）；build 通過。與 Codex 紀錄一致。
- 契約變更範圍：package-manifest 的 artifacts 上限 8 改 10，新增 role `kit-workflow`。最大組合（readme、recipe、workflow、2 份總表、報告、3 份手冊、場域設定）恰為 10，已由測試 `toHaveLength(10)` 涵蓋。這是經使用者授權（thread Decisions 第 1 項）的契約放寬，決議補記為 D100。

# Review Findings

| 編號 | 嚴重度 | 內容 | 處理 |
|---|---|---|---|
| R01 | 中 | 動到 `schemas/` 與 `libs/ui-runtime/` 卻沒有決議編號，違反決策記錄要求 | Claude 已補 D100 |
| R02 | 低 | 上限 10 已無餘裕，下一種新 artifact 會再放寬 | 記為風險；之後新增 role 時改為依 role 分別設上限，不再累加總數 |
| R03 | 低 | upload-validation 的流程只有 2 個節點、狀態 draft，其他 kit 皆為 missing；交付包報告因此恆為 not-provided | 屬預期。WP2 其餘模板補齊後才會改變 |
| R04 | 資訊 | 嚴格依舊 schema 解析新交付包的外部消費端需同步升級 | 本專案內無此消費端；已在 D100 註明 |

結論：WP1–WP3 首個增量通過審閱，無阻擋項目。

## 後續分工（2026-10-18）

**WP2 其餘 kit 流程模板：交 Codex，預計完成 2026-10-18 18:00（約 18 小時，含額度風險緩衝）。** 規則：只為 registry 中 `verified: true` 的能力建立節點；來源找不到的功能不建節點、在 scope 寫明；每份標 draft；不臆造跨 kit 連線；逐份在 Codex Notes 記錄來源路徑。目標 kit：generic-forms-kit、station-data-link-kit、import-pipeline-kit、analytics-kit、audit-edit-kit、mod-subscription-kit、logs-ops-kit、platform-core-kit、query-traceability-kit。到期未完成由 Claude 接手。

**WP4 至 WP6（真實預覽）：暫停，需 user 決定下列事項後才能派工。**
1. 範圍：全部相容 kit，或先只做 upload-validation-kit 的上傳到狀態查詢？（建議後者）
2. 共用後端來源缺口（`app.core`、`app.config.constants`、`csv_field_mapper` 等，記於 `kits/BASELINE.md`）要從基線版複製補齊嗎？這會動 `kits/`，需決議。
3. 預覽用資料庫：使用哪一種（本機 SQLite 或另起 PostgreSQL）？
4. 本機啟動後端與開埠由 Claude 執行（Codex 沙箱不能監聽連接埠），驗證時間需排入 Claude 的工作。

# Test Plan

- Schema／版本、重複節點、懸空邊、循環、無效子功能與 capability 引用。
- 未選 kit 排除、子功能關閉不補接邊、同名節點不同 kit 不衝突、缺檔及錯檔不宣稱有效。
- 畫面表格、交付包內容與 checksum、重複輸出確定性、原有輸出回歸。
- typecheck、目標 Vitest、build；真實預覽整合測試留至 WP4–WP6。

# Decisions

- 使用者 2026-10-16 明確授權寫入根目錄 mailbox 並開始修改；沿用此現有 mailbox，不新增另一個目錄。
- 總表先定義為按 kit 分組的節點／連線清單；不推測跨 kit 的業務先後關係。
- Kit AoV 是描述文件，不執行任意腳本，也不代替 workflow 引擎。
- 不修改唯讀基線來源；本地 kit 可新增描述檔，來源範例保留 draft，來源登錄 verified 不等於執行驗證。

# Session Summary

## 首個增量實作結果

- WP1 完成：新增嚴格 JSON schema 與語意驗證（Kit／版本、節點重複、子功能／capability 引用、懸空邊、循環）。Kit 流程與既有業務 AoV 為不同文件，不修改舊格式。
- WP2 部分完成：新增 upload-validation-kit/workflow.aov.json，兩個節點與上傳→狀態查詢連線；明確 draft 且非全功能覆蓋。其餘 kit 未臆造流程，總表列 missing。
- WP3 完成首期表格：OutputPage 可展開檢視；交付包新增 aov/kit-workflows.json 與 aov/kit-workflows.md，納入 manifest/checksum。含缺漏／草稿時 validation report 的 kit-workflows 為 not-provided；不阻擋既有設定交付。
- 選配後移除未啟用子功能的節點及其連線，不補接鄰居。JSON 內各 kit 分組，節點 ID 不跨 kit 合併。缺漏／錯誤亦保留來源路徑與原因。
- package-manifest 新增 kit-workflow role、檔數上限由 8 改 10；舊交付包仍能讀取。嚴格依舊 schema 解析新交付包的外部消費端需同步升級。
- 未修改使用者原有工作區變更；未改基線目錄、未安裝依賴、未提交 Git、未觸發正式資料請求。
- WP4–WP6 未實作：目前預覽仍為模擬資料，尚未啟動任何真實 kit 系統。全量可執行預覽仍需補來源、權限、資料庫、前後端組裝及執行測試。本 thread 保持 in_progress，不標完成。

## 驗證紀錄

- npm.cmd run typecheck：通過。
- 目標 Vitest（kitWorkflows、deliveryPackage、output、schema、manualFiles）：40 tests 通過；其後補一項跨 kit 同名節點測試，結果追加於下。
- 補測後 kitWorkflows 共 13 tests 全數通過（相較前輪新增 1 項）；本增量累計 41 個不同測試通過。
- npm.cmd run build：通過；Vite 提示現有 React Flow use client 與大於 500 kB chunk 警告。
- 初次新增測試有 8 個斷言因「省略欄位」與「明確 undefined」差異失敗；已改成檢查 status 與缺少 workflow，重跑通過，未為迎合測試修改錯誤處理。
- 未執行全套測試、真實瀏覽器、Python Kit 啟動與部署測試；本次驗證只涵蓋此首期增量。

## 後續審閱重點

請 Claude 審閱流程契約、草稿／缺漏呈現、封裝相容性；確認 upload-validation 範例的流程範圍，再依 WP2 補其餘模板。WP4 開始前以 kits/BASELINE.md 的缺失清單核對實際來源，不能以現有 registry 的 verified 旗標替代啟動測試。

# Open Questions

- 後續「所有 kit」以有效 catalog 為準，排除已廢除 tenant-auth；缺少實作的 kit 必須補齊或明示不可啟動。
- 跨 kit 連線的實際資料綁定與每份流程內容需逐一核對來源；本輪不臆造。

## 2026-10-18 Claude 審閱 WP2

- 我獨立重跑：typecheck 通過；`npm.cmd test` 32 個檔案、323 通過、0 失敗、1 略過（既有身分授權）。Codex 回報的 1 項失敗（安全 CLI 沙箱 EPERM）在我的環境未重現，屬沙箱限制，非程式問題。
- 我以腳本逐份核對九份新模板加既有一份：所有節點引用的能力在 registry 皆為 `verified: true`，全部為 draft；共 45 個新節點、5 條邊（generic-forms 3、import-pipeline 2），其餘 kit 無邊，無跨 kit 連線。
- 邊的依據逐檔記於上方 Codex Notes；內容屬前置識別碼順序，與審閱時抽查一致。邊的語意正確性只靠靜態來源判讀，未經執行驗證，模板維持 draft。
- 結論：WP2 通過。WP4 至 WP6 仍待 user 決定範圍、共用來源補齊、預覽資料庫（見上方後續分工）。

## 2026-10-19 真實預覽 WP4 第一批派工（Claude）

依 D104、D105 與 `docs/preview-todo.md`。範圍為全部相容 Kit；執行環境固定 Docker 加 PostgreSQL（Windows 與 Linux 皆可）。**Codex 只寫程式與設定；容器啟動、真實 API、資料寫入與重置的實測由 Claude 執行。**

### WP4a 預覽後端組裝與容器設定（Codex）

**預計完成時間：2026-10-19 18:00。** 到期未完成由 Claude 接手。目錄：`services/preview/`（新增）。參考檔在 `services/preview/reference/`（唯讀）。

1. **組裝器：** 把 `kits/*/src/backend` 合併成單一 `app` 套件樹（各 Kit 的 `app/` 會重疊，不得靠命名空間套件碰運氣）。排除 `tenant-auth-kit`、無原始碼的 Kit（`station-admin-kit`、`station-data-link-kit`，見 todo T2、T3）與只有契約的 Kit。組裝器為確定性的：同輸入同輸出，並列出實際納入與排除的 Kit 及原因。可用 Node（`scripts/`，`.mjs`，須通過既有 typecheck）或 Python 實作，擇一並說明。
2. **入口 `app.main`（預覽專用，不複製基線的 `baseline-main.py`）：** 註冊所有已納入 Kit 的路由；自行提供 `GET /healthz`（todo T5）；啟動時以模型建立資料表（todo T8）；提供只在預覽啟用的「重置資料」入口或指令，重置後資料表回到空狀態。路由註冊依 `reference/backend_router_registry.py` 的對應，但以 `kits/` 實際存在的檔案為準。
3. **import-pipeline-kit 的 P1／P2／P3 分支（todo T1）：** 在 user 決定前，這些分支回傳明確的「不支援」錯誤（HTTP 501 與可讀訊息），不得崩潰。不修改基線複製的 `import_v2.py`；用組裝器層的方式處理（例如在組裝階段提供會拋出明確錯誤的替代模組，並在 Codex Notes 說明作法與理由）。
4. **容器：** `services/preview/docker-compose.yml`（`postgres` 加後端兩個服務）、`services/preview/Dockerfile`（Python 版本固定，依賴以固定版本安裝；可參考 `reference/requirements.baseline.txt`，並說明與基線的差異）。PostgreSQL 與後端只綁 `127.0.0.1`，帳密只用本機測試用的固定假值並放在 compose 設定中，不得出現真實連線字串；使用具名 volume，重置指令要能清空。Windows 與 Linux 皆須可用：不得依賴 Windows 路徑或 PowerShell 專用語法，啟動只透過 `docker compose`。
5. **啟停腳本：** `services/preview/preview.mjs`（Node，跨平台）提供 `up`、`down`、`reset`、`status`；失敗時輸出可讀原因。
6. **測試：** 組裝器的單元測試（納入與排除、確定性、缺來源時明確列出）；組裝後的樹以 Python `compileall` 風格的靜態檢查驗證沒有 `app.*` 匯入缺口（可重用 `docs/preview-todo.md` 所述的掃描邏輯，寫成測試）；不得需要 Docker 或網路。
7. **文件：** `services/preview/README.md`（繁體中文）：如何啟動、停止、重置；哪些 Kit 納入與排除及原因；已知限制。不得宣稱真實預覽已驗證。

### 限制與停止條件

- 不修改 `kits/` 內任何既有檔案（含基線複製檔）、`schemas/`、`config/`、`libs/ui-runtime/`、`package*.json`；不新增 npm 依賴；Python 依賴只寫進預覽的 requirements 與 Dockerfile。
- 不連網、不執行 Docker、不啟動伺服器、不執行 git 寫入。
- 範例資料、密碼、連線字串不得使用任何真實或來源案例內容。
- 只有必須改 `kits/` 既有檔案、新增 npm 依賴或需要真實資料時才停止並寫明；其餘衝突以既有檔案為準，調整自己的實作並記錄。
- 驗證指令：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`；完成後在 Codex Notes 記錄做了什麼、變更檔案、結果（含失敗與略過；security.test.mjs 的 EPERM 要如實回報）；thread status 維持 in_progress、owner 改 claude。

### 之後（不在本批）

WP4b（Claude）：以 Docker 實際啟動、驗證每個納入 Kit 的真實 API 與資料寫入。WP5：預覽後端驗證 Recipe、依有效選配開放功能並拒絕直接呼叫。WP6：重置、切換選配、獨立選配建置驗收。完成前畫面維持「模擬資料」標籤。

## 2026-10-19 Claude 審閱 WP4a 與 WP4b 實測

- Codex 任務 task-mvf5tahb-d03y18 為 completed（9 分 3 秒）。我獨立驗證，不採信自述。
- 靜態：typecheck 通過；`npm.cmd test` 38 個檔案、454 通過、0 失敗、1 略過；build 通過；預覽的 `node --test` 5 項與 Python 靜態測試 2 項通過（這兩組不在 `npm test` 內，已寫入 README）。`git diff` 確認未改 `kits/`、`schemas/`、`config/`、`libs/`、`package*.json`。
- Docker 實測（WP4b，Claude 執行）：映像建置成功（靜態檢查 72 個 Python 模組、匯入無缺口），兩個容器 healthy，`/healthz` 正常，資料表由模型建立，`PREVIEW_READY` 出現。煙霧測試 17 項：15 通過、2 項已知缺口（T9、T10）、0 項未預期失敗；包含真實寫入與讀回。重置前 stations 3 筆，重置後 0 筆，仍 healthy。
- 實測發現 WP4a 三個問題，已由我修正並寫入 D106：F1 Windows 保留埠段使 PostgreSQL 埠無法綁定；F2 `internal: true` 使發布埠無效（容器 healthy 但宿主連不上）；F3 管理員與角色限定端點永遠 403（缺身分替身）。詳見 `docs/preview-todo.md` §4。
- 新增缺口 T9（table_registry 無來源資料，匯入管線無法建立工作）、T10（日誌摘要因 asyncpg 日期字串回 500）、T11（只驗證可呼叫，未驗證商業語意）。

### Review Findings（WP4a）

| 編號 | 嚴重度 | 內容 | 處理 |
|---|---|---|---|
| R01 | 高 | `internal: true` 使容器發布埠完全無效，宿主連不上；靜態測試甚至把它當成必要條件 | 已修（D106），測試改為斷言資料網路內部、只發布後端一個埠 |
| R02 | 高 | 預覽入口缺身分替身，所有管理員端點 403，連帶無法設定欄位與註冊資料表，整條表單流程斷掉 | 已修（D106）；仍標明不是驗證機制 |
| R03 | 中 | 固定埠 55432 在 Windows 會落在保留埠段而無法綁定 | 已修：預設 18000 並可覆寫；PostgreSQL 不再發布 |
| R04 | 低 | Codex 的測試只驗證設定字串與靜態規則，沒有任何一項能發現 R01、R02；這類問題只有實際啟動才看得出來 | 新增 `smoke.mjs` 對真實 API 驗證，實測納入驗收 |
| R05 | 低 | 預覽的測試不在 `npm test` 內 | 先寫入 README；是否納入 npm script 需改 `package.json`，另行決定 |

結論：WP4a 的程式經修正後通過；WP4b 部分完成（啟動、真實寫入、重置已驗證；T9、T10 缺口待決）。WP5（依有效選配開放功能並拒絕直接呼叫）與 WP6（切換選配、獨立選配建置驗收）尚未開始。畫面上的「模擬資料」標籤維持不變。

## 2026-10-20 WP4c 派工：T1 通用模型與 T9 種子（Claude）

user 決定（D107）：T1 為 `import-pipeline-kit` 的 P1／P2／P3 分支建立通用紀錄模型；T9 補 `table_registry` 種子；T10 已由 Claude 完成（組裝補丁，煙霧測試 16/17）。

**預計完成時間：2026-10-20 18:00。** 到期未完成由 Claude 接手。分支 `feature/preview-gaps`。Codex 只寫程式，容器實測由 Claude 執行。

### T9 預覽種子（先做）

1. 目標：讓 `POST /api/v2/import/jobs` 對一張合成的「通用表」能建立工作、查詢、查錯誤、提交，資料真的寫進資料庫並能讀回。基線的 `import_v2.py` 有 `schema_driven` 路徑會把資料列寫進通用紀錄（`generic_records`）；該路徑要求 `table_registry` 有資料列，且有對應 `schema_versions`（含 `header_fingerprint` 與 `schema_json`）。請讀 `kits/import-pipeline-kit/src/backend/app/services/import_v2.py`、`kits/platform-core-kit/src/backend/app/services/csv_field_mapper.py`、`models/core/schema_registry.py`、`models/generic_record.py`，確認需要哪些資料列與 fingerprint 計算方式。
2. 種子放在 `services/preview/app/preview_seed.py`（擴充現有命令，或新增 `--tables` 選項，可重複執行、冪等）：建立一張合成通用表（名稱與欄位自訂，例如 `demo-lots`，欄位用通用名稱，不得出現任何來源案例的名稱、欄位語意或數值）及其 schema 版本。
3. 更新 `services/preview/smoke.mjs`：把「建立匯入工作並查詢」由 GAP 改為真實流程（建立、查詢、查錯誤、提交、讀回資料列），並移除對應的 `knownGap`。

### T1 通用 P1／P2／P3 模型

1. 現況：`import_v2.py` 約 870 至 1100 行的 P1／P2／P3 分支延遲匯入 `app.models.p1_record`、`p2_record`、`p2_item_v2`、`p3_record`、`p3_item_v2`，這五個模組沒有來源，預覽目前以 `preview_support.reject_table_code` 回 501。
2. 做法：依程式**實際使用**的屬性、建構參數與查詢條件推導欄位（掃描 `import_v2.py`、`routes_import_v2.py`、其他 kit 對這些類別的引用），在預覽覆蓋層建立這五個模組，模組路徑與類別名稱必須與匯入語句完全一致，並被 `Base.metadata.create_all` 註冊。欄位用通用型別與名稱，只含程式實際用到的欄位，每個欄位在 Codex Notes 列出依據的程式位置；程式沒用到的不要自創。
3. 移除預覽對 P1／P2／P3 的 501 阻擋（`preview_support` 與 `assemble.mjs` 的對應補丁），但不得放寬其他安全檢查；`table_registry` 需有 `P1`、`P2`、`P3` 三列種子（同上，冪等）。
4. 更新煙霧測試：P1／P2／P3 各以合成的最小 CSV 走建立工作與提交，驗證不再是 501；內容為通用合成資料。
5. 若推導出的欄位只靠猜測才能完成（程式沒有足夠資訊），停止並在 Codex Notes 寫明哪些欄位缺依據，不得自創。

### 限制與停止條件

- 不修改 `kits/` 既有檔案（含基線複製檔）、`schemas/`、`config/`、`libs/`、`package*.json`；不新增 npm 依賴；Python 依賴不變（需要新增時停止並寫明）。
- 不連網、不執行 Docker、不啟動伺服器、不執行 git 寫入。
- 合成資料不得含來源案例的任何真實名稱、欄位語意或數值。
- 驗證指令：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`，以及 `node --test services/preview/tests/preview.test.mjs`、`python -I services/preview/tests/test_static.py`；結果（含失敗與略過）如實記錄於 Codex Notes；thread status 維持 in_progress、owner 改 claude。

## 2026-10-20 Claude 審閱 WP4c（T1、T9）

- Codex 任務 task-mvg9c0k6-79ex4q 為 completed（7 分 6 秒）；以下為我獨立驗證。
- 靜態：typecheck 通過；`npm.cmd test` 38 個檔案、454 通過、0 失敗、1 略過（Codex 回報的 EPERM 失敗在我的環境未重現）；預覽 `node --test` 7/7、Python 靜態測試 4 項通過；`git diff` 確認未改 `kits/`、`schemas/`、`config/`、`libs/`、`package*.json`；專有詞彙搜尋命中為零。
- Docker 實測：重建映像後執行種子兩次、煙霧測試三次，20/20 通過；P1／P2／P3 與通用表的匯入皆 COMPLETED 並寫入資料庫，重匯不重複。詳見 `docs/preview-todo.md` 的「T1、T9 完成紀錄」。

### Review Findings（WP4c）

| 編號 | 嚴重度 | 內容 | 處理 |
|---|---|---|---|
| R01 | 中 | 煙霧測試的通用表讀回原本走 `/api/forms/{code}/records`，但種子把同一代碼同時登錄為 station 與 table_registry，基線視為領域表而查不到資料，造成 1 項失敗 | 已修：讀回改走 query-traceability；缺口記為 T12 |
| R02 | 中 | 五個 P 系列模型欄位帶有特定製程語意（見 todo 的重要說明） | 欄位皆有基線程式行號為據、無自創；需 user 知悉，對外文件需另行去識別化說明 |
| R03 | 低 | `preview.mjs reset` 的重啟不含 `--build`，程式變更後只執行 reset 會沿用舊映像（本輪即因此看到舊的 501 訊息） | 記錄；程式變更後請用 `up` 重建，README 已有說明 |
| R04 | 低 | `analytics/trend` 對領域表代碼回 500（T12） | 已登錄為低度缺口 |

結論：T1、T9 通過；預覽缺口剩 T2、T3（無來源）、T4（訂閱端點）、T6（身分）、T11、T12。WP5、WP6 尚未開始。
