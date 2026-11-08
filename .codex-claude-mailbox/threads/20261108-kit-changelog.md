---
id: "20261108-kit-changelog"
title: "Kit 變更紀錄：每個 Kit 的 CHANGELOG.md 記錄流程節點的修改、原因與前後畫布，供學習隱性知識"
status: "ready_for_user_review"
owner: "claude"
reviewer: "user"
priority: "medium"
created_by: "claude"
created_at: "2026-11-08"
updated_at: "2026-11-08"
role_priority:
  implementation: "claude"
  review: "user"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "libs/kit-changelog/index.ts"
    type: "file"
  - path: "scripts/kit-changelog.mjs"
    type: "file"
  - path: "apps/composer-gui/src/kitChangelog.test.ts"
    type: "file"
  - path: "docs/kit-authoring.md"
    type: "file"
---

# 目的

user 2026-11-08 的要求：每個 Kit 要寫 CHANGELOG.md，記錄修改的 node_name、修改原因、版本前後的變化（顯示在畫布上加文字描述）。這些變更用來訓練 HMM，從變化紀錄推測並整理隱藏知識，轉成顯性規則，因此能給 user 更好的建議。user 同時決定：歷史要回補、強制寫、與案例庫共用。決議 D190。

# 設計

- 一筆紀錄：`seq`、日期、作者、來源（`manual` 或 `git:<hash>`）、Kit 版本、修改原因分類（8 類封閉清單）、原因文字、節點變更（新增、移除、修改，含修改前後欄位）、連線變更、修改前後的圖雜湊。
- 只記差異，不存整張圖；從空白依序重播就得到每一步的完整圖。重播結果的雜湊必須等於紀錄的修改後雜湊，最後一步必須等於目前的 `workflow.aov.json`。這讓「改了流程不留紀錄」和「事後改紀錄」都會被測試擋下。
- `CHANGELOG.md` 是產生檔：人讀的文字（節點表、連線清單、Mermaid 前後畫布）與機器可讀 JSON 由同一份資料產生，測試要求逐字一致。
- 只有連線變更的節點也列入「被修改的節點」，不會有節點在畫布上變了、表裡卻找不到。
- 圖的身分不看節點、連線、能力的順序，只看內容。

# 指令

`node scripts/kit-changelog.mjs add <kit> --cause <分類> --reason "<原因>"`、`render`、`check`、`backfill`。

# 回補

13 個 Kit、19 筆。analytical-four 7 筆（初版加 6 次修改，分類：5 筆 new-feature、1 筆 align-runtime，原因取自提交內文與 D183、D184）；其餘 12 個 Kit 各 1 筆 initial。回補對照檔放暫存區未進 repo，結果已在各 `CHANGELOG.md`。

# 驗證

- 新增 35 項 vitest（`kitChangelog.test.ts`），npm test 全部 844 通過、1 略過；typecheck 乾淨；套件測試 72 通過。
- 變異檢查 5 項皆被攔下：略過最後與流程描述比對、diff 忽略能力變更、重播略過修改前雜湊、略過文字與資料一致性、只連線變更的節點不列入。
- 端到端：改節點名稱未記錄時 `check` 失敗並指名「使用者登入（login）」；`add` 後通過；已還原。

# 限制與未做

- 不存截圖，畫布由結構重新產生；Mermaid 在 GitHub 與多數 Markdown 預覽可顯示，Composer 畫面尚未顯示。
- 分類與原因是人工判斷；回補的 12 個初版原因只寫提交標題。
- 未提供 HMM 用的匯出格式；每筆紀錄的 JSON 已可直接解析，但狀態、觀測值怎麼定義要等 user 決定模型設計。分類目前 8 類，`other` 變多就代表要新增分類。
- `libs/` 下既有的測試（例如 `libs/aov-integration/*.test.ts`）不在 `npm test` 範圍內（vitest root 是 `apps/composer-gui`）；本功能的測試放在 `apps/composer-gui/src/` 才會被強制。這是既有現況，未處理。
- 與案例庫的整合：詞彙對齊（`reason`、`author`、日期），未寫匯入。待與 composer-refactor-90 討論。
- 每個 Kit 新增或修改流程的人要記得補一筆；`npm test` 會提醒，但不會自動產生原因。
