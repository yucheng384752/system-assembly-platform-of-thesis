# WP4a 預覽後端組裝

此目錄提供全量相容 Kit 的預覽後端。**尚未完成 Docker、PostgreSQL、真實 API 與重置實測**；WP4b 由 Claude 執行。Composer 畫面（開發伺服器）會偵測此後端並在連線時對第一批三個畫面顯示「真實預覽」（D116 至 D119，經 Vite 代理 `/preview-api`）；其餘 Kit 與未連線時維持「模擬資料」。

## 啟動與停止

在專案根目錄執行，Windows 與 Linux 相同。需要 Node 22.12 以上，以及支援 `up --wait` 的 Docker Compose v2；Windows 使用 Linux containers。首次建置需由有網路權限的 Claude 下載映像及 Python 套件，執行中的預覽網路禁止連外。Codex 未執行以下 Docker 指令。

```text
node services/preview/preview.mjs up
node services/preview/preview.mjs status
node services/preview/preview.mjs down
```

所有操作都呼叫 `docker compose`，固定 project `composer-preview`，不讀宿主 `.env`、不掛載宿主原始碼，也不使用本機 Python 啟動服務。若只用 Compose，可直接執行：

```text
docker compose -p composer-preview -f services/preview/docker-compose.yml up --build -d --wait --wait-timeout 180
docker compose -p composer-preview -f services/preview/docker-compose.yml logs backend
```

預期建置會印出 `assembly-report.json` 內容，納入 10 個 Kit、排除 3 個 Kit；靜態檢查印出 `STATIC_OK: ... Python modules; syntax and app imports closed`。啟動日誌預期出現：

```text
PREVIEW_READY: tables created; no seed data; authentication not covered
```

`status` 應顯示 postgres 與 backend 都 healthy。後端位於 `http://127.0.0.1:18000`（可用環境變數 `PREVIEW_API_PORT` 改埠），`GET /healthz` 會查詢資料庫，成功回傳：

```json
{"status":"ok","preview":true,"authentication":"not-covered"}
```

PostgreSQL **不發布到宿主埠**，只在內部網路 `data` 中供後端連線（該網路為 `internal: true`，沒有對外路由）；資料庫與使用者均為 `preview`、密碼為 `preview-local-only`，皆為固定本機假值。需要檢視資料時用 `docker compose -p composer-preview -f services/preview/docker-compose.yml exec postgres psql -U preview -d preview`。後端另接網路 `edge` 以便宿主連線，**宿主發布的埠只綁 `127.0.0.1`**：預設 `18000`（`PREVIEW_API_PORT` 可改；Windows 會保留部分埠段，原預設 55432 與 58000 曾因落在保留段而無法綁定）。注意：`edge` 不是隔離網路，後端容器理論上可以對外連線；預覽的隔離靠固定假值與不含任何外部服務設定，而不是網路層封鎖。不開放 CDN 文件頁；可讀取 `/openapi.json`。不可將這組設定用於正式部署。

## 空資料庫與重置

啟動以所有組裝模型的 `Base.metadata.create_all` 建表；logs-ops 的 `system_logs` 另使用該 Kit 自帶的 PostgreSQL DDL。啟動不種租戶或業務資料，租戶 API 在空資料庫會回傳 404；健康檢查不需要租戶。

實測需要租戶時，明確執行下列預覽專用命令，建立固定合成租戶與表格種子，不產生來源案例資料：

```text
docker compose -p composer-preview -f services/preview/docker-compose.yml exec -T backend python -m app.preview_seed
```

預期輸出 `PREVIEW_TENANT: 00000000-0000-4000-8000-000000000001`；可重複執行。建立後可帶 `X-Tenant-Id` 同值，或利用唯一租戶解析測試一般 API。

D107：種子同時建立 `preview_entries` 的 TableRegistry、SchemaVersion、Station 與 StationSchema，欄位為 `entry_key`、`value`，讓匯入管線走 schema_driven 寫入 generic_records。重跑不新增版本；既有 schema 與種子不同時拒絕覆蓋並要求重置。P1/P2/P3 只建立 TableRegistry，不建立同名 Station，以便測到相容模型分支。

```text
node services/preview/preview.mjs reset
```

這是預覽限定的重置指令，先 `down --volumes` 停掉後端與背景工作，再重建兩個具名 volume 與容器，等待健康。**會刪除此 project 的全部預覽 DB、上傳檔、日誌與權限設定**，不影響其他 Compose project。失敗即停止，不繼續下一步。完成輸出「預覽 volume 已重建；資料表為空，未建立租戶或業務資料。」重置後不要立即執行 seed，先驗證所有資料表空白。一般 `down` 保留 volume。沒有另開可由網頁呼叫的破壞性重置 API。

## 組裝規則與納入清單

選 Node `.mjs`，使用內建 fs/path/crypto，無 npm 新依賴。可在沒有 Docker／Python 套件的環境執行。產出為實體單一 `app/` 套件，每層補 `__init__.py`。只接受**尚不存在的輸出目錄**，不刪除或覆寫既有目錄。以固定排序產出檔案與含 SHA-256 的報告，不含時間或宿主路徑；同輸入逐位元組相同。Python 換行正規化為 LF。衝突不依複製順序覆蓋；未列明的衝突直接失敗。

| Kit | 結果與路由 |
| --- | --- |
| platform-core-kit | 納入共用基底；broker `/api/kit`、權限設定 `/api/admin/endpoint-permissions` |
| generic-forms-kit | 納入 `/api/forms` 與 `/api/dataflows/links` |
| upload-validation-kit | 納入上傳與驗證，組裝前綴 `/api` |
| import-pipeline-kit | 納入 `/api/v2/import`，P1/P2/P3 使用基線真實模型（D125，容器實測通過） |
| query-traceability-kit | 納入 `/api/v2/query` |
| analytics-kit | 納入 `/api/analytics` |
| audit-edit-kit | 納入 `/api/edit` 與 `/api/audit/events` |
| logs-ops-kit | 納入 `/api/logs`，本機持久化日誌 |
| mod-subscription-kit | 納入實際 `/api/mod` 四個端點；同步只連容器內假服務 |
| tenant-auth-kit | 排除，D03 已廢除 |
| station-admin-kit | 排除，T2 缺少 routes_stations.py |
| station-data-link-kit | 納入 `/api` 的 P1/P2/P3 相容轉接器 `POST /api/import`（D125 自基線補齊 `routes_import.py` 與模型）。基線行為：重新讀取已存檔案並匯入驗證工作的全部列，不剔除驗證器標為無效的列 |
| entry-permission-kit | 排除，預覽以自己的閘門取代身分驗證（D127）；其四個路由檔已有註冊規則（前綴空字串、不解析租戶），由測試檢查所有 Kit 的路由檔都有規則，正式系統包才納入 |

以 reference 路由前綴為依據，實際共註冊 12 個現存 router；reference 沒列到的 generic-forms、mod-subscription、admin-permissions 依來源補列。reference 的 `routes_ut`、`traceability` 無來源，不虛構路由。自行提供 `/healthz`，不改 registry 的 `verified: false`。只複製納入 Kit 的契約到組裝根目錄供 broker 查詢；契約聲明不代表每個 capability 都能執行。backend 的管理 scripts 不作為 app 執行來源或容器入口。

以下差異全部只在組裝產物，`kits/` 與 `reference/` 唯讀：

- `core/monitoring.py` 明確採 logs-ops 版本，取代 platform-core 的 no-op，符合檔案自身說明；不啟動遠端 heartbeat。
- 重建 `models/__init__.py`，載入現有模型，排除基線匯出但不存在的 analytics_mapping、validation_rule。D125 起 `tenant_users`、`tenant_api_keys` 使用基線真實模型（自 `kits/platform-core-kit`），不再有預覽空表；只有資料表，沒有身分驗證實作，不製造使用者或金鑰，不宣稱授權有效。
- D107 的 P1/P2/P3 預覽相容模型已於 D125 移除，改用基線真實模型（`kits/station-data-link-kit`）；D107 當時的前提「基線沒有這些模組」不成立。
- 移除 T1 專用 501 補丁及 fallback；組裝後 import 路由與服務保持基線內容，其他檢查不變。T10 日期補丁仍要求錨點吻合，來源漂移即停止。
- `app.main` 是新入口，不載入 baseline-main、不啟動正式授權或 bootstrap。啟動必須符合 `COMPOSER_PREVIEW=1`、固定預覽 DB、固定本機 MOD URL 及外部服務關閉條件。

## Python 依賴

Python 固定 `3.12.8`，PostgreSQL 固定 `16.6-bookworm`，Node 組裝階段固定 `22.14.0-bookworm-slim`。`requirements.txt` 固定直接與間接套件版本。相對基線：移除 SQLite 專用 aiosqlite；asyncpg、greenlet、cryptography 的下限改為固定版；uvicorn 不裝 standard extras（預覽無 reload、WebSocket 需求）；新增 `psycopg2-binary`，因 logs-ops 的同步 writer 將 asyncpg URL 轉成 PostgreSQL 預設同步 driver。其餘直接依賴沿用基線版本。

這是離線撰寫的候選安裝組合，尚未執行 pip resolver、映像建置或安全更新審核；固定 tag 與版本不是 digest／hash 鎖定。安裝相容性由 Claude 實測記錄，不能以靜態檢查取代。

## 不需 Docker／網路的檢查

```text
node --test services/preview/tests/preview.test.mjs
node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target es2022 --module nodenext --moduleResolution nodenext --types node --skipLibCheck services/preview/assemble.mjs services/preview/preview.mjs
node services/preview/assemble.mjs services/preview/.assembled
python -B services/preview/check_tree.py services/preview/.assembled
python -B -m unittest discover -s services/preview/tests -p test_static.py
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Linux 的 Python 命令可使用 `python3`，npm 使用 `npm`。`.assembled` 必須原本不存在；重跑請選另一個新目錄，避免誤刪資料。Node 測試自己使用可清理的專用暫存目錄。Python 檢查只用標準庫：逐檔 `compile`（不寫 pyc），AST 掃描絕對、相對、函式內延遲 `app.*` 匯入及路由登錄；不啟動 app、不連 DB。Node 的 import 掃描只是補充，不替代 Python 語法檢查。根目錄 typecheck／Vitest 原本不涵蓋此目錄，因此另列新檔 checkJs 與測試命令，沒有改 package 或 tsconfig。

2026-10-19 Codex 結果：Node 5/5 通過、新檔 checkJs 通過、專案 typecheck／build 通過。全套 Vitest：453 passed、1 failed、1 skipped；失敗是 security CLI 讀取私鑰及 afterAll 清理的 EPERM，沒有為通過而改測試。Python 系統入口無法執行（logon session），既有 `.venv` 的 Python313 目標不可用，所以 Python 靜態檢查與 unittest **未執行**。Dockerfile 會執行靜態檢查；Claude 仍需先補跑 unittest。

## Claude 的 WP4b 驗收

1. 補跑上述 Python 檢查與 unittest，確認模型匯入／SQLAlchemy mapper、外鍵與 ENUM 的實際相容性，再用 Compose build/up。發生錯誤應保留完整日誌，不吞錯或臆測為已通過。
2. 確認宿主只發布兩個 loopback 埠、容器不可連外、兩服務 healthy、healthz 查 DB 成功、初始業務表與租戶表空白。
3. 執行 seed 兩次核對資料列數。對九個 Kit 逐個測實際端點與資料持久化。驗證 preview_entries 的 fingerprint 解析、READY、空錯誤清單、提交 COMPLETED 與 records 讀回。P1/P2/P3 各建立並提交成功；P3 使用合成 date，直接查 DB 確認三種 record 及 P2/P3 item 實際寫入，再重匯驗證更新及替換。不得建立同名 Station 而繞過相容模型。
4. MOD 同步用任意合成 subscription id；假服務固定回 basic/active，回應含 `preview_fake: true`，不得作為真實訂閱證據。驗證本機 sync、query、entitlements、帶假 webhook secret 的 webhook。外部 PDF 轉換未提供，不連外。
5. 寫入後執行 reset，確認租戶、所有業務表、system_logs、上傳檔與權限設定清空；再 seed／CRUD 確認可重新使用。具名 volume 會重新建立。
6. 重跑 security 測試並處理 EPERM 暫存目錄。本次 `composer-security-73Ib7q` 未宣稱清除成功。

權限設定與 audit/events 路由仍註冊，但原始碼的 system-admin 檢查保留，沒有身分提供者時預期 403；不偽造管理員或繞過檢查。角色授權、Recipe 啟停能力及直接 API 拒絕屬 WP5，授權測試標為「未涵蓋」。全量組裝成功不等於所選 Kit 獨立部署成功，兩者必須分開報告。

## 煙霧測試與身分替身

`node services/preview/smoke.mjs [baseUrl]` 對執行中的容器發出真實請求並寫入合成資料，輸出 PASS／GAP／FAIL；GAP 是登錄在 `docs/preview-todo.md` 的已知缺口，不算通過。測試前需先執行一次 `docker compose ... exec -T backend python -m app.preview_seed` 建立合成租戶。

管理員與角色限定端點（端點權限、稽核事件、修正原因）需要身分：預覽入口以固定假金鑰 `X-Admin-API-Key: preview-fake-admin-key` 視為管理員，並以 `X-Preview-Role: manager|operator` 指定角色。**這只是測試用替身，不是驗證機制，授權測試仍標為「未涵蓋」。**

靜態測試不需要 Docker：`node --test services/preview/tests/preview.test.mjs` 與 `python -I services/preview/tests/test_static.py`。

## WP4c 交接（2026-10-20）

T9 與 T1 程式已補齊，尚未執行本批容器實測。T9 不再接受 GAP，必須提交完成並核對讀回資料；三種相容分支必須建立 201、查錯誤為空、提交 200 並完成。P1/P2 使用合成 lot_no，P3 另加通用 date，不放寬基線規則。靜態檢查與環境失敗完整記於 mailbox Codex Notes，容器驗收由 Claude 執行。

## 選配閘門與獨立組裝

- **選配的來源是 Composer 的 Recipe。** 預設無 Recipe（`all`）：映像內所有 Kit 開放。`PUT /_preview/recipe`（需預覽管理員標頭）套用 Recipe，`DELETE /_preview/recipe` 回到 `all`，`GET /_preview/capabilities` 回傳 mode、開放與被拒絕的能力、`unavailable` 與 `warnings`。無效 Recipe 回 422，現有選配不變。
- **未開放一律回 403**（含 Kit 名稱與能力）；registry 沒有登錄的路由預設拒絕；`/api/kit/call/{capability}` 以請求的能力再判定；匯入、背景工作與 webhook 在執行前也檢查。目錄中存在但預覽無後端的 Kit（`entry-permission-kit`、`station-data-link-kit`、`station-admin-kit`）列為 `unavailable`，Recipe 仍可套用，依賴它們只產生警告，並不代表依賴已滿足。
- **切換選配只改存取權限，不刪資料**；要清空請用 `preview.mjs reset`。
- **獨立組裝：** `node services/preview/preview.mjs up --recipe <Recipe 檔>` 只組裝所選 Kit。組裝階段的檢查會拒絕兩種缺口：缺少的 `app.*` 模組匯入，以及指向未納入資料表的字串外鍵。基線以 `try` 加 `raise`（回 501）保護的可選匯入不算缺口，但會逐項列在 `assembly-report.json` 的 `optionalImports`，不靜默略過（D122）。實測的最小可獨立集合為 platform-core、generic-forms、audit-edit（核心的模型指向通用表單的資料表，通用表單的資料表指向稽核的資料表；見 `docs/preview-todo.md` T13）。選配狀態保存在資料卷，在既有資料卷上改用 `--recipe` 時先執行 `reset` 才是全新的獨立部署。
- **測試：** `node services/preview/smoke-domain.mjs` 驗證有實體表的登記代碼仍走實體路徑（T12 回歸；只在全量映像執行，因趨勢檢查需要 analytics-kit）。`node services/preview/smoke-gating.mjs` 對執行中的容器驗證閘門（需先 `up` 與 `app.preview_seed`）；Python 靜態測試需要固定版本的 `jsonschema`：`python -m venv services/preview/.test-venv`，安裝 `jsonschema==4.23.0` 後以該 venv 的 Python 執行 `test_static.py`。Node 測試已納入 `npm test`。
