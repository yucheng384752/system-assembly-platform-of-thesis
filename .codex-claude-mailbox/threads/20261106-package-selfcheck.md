---
id: "20261106-package-selfcheck"
title: "安裝包自檢：產生安裝包前通過所有 Kit 測試，現場驗證環境與一致性，並補齊缺少測試的 Kit 與新增 Kit 規範"
status: "done"
owner: "claude"
reviewer: "user"
priority: "high"
created_by: "claude"
created_at: "2026-11-06"
updated_at: "2026-11-06"
role_priority:
  implementation: "claude"
  review: "user"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "services/package/bundle-images.mjs"
    type: "file"
  - path: "docs/kit-authoring.md"
    type: "file"
---

# 目的

user 2026-11-06 的決定：
1. 兩層都要做：發布前測試閘門，以及現場的環境與一致性自檢。
2. 產生安裝包前必須通過所有測試；現場只驗證環境與一致性（不重跑單元測試）。
3. 沒有測試的 Kit 要補上測試，並撰寫「添加新 Kit」規範。

# 設計

**第一層：發布前測試閘門。** 放在 `bundle-images.mjs`：後端映像建置之後、簽章之前。理由：Kit 的鎖定相依含 torch、chromadb 等，在開發機重建不可靠；映像（Python 3.12.8 與鎖定套件）才是正式環境。
- Dockerfile 範本改為多階段：`deps`（安裝鎖定相依）、`selftest`（加 pytest，不進正式映像）、`runtime`（最後一階段，內容與原本相同）。
- 對每個選入的 Kit 各開一次容器跑 `kits/<kit>/tests`（各 Kit 的 `app` 套件同名，必須分程序），再跑「總測試」（對合併後的後端執行環境與一致性檢查的靜態部分）。
- 任何一項失敗即中止，不產出映像封存與簽章；錯誤訊息指出 Kit 與失敗的測試。
- 結果寫進 manifest 的 `selftest` 欄位（隨 manifest 簽章）：每個 Kit 的測試檔雜湊、來源雜湊、測試數、結果。
- 安裝引擎 `verify` 拒絕沒有 `selftest` 或結果非通過的安裝包。

**第二層：現場環境與一致性自檢。** `backend/app/selfcheck.py`，同一份程式碼在第一層也會被執行。
- 套件完整性：`/system/backend` 檔案雜湊對照 manifest。
- 每個 Kit：契約宣告的路由確實存在於應用程式；所有非公開路由都被某個入口點涵蓋；Kit 消費的能力由已選入的 Kit 提供。
- 環境：資料庫可連線且資料表齊全、秘密檔存在且非空、授權狀態（沿用既有守門）。
- 結果寫入 `/system/data/selfcheck.json`；失敗時守門層對所有請求回 503 並列出 Kit 與原因，`/healthz` 同樣回 503，安裝引擎的健康檢查把原因帶進錯誤訊息並還原。
- Kit 可選擇提供自己的檢查（規範見 `docs/kit-authoring.md`）。

**補測試與規範。** 缺少測試的 Kit 逐一補上不依賴資料庫與網路的測試；`docs/kit-authoring.md` 說明新增 Kit 的目錄、契約、測試、手冊、自檢、overlay 登錄與驗收；一個測試確保每個選入系統的 Kit 都有測試，否則閘門失敗。

# 進度與結果

| 階段 | 內容 | 結果 |
|---|---|---|
| S1 | `bundle-images` 在映像建置後、簽章前，於映像內逐 Kit 跑測試（pytest 裝進暫存目錄，不進出貨映像；Kit 目錄、config、套件目錄唯讀掛入；以 `/system/backend` 為匯入根） | 完成；沒有測試或失敗即中止，訊息指名 Kit |
| S2 | 補缺少測試的 8 個 Kit，另有系統層測試（守衛、授權守門、自檢） | 完成；各 Kit 通過（audit-edit 24、entry-permission 36、import-pipeline 29、analytics 29、query-traceability 11、mod-subscription 17、upload-validation 47、station-data-link 39、factory-core 31、analytical-four 135、platform-core 16、generic-forms 5、logs-ops 2、系統層 67）；做過 9 個變異檢查，8 個抓到，1 個是多餘的重複防護（等價變異） |
| S3 | manifest 的 `selftest`（每個 Kit 的測試數、測試檔雜湊、來源雜湊）與安裝引擎 `verify` 檢查；組裝時檔案清單記下每個後端檔案屬於哪個 Kit | 完成；缺證明、狀態非通過、Kit 沒證明、證明與原始碼不符都被拒（碼 11），訊息指名 Kit |
| S4 | 現場自檢（`selfcheck.py`）：套件完整性、契約、相依、入口權限目錄、路由、資料庫；失敗時守門回 503 並指名 Kit，`/healthz` 同；30 秒重檢；安裝引擎在啟動失敗時讀自檢結果帶進錯誤訊息 | 完成 |
| S5 | `docs/kit-authoring.md`、`kit-tests-required.test.mjs`（新 Kit 沒有測試即失敗，已驗證會失敗）、安裝維運手冊補一節 | 完成 |

## 實機驗證（VM，Ubuntu 22.04）

- 正向：base 組合走完整流程：閘門通過、簽章、引擎驗包（含測試證明）、安裝 36 秒、自檢通過（`/system/data/selfcheck.json` 為 passed）、冒煙 24/24、功能 35/35、後端 5xx 為 0。manifest 的 `selftest` 含 7 個 Kit 加系統層，83 個檔案帶 Kit 歸屬。
- 閘門反向：實際擋下過缺測試的 Kit（audit-edit、import-pipeline、station-data-link、upload-validation）、跨 Kit 匯入失敗的 entry-permission，以及系統層測試互相干擾；訊息都指名。
- 現場自檢反向（端對端）：故意讓 upload-validation-kit 契約宣告不存在的路由（單元測試抓不到）。發布流程通過，安裝在啟動步驟失敗並還原，訊息為「現場自檢未通過，系統不啟動：upload-validation-kit：入口「upload.read」宣告的 GET /api/upload/ghost 在系統中不存在」。契約已還原。

## 自檢找到並修正的既有問題

1. `db.tenants.read` 被 generic-forms、mod-subscription、station-data-link、upload-validation 需要，tenant-auth-kit 廢除後沒有 Kit 提供。改由 platform-core-kit 契約提供。
2. entry-permission-kit 的角色管理路由沒有入口宣告（實際只有內建管理員能用）。契約新增 `adminRoutes` 明列。
3. audit-edit-kit 的編輯端點沒有接住 `CoerceError`，編輯時填入非數字會回 500。改回 422（新測試抓到）。

## 未涵蓋與限制

- 發布閘門需要 Docker 與網路（pytest 安裝在測試容器），所以屬發布步驟，不在組裝（`assemble-system`）內；`bundle-images` 之前沒有測試證明。
- 測試證明綁定的是各 Kit 的來源雜湊與測試檔雜湊；閘門掛載的是執行發布那台機器上的倉庫，沒有驗證那份倉庫與組裝時的是同一份（來源雜湊不符會被安裝引擎拒絕，但只涵蓋進入組裝的來源檔）。
- 現場自檢不跑單元測試（依 user 決定）。
- 自檢的資料庫檢查只看資料表是否存在與預設租戶，不比對欄位。
- station-admin-kit 與 tenant-auth-kit 被組裝排除，不要求測試。
- 本機（Windows）執行 `services/installer/tests/test_engine.py` 有 2 個既有的環境失敗（檔案權限位元與 CPU 架構判斷），在 VM 上通過；與本功能無關。
- 另外在 full 組合偶發過一次「刪除紀錄」504，無法重現，仍待觀察（見 20261104 thread）。

## 合併

2026-11-06 user 決定合併。合併前向另外兩個 session 確認沒有進行中的合併或推送（composer-refactor-90、三代AoV修改清單皆回覆不會動 main）。先把 main（b195efe，含 canvas D169-D173、甘特 D174）合進分支，只有決議表尾端衝突，兩邊保留；合併後套件測試 72、型別檢查通過、vitest 750 通過；再以比對舊值的方式快轉 main 到 7dd39a7。未推送，origin/main 仍在 9bfd751。
