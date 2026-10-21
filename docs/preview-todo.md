# 真實預覽：來源缺口與待完成清單

日期：2026-10-19（D104、D105）
範圍：全部相容 Kit（排除已廢除的 `tenant-auth-kit`，D03）。能從基線版複製的已複製；複製不了的列在這裡，每項都必須在預覽驗收前完成或明確標示不可啟動，不可靜默略過。

## 1. 已從基線版複製（2026-10-19）

來源：`form-system-kit-composer/dist/generated-system/backend/app`（組裝輸出，唯讀），逐檔原樣複製進 `kits/platform-core-kit/src/backend/app/`，作為共用基底。共 15 個檔案：

| 類別 | 檔案 |
|---|---|
| 共用核心 | `core/config.py`、`core/database.py`、`core/logging.py`、`core/tenant_resolver.py`、`api/deps.py`、`config/constants.py` |
| 共用模型 | `models/generic_record.py`、`models/core/tenant.py`、`models/core/schema_registry.py`、`schemas/audit.py` |
| 共用服務 | `services/csv_field_mapper.py`、`utils/normalization.py` |
| 套件標記 | `config/__init__.py`、`models/__init__.py`、`schemas/__init__.py` |

複製後以掃描腳本重新檢查所有 `app.*` 匯入：除下表第 1 項外，其餘都找得到來源。

## 2. 複製不了，必須完成（TODO）

| 編號 | 缺口 | 證據 | 完成條件 | 預設處理 |
|---|---|---|---|---|
| T1（已完成 2026-10-20，D107） | `import-pipeline-kit` 的 `app.models.p1_record`、`p2_record`、`p2_item_v2`、`p3_record`、`p3_item_v2` 不存在 | 只在 `import_v2.py` 約 870 至 1040 行的分支內延遲匯入；基線版任何 `.py` 都沒有這些模組，只出現在組裝計畫 JSON | 由 user 決定：（a）為這些分支建立通用的紀錄模型，或（b）預覽時關閉這些分支並在畫面標示不可用。兩者都要有測試 | 在決定前，這些分支回傳明確的「不支援」錯誤，不得崩潰或假裝成功 |
| T2 | `station-admin-kit` 的 `routes_stations.py` 不存在 | 契約宣告 `/api/stations`，基線版任何位置都沒有來源（D89） | 取得來源或明確標示該 Kit 不可啟動 | 預覽排除，列為「無來源」 |
| T3 | `station-data-link-kit` 的 `routes_import.py` 不存在 | 不在組裝輸出（D68、D90） | 同 T2 | 預覽排除，列為「無來源」 |
| T4（已完成 2026-10-21，D121） | `mod-subscription-kit` 契約端點 `/api/mod-subscription` 無對應實作 | D94：實際為 `/api/mod` 下的同步、webhook、查詢、權益 | 預覽只啟用 verified 的端點；訂閱相關外部服務一律使用本機假服務，不連外 | 外部訂閱服務不連線 |
| T5 | `platform-core-kit` 的 `platform.health`（`GET /healthz`）沒有實作 | D93 | 預覽組裝器自行提供 `/healthz`（不修改基線複製檔），並在 registry 維持 `verified: false` | 組裝器提供 |
| T6 | `entry-permission-kit` 尚無身分驗證 | 專案安全基準：角色只是提示 | 預覽不宣稱授權有效；授權測試標為「未涵蓋」 | 維持現狀 |
| T7 | Python 依賴清單 | 基線版 `requirements.txt` 位於組裝輸出，尚未驗證在本機與 Linux 都可安裝 | 預覽映像以固定版本安裝並啟動成功 | 由 WP4 處理 |
| T8 | 資料表建立與重置 | `migrations/` 目前沒有基線資料表 | 預覽以模型建立資料表，並提供重置；不接任何正式資料 | 由 WP4 處理 |

## 3. 完成後的判定

- T1 至 T8 每項都有「已完成」或「明確標示為不可用」的結論與測試或實測紀錄，才可把「模擬資料」標籤換成「真實預覽」。
- 全量預覽成功與僅所選 Kit 的獨立部署驗證分開報告。

## 4. WP4b 實測結果與新增缺口（2026-10-19，Docker 加 PostgreSQL，Claude 實測）

實測環境：Windows 11、Docker 引擎 29.4.2（Linux 容器）、Compose v5.1.3；映像 `python:3.12.8-slim`、`postgres:16.6`。執行 `node services/preview/preview.mjs up` 後以 `node services/preview/smoke.mjs` 對容器內真實 API 發出請求並寫入資料。

| 結果 | 內容 |
|---|---|
| 啟動 | 靜態檢查 72 個 Python 模組、`app.*` 匯入無缺口；兩個容器 healthy；`/healthz` 回傳 ok；啟動訊息 `PREVIEW_READY` |
| 煙霧測試 | 17 項中 15 項通過、2 項已知缺口、0 項未預期失敗（見下表）；通過項包含真實寫入：建立表單、設定欄位、匯入 2 筆資料列並讀回、上傳檔案並查詢狀態、建立修正原因、訂閱同步（本機假服務） |
| 資料重置 | `preview.mjs reset` 前 stations 有 3 筆，重置後 0 筆，服務仍 healthy |
| 資料持久 | 容器重啟後資料表存在（具名 volume）；重置才清空 |

### 實測中修正的 WP4a 問題（由 Claude 修正並記錄）

| 編號 | 問題 | 修正 |
|---|---|---|
| F1 | Windows 保留部分埠段，原預設 PostgreSQL 埠 55432 無法綁定 | 後端預設埠改 18000，可用 `PREVIEW_API_PORT` 覆寫；PostgreSQL 不再發布到宿主 |
| F2 | `networks: internal: true` 使容器的發布埠完全無效：容器 healthy 但宿主連不上 | 拆成內部網路 `data`（只有 PostgreSQL 與後端）與 `edge`（僅供後端發布 127.0.0.1 埠）。`edge` 不阻擋對外連線，隔離靠固定假值與不含外部服務設定（README 已寫明，D105 已更正措辭） |
| F3 | 管理員與角色限定的端點（端點權限、稽核事件、修正原因）永遠回 403：預覽入口沒有基線的 API key 中介層，`request.state.is_admin` 不會被設定，連帶無法設定欄位、無法註冊資料表 | 預覽入口新增預覽專用的身分替身：固定假金鑰 `X-Admin-API-Key` 與 `X-Preview-Role` 標頭。這不是驗證機制，T6 維持「未涵蓋」 |

### 新增缺口（必須完成或明確標示不可用）

| 編號 | 缺口 | 證據 | 目前處理 |
|---|---|---|---|
| T9（已完成 2026-10-20，D107） | `import-pipeline-kit` 建立匯入工作需要 `table_registry` 有資料列，但沒有任何程式或來源會建立；通用表單存在 `stations`，兩者是不同登錄 | 資料庫 `table_registry` 為空；建立匯入工作回 400 `Invalid table code` | 煙霧測試列為 GAP。需決定：補一份通用的 table_registry 種子與對應資料表，或預覽標示匯入管線不可用 |
| T10（已完成 2026-10-20，D107） | `logs-ops-kit` 的 `/api/logs/summary` 回 500：程式把 ISO 日期字串傳給 asyncpg 的 timestamp 參數 | 容器日誌 `expected a datetime.date or datetime.datetime instance, got 'str'`，位於 `routes_logs.py` 的 `log_summary`（`list` 端點回 200） | 煙霧測試列為 GAP。基線複製檔不修改；可在組裝階段以補丁修正，需 user 同意 |
| T11 | 煙霧測試只驗證端點可呼叫與資料寫入，未驗證各 Kit 的商業語意（例如上傳的驗證規則需要環境設定的合法值，測試檔 2 列皆被判為無效） | 上傳回應 `valid_rows 0, invalid_rows 2` | 屬預期，不視為失敗；語意驗證另案 |

### T10 完成紀錄（2026-10-20）

組裝階段補丁已套用（`assemble.mjs` 的 `adapt`，錨點不符即拒絕）。Docker 重新建置後實測：`/api/logs/summary` 回 200，`/api/logs/?since=&until=` 以 ISO 起訖時間過濾回 200；煙霧測試 16/17 通過、1 項已知缺口（T9）。單元測試涵蓋補丁內容、回應仍為 ISO 字串、來源漂移時拒絕。

### T1、T9 完成紀錄（2026-10-20，Claude 實測）

| 項目 | 結果 |
|---|---|
| T9 種子 | `preview_seed` 建立合成通用表 `preview_entries`（table_registry、schema_versions、station、station_schema 各一列）；連續執行兩次不重複 |
| T9 匯入流程 | 建立匯入工作時省略 `table_code`，由標題列雜湊（header fingerprint）解析到 `preview_entries`；工作 COMPLETED，資料真的寫入 `generic_records`；由另一個 Kit（query-traceability）的 `/api/v2/query/lot/...` 讀回 |
| T1 模型 | 五個模型（`p1_record`、`p2_record`、`p2_item_v2`、`p3_record`、`p3_item_v2`）建立並註冊；P1、P2、P3 各以合成最小 CSV 建立工作並提交：工作 COMPLETED、資料列各 1、錯誤 0；直接查資料庫確認 p1／p2／p3 與 p2／p3 明細表各有 1 筆 |
| 重匯 | 煙霧測試連續執行三次後各表筆數維持 1：重匯為更新或取代，沒有重複新增 |
| 煙霧測試 | 20/20 通過、0 項已知缺口、0 項未預期失敗 |
| 靜態測試 | `node --test` 7/7 通過；Python 靜態測試 4 項通過（Codex 的環境無法啟動 Python，我在自己的環境執行） |

**T1 的重要說明（需 user 知悉）：** 五個模型的欄位逐欄對照基線 `import_v2.py` 的實際行號推導（見 thread Codex Notes 的「逐欄依據」），沒有自創欄位。但這些欄位名稱帶有特定製程的語意（例如 `winder_number`、`slitting_result`、`thickness1` 至 `thickness7`、`machine_no`、`mold_no`），因為基線程式就是這樣讀寫它們；它們是為了讓基線程式能執行而必要的相容結構，不是「通用」資料表。預覽中只放合成資料，不含任何來源案例的真實值。若論文或對外文件要引用這些表，需要另行去識別化說明。

### T12（新增，低）

| 編號 | 缺口 | 說明 |
|---|---|---|
| T12 | 一個代碼若同時是 station 與 `table_registry` 項目，基線把它視為「以實體資料表儲存」的領域表：通用表單的 `/api/forms/{code}/records` 查不到資料，`/api/analytics/trend?code=` 回 500（找不到同名實體資料表） | 這是種子選用同一個代碼所致，符合基線語意，不是基線缺陷。影響範圍只有這張合成表的兩個端點；讀回改走 query-traceability。若要完整支援，需為合成表建立實體資料表，另案 |

## 5. Linux 主機實測（2026-10-20，Claude 實測）

環境：Ubuntu 22.04.5（核心 6.8.0）、Docker 29.1.3、使用者在 docker 群組；主機原本沒有 Node 與 Docker Compose 外掛。測試用的工具都裝在使用者目錄，不使用 sudo：Node v22.23.3（官方 tarball，SHA-256 與 `SHASUMS256.txt` 相符）、Docker Compose v5.6.0（GitHub release 的執行檔，SHA-256 相符，放在 `~/.docker/cli-plugins/`，**測試後保留**）。程式來源為 `main`（`git archive`，等同乾淨檢出，不含工作樹的未提交變更）。

| 項目 | 結果 |
|---|---|
| `node services/preview/preview.mjs up` | 映像建置成功，兩個容器 healthy，埠只綁 `127.0.0.1:18000` |
| 種子與煙霧測試 | 20/20 通過、0 項已知缺口、0 項未預期失敗（含真實寫入與 P1／P2／P3 匯入） |
| 靜態測試 | `node --test` 7/7 通過；`python3` 靜態測試 4 項通過（Python 3.10） |
| 重置 | `preview.mjs reset` 前 stations 2 筆、重置後 0 筆，服務仍 healthy |
| 清理 | 已 `down --volumes`、移除 `composer-preview-backend` 映像與測試目錄；主機無殘留容器與資料卷 |

觀察（不影響結果；2026-10-20 更正）：repo 內的檔案（blob）本來就是 LF；測試程式來源用 `git archive` 在 Windows 上產生，而此機器的 `core.autocrlf=true` 會讓封存內容轉成 CRLF，所以 Linux 主機拿到的是 CRLF 版本，Docker 仍可正常解析。原先寫成「repo 內以 CRLF 儲存」是錯的。Linux 實測未涵蓋：WP5 選配閘門（尚未完成）、長時間運行、非 root 以外的權限設定。

## 6. 選配閘門與獨立組裝（2026-10-20，WP5、WP6，Claude 接手完成）

詳見 `.codex-claude-mailbox/threads/20261016-kit-workflows-live-preview.md` 的「Claude 接手完成 WP5／WP6」。

| 結果 | 內容 |
|---|---|
| 全量預覽 | 煙霧測試 20/20 通過（含選配閘門存在時） |
| 選配閘門 | `smoke-gating.mjs` 12/12 通過：無效 Recipe 原子拒絕、未開放 Kit 與子功能回 403、通用轉發端點不能繞過、未知路由預設拒絕、切換即時生效且不刪資料、重啟後保持、預覽不可用 Kit（D109）列為 unavailable |
| 獨立組裝 | 5 個 Kit 的集合可獨立組裝、啟動並寫入資料；未納入的 Kit 回 403「未納入此映像」 |

新增缺口：

| 編號 | 缺口 | 說明 |
|---|---|---|
| T13 | `platform-core-kit` 的資料庫能力延遲匯入 audit-edit-kit 與 import-pipeline-kit 的模型 | 只選「核心加通用表單」無法獨立部署；組裝階段 fail-closed 報告。最小可獨立集合含 platform-core、generic-forms、audit-edit、import-pipeline、upload-validation。若要縮小集合，需以組裝補丁處理這些延遲匯入，另案決定 |

### 新 schema 重新驗證（2026-10-20）

畫布與參數設定工作合併後（Recipe schema 新增可選欄位 `productionSettings`，D111），以 `main` 重新建置映像並驗證閘門：映像內的 `recipe.schema.json` 含新欄位；全量煙霧測試 20/20 通過；選配閘門 13/13 通過（新增一項：含 `productionSettings` 的 Recipe 通過、版本錯誤與多餘欄位被拒）。

### T4 完成紀錄（2026-10-21）

`subscriptions.manage` 與 `query.records.search` 屬契約宣告但原始碼無實作（registry `verified: false`），先前閘門會放行再由應用回 404；現在閘門直接回 403 並說明原因。`platform.health` 由預覽 `/healthz` 提供，不受影響。實測（全量映像，Docker）：煙霧測試 20/20、選配閘門 13/13；`GET /api/mod-subscription` 與 `GET /api/v2/query/records` 皆 403；已驗證的 `subscriptions.sync` 仍經本機假服務回 200。靜態測試：Node 11 項、Python 14 項通過。
