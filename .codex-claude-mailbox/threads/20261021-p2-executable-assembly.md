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
| A1 | 「所有已紀錄 Kit」= 13 個 Kit 中有可執行來源者共 9 個（D125 補上 station-data-link 後為 10 個，見 Claude Notes）。排除 4 個：`tenant-auth-kit`（D03 已廢除）、`station-admin-kit`（T2，基線任何位置都沒有 `routes_stations.py`）、`station-data-link-kit`（T3，缺 `routes_import.py`）、`entry-permission-kit`（僅契約，無 backend）。這 4 個列入系統包 manifest 的 `notIncluded` 並逐項寫原因，不虛構程式碼 | `docs/preview-todo.md` T2/T3、`kits/BASELINE.md`、預覽 README 納入清單 | 已更新：D125 後納入 10 個，排除 3 個（tenant-auth、station-admin、entry-permission） |
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

## WP1 第二次

2026-10-21，分支 `feature/p2-executable-assembly`。已完整重讀 thread（含第一次停止回報、WP2 調查、user 決議與前置處理）、spec 第 12 節及現有組裝／驗證程式。依最新派工採全量 10 Kits、最小 6 Kits；舊 tenant_api_keys／station-data-link 來源缺口已解除。本輪完成 WP1 的 Node 組裝核心與測試，Python 真實驗收仍待 Claude；不宣稱系統可啟動或可安裝。

### 變更摘要與檔案清單

- 新增 `services/package/assemble-system.mjs`：輸入 Recipe，重用 preview 的 inventory、衝突處理、policyData、adapt、pythonCheck，以及既有 `check_tree.py`；既有函式皆已 export，故完全沒有修改 `services/preview/assemble.mjs`。
- `systemSource` 先套用共用 adapt（保留 T10/T12 與錨點拒絕），再移除 adapt 新增的 require_access 呼叫與 preview_gate import。Kit 原有授權程式不改；拒絕來源本身已帶同名預覽依賴。完全不複製 preview/app，因此 main.py、gate、support、seed、registry 與假外部服務均不進輸出；不引用已刪除的 preview/app/models。
- 產出 `backend/app/`、`kits/<id>/{manifest,kit.contract}.json`、`config/system.recipe.json`、`aov/<id>/workflow.aov.json`、`permissions/endpoint_permissions.json`、`database/migrations/plan.json`、`validation/report.json` 及 `system-manifest.json`。重建 models/__init__.py 載入真正模型，包含 tenant_api_key 與 P1/P2/P3。
- 新 manifest 採獨立 `format: composer-system-assembly`、`schemaVersion: 1.0.0`、`installable: false`；不改舊 schema。列 recipeVersion、kitManifestVersion、Kit version／versionSource／sourceSha256、每個產物 path／sha256／bytes／role。Kit 版本沿用 catalog 規則：自有 version 優先，否則 overlay.version（現為 c4b2b7b-ui.1）；sourceSha256 額外識別合併後該 Kit 實際供應的原始後端來源，不把 catalog 標籤誤當新補檔的 git commit。
- `notIncluded` 固定列 entry-permission-kit（只有契約）、station-admin-kit（缺 routes_stations.py）、tenant-auth-kit（D03 廢除）及原因；`notSelected` 另列 Recipe 未選的可用 Kit。正式入口列 `formal entry file (WP3)` 於 `notProvided`，不生成替代 main.py。migration plan 明示未提供 executable migration，沒有假 migration 或 create_all；不執行資料庫操作。
- Manifest 不含時間戳或輸出絕對路徑，固定檔案排序；manifest 自身不能自我雜湊，待 WP3/WP4 簽章封裝涵蓋其 bytes。輸出必須是新目錄；後續檢查失敗清除本次新建目錄，既有目錄原封保留。
- 新增 `services/package/tests/package.test.mjs`（7 個測試）、`tests/index.js`（指定目錄指令入口）、`tests/mutations.mjs`（三項變異副本驗證），以及 `services/package/README.md`（介面、格式、範圍與驗證限制）。
- 除本節外未修改 thread 既有內容／狀態／index。沒有改 kits、schemas、libs、apps、docs、其他 preview 檔案、TODO.md 或設定。起始已存在的 TODO.md 修改保留。沒有 git add/commit、Docker、網路或新 npm 依賴。

### 驗證方式與實際結果（含失敗）

- `node --test services/package/tests`：最終退出碼 0，7/7 通過。全量 10 Kits 與最小 6 Kits（platform-core、generic-forms、audit-edit、station-data-link、upload-validation、import-pipeline）各組裝兩次，逐檔 bytes、checksum、manifest、目錄結構與來源未變更皆通過；驗證預覽字串／檔案排除、T12 數量、模型註冊、既有目錄拒絕、未知／排除／重複 Kit、可執行依賴缺失、驗證失敗清理與 optional imports 保留。
- 第一次同指令退出碼 1：Node 24 把目錄視為模組入口，無 index 時回報 Cannot find module services/package/tests。已在允許的 tests/ 內新增 index.js，後續相同指令通過；不是忽略該失敗或改用另一條驗收指令。
- `node --test services/preview/tests/preview.test.mjs`：退出碼 0，12/12 通過。現有測試的 Docker 呼叫使用 stub，未啟動 Docker。
- `npm.cmd run typecheck`：退出碼 0，現有兩份 tsconfig 通過。但 tsconfig.node.json include 只有 scripts 與既有 GUI security test，**不涵蓋新增 package 程式**。建議 Claude 後續把 `services/package/**/*.mjs` 與 `services/package/tests/index.js` 納入 include，屆時補足 checkJs 所需型別並實跑；本輪依限制未修改 config，也不宣稱新增 mjs 已通過 TypeScript 檢查。
- 所有 package 測試只在同步 run 邊界注入 stub，並斷言 Recipe 驗證器／check_tree.py 的參數、backend 根目錄與 shell:false，以及非零退出碼／spawn error 傳播。**check_tree.py、T13 真實 AST／外鍵閉包驗證、Python tests：by Claude，本輪完全未執行。** 模擬 foreign-key failure 只驗證錯誤處理，並非真實刪模型的 Python 變異。
- 輸出 validation/report.json 使用 `accepted-by-run-interface`，不把測試 stub 成功寫成 Python 實測通過；runtime／fieldVerification 明示 not-run。

### 變異驗證

`node services/package/tests/mutations.mjs`：退出碼 0。每項在 tests/ 下建立獨立實作與測試副本，使用同一套斷言，不改正式實作；結束清除副本。三個子程序皆退出碼 1，符合預期：

1. 移除 preview_gate import 排除：5 項失敗，組裝掃描發現 `backend/app/api/routes_generic_forms.py` 殘留預覽項目，全量／最小皆拒絕輸出。
2. 移除 db_capabilities.py 的 T12（改回原始內容）：3 項失敗，全量／最小的 to_regclass 數量斷言失敗，來源錨點拒絕斷言亦失敗。
3. 移除 manifest.notIncluded：2 項失敗，全量／最小 manifest 斷言皆失敗。

變異後再次執行正式 package 7/7、preview 12/12 及 typecheck 均通過，沒有留下變異或測試暫存樹。

### 未涵蓋與 Claude 交接

- 請 Claude 用可用 Python 對全量與最小案例跑正式 assembleSystem（不注入 run），以及既有 Python 靜態測試，確認真實語法／匯入／FK 閉包。Node 結果不取代這一步。
- 正式 main entry、router 掛載、啟動／授權整合、環境秘密值配置、可執行 migration、部署／簽章驗證屬 WP3；前端屬 WP2，合併 Workflow／手冊與下載屬 WP4，實機驗證屬 WP5。Kit 既有設定中的預設值未在此階段改寫，正式入口與環境設定仍需 WP3 審核。沒有把 preview 入口改名當正式入口。
- 目前 permissions 是原始宣告，AoV 是每 Kit 原始工作流程，不宣稱已完成正式權限驗證或最終交付 Workflow 合併。正式驗收前維持 installable:false。
- 本輪未觸發新的派工停止條件；沒有擴大實作到後續 WP。預計完成時間依派工為 2026-10-21 22:30，實際工作及測試結果如上，未以尚待 Claude 的 Python 驗證宣稱完整部署驗收。

## WP3a：2026-10-22 停止條件回報

### 變更摘要

已完整閱讀本 thread（含最後 user 決議與 WP3a 派工）、services/package/README.md、assemble-system.mjs、預覽 Dockerfile／Compose／reference 全部檔案，以及 spec 第 12 節與 D45。確認分支 feature/p2-executable-assembly。正式認證來源閉包缺失，依派工「若該機制無法在不改 Kit 的情況下組出可啟動系統，停止並回報，不自行設計身分驗證」停止，未實作部署產物，不宣稱 WP3a 完成。

具體證據：

- platform-core 的 app/core/config.py:151–192 提供 AUTH_MODE、API key header、ADMIN_API_KEYS 設定，但不是驗證實作。
- app/api/deps.py:29–58 讀取 request.state.auth_tenant_id；AUTH_MODE=api_key 且未綁定驗證租戶時回傳 401。搜尋所有 kits 的 Python 原始碼，沒有 hash_api_key 定義、api_key_auth_middleware 實作或 request.state.auth_tenant_id 賦值。
- services/preview/reference/baseline-main.py 的 api_key_auth_middleware 包含基線驗證流程，但直接 import app.core.auth.hash_api_key；kits/platform-core-kit/src/backend/app/core/ 下沒有 auth.py，其他 Kit 亦未提供此函式。即使抽取該 middleware，來源閉包仍不成立。tenant_api_key.py／tenant_user.py 是模型，不補足此缺口。
- 未以 AUTH_MODE=off、假驗證、改寫雜湊演算法或預覽閘門繞過缺口。需 Claude/user 先確認並補齊既有正式認證來源或調整派工；本輪不修改 Kit，也不自行設計認證。

### 檔案清單

只在本檔 Codex Notes 新增本 WP3a 小節，保留既有內容、frontmatter、Claude Notes 與 index。services/package/、services/preview/assemble.mjs 均未修改。開始時已有 TODO.md 修改，保留。未 git add/commit；未使用 Docker、網路或新 npm 依賴。

### 驗證方式與實際結果（含失敗項）

- npm.cmd run typecheck：退出碼 0；現有兩份 tsconfig 通過，不代表 Python 或新增部署產物已驗證。
- npm.cmd test：退出碼 1；Vitest 39 個檔案通過、1 個失敗；497 tests 通過、1 失敗、1 略過。security.test.mjs:128 的簽章 CLI 無法開啟暫存 signing-private-key.pem（EPERM），afterAll 在 :107 清理同一暫存目錄亦 EPERM。暫存位置為 C:/Users/gslab/AppData/Local/Temp/composer-security-rJQsa2；未宣稱清理成功。因命令以 && 串接，後續 preview Node 測試未執行。未修改越界測試或安全腳本以消除失敗。
- node --test services/package/tests：退出碼 0，既有 WP1 測試 7/7；使用 Python subprocess stub，不是正式 Python 驗證。
- node services/package/tests/mutations.mjs：退出碼 0；既有三個 WP1 變異子程序均退出碼 1：移除預覽排除使 5 項失敗、移除 T12 使 3 項失敗、移除 notIncluded 使 2 項失敗。這是既有測試可失敗的驗證，不是 WP3a mutation 成果。
- 初次 PowerShell 讀取中文為亂碼，已設定 UTF-8 分段完整重讀。上述認證缺口依原始碼與檔案清單核對，沒有執行 Python import 的實測結果。

### 未涵蓋

WP3a 的 deployment/、正式 main.py、環境秘密值檢查、首次建表步驟、manifest/notProvided 更新均未實作；因此全量／最小部署輸出、可重現性及 WP3a 三項變異（秘密值檢查、預覽排除、notProvided 更新）未驗證。Python 語法／匯入／FK／啟動檢查：由 Claude 執行（to be run by Claude）；Docker 實測亦由 Claude 執行。須先解除認證來源停止條件才能續作，未以預計 2026-10-22 17:00 完成時間宣稱達標。

## WP3a 第二次

### 變更摘要

依 2026-10-25 重派實作，分支為 `feature/p2-executable-assembly`。認證使用 entry-permission-kit；沒有新增 core/auth.py、機器金鑰驗證或匿名替代。全量 11 Kit 與最小 7 Kit 的 Node 組裝測試成功，部署產物與正式入口已產生；不宣稱 Python／Docker／正式授權實測完成，`installable` 仍為 false。

- 系統包自己的 inventory 排除表只排除 station-admin-kit、tenant-auth-kit；明確拒絕未選 entry-permission-kit。入口目錄由所選契約彙整，以既有 Ajv 2020/schema 驗證，另拒絕重複鍵、未知角色、audit 寫入預設與重複路由（參數名稱正規化後比較）。公開 webhook 只隨 mod-subscription-kit 加入。
- 正式 main.py 在路由匯入前檢查必要環境變數；依共享 prefixes／tenantFree 與檔名順序掛實際路由。舊端點 middleware 先註冊、入口 middleware 後註冊；machine_access_unavailable 固定回 401。healthz 檢查連線、全部已註冊模型資料表與預設租戶，缺初始化回 503，不建表。
- system_init.py 明確執行 create_all、建立缺少的預設租戶；以 PostgreSQL transaction advisory lock 序列化，既有租戶不更新。模型與 models/__init__.py 相同；管理員另用 Kit 的 create_admin stdin 命令。冪等性目前只做產物靜態檢查，實際重跑待 Claude。
- Compose 提供 PostgreSQL internal network、backend expose、loopback 預設 nginx port、非 root backend 與 init profile。秘密一律 `:?`，webhook 秘密只在選入該 Kit 時要求。映像固定 python:3.12.8-slim-bookworm、postgres:16.6-bookworm、nginx:1.28.0-bookworm；後者固定 1.28 stable release／Debian 家族，不宣稱已查最新安全狀態。容器包含 Kit 契約供既有 capability_index 讀取。
- requirements 為預覽固定版本加所選 Kit 根目錄 requirements.txt，去重、拒絕版本衝突與未固定版本。全部產物含 role／sha256／bytes，更新 notProvided；endpoint_permissions 非空時輸出交集警告。
- 核對發現 core/config.py 原本帶資料庫與 SECRET_KEY 範例預設。已在組裝副本以來源錨點移除這兩個 Field default，原 Kit／原設定驗證器不變；這可在授權範圍內完成，不需另設認證。entry-permission-kit 沒有 workflow.aov.json，依未提供產物的規則明列於 notProvided，不造假 AoV、不修改 Kit。

### 檔案清單

僅修改本 thread 的 Codex Notes 與以下 services/package/ 檔案：

- `assemble-system.mjs`、`deployment.mjs`、`README.md`
- `templates/main.py`、`templates/system_init.py`、`templates/docker-compose.yml`、`templates/backend.Dockerfile`、`templates/nginx.conf`、`templates/env.example`、`templates/README.md`
- `tests/package.test.mjs`、`tests/deployment.test.mjs`、`tests/mutations.mjs`、`tests/index.js`、`tests/entry-points.test.mjs`（最後一檔只補既有 names 的 JSDoc）

未改 kits、schema、preview、docs、libs、apps、scripts、TODO、MERGE-PLAN；未 git add/commit，未使用 Docker、網路或新增 npm 依賴。工作期間外部已有／出現的 MERGE-PLAN 與 docs/executable-plan-contract.md 狀態未干預；本 thread 其餘內容、frontmatter、Claude Notes 與 index 保留。

### 驗證方式與實際結果（含失敗與未執行項）

- `node --test services/package/tests`：最終 13/13 通過，退出碼 0。11／7 Kit 各組裝兩次，逐檔 bytes／manifest／checksum／role 一致；部署檔、入口目錄、實際路由與前綴、必要環境檢查、middleware 順序、init／healthz 靜態條件、requirements 完整集合及預覽／預設秘密掃描均有斷言。Recipe/check_tree subprocess 使用 stub，不能當成 Python 結果。
- 拒絕案例：沒選入口 Kit（另含只有 platform-core、沒有依賴檢查可代擋的案例）、重複入口鍵、未知角色、audit 寫入、重複路由、schema 錯誤；非空 endpoint_permissions 的警告與來源保留亦通過。選入 webhook 時，輸出 Compose 缺必填語法會讓測試失敗。
- `node --test services/preview/tests/preview.test.mjs`：14/14 通過，退出碼 0。
- `npm.cmd run typecheck`：退出碼 0。
- README 所列獨立 `--strict --checkJs`：services/package 全部受檢檔案 **0 診斷**；追蹤到未修改的 services/preview/assemble.mjs 有 **26 個既有診斷**，完整 tsc 仍非零（子程序 status 2；PowerShell 工具回報退出碼 1）。未以忽略錯誤或修改 preview 消除，不能宣稱整條指令通過。
- `git diff --check`：通過。
- 開發期間失敗已修正：PowerShell 管線中文編碼造成測試正則語法錯誤；新 Kit 無 workflow 導致 ENOENT；新 deployment 子目錄使舊測試的 DFS 順序與 manifest 全路徑排序不同；未隔離依賴檢查的 mutation 誤存活；擴充秘密掃描曾把 Python `= secret` 變數引用誤判為字串。最終測試均重新執行；沒有把這些初次失敗隱藏成一次全過。
- Python 語法／AST／import／FK／實際 Settings／Directory.load／啟動、缺變數、healthz、init 冪等、create_admin、HTTP 權限拒絕，以及 Docker Compose config/build/smoke：**to be run by Claude（由 Claude 執行）**，本輪未啟動 Python 或 Docker。

### 變異

`node services/package/tests/mutations.mjs`：最終退出碼 0，先跑正常基線通過，再逐一在暫存副本驗證以下 **9/9 killed**（變異子程序退出碼皆為 1，且指定測試失敗；SyntaxError／ERR_MODULE_NOT_FOUND 不算）：

1. 移除 SECRET_KEY Compose `:?`。
2. 移除 MOD_WEBHOOK_SECRET Compose `:?`。
3. 移除預覽 gate import 排除。
4. 移除 permissions/entry_points.json 彙整輸出。
5. 還原未更新的 formal entry／deployment notProvided。
6. 移除未選入口權限 Kit 的明確拒絕。
7. 移除 main.py 啟動秘密非空檢查。
8. 移除 T12。
9. 移除 notIncluded。

第 6 項初次存活：六 Kit 仍會因相依 entry-permission-kit 而拒絕，原本只比對 Kit 名稱的斷言掩蓋目標檢查消失。已加入無此依賴的 platform-core-only Recipe 並檢查明確拒絕原因；最終變異會真正讓此案例錯誤產出，測試因未拒絕而失敗。所有暫存變異／測試目錄於程序結束清除。

### 未涵蓋

前端、TLS、機器 API key、hash-locked requirements、可執行升級 migration、安裝引擎、簽章／授權整合、合併手冊、現場部署仍未提供。入口權限 Kit 的 AoV 缺件已明列；permissions volume 在首次部署由 image 初始化，升級不會自動刷新，README 明示後續升級流程須協調目錄與既有端點權限，不能刪 volume 當升級。未使用任何真實秘密。

交由 Claude 先執行全量／最小的真實 Python 組裝與 check_tree，再驗證缺變數拒啟動、未建表／缺租戶 503、init 重跑不改既有資料、admin stdin bootstrap、middleware 權限拒絕及 Compose 的隔離／健康檢查。Node 靜態斷言不足以證明上述執行行為。

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

## 2026-10-21 user 決議與前置處理（Claude，commit c500001、84a07cd、d5eeeef）

user 三項皆同意並核准前端依賴：

1. 補 `tenant_user.py`、`tenant_api_key.py` 進 `kits/platform-core-kit`（commit c500001）。
2. 補 `station-data-link-kit` 原始碼，並以基線真實 P1/P2/P3 模型取代 D107 自建模型（commit 84a07cd、d5eeeef）。
3. `station-admin-kit`、`entry-permission-kit` 維持排除。
4. 前端新增依賴核准：`react-i18next` 15.0.2、`i18next` 23.15.2、`i18next-browser-languagedetector` 8.0.0、`lucide-react` 0.460.0、`@vitejs/plugin-react` 4.4.1，另系統前端獨立 package/lock 採 `vite` 6.0.5、`typescript` 5.7.2、`@types/react` 18.3.12、`@types/react-dom` 18.3.1（以基線 `dist/generated-system/frontend` 的 package.json 與 lock 為準，不動 Composer 根目錄 lock）。

**驗證（Claude 實測）：** `kits/` 的檔案逐檔取自基線；預覽組裝 82 個 Python 模組閉包通過；Docker 全量映像煙霧 24/24（新增 `POST /api/import` 轉接器實測）、領域表回歸 2/2、選配閘門 13/13；Python 靜態 19 項、Node 12 項、`npm test` 498 通過 1 略過、typecheck 通過。

**與計畫的差異（規則 7、12）：**

- 最小可獨立集合：station-data-link 成為可用 Kit 後，Recipe 驗證器要求依賴閉包，由 D122 的 3 個變為 6 個（platform-core、generic-forms、audit-edit、station-data-link、upload-validation、import-pipeline），且沒有任何可選匯入缺口。WP1 的「最小案例」改用這 6 個。
- 基線行為記錄：`POST /api/import` 會匯入驗證工作的全部列，不剔除驗證器標為無效的列，未修改。
- 刪除了預覽的 5 個相容模型檔與 `tenant_api_keys` 空表（git 可還原）。
- 預覽 `app.models` 不再有預覽覆蓋層；WP1 輸出不得再引用 `services/preview/app/models/`。

WP1 的停止條件已解除，重新派工。

## 2026-10-22 WP1 驗收（Claude）

Codex 狀態以 `codex-companion status` 確認為 completed（5 分 19 秒，早於預計 22:30）。Codex 的自述逐項重新驗證如下，未照單全收：

- Node：`node --test services/package/tests` 7/7；`mutations.mjs` 三項變異皆被攔到；`preview.test.mjs` 12/12。
- **Codex 無法跑的真實 Python 驗證，由 Claude 補跑（使用 `services/preview/.test-venv`）：** 全量 10 Kit 與最小 6 Kit 以不注入 `run` 的正式 `assembleSystem` 組裝，Recipe 驗證器與 `check_tree.py`（語法、匯入、外鍵閉包）皆通過，退出碼 0。
- 全量輸出組裝兩次，`diff -r` 無差異（可重現）。輸出內以 `COMPOSER_PREVIEW|preview-local-only|preview_seed|preview_gate|preview_registry|_preview/mod` 掃描，零命中。manifest：10 個 Kit、113 個檔案、`notIncluded` 為 3 個 Kit 加原因、`installable: false`、`notProvided` 列出後續 WP。
- Python 靜態測試 19 項通過（預覽測試未受影響）。
- 型別：Codex 指出新檔未納入 typecheck。依 README 慣例（預覽 .mjs 以獨立 tsc 指令檢查，不在 `tsconfig.node.json`）補了 JSDoc 型別，新檔在 `--strict --checkJs` 下零錯誤；`services/preview/assemble.mjs` 在同設定下本來就有 28 行錯誤（對照 4978c10 版本），不屬本功能，未處理。補型別只加註解與型別轉換，未改行為，之後測試與變異再跑一次皆通過。

**已知限制：** `validation/report.json` 的 `recipeValidation`、`backendClosure` 寫 `accepted-by-run-interface`，即使真實執行 Python 也是同字串，無法區分實跑與 stub。WP4 產生正式報告時需改成可區分（列入 WP3/WP4 輸入）。權限檔與 AoV 是各 Kit 原始宣告，尚未合併。

WP1 完成。下一步 WP3（部署：正式入口、compose、反向代理、安裝腳本、簽章驗證）與前端 WP2b（依 WP2 調查實作，依賴已核准）。

## 2026-10-22 user 決議與 WP3 設計（Claude）

user 決議：

1. 走方案 A：Docker Compose 跑在客機 Ubuntu 22.04 LTS，客機可安裝 Docker（取代 D124 對「Docker 前提」的假設，A2 改為已確認）。
2. daihui_project 位於 `C:\Users\gslab\Desktop\daihui_project`（唯讀來源）。
3. 完成 `entry-permission-kit` 後替代 tenant-auth；另開 thread `20261022-entry-permission-kit`，不在本 thread 處理。

**未回答、暫作工作假設：** `docs/install-engine-contract.md` 是否升為正式決議。WP3 以該契約為設計依據（子命令、`plan.json`、輸入通道、事件與狀態、退出碼、還原語意），但把「apt 安裝 PostgreSQL、systemd、虛擬環境」改為「Docker Compose 容器」；契約本身仍標草稿，待 user 確認後才改狀態。

**WP3 拆分（Claude 規劃）：**

| WP | 內容 | 負責 | 驗收 |
|---|---|---|---|
| WP3a | 部署產物：正式後端入口（不含預覽）、後端 Dockerfile、`docker-compose.yml`（PostgreSQL 16 與後端只綁 127.0.0.1，反向代理容器對外）、反向代理設定、`.env.example`（只含 `secret_ref` 與欄位說明，無秘密值）、首次安裝的資料表建立步驟（明確執行，不是默默執行；不宣稱升級遷移）；由 `services/package/assemble-system.mjs` 產出到 `deployment/` 並納入 manifest | Codex | 靜態與單元測試；Docker 實測由 Claude |
| WP3b | 安裝引擎（Python 標準庫為主，POSIX sh 入口）：`detect`、`verify`、`plan`、`apply`、`status`、`cancel`、`rollback`，`plan.json` 綁定 `planSha256`，秘密值只走標準輸入或 0600 暫存檔，事件 JSON Lines，退出碼依契約第 6 節；安裝前驗證沿用 `scripts/security`（簽章、授權、sha256）的語意 | Codex | 單元測試（假 Docker 邊界）；實機由 Claude 在 192.168.200.63 驗證 |
| WP3c | 網頁精靈（契約第 7 節）。依賴先調查，不新增套件 | Codex | WP3b 之後再派 |

順序：WP3a、WP3b、WP3c；每個 WP 驗收後才派下一個。

### WP3a 派工

**預計完成時間：2026-10-22 17:00。** 到期未完成由 Claude 接手（先以 `codex-companion status` 確認狀態）。

**範圍（只可新增或修改）：** `services/package/` 內檔案（擴充組裝輸出 `deployment/`）、本 thread 的 Codex Notes。允許對 `services/preview/assemble.mjs` 只加 `export`。不得修改 `kits/`、`schemas/`、`libs/`、`apps/`、`docs/`、`scripts/`、預覽其他檔案、`TODO.md`。需要新 schema 時，把草案放 `services/package/` 並在 Notes 說明。

**成功條件：**

1. 全量與最小案例的輸出多出 `deployment/`：`docker-compose.yml`、後端 `Dockerfile`、反向代理設定、`.env.example`、`README.md`（只描述實際存在的行為）；全部列入 `system-manifest.json` 的 `files`，並從 `notProvided` 移除「formal entry file」與「deployment」中已完成的項目，其餘仍列出。
2. 正式後端入口 `backend/app/main.py`：路由由所選 Kit 的實際來源決定（參考 `services/preview/reference/backend_router_registry.py` 與 `baseline-main.py`），不含預覽閘門、預覽種子、預覽重置、假外部服務、`COMPOSER_PREVIEW`；啟動時不使用預覽固定密碼，資料庫位址與金鑰一律來自環境變數；未提供必要環境變數時啟動失敗並說明缺哪一項，不使用預設弱值。
3. 資料庫只在內部網路，不發布到宿主埠；後端只綁 127.0.0.1 或內部網路，對外只經反向代理（spec D45）；映像與套件版本固定，沿用預覽已驗證的組合（Python 3.12.8、PostgreSQL 16.6-bookworm）。
4. 首次安裝的資料表建立是獨立的、明確的一步（例如一個只執行一次的容器命令），其內容與模型集合一致；可執行升級遷移仍列入 `notProvided`。
5. 輸出可重現（相同輸入相同位元組），掃描預覽項目零命中；測試要能失敗：移除秘密值檢查、移除預覽排除、移除 `notProvided` 更新時對應測試失敗，並在 Notes 記錄變異。
6. 不使用 Docker、網路、新 npm 依賴；沙箱沒有 Python，Python 類檢查標「由 Claude 執行」。

**停止條件：** 需要修改 `kits/` 或既有 schema；Kit 的正式啟動必須依賴預覽項目；入口權限（entry-permission）尚無實作，所以認證只能沿用 `platform-core-kit` 現有 `AUTH_MODE`／API key 機制，若該機制無法在不改 Kit 的情況下組出可啟動系統，停止並回報，不自行設計身分驗證。

**回報格式：** 變更摘要、檔案清單、驗證方式與實際結果（含失敗項）、未涵蓋。

## 2026-10-22 WP3a 停止後的核對與順序調整（Claude）

Codex 在 WP3a 依停止條件停止（`codex-companion status`：completed，無檔案變更，只寫了 Notes）。停止理由成立並已核對：

- `platform-core-kit` 的 `api/deps.py` 在 `AUTH_MODE=api_key` 時要求 `request.state.auth_tenant_id`，沒有就回 401；但所有 `kits/` 都沒有設定它的程式（基線在 `main.py` 的 `api_key_auth_middleware`，且它 import `app.core.auth.hash_api_key`，`kits/` 沒有 `core/auth.py`）。預覽靠自己的入口與閘門繞過，正式系統包不能。
- 基線其實有 `core/auth.py`（`build/station-data-link-genericization/...`、`dist/client-deploy-gui-selected-form-system/...`），可作為「沿用 API key」替代方案的補檔來源，但需 user 核准；暫不補。
- 使用者認證在正式系統由 `entry-permission-kit`（D127）的中介層設定 `auth_tenant_id`、`actor_role`、`is_admin`，所以正式 `main.py` 依賴它。

**順序調整：** EP2（入口權限後端）→ EP4 的契約與 manifest（讓組裝器認得此 Kit）→ 重派 WP3a（Recipe 必須選入口權限 Kit，或明確採 API key 替代並補 `core/auth.py`）。EP2 與 WP3a 不共用檔案，但 WP3a 要等 EP2 才有可組裝的認證。

另：Codex 回報 `npm.cmd test` 在其沙箱有 1 個失敗（security.test.mjs 暫存私鑰 EPERM），屬沙箱檔案權限問題；Claude 環境實測 498 通過 1 略過，不是回歸。

## 2026-10-25 WP3a 重派（Claude）

前置條件已解除：認證來源是 `entry-permission-kit`（D127、D128，已有後端、契約、22 個入口宣告與覆蓋測試）。`services/preview/assemble.mjs` 的 `inventory(kits, selected, excludedKits)` 現在接受呼叫端的排除表（預設值仍是預覽的表，預覽行為不變），`excluded` 也已匯出，所以系統包可以自己決定排除 `station-admin-kit` 與 `tenant-auth-kit` 兩個，納入 `entry-permission-kit`（共 11 個可納入 Kit）。

**預計完成時間：2026-10-25 04:00。** 到期未完成由 Claude 接手（先以 `codex-companion status` 確認狀態）。

### 設計決定（Codex 不得自行更改；與此矛盾時停止回報）

1. **認證：** Recipe 必須選入 `entry-permission-kit`，否則組裝失敗並說明原因（API key 替代方案尚未提供，因為基線 `core/auth.py` 不在 `kits/`）。最小案例改為 7 個 Kit：platform-core、generic-forms、audit-edit、station-data-link、upload-validation、import-pipeline、entry-permission。全量案例為 11 個。
2. **入口目錄：** 組裝時從所選 Kit 的 `kit.contract.json` 的 `entryPoints` 彙整出 `permissions/entry_points.json`，格式為 `schemas/entry-points.schema.json`（可用專案已有的 Ajv 2020 驗證，不新增依賴）；入口鍵重複、角色名不在 `admin/manager/operator/audit`、寫入入口含 `audit`、路由重複被兩個入口宣告，任一者都拒絕組裝。`publicPaths`：永遠含 `/healthz`、`/api/auth/login`；只有在選入 `mod-subscription-kit` 時才加 `/api/mod/subscriptions/webhook`。
3. **MOD webhook 密鑰：** 選入 `mod-subscription-kit` 時，`deployment/docker-compose.yml` 必須用 `${MOD_WEBHOOK_SECRET:?...}` 讓缺少時 compose 直接失敗，後端 `main.py` 也要在啟動時檢查該環境變數存在且非空，缺少就啟動失敗並說明。未選入該 Kit 時不要求。
4. **`endpoint_permissions.json`：** 輸出 `permissions/endpoint_permissions.json`（來源是 platform-core 的檔案，預設 `{}`）。若非空，`validation/report.json` 以警告列出「舊端點權限層會與入口層取交集」。
5. **機器 API key：** 不提供。`configure_entry_permission` 要求 `machine_auth` 可呼叫；`main.py` 提供一個永遠回 401 的函式（名稱 `machine_access_unavailable`），並在 manifest `notProvided` 列出「machine API key authentication」。不得自行實作金鑰驗證或補 `core/auth.py`。
6. **中介層順序：** `endpoint_permission_middleware` 先註冊（內層），`entry_permission_middleware` 後註冊（外層）。參考已通過 48/48 的 `kits/entry-permission-kit/tests/e2e/e2e_main.py`。
7. **路由註冊：** 以 `services/preview/assemble.mjs` 匯出的 `prefixes` 為註冊前綴規則（含 `routes_ep_*`）；`main.py` 只掛所選 Kit 實際存在的路由檔；掛載順序固定（依檔名排序）。
8. **首次安裝建表：** 獨立、明確的一步，不在後端啟動時默默執行。提供 `backend/app/system_init.py`（`python -m app.system_init`）：建立全部資料表（`Base.metadata.create_all`，模型集合與 `models/__init__.py` 一致），並以環境變數 `DEFAULT_TENANT_ID`（必填）建立預設租戶（`tenants` 表，名稱／代碼來自 `SYSTEM_ID`），冪等，重複執行不報錯也不改資料。初始管理員仍由 `python -m app.entry_permission.create_admin` 建立（WP3b 的安裝引擎呼叫），不在此步驟。`manifest.notProvided` 列出「executable upgrade migrations」。
9. **後端啟動：** 若資料表不存在或預設租戶不存在，`/healthz` 回 503 並說明（不自動建表）。`/healthz` 檢查資料庫連線。缺少必要環境變數（`DATABASE_URL`、`ENTRY_PERMISSION_JWT_SECRET`、`DEFAULT_TENANT_ID`、`SECRET_KEY`，以及第 3 點）時啟動失敗，說明缺哪一項，不使用預設值。
10. **部署檔（`deployment/`）：** `docker-compose.yml`、`backend.Dockerfile`、反向代理設定、`.env.example`、`README.md`。
    - 映像固定：`python:3.12.8-slim-bookworm`、`postgres:16.6-bookworm`、反向代理使用固定標籤的 nginx（選一個穩定版本並寫入 README 說明為何）。
    - 資料庫只在 `internal: true` 網路，不發布到宿主埠；後端 `expose` 不發布；反向代理發布 `${PROXY_BIND:-127.0.0.1}:${HTTP_PORT:-8080}:80`（預設只綁本機；內網開放由安裝引擎設定，TLS 未提供，README 與 `notProvided` 都要寫）。
    - 秘密值一律 `${NAME:?必填說明}`，`.env.example` 只有欄位名稱與說明，沒有任何秘密值或看似真實的預設值。
    - 後端以非 root 使用者執行；healthcheck 打 `/healthz`；`init` 為一次性服務（profile `init`），依賴資料庫健康。
    - 反向代理只轉送 `/api/` 與 `/healthz`；`/` 回 503 純文字「前端尚未納入此套件版本」（前端由 WP2 另案），並列入 `notProvided`。
    - 依賴固定檔：`deployment/backend/requirements.txt`，內容為預覽 `requirements.txt` 加所選 Kit 的 `requirements.txt`（入口權限的 `PyJWT==2.15.1`、`bcrypt==5.0.0`），去除重複；未帶 `--hash`，`notProvided` 列出「hash-locked dependency file（建議 `--require-hashes`）」，原因見 P2 thread 2026-10-22 的雜湊查證。
11. **manifest：** 全部新檔案列入 `files`（含 role）；`notProvided` 移除已完成者（formal entry file、deployment 中已做的部分），其餘仍列出並新增本節提到的項目。
12. **可重現與排除掃描：** 沿用 WP1 規則。預覽項目掃描（`COMPOSER_PREVIEW`、預覽固定密碼、`preview_seed`、`preview_gate`、`preview_registry`、`_preview/mod` 等）零命中；另新增掃描：輸出不得含看似真實的預設秘密（例如 `change-me`、`password`、`secret` 作為值）。

### 範圍與限制

只可新增或修改：`services/package/` 內檔案、本 thread 的 Codex Notes（新增「WP3a 第二次」小節，不覆蓋前次）。不得修改 `kits/`、`schemas/`、`libs/`、`apps/`、`docs/`、`scripts/`、`services/preview/`、`TODO.md`。需要新 schema 時把草案放 `services/package/` 並在 Notes 說明。不 git add/commit；不使用 Docker、網路、新 npm 依賴；沙箱沒有可用 Python，Python 類檢查（`check_tree.py`、容器內啟動）標「由 Claude 執行」，不得宣稱通過。

### 成功條件

1. 全量（11）與最小（7）案例都能組裝，輸出含 `deployment/`、`permissions/entry_points.json`、`backend/app/main.py`、`backend/app/system_init.py`，且可重現（兩次輸出逐檔相同）。
2. 拒絕案例都有測試：沒選入口權限 Kit；入口鍵重複；寫入入口含 audit；webhook 在選入訂閱 Kit 但 compose 缺 `:?`（以掃描輸出驗證）。
3. 變異驗證（拿掉任一項測試必須失敗）：移除 `:?` 必填語法、移除預覽排除、移除入口彙整、移除 `notProvided` 更新、移除「沒選入口權限即拒絕」。記錄於 Notes。
4. `node --test services/package/tests` 與 `node --test services/preview/tests/preview.test.mjs` 全過；`npm.cmd run typecheck` 通過；新檔 JSDoc 型別在 `--strict --checkJs` 下零錯誤（指令見 P2 thread 2026-10-22 WP1 驗收）。

### 停止條件

需要修改 `kits/` 或既有 schema；入口權限 Kit 與所選 Kit 的實際介面與上述設計矛盾（例如 `configure_entry_permission` 簽章、`database.init_db` 行為）；任何一項設計決定無法在不自行設計認證的情況下實現。停止並在 Notes 回報，不自行決定。

### 回報格式

變更摘要、檔案清單、驗證方式與實際結果（含失敗與未執行項）、變異、未涵蓋。

## 2026-10-25 WP3a 第二次驗收（Claude）

`codex-companion status`：`task-mvmm7tjw-yrccvw` completed（11 分 37 秒）；工作樹確有新增與修改的檔案。Codex 自述逐項重新驗證：

- Node：`node --test services/package/tests` 全過（14 項）；`mutations.mjs` 5 項變異皆被攔到；預覽 Node 14 項；`npm run typecheck` 通過；新檔在 `--strict --checkJs` 下零錯誤。
- 真實 Python 檢查（Codex 無法執行）：全量 11 個 Kit 與最小 7 個 Kit 以不注入 `run` 的正式組裝，Recipe 驗證器與 `check_tree.py` 皆通過；全量輸出組裝兩次 `diff -r` 無差異；預覽項目掃描零命中。最小案例的入口目錄 17 個入口、公開路徑不含 webhook，且 compose 與 `main.py` 沒有 `MOD_WEBHOOK_SECRET`；全量案例 22 個入口、公開路徑含 webhook。
- **真實 Docker 部署驗證（Claude）：** 用組裝輸出的 `deployment/` 以 `docker compose` 建置並啟動（postgres 16.6、後端、nginx 1.28.0）。缺少必填秘密時 `compose config` 直接失敗；`init` 建立 38 張表與預設租戶，重複執行不報錯；資料庫沒有發布到宿主埠，只有反向代理發布 `127.0.0.1:18080`；建立初始管理員後，透過反向代理跑 `services/package/e2e/system_e2e.py`：**48/48 通過**，後端日誌 0 筆錯誤。涵蓋：登入與強制改密碼、固定租戶、22 個真實入口的拒絕與放行（operator／manager／audit／admin）、通用代理、未列入路由預設拒絕、MOD webhook 公開但仍需密鑰（無或錯誤密鑰 401、正確密鑰進入處理器）、覆寫雙向、唯讀角色不可被提權、機器金鑰一律 401、鎖定寫入資料庫並於到期後解除。

**驗證中發現並修正的缺口（Codex 漏掉）：** 第一次部署 E2E 通過 45/46 與 47/47 時，後端日誌出現 4 筆錯誤：`GET /api/logs/` 回 500，因為 `system_logs` 是 logs-ops 的純 DDL（沒有 ORM 模型），`create_all` 不會建立，預覽的 `main.py` 有另外執行 `monitoring._DDL_PG` 並啟動寫入器，系統包模板漏了。當時測試只斷言「不是 401／403」所以沒攔到，已改為斷言 200（日誌清單與摘要）。修正在 `services/package/templates/system_init.py`（建表）與 `main.py`（`init_monitoring(server_url="")`，遠端心跳關閉；`stop_heartbeat` 於關閉時呼叫），並新增 `deployment.test.mjs` 的測試（先紅後綠）。修正後重新建置全新堆疊，48/48 通過、日誌 0 錯誤。

**驗證流程中的陷阱：** `docker compose run --rm init` 不會重建已存在的快取映像，改模板後必須先 `--profile init build`；我第一次修正後就是因此看到舊行為（已記在 `services/package/e2e/README.md`）。

**未解決的間歇性失敗：** `node --test services/package/tests` 在約 16 次執行中有 2 次，`contract rejection cases and nonempty endpoint intersection warning` 失敗，其餘 14 次與單獨跑 12 次皆通過；沒有取得失敗當下的訊息，**原因未查明**（可能與 Windows 上複製整個 `kits/` 的暫存目錄有關，未證實）。不視為已穩定；後續若再發生，需要保留輸出調查。

**已知限制（延續 `notProvided`）：** 前端、TLS、機器 API key、帶雜湊的依賴鎖定檔、可執行升級遷移、registry／workflow／手冊、安裝引擎與精靈（WP3b、WP3c）、客機實機安裝驗證（WP5）。映像建置需要連網取得 PyPI 套件（本次建置成功，先前一次整份需求檔安裝出現的雜湊不符未再發生）。後端容器接了非內部的 `edge` 網路以便對外連線（MOD 服務），只有反向代理對宿主發布埠；`proxy` 只依賴 `backend` 啟動而非健康，若後端起得慢，nginx 啟動時可能解析不到主機（本次未發生），建議後續改為 `service_healthy`。
