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
| T1 | `import-pipeline-kit` 的 `app.models.p1_record`、`p2_record`、`p2_item_v2`、`p3_record`、`p3_item_v2` 不存在 | 只在 `import_v2.py` 約 870 至 1040 行的分支內延遲匯入；基線版任何 `.py` 都沒有這些模組，只出現在組裝計畫 JSON | 由 user 決定：（a）為這些分支建立通用的紀錄模型，或（b）預覽時關閉這些分支並在畫面標示不可用。兩者都要有測試 | 在決定前，這些分支回傳明確的「不支援」錯誤，不得崩潰或假裝成功 |
| T2 | `station-admin-kit` 的 `routes_stations.py` 不存在 | 契約宣告 `/api/stations`，基線版任何位置都沒有來源（D89） | 取得來源或明確標示該 Kit 不可啟動 | 預覽排除，列為「無來源」 |
| T3 | `station-data-link-kit` 的 `routes_import.py` 不存在 | 不在組裝輸出（D68、D90） | 同 T2 | 預覽排除，列為「無來源」 |
| T4 | `mod-subscription-kit` 契約端點 `/api/mod-subscription` 無對應實作 | D94：實際為 `/api/mod` 下的同步、webhook、查詢、權益 | 預覽只啟用 verified 的端點；訂閱相關外部服務一律使用本機假服務，不連外 | 外部訂閱服務不連線 |
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
| T9 | `import-pipeline-kit` 建立匯入工作需要 `table_registry` 有資料列，但沒有任何程式或來源會建立；通用表單存在 `stations`，兩者是不同登錄 | 資料庫 `table_registry` 為空；建立匯入工作回 400 `Invalid table code` | 煙霧測試列為 GAP。需決定：補一份通用的 table_registry 種子與對應資料表，或預覽標示匯入管線不可用 |
| T10 | `logs-ops-kit` 的 `/api/logs/summary` 回 500：程式把 ISO 日期字串傳給 asyncpg 的 timestamp 參數 | 容器日誌 `expected a datetime.date or datetime.datetime instance, got 'str'`，位於 `routes_logs.py` 的 `log_summary`（`list` 端點回 200） | 煙霧測試列為 GAP。基線複製檔不修改；可在組裝階段以補丁修正，需 user 同意 |
| T11 | 煙霧測試只驗證端點可呼叫與資料寫入，未驗證各 Kit 的商業語意（例如上傳的驗證規則需要環境設定的合法值，測試檔 2 列皆被判為無效） | 上傳回應 `valid_rows 0, invalid_rows 2` | 屬預期，不視為失敗；語意驗證另案 |
