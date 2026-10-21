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
| A2 | 安裝形式為命令列安裝腳本（`install.ps1`／`install.sh`，互動詢問必要參數），不做圖形安裝精靈。執行環境為 Docker Compose（預覽已驗證的 Dockerfile、PostgreSQL 16、固定版本），由反向代理容器提供前端並轉送 API；資料庫不發布到宿主埠 | 預覽已有可運作的容器組態；spec D45 要求後端只經反向代理、不直接對外 | 待確認：client 現場是否允許 Docker |
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

（待 Codex 填寫）

# Claude Notes

- 2026-10-21 18:40 建立分支與本計畫，派 WP1。WP2 的調查等 WP1 結束後再派，避免兩個任務同時寫本 thread。
