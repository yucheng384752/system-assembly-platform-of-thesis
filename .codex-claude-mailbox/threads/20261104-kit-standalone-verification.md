---
id: "20261104-kit-standalone-verification"
title: "Kit 獨立執行性驗證：必要 Kit 加任一選配 Kit，組出系統包並在 VM 安裝與操作"
status: "in_progress"
owner: "claude"
reviewer: "user"
priority: "high"
created_by: "claude"
created_at: "2026-11-04"
updated_at: "2026-11-04"
role_priority:
  implementation: "claude"
  review: "user"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "services/package/e2e/kit-matrix/"
    type: "directory"
---

# 目的

user 要求：Kit 手冊要一個個實測後再寫，並順便驗證 Kit 的可獨立執行性。「獨立執行」的定義（user 2026-11-04）：必要 Kit 加任一選配 Kit，要能組出系統包，並在 VM 上可安裝、可操作。本文件是第一輪的測試結果，手冊內容尚未撰寫。

# 方法

- 組合：必要 Kit（platform-core、entry-permission、station-data-link、upload-validation，加必選流程 data-import 帶入的 import-pipeline）加一個選配 Kit。選配共 9 個，station-admin-kit 被組裝器排除（無正式來源），另 8 個各一組。
- 每組：本機真實組裝（真實 Python 檢查，非 Node 替身）、前端建置、在 Ubuntu 22.04 VM（Docker 29.1.3、Compose 5.6.0）建離線映像、以測試根金鑰簽章、安裝引擎 `verify`、`issue-license`（綁這台機器的硬體）、`plan`、`apply`（11 步與健康檢查）、操作驗證、還原與清理。
- 操作驗證：通用冒煙（healthz、前端首頁、授權有效且硬體相符、無憑證 401、強制改密碼、登入、後端容器內列出的所有不帶路徑參數的 GET 路由皆不得 5xx）加功能操作（建使用者與角色權限、表單與欄位、CSV 預覽與匯入、編輯加原因、刪除、資料流連結，以及各選配 Kit 自己的路由）。factory-core 另跑既有 `factory_e2e.py`（寫入、重啟、驗證）。
- 工具：`services/package/e2e/kit-matrix/`。授權與金鑰皆為測試用，非正式根金鑰。

# 結果

| 組合 | 組裝 | 前端 | 映像 | 安裝 | 通用冒煙 | 功能操作 | 後端 5xx |
|---|---|---|---|---|---|---|---|
| 只選必要 Kit | 失敗 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 |
| 必要 + generic-forms + audit-edit（基底） | 通過 | 通過 | 通過 | 33 秒 | 24/24 | 31/32 | 0 |
| 基底 + query-traceability | 通過 | 通過 | 通過 | 103 秒 | 24/24 | 36/37 | 0 |
| 基底 + analytics | 通過 | 通過 | 通過 | 32 秒 | 27/27 | 38/39 | 0 |
| 基底 + logs-ops | 通過 | 通過 | 通過 | 130 秒 | 26/26 | 35/36 | 0 |
| 基底 + mod-subscription | 通過 | 通過 | 通過 | 36 秒 | 24/24 | 36/37 | 0 |
| 基底 + factory-core | 通過 | 通過 | 通過 | 169 秒 | 23/23 | 31/32，另 e2e 49/49 與重啟後 8/8 | 0 |
| 基底 + station-admin | 依設計排除 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 |
| 基底 + analytical-four（main） | 失敗 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 |
| 基底 + analytical-four（`feature/analytical-four-verification` 519aff0） | 通過 | 通過 | 未執行 | 未執行 | 未執行 | 未執行 | 未執行 |

功能操作每組唯一的失敗都是發現 3（稽核事件權限），其餘全過。

# 發現

1. **只選必要 Kit 組不出系統包。** `upload-validation-kit`（必要）的上傳頁需要 `generic-forms-kit`（D152），`generic-forms-kit` 的通用表格頁又需要 `audit-edit-kit` 的編輯視窗。兩條相依沒有宣告在 Kit 目錄的 `dependencies`，只在前端組裝時報錯（訊息：「前端無法在沒有 generic-forms-kit 時納入」）。使用者在 Composer 只選必要流程，到產出系統包才會被擋。待 user 決定：把這兩條相依宣告進 Kit 目錄（建議），或把必要集合改成包含它們。
2. **安裝引擎解壓的檔案權限取決於呼叫者的 umask。** `package.py` 以 `open(target, 'xb')` 建檔，不指定權限。在 `umask 077` 下 apply，`system-manifest.json` 變成 0600 root，以 uid 10001 執行的後端讀不到，授權閘門報 `manifest-missing`，`health-check` 步驟逾時失敗並自動還原該步驟。預設 umask 022 下 11 步全過。建議引擎明確設定解壓檔案權限，或在手冊註明；本輪未修改引擎。
3. **稽核角色可見的入口與端點實作不一致。** `permissions/entry_points.json` 的 `audit.events_read` 宣告 admin、manager、audit 可讀，但 `routes_audit_events.py` 內部寫死 `system-admin only`（基線版 2026-08-21 的使用者決定），audit 與 manager 角色一律 403。兩層權限取交集，所以實際只有管理員可讀。需決定以哪一邊為準。
4. **`analytical-four-kit` 在 main 上組裝失敗。** `check_tree.py` 不認得套件重新匯出的名稱（例如 `app.analytical_four.engine.data_manager.CSVDataManager`）。`feature/analytical-four-verification`（尚未合併）已修，我用該提交在獨立的 detached worktree 組裝與建前端皆通過。
5. **analytical-four-kit 無法在目前的 VM 驗證安裝。** 該分支回報映像 2.5 GB；VM 根目錄只剩約 5.3 GB（其中 snap 4.4 GB、系統日誌 1.7 GB 非本測試產生），建置、存檔、打包、安裝時載入與解壓的峰值超過可用空間，不冒險執行。需要擴充 VM 磁碟，或 user 同意清理上述項目。
6. **查詢頁面對不存在的批號回 200 與空結果，不是 404。** query-traceability 的 `/lot` 與 `/trace` 皆如此；非錯誤，但畫面需要自行顯示「查無資料」。
7. **匯入預覽遇到只有標頭或無法解析成列的檔案，回 `total 0` 且沒有訊息。** 真正的二進位檔會回 422。
8. **既有 `factory_e2e.py` 讀 `DATABASE_URL` 環境變數，正式系統已改為秘密檔。** 不帶變數執行時有 6 項資料庫守衛檢查因 KeyError 而失敗（腳本問題，非 Kit 缺陷）；驅動腳本改為從容器內 `/run/secrets/database_url` 讀出後傳入，6 項隨即全過。

# 已驗證的修正（本輪順帶）

- 通用表單的匯入預覽只列可匯入的新列（先前連重複列一起列），型別錯誤訊息改用「整數、數值、是否、日期」。系統中實測：3 筆含 1 筆錯誤的 CSV 預覽為 2 筆可匯入 1 筆錯誤，訊息含「整數」不含 integer；與既有資料重複的列只計入重複數、不出現在預覽表。

# 未涵蓋

- 瀏覽器介面：前端 bundle 已建置且首頁可由代理提供，但沒有在瀏覽器逐頁操作；上一輪（D152）只走過登入、上傳頁、查詢頁。
- 非管理員角色的完整授權矩陣：只驗了操作員、稽核對表單、分析、日誌、編輯的拒絕與放行。
- 多個選配 Kit 同時選取的組合，與 `merge-delivery` 併入手冊後的整包。
- 長時間運作、備份還原、升級。
- analytical-four-kit 的安裝與操作（見發現 5）。station-admin-kit 沒有正式來源，無法驗證。
- `wizard` 網頁精靈。

# 環境與清理

- VM：192.168.200.63，每組測完以測試專用腳本移除容器、資料卷、`/opt`、`/etc`、`/var/lib` 下該系統的目錄與映像；`~/kv`（Node 22.23.3、測試金鑰、腳本）留著供下一輪。
- 使用者先前為實機驗證加的臨時 sudoers（`/etc/sudoers.d/wp5-test`）仍在，測試結束後應移除。
- 驗證用 worktree：`composer-refactor-kitverify-wt`（本分支 `verify/kit-standalone`）、`composer-refactor-a4-wt`（detached，僅用於組裝 analytical-four 的另一分支，不寫入）。
