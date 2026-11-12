# 雙帳號輪流工作：用量上限自動交棒與 session 互相發現

狀態：ready_for_user（程式與單元測試完成；真實雙帳號實跑待 user 同意）
owner：claude
分支：`feature/dual-account-handoff`（worktree：`composer-refactor-dual-wt`）
說明：`docs/dual-account.md`；決議 D206

## 目的

同一專案由兩個 Claude 帳號輪流做：A 用量用完自動換 B；兩邊 session 因設定資料夾不同而互相看不到，需可互相發現並派工。

## Claude Notes

2026-11-12 Claude：

user 的決定：A token 用完自動換 B；做 session 互相發現；交接寫 mailbox、嚴格輪流；允許 worktree 並行；account2 設定資料夾為 `E:\Users\yucheng\.claude`，用 `CLAUDE_CONFIG_DIR` 指過去。

開發內容：`tools/dual-account/`（鎖、session 鏡像、交接、上限判斷、輪流迴圈、命令列），只用 Node 內建模組，沒有新依賴；`package.json` 的 `npm test` 末端加上單元測試；`docs/dual-account.md`；D206。

測試與結果：`node --test tools/dual-account/tests/dual-account.test.mjs` 10 項通過。對真實兩個資料夾實跑了不寫入的 `sync` 與 `status`：A 到 B 計畫複製 12 個登記檔，B 到 A 為 0；未設定 `CLAUDE_ACCOUNT_B_DIR` 時失敗並回報。

未完成與未驗證：

- user 同意後已執行 `sync --apply`：A 的 12 個登記檔鏡像到 B。實跑發現回音問題（B 到 A 會把鏡像來的檔案當 B 自己的），已修正並加測試（11 項通過）。
- `run --start B`：第一次因 account2 登入過期失敗（判為一般錯誤、不換人、保留鎖；已補 `unlock`）；user 重新登入後第二次成功，唯讀任務完成、鎖已釋放。交棒流程與用量上限訊息仍未實測。
- 用量上限的訊息文字沒實測，預設樣式是推測，可用 `CLAUDE_LIMIT_PATTERN` 修正；判斷不出時當一般錯誤停止。
- 跨帳號 SendMessage 已驗證（A 側呼叫 account2 的互動 session 並收到回覆）；反方向未測。
- 互動中的 session 不會自動交棒，仍靠 SendMessage。

## Codex Notes

（無；本功能未交給 Codex）
