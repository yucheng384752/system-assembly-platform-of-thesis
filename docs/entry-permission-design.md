---
title: entry-permission-kit 設計（EP1）
date: 2026-10-22
status: 設計草稿，依 D127 實作；實作前以本文為資料與介面定義
---

# entry-permission-kit 設計（EP1）

依據：spec 第 8 節、D03、D127；來源盤點見 `.codex-claude-mailbox/threads/20261022-entry-permission-kit.md`。來源專案 `daihui_project` 唯讀，只借用概念與已驗證的規則，不複製其產線耦合。

## 1. 決議摘要（D127）

| 項目 | 決定 |
|---|---|
| 角色 | 資料表中的可設定角色；內建 `admin`（管理員）、`audit`（唯讀）、`manager`、`operator`。不內建產線的 `qc` |
| 產品範圍 | 第一版不做 |
| 入口目錄 | 各 Kit 在 `kit.contract.json` 宣告 `entryPoints`，組裝時彙整，不寫死常數 |
| 執行點 | 一個共用中介層，取代對終端使用者的 `AUTH_MODE=api_key`；API key 保留給機器對機器 |
| 依賴 | `PyJWT==2.15.1`、`bcrypt==5.0.0`（2026-10-22 查證為 PyPI 最新；user 於 2026-10-22 核准套件選擇，版本若要更換請提出） |
| 租戶 | 固定單一預設租戶，`DEFAULT_TENANT_ID` 來自設定；不改 `kits/` 基線模型 |
| 範圍外 | SSO、MFA |
| 未選此 Kit | 組裝器要求明確選擇替代：沿用 API key，或受限制公開；不得預設為匿名全權 |

## 2. 與現有 Kit 的整合方式

基線的 Kit 不看使用者資料表，只看請求狀態：`request.state.is_admin`、`request.state.actor_role`、`request.state.auth_tenant_id`（例如 `audit-edit-kit` 要求 `is_admin` 或 `actor_role == "manager"`；`platform-core-kit` 的 `endpoint_permission_middleware` 與 `deps.py` 同樣讀這些欄位）。因此入口權限 Kit 的整合點是：

1. 一個認證中介層，排在 `endpoint_permission_middleware` 之前，驗證 `Authorization: Bearer` 的 JWT，查使用者與角色，設定 `request.state.actor_user_id`、`actor_role`（角色名稱）、`is_admin`（角色為內建 `admin`）、`auth_tenant_id`（預設租戶）。
2. 其後的入口授權：以請求的方法與路徑找到入口，依「個別覆寫 > 角色授權 > 入口預設角色」判定。
3. 現有 Kit 一行都不用改。限制（要寫進手冊）：現有 Kit 內寫死的 `actor_role == "manager"` 只認角色名稱 `manager`；自訂角色要能通過這類檢查，只能靠入口授權與 `is_admin`，不能靠名稱。
4. 機器對機器：`X-Admin-API-Key` 路徑維持基線行為，不經使用者登入。
5. **固定租戶（2026-10-22 釐清）：** `platform-core-kit` 的 `get_current_tenant` 在 `is_admin` 時會採用請求標頭 `X-Tenant-Id`，只設定 `auth_tenant_id` 不足以固定租戶。中介層因此在通過認證後檢查 `X-Tenant-Id`：未提供，或等於 `DEFAULT_TENANT_ID`，放行；其他值一律回 403（`{"detail": "Forbidden"}`，不洩漏預設租戶值），並記錄日誌。不修改基線依賴。
6. **與舊的端點權限層的交集（2026-10-22 釐清）：** `endpoint_permission_middleware` 依 `endpoint_permissions.json`（預設為空物件）對最長路徑前綴要求角色，失敗回 403，實際上是強制而不是提示。決定：保留它作為額外否決，不繞過。入口授權先判定，放行後舊層仍可能否決，所以「放行」的語意是「入口層允許」；`GET /api/entry-points/me` 只反映入口層，手冊與 API 說明須註明，若部署設定了 `endpoint_permissions.json`，實際結果是兩層的交集。組裝器在輸出時若 `endpoint_permissions.json` 非空，於 `validation/report.json` 以警告列出。

## 3. 資料模型（非同步 SQLAlchemy、UUID 主鍵、PostgreSQL）

不修改 D125 補進的 `tenant_users`、`tenant_api_keys`（它們仍是外鍵目標）。新增資料表一律前綴 `ep_`。

| 表 | 欄位 | 規則 |
|---|---|---|
| `ep_roles` | `id`、`name`（唯一，小寫英數與底線）、`display_name`、`is_builtin`、`is_readonly`、`created_at` | 內建角色不可刪除；`admin` 不可設為唯讀；`audit` 固定唯讀 |
| `ep_users` | `id`、`username`（唯一）、`password_hash`、`display_name`、`employee_no`（可空）、`role_id`→`ep_roles`、`must_change_password`、`is_active`、`failed_login_count`、`locked_until`、`last_login_at`、`created_at`、`updated_at` | 鎖定狀態存資料庫，多 worker 有效（取代來源的行程記憶體） |
| `ep_role_entry_points` | `role_id`、`entry_point`、`allowed` | 角色層授權，唯一鍵 `(role_id, entry_point)`；無紀錄即採入口宣告的預設角色 |
| `ep_user_entry_point_overrides` | `id`、`user_id`、`entry_point`、`allowed`、`assigned_by`（可空，`SET NULL`）、`created_at` | 唯一鍵 `(user_id, entry_point)`；雙向覆寫；不得以唯讀角色的使用者為目標 |

判定順序：`is_active` 為假則拒絕；使用者覆寫有紀錄則以覆寫為準；否則角色授權有紀錄則以其為準；否則入口宣告的 `defaultRoles` 含該角色才允許。唯讀角色（`is_readonly`）對 `access: "write"` 的入口一律拒絕，且在判定順序之前，覆寫與授權都無法放行。

## 4. 入口宣告與彙整

`kit.contract.json` 新增可選欄位 `entryPoints`：

```json
{
  "entryPoints": [
    {
      "key": "audit.edit_record",
      "label": "修正資料列",
      "access": "write",
      "defaultRoles": ["admin", "manager"],
      "routes": [
        { "capability": "records.edit", "method": "PATCH", "path": "/api/edit/records/{table_code}/{record_id}" }
      ]
    }
  ]
}
```

- **路由明確列出（D128，取代先前「引用能力編號再解析」的做法）：** 各 Kit 的契約只宣告部分路由，所以 `routes` 直接寫 `{capability, method, path}`；契約未宣告的路由使用新的能力編號。路徑含組裝前綴（例如 `/api/edit/...`）。
- **覆蓋測試：** 測試以 AST 掃描各 Kit 的 `routes_*.py` 得到真實路由（加組裝前綴），每一條都必須恰好被一個入口涵蓋，入口中列出但不存在的路由也失敗；入口權限自己的路由與公開例外另有明列的規則。新增路由而漏列入口時測試失敗，不會默默變成「僅 admin」。
- `key` 全系統唯一，格式 `<領域>.<動作>`；重複則拒絕組裝。
- 組裝輸出 `permissions/entry_points.json`，格式見 `schemas/entry-points.schema.json`，進 `system-manifest.json` 的 `files`。
- **預設拒絕：** 不在任何入口、也不在公開例外的 `/api` 路徑，只有內建 `admin` 可通過，並記錄日誌。
- **公開例外（D128）：** `/healthz`（GET）、`/api/auth/login`（POST），以及 `/api/mod/subscriptions/webhook`（POST）。webhook 由外部 MOD 服務呼叫、沒有使用者 token，端點以 `X-Mod-Webhook-Secret` 自行驗證；但基線程式只在 `MOD_WEBHOOK_SECRET` 有設定時才檢查，所以選入 mod-subscription-kit 的系統包，**組裝與啟動都必須要求該環境變數存在且非空**，缺少就失敗。公開例外集合固定在程式裡，目錄的 `publicPaths` 只能是它的子集。
- **通用代理 `POST /api/kit/call/{capability}`：** 會執行 6 個資料庫讀取能力（已核對全為讀取），不經各 Kit 的入口，所以預設角色取較窄的 `admin`、`manager`（入口 `platform.kit_call`）。
- 入口可見性（前端選單）與 API 存取使用同一份解析結果：`GET /api/entry-points/me` 回傳目前使用者可用的入口鍵。

為了讓現有 Kit 的端點進入目錄，EP4 為 9 個有後端的 Kit 的 `kit.contract.json` 補 `entryPoints`（共 22 個入口，涵蓋 52 條路由，清單與角色見 mailbox thread `20261022-entry-permission-kit` 的「EP4 入口清單」，user 於 2026-10-24 照預設核准）；這會修改 `kits/`，屬於另行核准的步驟（每個 Kit 一個 commit，預設角色保守，只用內建角色）。

## 5. API

| 方法 路徑 | 說明 | 入口 |
|---|---|---|
| `POST /api/auth/login` | 登入，回 JWT；失敗 5 次鎖 15 分鐘（資料庫計數）；回應不區分帳號不存在與密碼錯誤 | 公開 |
| `GET /api/auth/me`、`PATCH /api/auth/me` | 讀取與修改自己的顯示名稱 | 已登入 |
| `POST /api/auth/change-password` | 改密碼；成功後清除 `must_change_password` | 已登入 |
| `GET/POST /api/users`、`PATCH /api/users/{id}`、`POST /api/users/{id}/reset-password` | 使用者管理 | `entry_permission.user_manage`（預設 `admin`、`manager`）；`manager` 只能管理非 `admin`、非 `manager` 的角色 |
| `GET/POST/PATCH/DELETE /api/roles`、`PUT /api/roles/{id}/entry-points` | 角色與角色層授權 | 固定僅 `admin` |
| `PUT /api/users/{id}/entry-point-overrides` | 個別覆寫 | 固定僅 `admin`（程式寫死，不走入口，避免權限迴圈） |
| `GET /api/entry-points`、`GET /api/entry-points/me` | 入口目錄與目前使用者可用入口 | 已登入 |

## 6. 安全規則

- 密碼：長度需大於 8 且位元組數不超過 72（bcrypt 5 超過會拒絕）；是否加複雜度規則屬政策調整，先問 user。
- JWT：HS256，預設 8 小時，`sub` 為使用者 UUID；金鑰來自環境變數 `ENTRY_PERMISSION_JWT_SECRET`，長度不足 32 字元或未設定則**啟動失敗**（來源只記警告，本 Kit 改為 fail loud，規則 12）。無撤銷機制，已知取捨，寫入手冊。
- 初始管理員：只經安裝引擎的秘密輸入通道（標準輸入或 0600 暫存檔）建立，`must_change_password` 為真；不寫進設定、環境變數檔或日誌。提供一次性命令 `python -m app.entry_permission.create_admin`。
- 唯讀角色在結構上無法寫入（見第 3 節判定順序），不是逐端點檢查。
- 使用者可編輯的文字在前端一律純文字呈現。
- 角色只是提示的舊限制（CLAUDE.md 安全基準線）在本 Kit 的系統中不再適用，但**只能宣稱實際測過的拒絕路徑**。

## 7. 驗收（EP2 至 EP5）

單元與整合測試必須涵蓋，且能失敗：登入成功與失敗、鎖定與到期解鎖、強制改密碼前拒絕其他端點、停用帳號拒絕、JWT 過期與竄改、預設拒絕、覆寫雙向、覆寫不得提權給唯讀角色、唯讀角色寫入被拒、manager 不得管理 admin、覆寫端點僅 admin、入口目錄重複鍵拒絕組裝、金鑰缺少或過短啟動失敗。Docker 實機：以 HTTP 驗證上列拒絕路徑，並確認現有 Kit（例如修正資料列）在不同角色下的實際結果。

## 8. 範圍外與限制

SSO、MFA、帳號自助註冊、密碼找回、token 撤銷、產品範圍、跨租戶隔離。現有 Kit 內寫死的角色名稱限制見第 2 節。
