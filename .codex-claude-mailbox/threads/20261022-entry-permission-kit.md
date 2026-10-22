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

# Claude Notes

- 2026-10-22：完成盤點，未改任何程式。
- 2026-10-22：user 八項皆採建議，租戶固定單一，install-engine 契約升為正式決議。記錄為 D126（安裝引擎，改 Docker Compose）與 D127（入口權限設計）；設計寫在 `docs/entry-permission-design.md`（EP1），新增 `schemas/entry-points.schema.json`；spec 第 8 節加上決議段落。
- 依賴 `PyJWT==2.15.1`、`bcrypt==5.0.0` 是 `pip index versions` 查到的最新版（2026-10-22）；user 核准套件選擇，版本由 user 可更換。bcrypt 5 對超過 72 位元組的密碼會拒絕，設計已納入。
- 限制：Codex 沙箱沒有可用 Python，EP2 的 Python 只能寫、不能跑。純邏輯（判定、入口比對、密碼原則）用標準庫 `unittest` 寫成可在無第三方套件下執行的測試；需要資料庫與 FastAPI 的整合測試由 Claude 在 Docker 內執行並回填結果。
