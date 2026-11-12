# 雙帳號輪流工作（tools/dual-account）

目的：同一個專案由兩個 Claude 帳號輪流做。A 的用量用完，自動交給 B 接手；兩邊的 session 可互相發現並派工。決議 D206。

## 設定

兩個帳號各用自己的設定資料夾（`CLAUDE_CONFIG_DIR`）。路徑只放環境變數，不進 repo：

- `CLAUDE_ACCOUNT_B_DIR`：account2 的設定資料夾（必填）。
- `CLAUDE_ACCOUNT_A_DIR`：預設 `~/.claude`。
- `CLAUDE_LIMIT_PATTERN`：覆寫「用量上限」的判斷樣式（正規表示式）。
- `CLAUDE_BIN`：預設 `claude`。

## 指令

| 指令 | 作用 |
| --- | --- |
| `node tools/dual-account/cli.mjs sync` | 只列計畫：把還活著的 session 登記檔鏡像到對方資料夾 |
| `node tools/dual-account/cli.mjs sync --apply` | 實際寫入對方的 `sessions/` |
| `node tools/dual-account/cli.mjs status` | 看本分支目前由哪個帳號持有 |
| `node tools/dual-account/cli.mjs unlock` | 出錯後鎖會保留，人確認過後清除本分支的鎖 |
| `node tools/dual-account/cli.mjs run --thread <thread 檔> --task <文字或 @檔案> [--start A\|B] [--max-switches 4] [-- claude 額外參數]` | 用 `claude -p` 跑任務，到上限自動交棒 |

## 規則

- 嚴格輪流：同一分支同一時間只有持有者能寫；鎖放在 git common dir 的 `dual-account/`，不進版控。不同分支（worktree）各有各的鎖，可並行。
- 交接寫進既有 mailbox thread 的新段落（Handoff），含原因、分支、工作樹、不可做的事、交出方最後訊息、`git status --short`。thread 不存在會報錯，不自動建立。
- 鏡像只動自己建立的檔案（記在對方 `sessions/.mirrored-from-<A|B>.json`）；同名但非本工具建立的檔案不覆蓋。`.key` 檔不讀內容，只複製位元組。
- 未知錯誤（非用量上限）不自動換人，鎖保留給人檢查；兩個帳號都立刻碰到上限則停止。「立刻」指本輪不到 60 秒。

## 尚未驗證

- 用量上限的實際訊息文字沒有在本機觸發過，預設樣式是推測；第一次真的碰到上限時要確認，必要時用 `CLAUDE_LIMIT_PATTERN` 修正。判斷不出時會當成一般錯誤停止，不會誤換人。
- 2026-11-12 已實跑 `sync --apply`（A 的 12 個登記檔鏡像到 B，且修正回音問題）。`run --start B` 試跑失敗：account2 登入已過期（`OAuth session expired`），程式判為一般錯誤、未換人、保留鎖，符合設計；任務本身沒跑到。account2 重新登入後要再試一次，用量上限的實際訊息也仍未驗證。
- `claude -p` 的 stream-json 事件格式（`result`、`assistant`）依 CLI 說明與既有慣例撰寫，單元測試用假事件。
- 互動中的 session 不會自動交棒；互動模式仍靠 `SendMessage` 手動派工（記憶 feedback-handoff-to-account2-agent）。
