---
id: "20261106-package-selfcheck"
title: "安裝包自檢：產生安裝包前通過所有 Kit 測試，現場驗證環境與一致性，並補齊缺少測試的 Kit 與新增 Kit 規範"
status: "in_progress"
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

# 進度

| 階段 | 內容 | 狀態 |
|---|---|---|
| S1 | 映像多階段與 Kit 測試閘門（bundle-images） | 待做 |
| S2 | 補缺少測試的 Kit | 待做 |
| S3 | manifest 的 selftest 欄位與安裝引擎 verify | 待做 |
| S4 | 現場自檢（selfcheck.py、守門、健康檢查訊息） | 待做 |
| S5 | 新增 Kit 規範與強制測試、VM 驗證（故意讓一個 Kit 失敗，確認錯誤訊息指出該 Kit） | 待做 |
