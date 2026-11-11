# 論文主案例 S4：合成輸入檔、比對腳本與基準執行

日期：2026-11-11
分支：`feature/thesis-s4-baseline`（自 `main` 的 4102550 開出）
依據：`docs/thesis-source-inventory.md`（已凍結）；`docs/handoff-product-and-thesis.md`（分支 `docs/handoff-product-and-thesis`）第 4.2 節 S4、第 4.4 節、第 4.5 節第 3 步
狀態：腳本與單元測試完成；**還沒有在來源系統上跑過基準**（見第 6 節）。決議編號：本文件沒有取號。

## 1. 這一步做什麼

S4 判準是「同一批輸入、同一串操作，在來源系統與產出系統上得到相同的可觀察結果」。這一步提供三樣東西：

1. 可重跑的合成輸入檔產生腳本。
2. 一份與系統無關的情境清單，涵蓋凍結清單的 52 個步驟、權限表 21 列 × 5 種身分、連續失敗情境 T1 至 T10。
3. 比對腳本：比較兩份執行結果，輸出逐情境的相同或不同。

產出系統還不存在（第 4.5 節第 4 步）。它完成後要補一個轉接層（`tools/thesis-s4/adapters/`），提供與來源轉接層同名、同回傳形狀的操作，才能用同一份情境比對。

## 2. 檔案

都在 `tools/thesis-s4/`，不引入任何新依賴，只用 Node 內建模組。這個資料夾不在 typecheck 範圍（與 `services/` 下的 `.mjs` 相同）。

| 檔案 | 用途 |
|---|---|
| `lib/synthetic.mjs` | 合成輸入檔的內容定義（17 個檔案）與假轉檔服務的回傳內容 |
| `generate-inputs.mjs` | 把輸入檔寫到指定資料夾，附檔名、用途與 SHA-256 清單 |
| `fake-pdf-server.mjs` | 假的 PDF 轉檔服務：依檔名決定固定回傳、回錯誤、不回應 |
| `lib/scenarios.mjs` | 情境清單、只在畫面上發生的步驟、同一次執行無法涵蓋的項目 |
| `adapters/source.mjs` | 來源系統的轉接層：操作翻成 HTTP 請求，回應正規化 |
| `run.mjs` | 在一個系統上執行情境，輸出結果 JSON |
| `compare.mjs`、`lib/compare.mjs` | 比對兩份結果，輸出 JSON 與 Markdown 報告 |
| `tests/thesis-s4.test.mjs` | 單元測試，已接進 `npm test` |

## 3. 合成資料的規則

- 欄位名稱只讀自來源程式碼：`csv_field_mapper.py`、`import_v2.py`、`routes_query_v2.py`、`traceability.py`、`pdf_conversion.py`。沒有讀來源的 `.env`、`uploads/`、`test-data/` 或任何資料檔。
- 批號、日期、機台、模具、規格、數值全部是編造的：批號以 99 開頭（西元 2099 年），機台 P9x，模具 M-70x，規格 SYN-*。測試會檢查批號樣式。
- 內容沒有亂數與時間，重跑得到相同位元組；測試會檢查兩次產生的 SHA-256 相同。
- 產生的檔案不進 repo。帳號密碼由執行腳本當下隨機產生，只存在記憶體，不寫入結果檔。

輸入檔涵蓋：合法的 P1、P2、P3；空白列；批號格式錯與批號空白的列；同一檔兩個批號（匯入應失敗）；P3 缺日期（匯入應失敗）；收卷機編號來自檔名；不支援的副檔名；內容重複；PDF 的合法、非 PDF 內容、空檔，以及轉檔成功、失敗、逾時三種。

## 4. 比對的是什麼

- 轉接層只輸出狀態碼與業務內容，不輸出識別碼、時間戳記、權杖、文字措辭。驗證錯誤的訊息轉成類別（缺少、格式錯、非數字、其他）。
- 查詢結果裡的資料列只保留合成 CSV 原有的欄位，並以種類、批號、產品編號排序，因為來源的查詢排序在同一批匯入內不固定。
- 預期會不同的地方要在比對前寫進排除清單，每一筆都要有理由，否則比對腳本拒絕執行；被排除的差異仍會列在報告裡。
- 執行錯誤、缺少或多出的情境一律不算相同。

「金鑰+帳號」這個身分用 User 帳號的權杖加管理者金鑰（user 2026-11-11 決定）。

## 5. 腳本涵蓋不到的項目

照實列出，不算已比對：

| 項目 | 原因 | 處理方式 |
|---|---|---|
| U1、U2、U7、U11、A1 | 只發生在瀏覽器內，沒有後端請求 | 由 S2 逐節點實際操作；U7 的結果以「修正後的檔案重新驗證」（U8）代表 |
| U13 轉檔服務未設定回 503 | 需要另一組設定 | 把 `PDF_SERVER_URL` 留空另跑一次 |
| L5 改密碼後其他權杖失效 | 同一帳號再次登入就會使舊權杖失效，取不到第二個權杖 | 未比對 |
| T4 換來源位址 | 需要第二個來源位址能連到同一個服務 | 提供 `--alt-base-url`；沒有時記為「未執行」 |
| T6 服務重啟 | 腳本不能重啟服務 | 主階段最後留下被擋下的計數，55 秒內重啟後以 `--phase after-restart` 補跑；超時記為「未執行」 |

## 6. 還沒驗證的事（基準執行時要確認）

1. 轉接層的請求與回應欄位名稱都讀自程式碼，沒有對執行中的來源系統驗證。欄位不符時情境會記成執行錯誤。
2. 分析的 A2（執行分析）與 A4（萃取分數）依賴來源系統外部的分析套件與設定檔（`ANALYTICAL_FOUR_PATH`、`ANALYTICS_CONFIG_PATH` 等）；缺少時這兩個端點一律回 500，與資料無關。基準要不要掛上這個套件，須由 user 決定。
3. 來源在標記轉檔完成之後才把收卷機編號寫回 CSV，沒有可輪詢的訊號，腳本固定等 1.5 秒；若基準結果的 P2 轉檔輸出沒有收卷機欄，要加長等待。
4. 站點設定的讀取情境假設預設站點代碼含 `P1`，實際代碼以基準結果為準。
5. 來源的分析端點每分鐘 90 次、UT 端點每分鐘 30 次的限流，依目前情境數量不會觸發，沒有實測。

## 7. 怎麼跑基準

基準執行需要 user 提供或同意的環境設定；腳本與 Claude 都不讀來源的 `.env`。來源系統需要的設定（名稱讀自 `be/core/config.py`）：

| 設定 | 值 | 原因 |
|---|---|---|
| `DATABASE_URL` | 一個全新的空資料庫 | 情境假設沒有既有資料與帳號 |
| `SECRET_KEY` | 新產生的值 | 預設值在 production 會被拒絕啟動 |
| `ADMIN_API_KEYS` | 新產生的一把金鑰 | 與執行腳本時的 `S4_ADMIN_KEY` 相同 |
| `USE_GENERIC_SCHEMA` | `true` | 清單第 1 節（M7、M8） |
| `AUDIT_EVENTS_ENABLED` | `true` | 清單第 1 節（M9） |
| `PDF_SERVER_URL` | 假轉檔服務的位址 | U13 至 U18 |
| `PDF_SERVER_TIMEOUT_SECONDS` | `5` | 逾時情境要在合理時間內結束 |
| `UPLOAD_TEMP_DIR` | 一個新的空資料夾 | 不碰來源既有的 `uploads/` |
| `MONITOR_SERVER_URL` | 留空 | 不把操作送到外部監控 |

步驟：

```powershell
node tools/thesis-s4/fake-pdf-server.mjs                      # 另一個視窗；預設 127.0.0.1:18090
$env:S4_ADMIN_KEY = '<與 ADMIN_API_KEYS 相同>'
node tools/thesis-s4/run.mjs --system source --base-url http://<位址>:<埠> --alt-base-url http://<第二個位址>:<埠> --out baseline.json --note "USE_GENERIC_SCHEMA=true" --note "AUDIT_EVENTS_ENABLED=true"
# 55 秒內重啟來源服務，然後：
node tools/thesis-s4/run.mjs --system source --base-url http://<位址>:<埠> --phase after-restart --previous baseline.json --out baseline.json
```

主階段約需 2 至 3 分鐘（T2 要等 61 秒，逾時情境依 `PDF_SERVER_TIMEOUT_SECONDS`）。同一個資料庫只能跑一次主階段；重跑要換新的空資料庫。

比對（產出系統有結果之後）：

```powershell
node tools/thesis-s4/compare.mjs --baseline baseline.json --candidate generated.json --exclusions exclusions.json --out s4-report
```

## 8. 測試

`node --test tools/thesis-s4/tests/thesis-s4.test.mjs`：13 項。守住的前提：凍結清單每一項都有情境或明列為畫面步驟；權限表每列對五種身分各做一次；情境用到的操作轉接層都有；T4、T6 條件不足時記為未執行；合成資料可重現且批號樣式正確；假轉檔服務三種情況；比對不把執行錯誤、缺少的情境或沒有理由的排除算成通過。
