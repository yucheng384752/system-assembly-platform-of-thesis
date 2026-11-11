# 論文主案例 S4：合成輸入檔與比對腳本

狀態：in_progress（腳本完成，基準尚未執行）
owner：claude
分支：`feature/thesis-s4-baseline`
契約與用法：`docs/thesis-s4-baseline.md`

## 目的

`docs/handoff-product-and-thesis.md` 第 4.5 節第 3 步：製作 S4 的合成輸入檔與比對腳本，並在來源系統上跑出基準結果。依據是已凍結的 `docs/thesis-source-inventory.md`。

## Claude Notes

2026-11-11 Claude：本批沒有交給 Codex，由 Claude 直接實作。前一個 session（a5）在開工前遇到用量上限，由本 session 接手。

開發內容：

- `tools/thesis-s4/`：合成輸入檔定義與產生腳本、假的 PDF 轉檔服務、與系統無關的情境清單、來源系統轉接層、執行與比對的命令列入口、單元測試。只用 Node 內建模組，沒有新依賴。
- `package.json`：`npm test` 末端加上新的單元測試。
- `docs/thesis-s4-baseline.md`：規則、涵蓋不到的項目、尚未驗證的事、基準執行需要的設定與步驟。

來源系統的讀取範圍：只讀 `form-analysis-server/backend/app/` 下的 Python 程式碼（兩個子代理整理端點格式，另由 Claude 直接讀匯入、欄位對應、PDF 轉檔）。沒有讀 `.env`、`uploads/`、`test-data/` 或任何資料檔；沒有執行來源系統。

user 的決定（2026-11-11）：「金鑰+帳號」用 User 帳號的權杖加管理者金鑰。

測試方式與結果：

- `node --test tools/thesis-s4/tests/thesis-s4.test.mjs`：13 項全部通過。
- `npm.cmd run typecheck`：通過。新工具放在 `tools/`，不在 typecheck 範圍；原先放在 `scripts/` 時會被 `tsconfig.node.json` 以嚴格模式檢查而大量報錯，所以搬到 `tools/`，做法與 `services/` 下未受檢查的 `.mjs` 相同。
- `npm.cmd test`：GUI 73 檔 933 通過、1 略過（既有）；preview 14、案例庫函式庫 38、案例庫服務 8、本批 13，全部通過。
- 合成輸入檔實際產生一次，假轉檔服務回傳的 ZIP 以 Python 的 zipfile 讀取與檢查無誤。

未完成與未驗證：

- **沒有在來源系統上跑過基準。** 轉接層的欄位名稱全部來自讀程式碼，第一次實跑預期會有需要修正的地方。
- 分析的執行分析與萃取分數依賴來源系統外部的分析套件，基準要不要掛上，待 user 決定。
- T4 需要第二個來源位址，T6 需要在兩段執行之間重啟服務；user 提議用 VM 部署後處理，細節待定。
- 產出系統的轉接層要等第 4.5 節第 4 步之後才能寫。

2026-11-12 Claude：本機試跑三次（來源 commit 362cc7c 的程式碼，Docker、全新空資料庫；不是正式基準）。

- 56 個情境執行完成，兩次獨立執行互相比對全部相同；T4 因沒有第二個來源位址未執行。
- 權限表 21 列 × 5 身分與凍結清單逐格相符；T1 至 T10（T4 除外）與清單相符。
- 轉接層修正兩處（匯入工作失敗欄位的判讀、外部端點的年份範圍）。
- 發現：來源的遷移在全新資料庫上失敗；自動建表的 `extras` 欄位是 `json` 而非遷移檔定義的 `jsonb`，使 P2 NG 明細與規格查詢回 500。試跑時手動改為 `jsonb`。正式基準的資料庫結構待 user 決定。
- 發現：來源依賴沒有固定版本，須用 `uv.lock` 的版本才能啟動。
- user 經 a5 轉述的決定：基準部署在 VM、設定值照建議、分析掛上 Analytical-Four。VM（192.168.200.63）已確認可用 ssh 金鑰登入，有 Docker 與 Compose。
- 細節見 `docs/thesis-s4-baseline.md` 第 6 節。試跑的結果檔與暫存環境都在 repo 之外，容器與資料卷已移除。
