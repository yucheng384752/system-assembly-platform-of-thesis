---
id: "20261021-p2-executable-assembly"
title: "P2 可執行組裝：產出可啟動的系統包（含後端、前端、安裝腳本），與設定交付包合併為單一壓縮檔"
status: "in_progress"
owner: "claude"
reviewer: "user"
priority: "high"
created_by: "claude"
created_at: "2026-10-21"
updated_at: "2026-10-21"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "docs/project-spec.md"
    type: "file"
  - path: "docs/decision-log.md"
    type: "file"
  - path: "services/preview/assemble.mjs"
    type: "file"
  - path: "services/package/"
    type: "directory"
---

# Goal

Composer 依 Recipe 產出一份可交付給 client 的壓縮檔，解壓後以安裝腳本啟動完整系統（後端、前端、資料庫遷移、授權驗證）。P2 完成後，現行的「設定交付包」與安裝包合併，client 最後只拿到一份壓縮檔（D21、D36、spec 第 12 節）。

分支 `feature/p2-executable-assembly`，由 main（4978c10）開出。

# User 已確認（2026-10-21）

1. 產出物是可啟動的系統包，由安裝精靈或腳本啟動。
2. 第一版涵蓋所有已紀錄的 Kit。
3. 包含前端。
4. P2 完成後合併：最後給 client 的只有一份壓縮檔。
5. 可派工給 Codex；所有修改須在本 thread 詳實記錄。

# Claude 的解讀與假設（需 user 確認，標為待確認者不得當成已決定）

| 編號 | 假設 | 依據 | 狀態 |
|---|---|---|---|
| A1 | 「所有已紀錄 Kit」= 13 個 Kit 中有可執行來源者共 9 個。排除 4 個：`tenant-auth-kit`（D03 已廢除）、`station-admin-kit`（T2，基線任何位置都沒有 `routes_stations.py`）、`station-data-link-kit`（T3，缺 `routes_import.py`）、`entry-permission-kit`（僅契約，無 backend）。這 4 個列入系統包 manifest 的 `notIncluded` 並逐項寫原因，不虛構程式碼 | `docs/preview-todo.md` T2/T3、`kits/BASELINE.md`、預覽 README 納入清單 | 待確認 |
| A2 | 安裝形式為命令列安裝腳本（`install.ps1`／`install.sh`，互動詢問必要參數），不做圖形安裝精靈。執行環境為 Docker Compose（預覽已驗證的 Dockerfile、PostgreSQL 16、固定版本），由反向代理容器提供前端並轉送 API；資料庫不發布到宿主埠 | 預覽已有可運作的容器組態；spec D45 要求後端只經反向代理、不直接對外 | 已確認（2026-10-21 user：Docker 可用） |
| A3 | 授權與簽章沿用既有 `scripts/security/*`（D37–D45）；系統包內含 `verify-package` 的等價檢查，安裝前必須通過 | spec 12.2 | 沿用 |
| A4 | 預覽專用項目不進系統包：`COMPOSER_PREVIEW=1`、固定預覽 DB 密碼、`preview_seed`、假外部服務、閘門的預覽模式。正式包的外部服務與秘密值一律走 `.env` 外部來源（`secret_ref`），不寫進包內 | CLAUDE.md 安全基準線 | 沿用 |
| A5 | T12 補丁（已登記且實體資料表存在）與 T13 外鍵閉包／可選匯入檢查，必須在系統包組裝帶入並有測試 | D122、D123 | 沿用 |
| A6 | 前端：Kit 的 `src/frontend` 是基線的 TSX 原始碼。建置前端需要 npm 依賴，依專案規則新增依賴須先經 user 核准，所以 WP2 先調查、不安裝 | CLAUDE.md | WP2 停止條件 |

# 規格衝突（規則 7，必須處理）

- spec 第 12 節與 D21、D32：目前「不附安裝腳本、不得稱為可安裝系統」。這是 P2 完成前的暫時限制（D21 寫明「可執行組裝完成前」）。處理方式：P2 實測通過前，GUI 與交付包文字維持現狀；通過後才更新 spec 第 12 節與 D21、D32 的文字，並新增決議。不在實作中途改文字，避免宣稱超前。
- `package-manifest.schema.json` 目前 `installable: false`。系統包需要新增 manifest 版本，不可直接改舊 schema 讓舊交付包失效（WP1 決定並記錄）。

# 工作包

| WP | 內容 | 負責 | 驗收 |
|---|---|---|---|
| WP1 | 系統包組裝核心：由 Recipe 與 `kits/` 產生 spec 12 節的目錄樹（`system-manifest.json`、`kits/`、`config/`、`database/migrations/`、`permissions/`、`aov/`、`validation/`、`backend/`），重用預覽組裝（含 T12、T13、檢查器），每個產物記錄 sha256；排除預覽專用項目（A4）；`notIncluded` 列出 4 個排除 Kit 與原因 | Codex | 見下方 WP1 派工 |
| WP2 | 前端：調查 Kit 前端建置需求（依賴、建置工具、與 Composer 前端的關係），只寫調查報告與依賴清單，等 user 核准後才實作建置與納入 | Codex（調查） | 報告寫入本 thread |
| WP3 | 部署：Dockerfile／compose／反向代理設定、`install.ps1`／`install.sh`、安裝前驗證（簽章、授權、checksum）、遷移與健康檢查 | Codex | 靜態檢查；實測由 Claude |
| WP4 | Composer 輸出頁：設定交付包與系統包合併為單一下載；manifest 與 schema；更新 spec 第 12 節與 D21、D32 | Codex／Claude | typecheck、測試、瀏覽器 |
| WP5 | 實測：Windows Docker 乾淨安裝、啟動、健康檢查、基本讀寫；授權失敗路徑；重複安裝；變異驗證 | Claude | 實測記錄 |

順序：WP1 → WP2（調查，可與 WP1 無檔案衝突時並行）→ 待 user 核准依賴 → WP3 → WP4 → WP5。每個 WP 完成後 Claude 驗收並 commit，才派下一個。

# WP1 派工

**預計完成時間：2026-10-21 22:30。** 到期未完成由 Claude 接手（先以 `codex-companion status` 確認狀態並取消仍在跑的任務）。

**範圍（只可修改或新增下列路徑，其他一律不碰）：**

- 新增 `services/package/`（`assemble-system.mjs`、`tests/`、`README.md`）。
- 若需共用預覽組裝的函式，只可在 `services/preview/assemble.mjs` 增加 `export`，不得改變既有行為；預覽的 Node 與 Python 測試必須維持通過。
- 在本 thread 的 Codex Notes 逐項記錄修改。
- 不得修改 `kits/`、`schemas/`、`libs/`、`apps/`、`docs/project-spec.md`、`docs/decision-log.md`（由 Claude 處理）。若需要新 schema，寫草案放在 `services/package/` 並在 Notes 說明，等 Claude 決定。

**成功條件：**

1. 輸入一份 Recipe（含 9 個可執行 Kit 的全量案例與 platform-core 加 generic-forms 的最小案例），輸出到一個必須原本不存在的新目錄，產出 spec 12 節目錄樹。
2. 輸出可重現：相同輸入、相同位元組（固定排序、無時間戳）。
3. `system-manifest.json` 列出每個檔案的 path、sha256、bytes、role，並記錄契約版本、Kit 實際版本、`notIncluded`（4 個排除 Kit 與原因）。
4. 組裝檢查沿用預覽的 `check_tree.py`（含 T13）；輸出內不得出現 `COMPOSER_PREVIEW`、預覽固定密碼、`preview_seed`、假外部服務（以測試掃描）。
5. T12 補丁在輸出內存在，錨點不符即拒絕組裝。
6. 測試要能失敗：拿掉任一項（排除預覽項目、T12 補丁、`notIncluded`）時對應測試必須失敗，並在 Notes 記錄做過的變異。
7. 不使用 Docker、網路、npm 新依賴；Node 內建模組即可。

**停止條件（規則 12）：** 遇到下列任一情況停止並在 Notes 回報，不自行決定：需要修改 `kits/` 或 `schemas/`；預覽組裝無法在不改行為下重用；某個 Kit 的正式（非預覽）啟動必須依賴被排除的預覽項目。

**回報格式：** 變更摘要、檔案清單、驗證方式與實際結果（含失敗項）、未涵蓋項目。

# Codex Notes

## 2026-10-21 WP1：停止條件回報，未完成實作

- 已完整閱讀本 thread、spec 第 12 節、預覽組裝及檢查器；依 WP1「某個 Kit 的正式（非預覽）啟動必須依賴被排除的預覽項目」停止實作。未自行把預覽相容空表升格為正式資料模型。
- 具體依賴：`upload-validation-kit` 的 `upload_job.py:72,89`、`pdf_upload.py:56`、`pdf_conversion_job.py:116`，`audit-edit-kit` 的 `models/core/audit_event.py:30`，以及 `import-pipeline-kit` 的 `import_job.py:66,80`，均有 `ForeignKey("tenant_api_keys.id")`。搜尋 kits 的 Python 來源沒有找到此表的實作；platform-core 的 models/__init__.py 仍引用缺失的 core.tenant_api_key。
- 現行組裝唯一補足來源為 `services/preview/app/preview_support.py:22` 的單欄空表。該檔明示 preview-only、待正式 identity 核准後替換；同檔 require_preview 綁定 COMPOSER_PREVIEW、固定 DB 密碼與假 MOD 服務。`services/preview/README.md:81` 也明示此表不代表驗證模型或授權有效。直接複製違反 A4；移除空表則依 check_tree.py 的 T13 規則產生缺失外鍵目標。抽出並正式採用該相容表需要明確決策，不能靠改名自行視為已解決。

### 變更摘要與檔案清單

- 只更新本 thread 的 Codex Notes；沒有新增 services/package，也沒有修改 services/preview/assemble.mjs。
- 未修改 kits、schemas、libs、apps、規格、決議或 TODO；開始時即存在的 TODO.md 修改保留。未寫入 .git、未 add/commit，未使用 Docker、網路或安裝依賴。
- 暫存診斷樹建立於 services/preview/.wp1-stop-*，finally 已清除；既有測試建立的暫存樹亦由測試清除。未更改 thread 狀態與 mailbox index（依本次路徑限制）。

### 驗證方式與實際結果（含失敗）

- `node --test services/preview/tests/preview.test.mjs`：退出碼 0，12/12 通過（含既有 T12、來源錨點拒絕與預覽組裝回歸）。測試中的 Docker 呼叫是 stub，未執行 Docker。
- `npm.cmd run typecheck`：退出碼 0，兩份 tsconfig 檢查通過。
- `python -B -m unittest discover -s services/preview/tests -p test_static.py`：退出碼 1，Python 尚未啟動，WindowsApps/python.exe 回報「指定的登入工作階段不存在。可能已被終止」。不是 Python 測試斷言失敗，不宣稱通過。
- `node --test services/package/tests`：退出碼 1，Could not find services/package/tests；觸及停止條件後未建立套件實作或測試，不宣稱 WP1 驗收通過。
- 診斷腳本以現有 assemble 建立全量暫存副本，原計畫先跑 check_tree.py，再刪去副本中 tenant_api_keys 的 Table 宣告重跑：第一次 Python 呼叫即失敗 `spawnSync python UNKNOWN`，退出碼 1；因此未到達刪除宣告的變異步驟，也沒有取得 T13 動態失敗結果。此處結論依據來源與檢查器規則，並非已成功執行的變異測試。
- 環境探查：python、python3、py 均解析至 WindowsApps alias，未找到 Local/Programs/Python 安裝可供替代。本輪不安裝新 runtime。
- 初次 PowerShell Get-Content 使用預設編碼導致中文顯示亂碼，已改 UTF-8 重新完整讀取；兩次探查不存在的 preview/app/models/preview_support.py、subscription.py 回報路徑不存在，後續以實際檔案清單定位 preview/app/preview_support.py。這些讀取未修改檔案。

### 變異與未涵蓋

- 本輪沒有完成任何 WP1 變異；T12／預覽排除／notIncluded 的移除變異均未執行。既有 Node 測試中的錨點錯誤案例通過，但不等同新系統包的變異驗證。
- 尚未實作或驗證系統包目錄樹、manifest 契約／版本／checksum、全量與最小 Recipe、輸出可重現、排除掃描與正式啟動；WP2–WP5 未執行。Python 靜態回歸亦受環境阻擋。
- 待 user／Claude 決定：tenant_api_keys 的正式來源與資料契約，或是否明確核准將預覽空表相容層轉為正式組裝支援；若需修改 kits/schema，需另行調整派工範圍。取得決策前 WP1 維持停止，不宣稱達成 22:30 完成目標。

## WP2 前端調查

2026-10-21，已核對分支 `feature/p2-executable-assembly`。已完整閱讀本 thread 與 Claude Notes；station-data-link 的後端來源應依 Claude 後續核對，不沿用 A1「無來源」的舊假設。本輪只寫調查，不實作。

路徑縮寫：`B/` = 唯讀基線 `C:/Users/gslab/Documents/New project/form-system-kit-composer/`；`D/` = `B/dist/generated-system/frontend/`；`G/` = `B/build/station-data-link-genericization/assembled-generic/frontend/`。以下路徑均可依此還原。

### 1. Kit 前端現況與完整檔案清單

以下清單相對於本專案根目錄，來自實際列舉。各 frontend 均沒有 package.json、lockfile、Vite 或 tsconfig。station-admin-kit 與 upload-validation-kit 都只有 CSS；entry-permission-kit、import-pipeline-kit、mod-subscription-kit、station-data-link-kit 沒有 frontend 檔案。其他具有 TSX 原始碼，platform-core 另有 TS 共用服務。

```text
kits/analytics-kit/src/frontend/src/pages/AnalyticsPage.tsx
kits/analytics-kit/src/frontend/src/styles/analytics-page.css
kits/audit-edit-kit/src/frontend/src/components/EditRecordModal.tsx
kits/audit-edit-kit/src/frontend/src/pages/EditReasonsPage.tsx
kits/generic-forms-kit/src/frontend/src/App.tsx
kits/generic-forms-kit/src/frontend/src/pages/DataflowPage.tsx
kits/generic-forms-kit/src/frontend/src/pages/FormsPage.tsx
kits/logs-ops-kit/src/frontend/src/pages/DeveloperLogsPage.tsx
kits/platform-core-kit/src/frontend/src/components/common/Modal.tsx
kits/platform-core-kit/src/frontend/src/components/common/ProgressBar.tsx
kits/platform-core-kit/src/frontend/src/components/common/ToastContainer.tsx
kits/platform-core-kit/src/frontend/src/components/common/ToastContext.tsx
kits/platform-core-kit/src/frontend/src/components/SimpleLogViewer.tsx
kits/platform-core-kit/src/frontend/src/components/ui/alert-dialog.tsx
kits/platform-core-kit/src/frontend/src/components/ui/button.tsx
kits/platform-core-kit/src/frontend/src/components/ui/input.tsx
kits/platform-core-kit/src/frontend/src/components/ui/progress.tsx
kits/platform-core-kit/src/frontend/src/components/ui/table.tsx
kits/platform-core-kit/src/frontend/src/services/kitClient.ts
kits/platform-core-kit/src/frontend/src/styles/app.css
kits/platform-core-kit/src/frontend/src/styles/figma.css
kits/platform-core-kit/src/frontend/src/styles/globals.css
kits/query-traceability-kit/src/frontend/src/pages/QueryPage.tsx
kits/query-traceability-kit/src/frontend/src/styles/query-page.css
kits/query-traceability-kit/src/frontend/src/styles/traceability-flow.css
kits/station-admin-kit/src/frontend/src/styles/admin-page.css
kits/station-admin-kit/src/frontend/src/styles/manager-page.css
kits/tenant-auth-kit/src/frontend/src/pages/ManagerPage.tsx
kits/tenant-auth-kit/src/frontend/src/pages/RegisterPage.tsx
kits/tenant-auth-kit/src/frontend/src/styles/manager-page.css
kits/tenant-auth-kit/src/frontend/src/styles/register-page.css
kits/upload-validation-kit/src/frontend/src/styles/upload-page.css
```

匯入關係（證據均為上列檔案 import）：

- 不是各 Kit 作為 npm 套件互相匯入，而是預期覆蓋合併為同一 frontend/src，相對路徑才會成立。
- generic-forms 的 App.tsx 固定匯入 UploadPage、QueryPage、RegisterPage、AdminPage、ManagerPage、AnalyticsPage、FormsPage、DataflowPage、DeveloperLogsPage、EditReasonsPage。其中 UploadPage/AdminPage 不在 kits；其他頁面分屬 query、tenant-auth、analytics、generic、logs、audit。App 同時匯入 core 的 ToastContainer/app.css，及缺失的 services/adminAuth、a11y。
- FormsPage 執行期匯入 audit-edit 的 EditRecordModal；後者反向以 import type 引用 FormsPage 的 FieldDef/RecordRow。不能任意單獨納入其中一個 Kit。
- audit-edit 兩個 TSX 與 tenant-auth 兩個頁面使用 core 的 ToastContext；core ToastContainer 匯入同目錄 ToastContext。EditReasonsPage 使用 manager-page.css；station-admin 與 tenant-auth 提供同名不同內容 CSS，存在覆蓋衝突。
- AnalyticsPage、FormsPage、DataflowPage、EditRecordModal、EditReasonsPage 使用 kits 缺失的 services/auth 與 tenant；DeveloperLogsPage、ManagerPage 使用 auth；RegisterPage 另用 tenant、tenantMap、adminAuth。core 的 kitClient.ts 也匯入缺失的 ./api，因此 core 不是獨立閉包。
- QueryPage 靜態匯入 React、react-i18next 與 query-page.css，沒有直接匯入 core 元件。tenant-auth 已廢除，保留副本不代表可恢復選用（kits/BASELINE.md）。

### 2. 基線完整來源及建置方式

| 位置（相對 B） | 實際現況 |
|---|---|
| build/station-data-link-genericization/assembled-generic/frontend | 83 檔；有 package.json、package-lock.json、index.html、vite.config.ts、tsconfig.json/app/node 三份設定；build 為 vite build |
| dist/generated-system/frontend | 90 檔，包括 3 個 dist 產物；上述設定齊全；build 為 vite build |
| dist/client-deploy-gui-selected-form-system/system/frontend | 與上一列 90 個檔案集合及位元組完全相同 |
| generated/mvp-import-flow/form-analysis-server/frontend | 45 檔，只有 src；無 package.json、lockfile、index.html、Vite、tsconfig，不能獨立 npm ci/build |
| dist/client-deploy-mvp-import-flow/system/frontend | 44 檔；有 package.json，但無 lockfile、index.html、Vite、tsconfig；宣告 build=tsc -b && vite build，設定不齊；plugin-react 為 4.3.3，其餘直接依賴版本同下表 |
| dist/form-system-generated-package/generated/mvp-import-flow/form-analysis-server/frontend | 45 檔，同樣沒有上述建置設定 |
| dist/form-system-generated-package/templates/frontend | 只有 package-lock.json，不是完整來源 |

另有 dist/**/kits/*/src/frontend 的 Kit 片段，不等同外層 system/frontend。數量排除 node_modules/.git，列舉涵蓋 ignored/hidden 內容。

依檔案完整度，兩份 D 系統前端並列最完整；建議以 D 的 87 個非 dist 檔案作為來源候選，不採舊 bundle。這是來源建議，不是已可交付或已驗證啟動的結論。

G 與兩份 D 的 package.json、package-lock.json、vite.config.ts、三份 tsconfig 逐位元組相同：

- scripts：dev=「vite」、build=「vite build」、preview=「vite preview」。build 沒有執行 tsc，既有 dist 不證明型別檢查通過。
- Vite 使用 @vitejs/plugin-react；server.proxy 的 /api 指向 VITE_PROXY_TARGET 或 http://localhost:8000；build.outDir=dist，沒有指定 base。此 proxy 僅為開發設定。
- tsconfig.json references app/node。app include src、target ES2020、lib ES2020/DOM/DOM.Iterable、module ESNext、moduleResolution bundler、jsx react-jsx、strict/noEmit/isolatedModules；node include vite.config.ts、target ES2022、lib ES2023，亦 strict/noEmit。兩者 tsBuildInfoFile 在 node_modules/.tmp；未宣告 resolveJsonModule，package 也未直接宣告 @types/node。獨立 typecheck 結果未知，不能自行認定通過或增補依賴。
- D/src/main.tsx 建立 React root、包 ToastProvider、載入 i18n/index.css/styles/figma.css，安裝 fetchWrapper 並初始化 a11y；只複製 Kit 片段缺這些入口與共用服務。

G 相對 D 缺 src/components/EditRecordModal.tsx、src/pages/FormsPage.tsx、DataflowPage.tsx、EditReasonsPage.tsx（後兩者同 pages）。六個共同檔在排除 CRLF/LF 差異後仍不同：src/App.tsx、src/pages/AnalyticsPage.tsx、src/pages/QueryPage.tsx、src/pages/upload/uploadFileAddWorkflow.ts、uploadFileUtils.ts、useUploadApi.ts（後兩者同 upload）。沒有證據判定哪份業務行為較新，不混搭猜測。

本專案 Kit 前端對照 D，統一換行後只有 tenant-auth-kit 的 styles/manager-page.css 不同，其餘全部一致；D 的 manager CSS 與 station-admin 版本一致。G 的 App 只有 upload/query/analysis/register/manager/admin/logs 七個 tab；D 加 forms/dataflows/editReasons。

Kit 聯集合併後，仍缺 D 以下檔案（相對 D，排除既有 dist 產物）：

```text
index.html
package.json
package-lock.json
src/components/admin/AnalyticsMappingManager.tsx
src/components/admin/StationLinkManager.tsx
src/components/admin/StationManager.tsx
src/components/admin/ValidationRuleManager.tsx
src/components/CSVEditor.tsx
src/components/FileUpload.tsx
src/hooks/useUpload.ts
src/i18n.ts
src/index.css
src/locales/en/common.json
src/locales/zh-TW/common.json
src/main.tsx
src/pages/AdminPage.tsx
src/pages/upload/BatchActionBar.tsx
src/pages/upload/BatchImportConfirmModal.tsx
src/pages/upload/FileDropArea.tsx
src/pages/upload/uploadApiClient.ts
src/pages/upload/uploadAsyncUtils.ts
src/pages/upload/uploadBatchOrchestrator.ts
src/pages/upload/uploadCsvEditToastUtils.ts
src/pages/upload/uploadCsvEditUtils.ts
src/pages/upload/uploadCsvEditWorkflow.ts
src/pages/upload/UploadedFileCard.tsx
src/pages/upload/uploadEligibility.ts
src/pages/upload/uploadFileAddToastUtils.ts
src/pages/upload/uploadFileAddUtils.ts
src/pages/upload/uploadFileAddWorkflow.ts
src/pages/upload/uploadFileUtils.ts
src/pages/upload/uploadImportCleanupUtils.ts
src/pages/upload/uploadImportToastUtils.ts
src/pages/upload/uploadPdfConversionOrchestrator.ts
src/pages/upload/uploadPdfConvertToastUtils.ts
src/pages/upload/uploadProgress.ts
src/pages/upload/uploadTypes.ts
src/pages/upload/uploadValidationErrorUtils.ts
src/pages/upload/uploadValidationOrchestrator.ts
src/pages/upload/uploadValidationToastUtils.ts
src/pages/upload/useUploadApi.ts
src/pages/upload/useUploadWorkflow.ts
src/pages/UploadPage.tsx
src/services/a11y.ts
src/services/adminAuth.ts
src/services/api.ts
src/services/auth.ts
src/services/fetchWrapper.ts
src/services/tenant.ts
src/services/tenantMap.ts
src/types/api.ts
src/vite-env.d.ts
tsconfig.app.json
tsconfig.json
tsconfig.node.json
vite.config.ts
```

D/App（實際為 D/src/App.tsx）與 kits/generic-forms-kit/src/frontend/src/App.tsx 統一換行後相同：靜態匯入所有頁面，useState 預設 register，以條件運算子掛載，不用 React Router。manager 角色控制 manager/editReasons/dataflows；adminUnlocked 控制 admin；兩者任一可見 logs。最後 fallback 是 DeveloperLogsPage。只隱藏 tab 仍保留 import，刪掉未選 Kit 檔案會破壞建置；畫面控制不是後端授權驗證。

### 3. 建置所需 npm 直接依賴（供核准，不安裝）

基線版本經 D/package.json 與 D/package-lock.json 對照一致；本專案版本以根 package-lock.json 核對。已有不同版本不代表相容，也不建議因此降級 Composer。

| 名稱 | 基線版本 | 本專案 lock | 用途與檔案證據 |
|---|---|---|---|
| react | 18.3.1 | 已有同版 | 各 TSX 的元件與 hooks |
| react-dom | 18.3.1 | 已有同版 | D/src/main.tsx createRoot |
| react-i18next | 15.0.2 | 新增，未存在 | App/QueryPage useTranslation、D/src/i18n.ts |
| i18next | 23.15.2 | 新增，未存在 | D/src/i18n.ts 翻譯引擎 |
| i18next-browser-languagedetector | 8.0.0 | 新增，未存在 | D/src/i18n.ts 語言偵測 |
| lucide-react | 0.460.0 | 新增，未存在 | D/src/components/CSVEditor.tsx 圖示 |
| @vitejs/plugin-react | 4.4.1 | 新增，未存在 | D/vite.config.ts 的 react() |
| vite | 6.0.5 | 已有 7.3.6，不同版 | D/package.json 與 vite.config.ts 的建置工具 |
| typescript | 5.7.2 | 已有 5.9.3，不同版 | TS 工具；D 的 build 未執行 tsc |
| @types/react | 18.3.12 | 已有 18.3.18，不同版 | React TSX 型別 |
| @types/react-dom | 18.3.1 | 已有 18.3.5，不同版 | React DOM 型別 |

前六項為 dependencies，後五項為 devDependencies。這是完整直接依賴清單；傳遞依賴由經核准的獨立 D/package-lock.json 固定，不手動逐項安裝。TypeScript AST 檢查 D/src 的靜態 import/export，外部套件僅前六項；沒有 React Router、Axios、Tailwind 或 Radix 的靜態套件匯入，不能由 ui 檔名推定需安裝 Radix。本專案 Ajv、@xyflow/react、Vitest 不在 D 的直接依賴（兩邊 package.json）。

需核准五個新增套件，以及獨立系統前端採用四個不同於 Composer lock 的基線版本；根 lock 不能直接替代 D 的 npm ci 輸入。本專案 @types/node 已有 22.20.4，但 D 未直接宣告；是否需補列以支援獨立型別檢查尚未判定，不自行新增。未使用網路，不提供版本安全性或升級相容性結論。

### 4. 建議納入方式、風險與停止點

以下為提案，尚未實作：

1. 核准後將 D 的入口、共用來源及建置設定納入版本控制，再按 Recipe 組合 Kit，不讓交付建置依賴開發者本機 B 絕對路徑。缺失來源應歸屬哪個 Kit 需另定，不直接修改 kits。依據：上述缺檔清單、kits/BASELINE.md。
2. 系統 frontend 採獨立 package/lock，避免干擾 Composer Vite 7。Docker builder 先複製 package/lock，再 npm ci（包含 devDependencies）、複製來源、npm run build；最終反向代理容器僅提供 frontend/dist，將 API 轉送內部後端，符合本 thread A2/A4。Node／代理映像精確版本及離線安裝資產未決定，不猜測。本輪未執行這些指令。
3. 組裝時依已選 Kit 產生明確 import、tab 描述與掛載清單，決定有效預設頁與 fallback；缺檔或依賴不足即拒絕組裝。不能只隱藏分頁或改用任意動態 import 字串。FormsPage→EditRecordModal 執行期依賴、反向型別依賴與 manager CSS 衝突仍須解決（第 1 節檔案）。
4. tenant-auth 已廢除，但 D 的 register/manager 與 App 權限狀態仍依賴它；entry-permission 沒有前端來源。替代入口／身分流程無法從目前檔案決定，不恢復廢除 Kit、不宣稱已有授權（kits/BASELINE.md、App、本 thread Claude Notes）。
5. 正式 API 位址不能只套開發 proxy：D/src/services/api.ts:21 的空 VITE_API_URL 會 fallback 至 localhost:8000；services/tenant.ts 空值則採同源。照搬可能使 client 瀏覽器打到 client 本機，正式同源策略待處理。services/auth.ts 讀 VITE_API_KEY，禁止把秘密注入靜態 bundle（CLAUDE.md、thread A4）。
6. D 的 AdminPage、components/admin/StationManager 等存在，不代表後端可用；Claude Notes 已核對 routes_stations.py 缺失。station-data-link 後端來源可補，但需另案對齊，不能把 A1 舊假設當定案。
7. 本專案 vite.config.ts root 為 apps/composer-gui；tsconfig.json include apps/libs，不含 kits。現有 build/typecheck 不能代替系統前端驗證。核准後需驗證全量／最小 Recipe、排除 Kit 的來源閉包、獨立型別檢查與 build、API／身分流程及後端契約；UI 實作遵守 DESIGN.md，本輪未做視覺合規驗收。

無法判定處已記錄並停止於調查：正式身分入口、跨 Kit 依賴拆分與 CSS 衝突政策、六個 G/D 差異檔的業務版本取捨、獨立型別檢查結果與正式映像版本皆未定。來源候選較完整不等於可直接交付。不猜測、不安裝、不繼續實作；新增依賴須依 CLAUDE.md 取得 user 核准。

### 5. 修改與驗證紀錄

只在本 thread 的 Codex Notes 新增本節，不改既有 WP1、Claude Notes、frontmatter 或 index。起始 TODO.md 已修改，保留原狀。

唯讀檢查包含檔案列舉、設定／匯入閱讀、Node 位元組與換行正規化比較、現有 TypeScript AST 靜態 import/export 解析、package/lock 版本核對。D/src 靜態相對匯入均找到對應檔案；不涵蓋動態載入、API 執行或型別正確性。早期 regex 誤把一般字串當 import，已以 AST 修正核對。初次 Get-Content 編碼亂碼已以 UTF-8 重讀；一次 Node 診斷與一次報告組裝指令有語法錯誤，修正後重跑，失敗指令未寫檔。

未執行 npm install/npm ci、build、typecheck、測試、Docker、伺服器或網路操作；未修改其他檔案，未 git add/commit。既有 dist 僅證明產物存在，不是本輪驗證結果。

# Claude Notes

- 2026-10-21 18:40 建立分支與本計畫，派 WP1。WP2 的調查等 WP1 結束後再派，避免兩個任務同時寫本 thread。

## 2026-10-21 WP1 停止後的核對（Claude）

Codex 在 2 分鐘內依停止條件停止，未寫任何程式；完成通知只代表轉發結束，實際狀態以 codex-companion 為準（completed，摘要「WP1 尚未實作」）。停止理由成立，且核對基線後發現比 Codex 回報更大的事實：

| 發現 | 證據（基線 `C:UsersgslabDocumentsNew projectorm-system-kit-composer`，唯讀） | 影響 |
|---|---|---|
| `tenant_api_keys` 的正式模型存在 | `generated/mvp-import-flow/.../app/models/core/tenant_api_key.py`（含 `tenant_user.py`、`tenant.py`、`schema_registry.py`） | WP1 阻擋可解：把真實模型補進 `kits/platform-core-kit`（比照 D104 補齊共用基底），取代預覽的單欄空表。僅是資料表，不含身分驗證實作；`tenant_users` 一併需要 |
| P1/P2/P3 模型在基線存在 | `generated/.../app/models/{p1_record,p2_record,p2_item_v2,p3_record,p3_item_v2}.py` | **與 preview-todo T1 的前提矛盾**：T1 寫「基線任何 .py 都沒有這些模組」，D107 因此自建相容模型。需要審視 D107；系統包應使用基線真實模型 |
| `routes_import.py`（station-data-link 的 p123 相容轉接器）存在 | `generated/.../app/api/routes_import.py`（1674 行）；`build/station-data-link-genericization/assembled-legacy` 另有 `record.py`、`p3_item.py`、`p2_item.py` | T3 的「無來源」前提不成立，可補。依賴 `services/{csv_field_mapper,production_date_extractor,product_id_generator,generic_validator}.py`、`utils/normalization.py`，generated 樹有這些檔 |
| `routes_stations.py`（station-admin）不存在 | 全基線搜尋無此檔；`main.py` 仍 import `routes_stations` 與 `app.core.seed_stations` | T2 無法回收。可行的只有依契約（`GET /api/stations`）與 `models/station.py`（138 行）重新實作，屬新增功能，非補上來源 |
| `entry-permission-kit` 本來就無後端 | 基線 kits 目錄沒有此 Kit，是 D03 的新 Kit | 需要新設計，不是補檔 |

結論：除廢除者外的 3 個 Kit，**station-data-link 可補上來源（T3）；station-admin 只能重新實作；entry-permission 只能新設計**。另外 T1 的前提錯誤使 D107 的自建模型可由真實模型取代。以上補檔會修改 `kits/`，需 user 決定（見回報）。

環境：Codex 沙箱內 `python` 是 WindowsApps 別名無法執行；Claude 的 shell 有 Python 3.13，Python 檢查與 Docker 驗證由 Claude 執行。
