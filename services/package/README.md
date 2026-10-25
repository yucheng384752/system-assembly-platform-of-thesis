# P2 系統包組裝（WP1 + WP3a）

組裝正式後端、入口目錄與部署檔。`installable: false`：安裝引擎、簽章／授權整合、前端與現場驗證尚未完成。

```text
node services/package/assemble-system.mjs <原本不存在的目錄> --recipe <recipe.json>
node --test services/package/tests
node services/package/tests/mutations.mjs
node --test services/preview/tests/preview.test.mjs
npm.cmd run typecheck
```

正式組裝會呼叫既有 Python Recipe 驗證器及 `check_tree.py`（語法、app 匯入、T13 外鍵閉包）。Node 測試以同步 `run` stub 取代 Python 子程序，不能視為 Python 通過。`validation/report.json` 保留 `accepted-by-run-interface`，runtime 與 fieldVerification 為 `not-run`。Python 與 Docker 檢查 **to be run by Claude**。

`assembleSystem(output, { recipe, kits?, run? })` 重用 preview 的 inventory、來源衝突規則、T10/T12 adapt、policyData 與 pythonCheck。只排除 station-admin-kit 和 tenant-auth-kit；必選 entry-permission-kit，不提供匿名或機器 API key 替代。全量為 11 Kit；最小為 platform-core、generic-forms、audit-edit、station-data-link、upload-validation、import-pipeline、entry-permission（皆加 `-kit`）。

| 輸出 | 內容 |
| --- | --- |
| `backend/app/` | 所選 Kit 來源與模型註冊；`main.py` 為正式接線；`system_init.py` 明確建表與建立預設租戶 |
| `permissions/entry_points.json` | 所選契約彙整，既有 Ajv 2020 schema 驗證；拒絕重複入口／路由、未知角色與 audit 寫入預設 |
| `permissions/endpoint_permissions.json` | platform-core 原始檔；非空時報告警告兩層權限取交集 |
| `deployment/` | Compose、backend.Dockerfile、nginx.conf、無秘密值的 .env.example、部署 README、backend/requirements.txt |
| `kits/`、`aov/`、`config/` | 原始契約／manifest、實際存在的 Kit workflow、Recipe |
| `database/migrations/plan.json` | 未提供可執行升級遷移；首次 create_all 不冒充 migration |
| `validation/report.json` | 驗證介面結果、optional imports、警告、排除掃描與未實測狀態 |
| `system-manifest.json` | 檔案 role／sha256／bytes、Kit 版本與來源 digest、notIncluded／notSelected／notProvided |

組裝副本會移除 adapt 加入的預覽閘門，以及 core/config.py 的 DATABASE_URL、SECRET_KEY 範例預設；後者以精確來源錨點確認再移除，保留 Kit 設定驗證器。所有 kits 原檔不變。正式入口先檢查必要環境變數，再載入路由；入口權限中介層在外、舊端點層在內。機器認證回 401。路由依實際檔名排序，採共享 prefixes 與 tenantFree 規則。

部署說明見 [模板 README](templates/README.md)。建表／預設租戶是明確的一次性 init；服務啟動不建表，healthz 檢查資料庫、模型資料表和租戶。PostgreSQL 僅 internal network，backend 僅 expose，nginx 預設 loopback。未提供 TLS、前端、hash-locked dependencies、升級遷移與機器 API key；皆列入 manifest。entry-permission-kit 尚無 workflow.aov.json，也明列缺件，不補造。

輸出固定排序且不含時間戳、輸出絕對路徑；11／7 Kit 各組裝兩次逐檔比較並核對 manifest。既有目錄不覆寫，寫出後驗證失敗會清除本次新目錄。Manifest 不雜湊自己，後續簽章封裝需涵蓋它。Python 套件版本來自 preview/requirements.txt 加所選 Kit 根目錄 requirements.txt，去重並拒絕衝突或未固定版本；使用已有 Ajv，不新增 npm 依賴。

變異工具先確認正常測試通過，再於專用暫存副本移除 Compose 必填語法、webhook 必填、預覽排除、入口彙整、notProvided 更新、必選入口權限、啟動秘密檢查、T12、notIncluded；每項必須讓指定測試失敗，語法／模組載入錯誤不算成功殺死變異。暫存副本最後清除。

獨立 JSDoc 檢查（根目錄 typecheck 不涵蓋本目錄）：

```text
node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck services/package/assemble-system.mjs services/package/deployment.mjs services/package/tests/index.js services/package/tests/mutations.mjs
```

此指令也追蹤到唯讀 preview/assemble.mjs 的既有型別診斷。需分別回報 package 診斷數與完整指令退出碼，不把完整指令稱為通過。
