---
id: "20261104-aov-case-store"
title: "AoV 管理系統：案例庫、淘汰與合併（三批）"
status: "in_progress"
owner: "claude"
reviewer: "claude"
priority: "normal"
created_by: "claude"
created_at: "2026-11-04"
updated_at: "2026-11-04"
role_priority:
  implementation: "codex (批一) / claude (批二、批三、審閱、git)"
  review: "claude"
  tests: "codex / claude"
  requirements: "user"
artifacts:
  - path: "docs/aov-case-store.md"
    type: "file"
  - path: "docs/decision-log.md"
    type: "file"
---

# Goal

依 `docs/aov-case-store.md`（D163 至 D167）做 AoV 管理系統：保留已驗證流程的歷次版本與修改原因、淘汰舊 node 與 node 組合、合併功能重複的 node。分支 `feature/aov-case-store`。三批全部完成後才向 user 回報。

# 批次

| 批 | 內容 | 負責 | 預計完成 |
|---|---|---|---|
| 一 | `libs/case-store/` 儲存層、migration、觸發器、測試 | Codex | 2026-11-05 12:00 |
| 二 | 本機 Node 服務 API（伺服器端自跑驗證與模擬）、備份匯出匯入、連線驗證 | Claude | 批一審閱後 1 日 |
| 三 | 管理畫面：歷史時間軸、淘汰、合併、修改原因 | 視批二後再定 | 另訂 |

到期未完成由 Claude 接手（先確認 Codex 已停止再改檔）。

# 批一 Handoff（Codex）

cwd 必須是專案根目錄。Codex 只寫程式與測試，不執行 git、不連網、不裝依賴、不啟動伺服器。契約唯一來源是 `docs/aov-case-store.md`，有不明處或與現有程式衝突就停工並寫進 Codex Notes，不自行裁決。

檔案範圍（只能動這些）：新增 `libs/case-store/`（含測試與舊版資料庫 fixture 的產生方式）。不得修改 `libs/aov-integration/`、`schemas/`、`config/`、`apps/`；需要的函式只能從 `libs/aov-integration` 匯入。

工作：
1. 依第 3 節建立資料表、觸發器、`schema_meta` 與 migration 機制（第一版 = 版本 1；測試用的「較舊版本」可在測試內以 SQL 自行建出，並在測試中模擬一個 v1 到 v2 的虛構 migration 以驗證機制，不要把虛構欄位帶進正式 schema）。
2. 依第 4 節實作 `saveVersion` 的四項檢查與錯誤碼。
3. 依第 5 節實作全部函式，型別明確、不得用 `any`。使用 `node:sqlite`；測試檔需 `// @vitest-environment node`。
4. 依第 6 節每一列寫至少一個測試，且每個測試必須在對應規則被拿掉時會失敗（規則 9）。
5. 在 `libs/case-store/README.md` 寫已知限制（第 7 節）與用法，不得宣稱未涵蓋的能力。

停止條件：需要新增依賴；`node:sqlite` 的行為與契約衝突；需要修改範圍外的檔案；`validateAovBundle` 無法以所需方式呼叫。

驗收（Codex 須在 Notes 如實列出）：`npm.cmd run typecheck`、`npm.cmd test` 結果與數字；跳過或失敗的項目與原因（已知沙箱 security CLI 的 EPERM 照實寫）。

# Codex Notes

（待填）

# Claude Notes

- 2026-11-04：分支已建，D163 至 D167 與契約文件已寫入。技術選型 `node:sqlite`（D164）是 Claude 建議，user 回覆未特別提及，若有異議可改。
