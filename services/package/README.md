# WP1 系統包組裝核心

這是 P2 的目錄樹與 manifest 階段，`installable: false`。不代表可以啟動或部署。

```text
node services/package/assemble-system.mjs <原本不存在的目錄> --recipe <recipe.json>
node --test services/package/tests
node services/package/tests/mutations.mjs
```

組裝使用 Node 內建模組。正式組裝呼叫既有 Python Recipe 驗證器與 `check_tree.py`（語法、匯入及 T13 外鍵閉包），需具備預覽驗證器原有的 Python/jsonschema 環境；不安裝依賴。`assembleSystem(output, { recipe, kits?, run? })` 的 `run` 為同步 subprocess 介面，測試注入 stub，不啟動 Python、Docker 或網路。

輸出包含：

| 路徑 | 內容 |
| --- | --- |
| `system-manifest.json` | 獨立格式 `composer-system-assembly` 1.0.0，未變更既有 schema |
| `backend/app/` | 選取 Kit 的後端、T10/T12 修正、真實模型註冊 |
| `kits/<id>/` | 原始 contract 與 manifest |
| `config/system.recipe.json` | 輸入 Recipe |
| `aov/<id>/workflow.aov.json` | 所選 Kit 的原始工作流程，尚未合併交付 Workflow |
| `permissions/endpoint_permissions.json` | 原始權限宣告，不表示已完成正式授權 |
| `database/migrations/plan.json` | 明示尚未提供 executable migration，不執行資料庫操作 |
| `validation/report.json` | 驗證介面結果、optional imports、排除掃描；實機驗證標為未執行 |

重用 preview 的 inventory、來源衝突規則、adapt、policyData、pythonCheck 與檢查器。`adapt` 產生的預覽閘門呼叫及 import 會移除；不更動 Kit 原有授權程式。預覽 app 層完全不複製。正式入口以 `formal entry file (WP3)` 列入 `notProvided`，沒有假的 main.py；前端、部署、正式 migration、授權及啟動整合留待後續 WP。

`notIncluded` 固定解釋 tenant-auth-kit（已廢除）、station-admin-kit（缺來源）、entry-permission-kit（只有契約）。`notSelected` 另外列出有來源但 Recipe 未選取的 Kit。可執行依賴必須選齊；無實作的依賴仍明示排除，不能宣稱認證已完成。

版本沿用 Composer catalog：Kit 自有 version 優先，否則採 `config/kits/overlay.json` 的版本，並記錄來源。`sourceSha256` 是該 Kit 在合併後實際供應之後端來源清單的 digest，包含路徑與原始檔案 digest；最終每個產物另有 path/sha256/bytes/role。Manifest 本身不能包含自己的 checksum，留待後續簽章封裝涵蓋。無時間戳、輸出絕對路徑；固定排序，同輸入產生相同 bytes。失敗會清除本次新建目錄，既有目錄不覆寫。

全量測試含 10 Kits；最小集合為 platform-core、generic-forms、audit-edit、station-data-link、upload-validation、import-pipeline（皆帶 `-kit`）。測試涵蓋輸出位元組、checksum、T12、排除掃描、真實模型、來源保留及驗證失敗。變異工具在 tests 暫存副本分別移除預覽排除、T12、notIncluded，確認原測試失敗並清除副本。

Python 檢查與 Python 測試：**by Claude**。Node stub 的成功只表示呼叫契約通過，不能當成 AST／外鍵驗證結果。`validation/report.json` 因此記錄 `accepted-by-run-interface`，不宣稱 Python 或正式啟動實測。現有根目錄 typecheck 尚不涵蓋本目錄；納入建議見交接 Notes。
