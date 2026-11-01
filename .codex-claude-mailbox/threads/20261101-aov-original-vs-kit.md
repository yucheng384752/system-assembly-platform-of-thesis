---
id: "20261101-aov-original-vs-kit"
title: "Analytical-Four 改成 Kit 前後的 AoV 比較（原始版本與 Kit 版）"
status: "in_progress"
owner: "codex"
reviewer: "claude"
priority: "medium"
created_by: "claude"
created_at: "2026-11-01"
updated_at: "2026-11-01"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "docs/aov-compare/"
    type: "directory"
---

# Goal

user 要求：由 Codex 做出 Analytical-Four 修改前（原始版本）的 AoV 與修改後（`analytical-four-kit`）的 AoV，並比較兩者差異。

AoV 格式統一用本專案的 Kit 流程描述（`composer-kit-workflow` v1，schema 為 `schemas/kit-workflow.schema.json`），兩份才能逐節點比較。AoV 只描述步驟與明確有向邊，不代表執行。

# Handoff

預計完成時間：2026-11-01 21:15（派工 20:01，約 75 分鐘）。過了預計時間仍未完成，改由 Claude 接手。

只可寫入：`docs/aov-compare/`（新目錄）與本 thread 的 Codex Notes。其餘一律唯讀；尤其不可改 `kits/`、`schemas/`、`config/`、`libs/`、`docs/` 其他檔案與來源專案。Claude 在別的 git worktree 工作，不會碰這些檔案，Codex 也不要碰 `.git`（git 寫入由 Claude 做；唯讀的 `git show` 可用，需加 `-c safe.directory=...`）。

## 輸入

原始版本（唯讀）：`C:\Users\gslab\Desktop\Analytical-Four`，**以 commit `f49cfd3` 為準**（用 `git show f49cfd3:main.py` 等讀取）。該資料夾的工作樹有 user 未提交的修改（`main.py`、本機 LLM 轉接層 `local_llm_server.py` 等），不屬於原始版本；若發現工作樹與 f49cfd3 的差異影響 AoV，請在比較文件列為「工作樹變體」，不要混進原始 AoV。主要依據：`main.py` 的 `Analytical_Four_System.main()` 與各方法、`data/raw/config/ut_config_v7.json`、`README.md`。

Kit 版（唯讀）：`kits/analytical-four-kit/`。**先從程式碼獨立推導**（`src/backend/app/analytical_four/pipeline.py`、`runs.py`、`settings.py`、`feedback.py`、`src/backend/app/api/routes_analytical_four.py`、`kit.contract.json`、`config/registry/analytical-four-kit.json`），完成 `kit.derived.aov.json` 之後，才可以開啟已出貨的 `kits/analytical-four-kit/workflow.aov.json` 對照。這樣比較才同時驗證出貨的那份有沒有漏或錯。

## 要交付的檔案（都放 `docs/aov-compare/`）

1. `original.aov.json`：原始版本的 AoV。節點是 `main()` 實際執行的步驟（含 mode 分支：daily 與 complain 各自走哪些步驟要看得出來，可用節點名稱或 scope 說明，不要發明新欄位）。原始版本沒有 API 能力，`capabilityIds` 給空陣列。`kitId` 用 `analytical-four-original`，`kitVersion` 用 `f49cfd3`，`status` 為 `draft`。
2. `kit.derived.aov.json`：由 Kit 程式碼獨立推導的 AoV。`kitId` 用 `analytical-four-kit`，`kitVersion` 為 `0.1.0`。能力編號取自 registry。
3. `comparison.md`（繁體中文，無 emoji）：
   - 摘要：三到五句，原始版本與 Kit 版最大的差異。
   - 步驟對照表：原始步驟 → Kit 階段／節點，標示「保留」「改寫」「新增」「移除」，改寫的要寫改了什麼（對照 `docs/analytical-four-kit.md` 與 `kits/analytical-four-kit/SOURCE.md` 的修改清單，並用程式碼核對，不要照抄）。
   - 流程結構差異：連線（邊）、分支（mode）、層級（A／B／C 與子功能）、前置與後置步驟（設定、就緒檢查、結果取得、回饋與案例庫）。
   - 行為差異：失敗處理、背景執行與執行紀錄、LLM 位址與金鑰、寫檔位置、錯誤是否仍會被悄悄略過。
   - 原始版本有、Kit 版沒有的東西（例如 `ErrorAnalysis`、預測模型、Gemini 路徑、`event_feedback_record` 的完整行為），逐項列出。
   - 出貨的 `workflow.aov.json` 與 `kit.derived.aov.json` 的差異：漏掉的節點、多出的節點、邊的差異、能力編號差異。每一項說明哪一份對、依據是哪個檔案哪個函式。
   - 限制：哪些地方只是由程式碼推得、沒有執行驗證。
4. `validate.mjs`（或可在本機直接用 node 執行的等價腳本）：用 `schemas/kit-workflow.schema.json`（Ajv 2020，專案已有 `ajv`）驗證 `original.aov.json` 與 `kit.derived.aov.json`，另檢查節點識別碼不重複、邊引用的節點存在、無環。能跑就把輸出貼進 Codex Notes；沙箱不能跑就明說。

## 停止條件

- 需要改動唯讀範圍內的檔案才能繼續：停止並在 Codex Notes 回報。
- 原始版本的某個步驟無法由 `f49cfd3` 的程式碼判定：不要猜，列在 `comparison.md` 的限制。
- 發現 Kit 版程式碼與文件互相矛盾：兩邊都記錄，以程式碼為準，並指出矛盾位置。

## 驗收（Claude 審查）

- 兩份 AoV 通過 schema 與結構檢查（Claude 會自己再跑一次）。
- 抽查至少五個步驟，從 AoV 節點追到程式碼函式。
- 比較表沒有未經程式碼核對的陳述；限制欄誠實。

# Codex Notes

（待 Codex 填寫）
