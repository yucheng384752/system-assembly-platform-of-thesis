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
