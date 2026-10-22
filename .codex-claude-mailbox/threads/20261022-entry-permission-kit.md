---
id: "20261022-entry-permission-kit"
title: "entry-permission-kit：由 daihui_project 抽離入口權限，取代 tenant-auth-kit（D03、spec 第 8 節）"
status: "in_progress"
owner: "claude"
reviewer: "user"
priority: "high"
created_by: "claude"
created_at: "2026-10-22"
updated_at: "2026-10-22"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "docs/project-spec.md"
    type: "file"
  - path: "kits/entry-permission-kit/"
    type: "directory"
---

# Goal

完成 `entry-permission-kit`，替代已廢除的 `tenant-auth-kit`（D03）：單租戶、多使用者，隔離單位是「使用者／角色對資源與操作的存取權」。來源為 `C:\Users\gslab\Desktop\daihui_project`（唯讀；v1.0.0，2026-10-21）。依 spec 第 8 節，先盤點、建立相容契約再抽離，不直接複製專案耦合。

目前 `kits/entry-permission-kit/` 只有 `.gitkeep`；Kit 只以 `config/kits/overlay.json` 的一筆登記存在（版本 0.1.0，說明「尚未串接身分驗證」）。

本 thread 與 P2 可執行組裝（`20261021-p2-executable-assembly`）分開：P2 的 WP3a 到 WP3c 在入口權限完成前，認證只沿用 `platform-core-kit` 既有的 `AUTH_MODE`／API key 機制。

# 盤點結果（唯讀；未讀 `.env`）

## 後端（`backend/app`，FastAPI、同步 SQLAlchemy Session、Alembic、整數主鍵）

| 項目 | 來源檔 | 內容 |
|---|---|---|
| 登入 | `api/routes/auth.py`（115 行） | `POST /auth/login`、`GET`／`PATCH /auth/me`、`POST /auth/change-password`；依 username 5 次失敗鎖 15 分鐘，記在行程記憶體（單 worker 才有效） |
| 憑證 | `core/security.py` | bcrypt 雜湊；JWT（python-jose），到期 8 小時，stateless，無撤銷 |
| 密碼原則 | `core/passwords.py` | 只檢查長度大於 8；首次登入強制改密碼（`must_change_password`） |
| 使用者 | `models/user.py`、`api/routes/users.py`（265 行） | `users`：username、password_hash、display_name、employee_no、role、must_change_password、is_active；新增／列表／改資料／重設密碼 |
| 角色 | `models/enums.py` | 固定五種：operator、manager、admin、qc、audit。audit 唯讀，靠「從未列入任何寫入白名單」成立，不是逐端點檢查 |
| 入口目錄 | `core/permissions.py`（166 行） | `EntryPoint(key, label, roles)` 程式常數，約 15 個入口（批次管理、派工、入庫單送出、設備點檢……）；呼叫端用 `require_entry_point(X)` |
| 個別覆寫 | `models/user_entry_point_override.py`、`core/user_entry_point_overrides.py` | `(user_id, entry_point) -> allowed`，雙向（可開可關）；沒有紀錄就走角色預設；不得以 audit 為目標；修改覆寫的端點寫死 admin-only，避免權限迴圈 |
| 產品範圍 | `models/user_product.py`、`core/user_products.py` | 帳號可操作哪些產品；屬產線業務耦合 |
| 依賴注入 | `api/deps.py`（112 行） | `get_current_user`、`require_password_changed`、`require_role`、`require_entry_point`、`require_any_entry_point`、`require_write_access` |
| 遷移 | `alembic/versions/0001_initial_rbac.py` 等 | RBAC 表由 Alembic 建立 |

## 前端（`frontend/src`）

`pages/LoginPage.tsx`、`pages/ChangePasswordPage.tsx`、`pages/UserManagementPage.tsx`、`auth/useAuth.tsx`、`lib/entryPoints.ts`；token 存 `localStorage`（daihui 的 CLAUDE.md 記為已知設計取捨）。

## 與 Composer 現有架構的落差（抽離時必須處理）

| 落差 | daihui | Composer 的 Kit |
|---|---|---|
| 資料庫存取 | 同步 `Session`、整數主鍵 | 非同步 SQLAlchemy、UUID 主鍵 |
| 租戶 | 無 | 現有 `tenant_users` 有 `tenant_id`；D03 要求移除或固定為單一值（spec 第 8 節待確認） |
| 入口目錄 | 程式常數，每個入口寫死在 `permissions.py` | Kit 各自宣告能力（`kit.contract.json`、registry）；spec 要求 Kit 宣告權限資源與操作 |
| 授權執行點 | 每個路由掛依賴 | `platform-core-kit` 有 `endpoint_permission_middleware` 與 `endpoint_permissions.json`，目前 `allowed_roles` 只是提示（CLAUDE.md 安全基準線） |
| 角色 | 固定五種，含產線的 qc | Composer 是通用平台，不應寫死產線角色 |
| 新依賴 | python-jose、bcrypt | 基線後端沒有這兩者；新增依賴須經 user 核准 |
| 遷移 | Alembic | 系統包首次安裝以明確步驟建表，升級遷移尚未提供（P2 WP3a） |
| 鎖定機制 | 行程記憶體 | 多 worker 或多實例無效，需改共享儲存 |

## 基線 tenant-auth 現況（對照）

基線的 `tenant_users`、`tenant_api_keys` 模型已在 D125 補進 `platform-core-kit`，但只有資料表，沒有登入或 API key 簽發實作（基線 `routes_auth.py` 屬 tenant-auth，未帶入）。基線前端的 `RegisterPage`、`ManagerPage` 依賴 tenant-auth，且 `services/auth`、`adminAuth`、`tenant` 缺檔。

# 需要 user 決定（先不派工）

1. **角色模型：** 沿用 daihui 的固定五種角色，還是改成資料表中可設定的角色？前者簡單、但寫死產線角色；後者通用、工作量較大。audit 唯讀語意要不要保留為內建？
2. **產品範圍（user_products）：** 屬產線業務，我建議不納入第一版。同意嗎？
3. **入口目錄的來源：** 我建議由各 Kit 在 `kit.contract.json` 宣告入口（key、label、預設角色），入口權限 Kit 在組裝時彙整，而不是寫死常數。同意嗎？
4. **執行點：** 我建議用一個共用的授權依賴或中介層，依入口目錄決定放行，取代現有 `AUTH_MODE=api_key`（API key 保留為機器對機器用途）。同意嗎？
5. **新依賴：** JWT 與密碼雜湊。daihui 用 python-jose 與 bcrypt；python-jose 近年維護狀況不佳，我傾向 PyJWT 加 bcrypt。需要你核准具體套件與版本（我查證版本後提出）。
6. **租戶欄位：** `tenant_users.tenant_id` 固定為單一預設租戶，還是移除？移除會牽動基線其他模型的外鍵。
7. **範圍外：** SSO、MFA 依 spec 是擴充建議，非已確認需求，我預設不做。
8. **未選此 Kit 的系統：** spec 要求必須明確採用替代驗證，不得變成匿名全權。組裝器要不要在沒選入口權限時強制選擇「沿用 API key」或「受限制公開」？

# 預計工作包（待上列決定後再派工）

| WP | 內容 | 負責 |
|---|---|---|
| EP1 | 設計文件與契約：資料模型（含 JSON Schema 或 Kit 契約的 `entryPoints` 擴充）、API、錯誤語意、預設拒絕行為；更新 spec 第 8 節的待確認項為決議 | Claude |
| EP2 | 後端：登入／改密碼／使用者管理／角色與入口覆寫、授權依賴、鎖定機制、初始管理員建立（接安裝引擎的秘密輸入通道）；測試含拒絕存取 | Codex |
| EP3 | 前端：登入、改密碼、使用者管理；取代 tenant-auth 的 Register／Manager 頁面 | Codex（依 P2 前端 WP） |
| EP4 | Kit 套件：`kit.contract.json`、`manifest.json`、`workflow.aov.json`、registry、安裝腳本、三份手冊；Composer 目錄與 overlay 更新 | Codex／Claude |
| EP5 | 納入 P2 系統包：組裝器處理入口目錄彙整與依賴、移除對 `AUTH_MODE=api_key` 的終端使用者驗證依賴；實機授權測試（拒絕未授權、audit 唯讀、覆寫不可提權） | Claude |

驗收需涵蓋 CLAUDE.md 安全基準線：目前「授權測試標為未涵蓋」，本 Kit 完成後才能改寫此項，並且只能宣稱實際測過的拒絕路徑。

# Codex Notes

## EP2

- 2026-10-22：介面核對後停止，EP2 尚未實作。已確認 cwd 為 `C:\Users\gslab\Desktop\composer-refactor`，分支為 `feature/p2-executable-assembly`。使用者要求遇到設計與 platform-core 實際介面矛盾時停止並在 Notes 回報，本次依此執行。
- 已完整閱讀：`docs/entry-permission-design.md`、`schemas/entry-points.schema.json`、本 thread、D127、platform-core 的 `core/database.py`、`core/config.py`、`api/deps.py`、`core/endpoint_permission_middleware.py` 與 `models/core/*.py`。另核對 `core/permission_config.py`。已唯讀閱讀指定 daihui 七個參考檔，未讀取 `.env`。

### 阻塞：固定租戶與既有依賴的行為不一致

- 設計第 1、2 節要求固定單一預設租戶，且內建 admin 設定 `request.state.is_admin=True`、`auth_tenant_id=DEFAULT_TENANT_ID`，既有 Kit 不修改。
- 實際 `kits/platform-core-kit/src/backend/app/api/deps.py` 的 `get_current_tenant` 在 `auth_tenant_id and is_admin` 分支使用 `effective_tenant_id = x_tenant_id or str(auth_tenant_id)`。因此僅設定設計指定的 state 並不能固定 admin 的租戶；若標頭指定另一個可解析租戶，後續依賴會使用該租戶。
- 待 user／Claude 明確定義：EP 中介層應拒絕不等於預設租戶的 `X-Tenant-Id`、忽略此標頭，或另案修改基線依賴。這些會造成不同 HTTP 行為，本次不自行選定，也未修改 platform-core。

### 另需釐清：入口授權與舊端點限制的交集

- `core/endpoint_permission_middleware.py` 實際以 `is_admin or (required_role != "system-admin" and actor_role == required_role)` 強制授權，失敗回 403；不是單純提示。`permission_config.py` 從端點設定讀取最長路徑前綴對應的角色。
- 若 operator 的入口覆寫允許，但舊端點設定要求 manager，EP 放行後仍會被舊層拒絕。設計第 2 節已承認既有硬編碼角色限制，但應明確確認此設定式中介層也保留額外否決權，以及 `/api/entry-points/me` 的「可用」是否僅代表 EP 判定。未自行繞過舊層或把自訂角色設為 admin。

### 變更摘要與檔案清單

- 唯一變更：`.codex-claude-mailbox/threads/20261022-entry-permission-kit.md`，新增本 EP2 Notes。
- 未新增後端、schema、requirements 或測試檔；未修改其他 Kit、docs、schemas、libs、apps、services、scripts、TODO.md；未寫契約、manifest、workflow 或 install 腳本；未 git add/commit。
- 起始工作區已有 `TODO.md` 修改，保留原狀。未依 mailbox 技能更新 index，遵守本任務限定修改範圍。

### 驗證方式與實際結果

- 已做：PowerShell／rg 靜態讀取與介面對照、cwd／分支／git diff 檢查。首次 Get-Content 使用預設編碼造成中文顯示亂碼，已用 UTF-8 重讀；合併輸出有截斷的 database/config 已分別完整重讀。
- 未執行：任何 Python、unittest、依賴安裝、網路或 Docker。Python 單元、語法與整合驗證均為「由 Claude 執行」，目前沒有通過或失敗的執行結果。
- 變異驗證：未建立或執行（因介面阻塞停止）。恢復實作後須由 Claude 執行移除唯讀寫入拒絕、移除未知入口預設拒絕等變異，確認對應測試失敗；不可將此待辦當成已完成驗證。
- 未涵蓋：本次未實作 EP2 全部模型、純邏輯、安全、API、中介層、初始 admin 與測試；所有設計第 7 節拒絕路徑及跨 worker 鎖定均未驗證。
- 原預計完成時間為 2026-10-22 17:00；目前因上述介面決策阻塞，不宣稱完成或驗收通過。

## EP2 第二次

### 變更摘要

- 2026-10-22：依 D127、`docs/entry-permission-design.md` 與入口目錄 schema 新增 EP2 後端來源及測試。前次 EP2 記錄完整保留。原預計完成時間為 **2026-10-22 17:00**；本次交付為程式與待執行測試，不代表驗收通過。
- 落實第 2 節第 5 點：使用者 JWT 認證成功後檢查 `X-Tenant-Id`；缺少或精確等於設定的 `DEFAULT_TENANT_ID` 才允許，空值／不同值／重複標頭拒絕，回 `403 {"detail":"Forbidden"}`，日誌不含預設租戶值。機器認證的後續 continuation 也套用標頭檢查。
- 落實第 2 節第 6 點：入口授權成功後呼叫原有下游，不提升角色、不改寫下游回應；舊 `endpoint_permission_middleware` 保留額外否決。`GET /api/entry-points/me` 的 OpenAPI 說明明載僅代表入口層，測試加入 EP allow／舊層 deny、兩層 allow、EP deny 及 me 可見性案例。
- 四張 `ep_` 表、非同步 API、HS256／8 小時 JWT、密碼 >8 字元且 <=72 UTF-8 bytes、資料庫行鎖與 5 次／15 分鐘鎖定、強制改密碼、雙向個別覆寫、角色授權、唯讀先拒絕、未知 API 僅內建 admin、stdin JSON 一次性 admin 建立均已寫入。
- `policy.py`、`directory.py`、`passwords.py`、`lockout.py` 無 sqlalchemy/jwt/bcrypt/fastapi import；security 的加密依賴延遲載入，金鑰檢查本身可用標準庫測試。requirements 僅兩個核准版本。

### 檔案清單

新增 23 個檔案（以下除 requirements/tests 外皆相對 `kits/entry-permission-kit/src/backend/app/`）：

- `models/ep_role.py`
- `models/ep_user.py`
- `models/ep_role_entry_point.py`
- `models/ep_user_entry_point_override.py`
- `entry_permission/policy.py`
- `entry_permission/directory.py`
- `entry_permission/passwords.py`
- `entry_permission/lockout.py`
- `entry_permission/security.py`
- `entry_permission/middleware.py`
- `entry_permission/create_admin.py`
- `api/routes_ep_auth.py`
- `api/routes_ep_users.py`
- `api/routes_ep_roles.py`
- `api/routes_ep_entry_points.py`
- `schemas/ep_auth.py`
- `schemas/ep_users.py`
- `schemas/ep_roles.py`
- `schemas/ep_entry_points.py`
- `kits/entry-permission-kit/requirements.txt`
- `kits/entry-permission-kit/tests/test_logic.py`
- `kits/entry-permission-kit/tests/test_middleware_integration.py`
- `kits/entry-permission-kit/tests/README.md`

另依明確授權僅追加本 thread 的 Codex Notes。未修改其他 Kit、docs、schemas、libs、apps、services、scripts、TODO.md；未建立契約、manifest、workflow 或 install 腳本；未 git add/commit。起始已有的 TODO.md 修改保留。依本次範圍限制，不更新 mailbox index。

### 驗證方式與實際結果（含未執行項）

- 已執行：PowerShell／rg 靜態閱讀、規格及基線介面核對、檔案清單與第三方 import 檢索、行尾空白掃描、`git diff --check` 與工作區狀態檢查。新增 23 檔行尾空白掃描為 0；這不是 Python 語法或行為驗證。Git 顯示使用者全域 ignore 檔無讀取權限警告，但狀態與 diff 命令有回傳結果。
- `test_logic.py`：22 個標準庫 unittest 方法，涵蓋判定順序、覆寫雙向／唯讀不可提權、manager 目標角色限制、入口 method/path、未知 API 預設拒絕、入口重複鍵與 JSON 重複成員、密碼字元與 72-byte 邊界、鎖定第五次及到期邊界、金鑰缺少／31／32 字元、固定租戶純函式、stdin 格式。
- `test_middleware_integration.py`：13 個 unittest 方法，使用實際 EP 與未修改的舊中介層，mock 資料庫讀取及舊端點設定；涵蓋兩層交集、admin 租戶拒絕、停用／唯讀／強制改密碼、JWT 過期與錯誤簽章、固定 admin dependency、啟動金鑰檢查、機器標頭不能自行認證及 me 僅回入口層。此套件不是 PostgreSQL／跨 worker／實機 HTTP 測試。
- **任何 Python（包含 compile/import/unittest）、依賴安裝、網路、Docker 均未執行。所有 Python、測試與整合結果一律：由 Claude 執行；目前沒有通過／失敗的執行結果。**
- 純邏輯待執行命令：`python -m unittest discover -s kits/entry-permission-kit/tests -p test_logic.py -v`。
- 中介層待執行命令：於 Claude Docker 中將組裝後 backend 放入 `PYTHONPATH`，執行 `python -m unittest discover -s kits/entry-permission-kit/tests -p test_middleware_integration.py -v`。不得以單獨 Kit 的片段 app 冒充已組裝後端。

### 變異

- **由 Claude 執行，尚未執行任何變異。** `tests/README.md` 列出逐一變異與預期失敗案例：移除唯讀拒絕、交換覆寫／角色優先序、放行未知入口、改成路徑前綴比對、移除重複鍵檢查、改密碼 byte／鎖定邊界、接受 31 字元金鑰、跳過租戶檢查，以及提升角色／繞過舊層。
- 租戶檢查變異必須使純函式與 admin 中介層案例失敗；舊層繞過變異必須使 `test_override_allow_does_not_bypass_old_role_veto` 失敗。不宣稱已有變異偵測結果。

### 未涵蓋與交接

- **由 Claude 執行：** PostgreSQL 真實建表／FK／unique、API response serialization、登入與重設密碼完整 HTTP 流程、跨 worker 同帳號失敗競爭與到期解鎖、初始 admin 並行建立、manager 管理 API 的真實拒絕、覆寫／角色修改資料庫結果、真實 bcrypt、既有 Kit（如 audit-edit）的實際授權結果。詳細案例在 `tests/README.md`。
- EP4／EP5 必須在啟動階段呼叫 `configure_entry_permission(app, directory_path=..., default_tenant_id=DEFAULT_TENANT_ID, machine_auth=原API-key中介層)`，註冊四個已含 `/api` prefix 的 routers、四個 models，並讓 EP 取代外層終端使用者 API-key gate，舊端點層保留在下游。僅把 EP 加在舊 API-key gate 內側會使 Bearer 請求先被拒絕。原機器 validator 必須保持其 `AUTH_MODE=api_key` 行為；本次只提供介面與交接，未修改組裝器或 platform-core。
- 非空 `endpoint_permissions.json` 的組裝警告、啟動入口接線、migration、手冊及 Docker 驗收仍交由 Claude 的 EP4／EP5；不能把本次來源交付視為已部署可用。
- 實作細節明載於 tests/README：grant PUT 使用 `entries` map，true/false 設定、null 清除、未提供鍵保留；多個路徑宣告同時匹配時全部需允許；僅內建 admin 有未知 API 例外，已宣告入口仍遵守覆寫／角色／預設順序。角色名稱建立後固定。
- 未存在帳號沒有 ep_users 資料列可儲存鎖定計數，回應仍統一 401；未額外新增追蹤表或行程記憶體計數。已存在帳號用 PostgreSQL 行鎖序列化計數。
- 無 JWT 撤銷；改密碼／重設不撤銷已發 token，但每次請求重新讀取帳號停用、角色與 must_change_password。此為規格既定限制。

# Claude Notes

- 2026-10-22：完成盤點，未改任何程式。
- 2026-10-22：user 八項皆採建議，租戶固定單一，install-engine 契約升為正式決議。記錄為 D126（安裝引擎，改 Docker Compose）與 D127（入口權限設計）；設計寫在 `docs/entry-permission-design.md`（EP1），新增 `schemas/entry-points.schema.json`；spec 第 8 節加上決議段落。
- 依賴 `PyJWT==2.15.1`、`bcrypt==5.0.0` 是 `pip index versions` 查到的最新版（2026-10-22）；user 核准套件選擇，版本由 user 可更換。bcrypt 5 對超過 72 位元組的密碼會拒絕，設計已納入。
- 限制：Codex 沙箱沒有可用 Python，EP2 的 Python 只能寫、不能跑。純邏輯（判定、入口比對、密碼原則）用標準庫 `unittest` 寫成可在無第三方套件下執行的測試；需要資料庫與 FastAPI 的整合測試由 Claude 在 Docker 內執行並回填結果。

# Claude Notes（續）

- 2026-10-22 EP2 第一次執行在介面核對階段依停止條件停止（`codex-companion status`：completed，1 分 31 秒，無程式變更）。兩項阻塞經核對屬實，由 Claude 依設計權責裁定並寫入 `docs/entry-permission-design.md` 第 2 節第 5、6 點：（1）固定租戶：中介層拒絕不等於 `DEFAULT_TENANT_ID` 的 `X-Tenant-Id`（403），不修改基線依賴；（2）舊的 `endpoint_permission_middleware` 保留為額外否決，入口層與舊層取交集，`/api/entry-points/me` 只反映入口層，組裝器遇非空的 `endpoint_permissions.json` 在驗證報告列警告。兩項皆不需要修改 `kits/` 既有 Kit。重新派工 EP2。

## 2026-10-22 EP2 驗收（Claude，第一階段）

`codex-companion status`：`task-mvj4du19-kg6zbi` completed（18 分 6 秒）；工作樹確有 19 個後端檔、`requirements.txt`、測試。Codex 自述逐項重新驗證：

- 語法：19 個檔通過 `ast.parse`。
- 純邏輯 `unittest`：22 項通過（Windows Python 3.13，僅標準庫）。
- 中介層整合測試：在 Docker `python:3.12.8-slim-bookworm`，依預覽相同固定版本安裝 fastapi、sqlalchemy 等加 `PyJWT==2.15.1`、`bcrypt==5.0.0`、組裝預覽後端後覆蓋 EP 檔，全部 35 項（22 純邏輯加 13 整合）通過。整合測試使用真實 EP 中介層與未修改的 `endpoint_permission_middleware`，資料庫查詢為替身；**不是** PostgreSQL 或部署後 HTTP 驗證。
- 變異驗證（一次一個，皆被測試攔到）：拿掉唯讀寫入拒絕、覆寫被忽略、JWT 金鑰門檻 32 改 31、密碼下限、密碼 72 位元組上限改 73、鎖定改第 6 次、鎖定時間改 1 分鐘、唯讀目標可被設覆寫，共 8 項。Codex 列的 9 項中，路徑前綴比對、重複鍵拒絕、租戶驗證略過、EP 放行後繞過 `call_next` 尚未做。
- 一次 `pip install -r services/preview/requirements.txt` 在容器內出現 `THESE PACKAGES DO NOT MATCH THE HASHES` 錯誤（未指名套件，發生在下載，檔案本身沒有 hash 鎖定）。改成只安裝需要的套件後成功。**原因未查明**（推測為下載損毀，但未證實）；若系統包安裝時再出現，視為需要調查的供應鏈訊號，不要忽略。

**預覽影響：** 新 Kit 有後端後，預覽組裝器掃到它並因路由沒有註冊規則而整個失敗。預覽沒有身分驗證，已在 `services/preview/assemble.mjs` 明確排除（原因 D127），預覽 Node 測試 12/12。系統包要納入它，組裝器需改為可自訂排除清單（`inventory` 目前共用預覽的排除表）；列入 EP5。

**尚未驗證：** 真實 PostgreSQL（建表、約束、並發建立管理員、跨 session 鎖定）、HTTP 端到端、現有 Kit 端點在各角色下的實際結果、`GET /api/entry-points/me`；`tests/README.md` 列的 8 項實機檢查與 5 項剩餘變異。不宣稱安全拒絕路徑已通過。

## 2026-10-22 套件雜湊不符的查證與路由註冊規則（Claude）

**1. 雜湊不符是哪個套件、原因：**

- 錯誤訊息的 `Expected sha256 c2e6fc39…4405`，用 PyPI JSON API 對照需求檔的 41 個固定版本，唯一吻合的是 `cryptography-43.0.3-cp39-abi3-manylinux_2_28_x86_64.whl`，也就是預覽 `requirements.txt` 固定的 `cryptography==43.0.3`。`Got e5da4bf7…0457` 不是這 41 個版本在 PyPI 上任何一個發佈檔的雜湊，所以是「下載到的位元組」與官方發佈檔不一致。pip 對來自索引的檔案一律用索引提供的 sha256 驗證，所以才在需求檔沒有 `--hash` 時出現這個訊息；`unknown package` 是 pip 在這種情況下無法標示來源需求時的固定字樣。
- 無法重現：相同需求檔在同一個映像內第二次、第三次完整安裝（含 `-r req.txt -r ep-req.txt`，`--no-cache-dir`，exit=0）都通過，所有檔案雜湊皆與官方相符。
- 結論：最可能是單次下載傳輸損毀（網路或快取節點），**未證實**；沒有發現竄改的證據（預期雜湊等於官方雜湊、重試取得的是官方檔案），但也不能排除。處置：不降低驗證（不加 `--no-deps`、不關雜湊檢查）；系統包的映像建置應失敗即中止，並建議之後把依賴改為帶 `--hash` 的鎖定檔（`pip install --require-hashes`）以便在建置時被明確攔下。這是 WP3a 的輸入。

**2. 路由註冊規則：** `services/preview/assemble.mjs` 新增 `routes_ep_auth`、`routes_ep_users`、`routes_ep_roles`、`routes_ep_entry_points` 的規則（前綴空字串，因為四個路由自帶 `/api/...` 前綴；不解析租戶，列入新匯出的 `tenantFree`），並匯出 `prefixes`、`tenantFree`。新增測試：掃描所有 Kit 的 `routes_*.py`（含預覽排除的 Kit），每一個都必須有規則，入口權限的路由必須自帶 `/api/` 前綴且為免租戶；拿掉 `routes_ep_roles` 規則時該測試失敗（變異驗證）。入口權限 Kit 仍在預覽排除（預覽以閘門取代身分驗證），README 已更新。

**再次驗證：** 預覽 Node 13/13、Python 靜態 19、`npm run typecheck` 通過、`npm test` 通過；Docker 全量映像 STATIC_OK 82 個模組，煙霧 24/24、領域表回歸 2/2、選配閘門 13/13。

## 2026-10-22 EP2 端到端驗證（Claude，真實 PostgreSQL 16.6 與 HTTP）

環境：`python:3.12.8-slim-bookworm` 加預覽固定版本依賴，PostgreSQL `postgres:16.6-bookworm`，uvicorn 真實監聽，`httpx` 打 HTTP。後端為測試用組裝：EP 中介層（外層）、未修改的 `endpoint_permission_middleware`（內層）、真實的 generic-forms 與 audit-edit 路由、EP 四組路由。機器 API key 中介層是**測試替身**（基線的 `api_key_auth_middleware` 不在 `kits/`），只模擬「管理金鑰時由請求標頭綁定租戶」。測試目錄 `entry_points.json` 為測試用的 4 個入口，不是 Kit 正式目錄（EP4）。腳本留在 `kits/entry-permission-kit/tests/e2e/`。

**結果：HTTP 48/48 通過；啟動與建立管理員檢查全部符合預期。**

- 啟動 fail loud：JWT 金鑰未設定與只有 31 字元時，行程以退出碼 3 結束並提到 secret，不啟動。
- 建立初始管理員：兩個同時執行的 `create_admin`（同帳號）退出碼為一個 0、一個 1，資料庫只有 1 個內建管理員；之後第二次、弱密碼都退出碼 1；輸出與伺服器日誌不含密碼；密碼以 bcrypt 雜湊儲存。
- 認證：無憑證與亂碼 token 為 401；未知帳號與錯誤密碼的 401 本文完全相同；首次登入強制改密碼，期間業務端點 403、`/me` 與改密碼可用，改完後同一 token 立即反映新狀態。
- 固定租戶：其他租戶標頭對 admin 也回 403；預設租戶可通過；重複標頭 403；機器金鑰加其他租戶標頭 403。
- 授權：operator 預設可讀不可寫；manager 可寫；audit 唯讀，管理者對 audit 設覆寫被拒、對 audit 角色授權寫入無效、仍 403；覆寫允許／拒絕／移除（null）三種都依預期生效；`/api/entry-points/me` 只列入口層。
- 舊層否決：operator 通過入口層後被 audit-edit 自己的 manager 檢查擋下（403 含 Manager 訊息）；manager 兩層都通過。
- 使用者與角色管理：manager 可列使用者，但不能建立 manager／admin、不能重設 admin 密碼；operator 不能列使用者；manager 不能用角色管理與覆寫端點。
- 鎖定：同一帳號 5 次失敗後，正確密碼也回相同 401；鎖定存在資料庫；將 `locked_until` 設為過去後可登入。
- 機器金鑰（替身）：正確金鑰加預設租戶標頭可通過；錯誤金鑰 401；Bearer 加機器標頭走使用者路徑，唯讀使用者仍不能寫。
- 伺服器日誌：0 筆 Traceback 或 ERROR。

**變異驗證（一次一個）：** 先前 8 項加本次 7 項共 15 項全部被測試攔到：前綴比對取代精確比對、重複入口鍵被接受、租戶標頭接受任意單一值、接受重複標頭、通過後提升為 admin、未列入入口的路由對所有人開放、略過 Bearer 使用者的租戶檢查。

**未涵蓋與限制：**
- 機器 API key 路徑只用替身驗證；基線真實的 `api_key_auth_middleware` 與 `core/auth.py` 不在 `kits/`（見 P2 thread 的 WP3a 停止紀錄）。
- 未驗證：多 worker 並發下的跨行程鎖定（只驗了資料庫保存鎖定狀態，單行程）、bcrypt 72 位元組的 HTTP 邊界（單元測試已覆蓋）、`PATCH /api/auth/me`、使用者／角色的 PATCH 與 DELETE、重設密碼後的強制改密碼、`GET /api/entry-points` 完整目錄、OpenAPI 產生。
- 測試目錄只有 4 個入口；Kit 實際的 `entryPoints` 宣告與組裝彙整（EP4、EP5）尚未做，所以「未宣告的現有 Kit 端點只有 admin 可通過」目前只靠 `uncatalogued` 規則，真實 12 個 Kit 的端點對照未驗證。
- 日誌中 token 與租戶值是否外洩未做專項檢查（只確認密碼不在輸出與日誌）。
