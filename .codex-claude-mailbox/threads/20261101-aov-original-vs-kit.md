---
id: "20261101-aov-original-vs-kit"
title: "Analytical-Four 改成 Kit 前後的 AoV 比較（原始版本與 Kit 版）"
status: "completed"
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

### 2026-11-01 20:02–20:06 +08:00 — 開始與來源限制

- 已完整讀取 Handoff；分支確認為 `docs/aov-original-vs-kit`，工作目錄固定專案根目錄。只寫四份交付物與本節，不更新 mailbox index、其他文件或 .git。
- 已先閱讀 Kit 的 pipeline、runs、settings、feedback、routes、contract 與 registry；尚未開啟出貨 workflow.aov.json。
- 原始 `git show f49cfd3:data/raw/config/ut_config_v7.json` 回報該路徑存在於磁碟但不在 commit。不得以工作樹設定冒充 commit 設定；原始流程仍可由 main.py 推導，實際預設 mode、資料路徑與特徵設定將列為 comparison.md 限制。
- 已確認原始 main 的 topology → rag → ng-code 與 Kit 的 ng-code → topology → rag 順序不同；回饋不是原始 main 自動步驟。
- 嘗試以系統 python 寫入本節時，啟動遭作業系統拒絕（登入工作階段不存在），未寫入；改用 apply_patch。這不阻擋後續 Node 驗證。

### 2026-11-01 20:06 +08:00 — 獨立推導完成，開始出貨圖比對

- 已寫入 original.aov.json（29 節點／29 邊）與 kit.derived.aov.json（25 節點／34 邊）。於 20:06:11 讀取出貨圖前，derived 檔 SHA256 為 `4EE1F8C385151877DE8FB80249A20F7F4449F33C9F92427306147C4EF5AF2523`。
- 此後才第一次開啟 `kits/analytical-four-kit/workflow.aov.json`。出貨圖十個分析階段齊全，但其 fan-out／fan-in 邊不是 runs.py 的實際順序，並省略成功／失敗出口、停用層級路徑與回饋自動核可捷徑。
- 已逐檔比對 engine 與 f49cfd3（先正規化匯入前綴及換行）；核實 SOURCE.md 的繪圖匯入刪除、拓樸除錯寫檔移除及相似搜尋排除產品編號。另發現文件未列出的 compilation_events 拓樸資料夾參數化。
- 原始工作樹 main.py 差異只作「工作樹變體」記錄；未混入 original AoV。Node v24.15.0 可用；驗證腳本使用現有 Ajv，不安裝套件。

### 2026-11-01 20:13 +08:00 — 交付完成，待 Claude 驗收

- 已完成四份交付：`docs/aov-compare/original.aov.json`、`kit.derived.aov.json`、`comparison.md`、`validate.mjs`，早於 21:15 預計時間。未改本 thread 的 frontmatter 狀態；驗收仍由 Claude 執行。
- comparison.md 使用繁體中文、無 emoji，包含逐步映射與函式／行號追溯、mode 與 A/B/C 路徑、背景／失敗／寫檔／LLM 行為、未搬入項目、出貨節點及全部 19 條邊的分組核對、能力歸屬、文件矛盾、工作樹變體與未驗證限制。
- 出貨圖 19 節點／19 邊；derived 25 節點／34 邊。兩份能力集合完全相同（registry 15 個），出貨十個 stage 的 runs.create 重複掛載列為語意差異，不誤報為不存在的能力。derived 的 SHA256 與首次開啟出貨圖前相同。
- comparison.md 的 12 個相對檔案連結全數存在，emoji 檢查為 false；交付目錄恰為指定四檔。唯讀 `git --no-optional-locks ... diff --name-only --no-ext-diff` 只列本 thread 的已追蹤修改（四份交付物為新檔）。所有本次成功寫入均限交付目錄及 Codex Notes，沒有 .git 寫入、套件安裝或來源修改。
- 執行 `node docs/aov-compare/validate.mjs`，exit code 0，實際輸出：

```text
PASS validator self-check: valid DAG, schema, duplicate IDs/edges, missing endpoints, self-loop, disconnected cycle
PASS original.aov.json: schema; unique node IDs; existing edge endpoints; acyclic; 29 nodes; 29 edges; 0 capabilities
PASS kit.derived.aov.json: schema; unique node IDs; existing edge endpoints; acyclic; 25 nodes; 34 edges; 15 capabilities
```

- 驗證器使用 Ajv 2020 與既有 schema，反例都在記憶體內，涵蓋 schema 錯誤、重複節點／邊、懸空兩端、自環及不連通子圖內的環；不產生測試暫存檔。
- 剩餘限制（不是以猜測補齊）：原始 ut_config_v7.json 未入指定 commit，無法得知實際設定；兩份 AoV 是靜態推導，沒有啟動分析引擎、API、向量模型或 LLM。未跑全專案測試或宣稱真實診斷品質通過。沒有需要修改唯讀範圍才能完成交付的阻擋。

### 2026-11-01 Claude 審查（驗收通過）

- 派工 20:01，Codex 20:13 完成，早於預計 21:15，不需接手。Codex 只寫了指定的四個檔案與本 thread；`schemas/`、`config/`、`kits/`、`libs/` 與來源專案都沒被動過（`git status` 只列 `docs/aov-compare/` 與本 thread）。
- 重跑 `node docs/aov-compare/validate.mjs`：三項 PASS（自我檢查、original 29 節點 29 邊、kit.derived 25 節點 34 邊、15 項能力）。
- 抽查，全部與 Codex 的陳述相符：(1) `git ls-tree f49cfd3` 沒有 `ut_config_v7.json`（0 筆）；(2) f49cfd3 的 `compilation_events` 沒有 `topology_folder` 參數，工作樹的是 user 未提交的修改，Codex 以 commit 為準是對的；(3) f49cfd3 的 `__main__` 呼叫 `main(output_folder="outputs/complain/")`；(4) f49cfd3 的每日訓練寫死 `outputs/known_base.json`；(5) 出貨 `workflow.aov.json` 為 19 節點 19 邊。
- Codex 發現、我已處理的事：Settings 允許三層全部關閉，這時分析不執行任何階段卻顯示成功。已在 `feature/analytical-four-site-mapping` 修正（至少啟用一層）。
- 基準時點：比較文件的 Kit 側是 main 在 4c174bc 的狀態。之後新增的 `check-data` 節點、`columnMapping`、資料檢查（D144）與「至少啟用一層」不在內。
- Codex 提出、尚未處理的差異（留待決定）：出貨 AoV 的 fan-out／fan-in 邊表達的是相依，不是 `runs.py` 的實際順序（NG 先於拓樸與 RAG）；`compilation_events` 的 `topology_folder` 參數化沒列入 `SOURCE.md`；`overlay.json` 的 layer-c 依賴 A+B，與 runtime 在每日模式允許 A+C 的規則不一致。
