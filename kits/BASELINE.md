# 基線版 Kit 副本

本目錄的 Kit 原樣複製自基線版 Form System Kit Composer，作為重構與論文對照的起點。

- 來源：`C:\Users\gslab\Documents\New project\form-system-kit-composer\kits`
- 基線 commit：`c4b2b7b`（2026-09-21），複製時來源目錄無未提交變更
- 複製日期：2026-09-30；153 個檔案，未修改內容

使用注意：

- `tenant-auth-kit` 依決策 D03 廢除，由 `entry-permission-kit` 取代；副本保留供對照，不應再被新 Recipe 選用。
- 這些原始碼目前不在本專案的 typecheck 與測試範圍（`tsconfig.json` 只含 `apps`、`libs`），GUI 仍使用 `apps/composer-gui/src/fixtures.ts` 的 mock Kit。
- 修改副本前先確認是否要同步回基線版；論文比較時以上述 commit 為基線版本。

## 已修改的副本檔案

- `platform-core-kit/src/backend/app/core/license.py`（2026-10-01，D37–D41）：移除 TPM EK 指紋與 challenge-response；授權 payload 升為 schemaVersion 2.0，必須以 `fingerprintSource`（Windows MachineGuid／Linux `/etc/machine-id`）綁定機器；公鑰改為組裝時填入的佔位值，未填入即拒絕所有授權。基線版行為以 commit `c4b2b7b` 為準。
- 新增 `platform-core-kit/tests/test_license.py` 與 `requirements-test.txt`（pytest 9.1.1、cryptography 50.0.2，D43）。執行方式：`python -m venv .venv`，`.venv\Scripts\python -m pip install -r kits/platform-core-kit/requirements-test.txt`，再 `npm.cmd run test:kits`。
- 2026-10-28（D142）：`license.py` 改為授權 3.0 驗證（憑證鏈、manifest 雜湊綁定，執行期沿用既有釘選的 cryptography）；`tests/test_license.py` 改寫為 3.0 測試（unittest 風格，pytest 與 `python -m unittest` 皆可執行），舊的 `linux_smoke.py`（2.0 格式、無 pip 主機用）已移除。

## 補齊的後端原始碼（2026-10-06，D90）

基線版 `kits/` 目錄中，下列 Kit 只有契約與前端 CSS，後端原始碼只存在於組裝輸出。依 `assembly/backend-registry/backend_router_registry.py` 的路由對應，自 `dist/generated-system/backend/app`（基線 commit `c4b2b7b`）原樣複製，不改內容。

- `upload-validation-kit/src/backend/app/`：`api/routes_upload.py`、`api/routes_validate.py`、`services/validation.py`、`services/pdf_conversion.py`、`models/{upload_job,upload_error,pdf_upload,pdf_conversion_job}.py`、`schemas/{upload,validate,pdf_conversion}.py`
- `import-pipeline-kit/src/backend/app/`：`api/routes_import_v2.py`、`services/import_v2.py`、`models/import_job.py`、`schemas/import_job.py`
- 未複製的外部依賴：`app.core.*`、`app.config.constants`、`services/csv_field_mapper.py`、`utils/normalization.py`、`models/record`（組裝輸出中也不存在）
- 補不齊：`station-admin-kit` 的 `routes_stations.py` 在基線版任何位置都不存在；`station-data-link-kit` 的 `routes_import.py` 不在組裝輸出。兩者維持無原始碼，不上架為工具

## 共用後端基底補齊（2026-10-19，D104）

為了讓全部相容 Kit 的後端能一起啟動，自基線版組裝輸出 `dist/generated-system/backend/app` 逐檔原樣複製 15 個共用檔案進 `platform-core-kit/src/backend/app/`（清單見 `docs/preview-todo.md` 第 1 節）。不修改內容。補不齊的項目（`app.models.p1_record` 等 5 個模型、`routes_stations.py`、`routes_import.py` 等）列在 `docs/preview-todo.md` 第 2 節，必須完成或明確標示不可用。

## 身分資料表與 station-data-link 來源補齊（2026-10-21，D125）

user 於 2026-10-21 核准，自基線版逐檔原樣複製（內容未修改，`cmp` 與來源一致）。基線路徑相對 `C:\Users\gslab\Documents\New project\form-system-kit-composer`。

- `platform-core-kit/src/backend/app/models/core/tenant_user.py`、`tenant_api_key.py`：來自 `generated/mvp-import-flow/form-analysis-server/backend/app/models/core/`（與 `build/station-data-link-genericization/assembled-legacy` 版本位元組相同）。只是資料表模型；不含身分驗證實作，不代表授權已涵蓋。補齊原因：`audit_event`、`upload_job`、`pdf_upload`、`pdf_conversion_job`、`import_job` 皆有 `ForeignKey("tenant_api_keys.id")`，`platform-core-kit` 的 `models/__init__.py` 也已引用這兩個模組。
- `station-data-link-kit/src/backend/app/`（P1/P2/P3 相容轉接器，推翻 preview-todo T3「無來源」的前提）：
  - 來自 `generated/.../app/`：`api/routes_import.py`、`models/{p1_record,p2_record,p2_item_v2,p3_record,p3_item_v2,base_record}.py`、`services/production_date_extractor.py`。
  - 來自 `build/station-data-link-genericization/assembled-legacy/backend/app/`：`models/{record,p2_item,p3_item}.py`、`schemas/import_data.py`（`dist/generated-system` 版本相同）。
- 仍補不齊：`station-admin-kit` 的 `routes_stations.py`（基線任何位置都不存在）；`entry-permission-kit` 無基線後端。兩者維持排除。
