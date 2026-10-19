# entry-permission-kit 帳號與入口權限

來源：場域系統 S2（真名對照不在 repo，D-A4）的登入與 RBAC 模組，經去識別化與解耦後放入本專案（取代已廢除的 `tenant-auth-kit`，D03；規格 §8）。拆分總表見 `docs/s2-kit-split.md`。

## 提供

- 登入、本人資料、首次登入強制改密碼、登入失敗鎖定（次數與時間窗由設定提供）。
- 帳號管理：manager 只能建立與管理現場操作員、品管人員；只有 admin 能改角色。
- 入口權限機制：其他 Kit 以 `registry.register(EntryPoint(...))` 註冊自己的入口，以 `require_entry_point` 保護端點。本 Kit 不列出其他 Kit 的入口。
- 入口覆寫：admin 可針對個別帳號開關入口；唯讀角色一律拒絕；`overridable=False` 的入口不可覆寫。
- 資源範圍：擁有資源的 Kit 以 `scope_types.register(ScopeType(...))` 註冊範圍類型，本 Kit 只保存 (帳號, 類型, 鍵)，不對其他 Kit 的資料表建外鍵。

## 與來源系統的差異（解耦）

| 來源寫法 | 本 Kit |
|---|---|
| 所有入口集中在一個 `permissions.py` | 各 Kit 自行註冊；重複 key、含唯讀角色、空角色清單直接報錯 |
| 帳號清單同時檢查「批次管理」入口 | 以 tag `user-directory` 宣告，本 Kit 不引用其他 Kit |
| `user_products` 對產品表建外鍵 | 通用 `user_scopes`，鍵值由擁有資源的 Kit 檢查 |
| 登入鎖定次數與時間寫死 | 改由 `LOGIN_MAX_ATTEMPTS`、`LOGIN_LOCKOUT_MINUTES` 設定 |
| 前端自行維護一份入口清單（已與後端不同步） | 新增 `GET /users/entry-points`，前端改讀後端目錄 |

資料遷移對應：`user_products(user_id, product_id)` → `user_scopes(user_id, scope_type='product-line', scope_key=<產品線代碼>)`，由 product-process-kit 的遷移包執行，本 Kit 不碰產品資料。

## 相依與已知限制

- 消費 platform-core 的 `app.core.config.settings` 與 `app.core.database`（`get_db`、`Base`）。資料庫存取為非同步 AsyncSession（D-A5），平台須以 `expire_on_commit=False` 建立 session。
- 登入鎖定存在單一程序記憶體，只在單一 worker 部署有效。
- 權杖為無狀態 bearer token，沒有撤銷清單，到期即失效。
- 前端頁面尚未抽出（下一個工作包）。
- 本 Kit 尚未登錄到 `kits/form-analysis.kit-manifest.json` 與 `config/registry/`：兩者會被 Composer GUI 與其測試讀取，須在可執行 `npm.cmd test` 的環境登錄並驗證。暫以 `kit.definition.json` 保存單一 Kit 定義。

## 測試

```
PYTHONPATH=kits/entry-permission-kit/src/backend python -m unittest discover -s kits/entry-permission-kit/tests
```

以上只涵蓋不需資料庫與第三方套件的入口目錄與登入鎖定。驗證狀態：純函式有單元測試；資料庫與 HTTP 由 `tests/s2-kits-integration` 實跑（七個 Kit 組成一個 FastAPI 應用程式，SQLAlchemy 非同步 + 記憶體 SQLite）。尚未在 PostgreSQL 與基線 platform-core 上實跑。
