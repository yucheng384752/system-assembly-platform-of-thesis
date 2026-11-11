# 論文主案例 S4：合成輸入檔、比對腳本與基準執行

日期：2026-11-11
分支：`feature/thesis-s4-baseline`（自 `main` 的 4102550 開出）
依據：`docs/thesis-source-inventory.md`（已凍結）；`docs/handoff-product-and-thesis.md` 第 4.2 節 S4、第 4.4 節、第 4.5 節第 3 步
狀態：腳本、單元測試與來源系統的正式基準都已完成（第 9 節）。產出系統的轉接層與比對要等第 4.5 節第 4 步。決議編號：本文件沒有取號。

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

## 6. 本機試跑的結果（2026-11-12）

試跑不是正式基準：沒有掛外部分析套件，也沒有第二個來源位址。目的是修正轉接層並核對凍結清單。來源程式碼取自 commit 362cc7c 的 `backend/app`、`alembic`、`requirements.txt`（只有程式碼，放在 repo 之外的暫存資料夾），在 Docker 內以全新的空資料庫執行。

結果：

- 56 個情境執行完成，T4 因沒有第二個來源位址記為未執行，T6 在重啟後補跑成功。
- 在兩個全新資料庫上各跑一次再互相比對：56 個情境全部相同。正規化後的結果可重現。
- 權限表 21 列 × 5 種身分的狀態碼，與凍結清單第 3.2 節逐格相符。
- T1、T2、T3、T5、T6、T7、T8、T9、T10 的結果與清單第 3.5 節相符（T2 等 61 秒後可再登入；T6 重啟後由 429 變回 401）。
- 轉接層修正兩處：匯入工作的「是否失敗」欄位判讀錯誤（已移除，改看狀態）；外部讀取端點的年份超出來源允許的 2010 至 2050（改用 2050）。

試跑發現、正式基準前要處理的事：

1. **來源在全新資料庫上建不出與正式環境相同的結構。** 遷移（`alembic upgrade head`）在第二個遷移檔就失敗；改由程式啟動時自動建表，`p1_records`、`p2_records`、`p3_records` 的 `extras` 欄位會是 `json`，而遷移檔定義的是 `jsonb`。在 `json` 之下，P2 的 NG 明細與規格查詢一律回 500（`could not identify an equality operator for type json`）。試跑時把這三個欄位手動改成 `jsonb` 後查詢正常。另有 10 個欄位同樣是 `json`，試跑中沒有造成錯誤，但與遷移檔是否一致沒有逐一核對。正式基準的資料庫結構要用哪一種，須由 user 決定（見 mailbox thread）。
2. **來源的依賴沒有固定版本。** `requirements.txt` 只寫下限，用最新版 FastAPI 無法啟動；試跑改用來源 `uv.lock` 內記載的版本（FastAPI 0.121.0 等），另外補裝鎖定檔沒有列的 `greenlet`、`asyncpg` 等。正式基準要把實際安裝的版本記進結果。
3. 試跑用單一工作行程。來源的正式啟動指令是 4 個工作行程，登入失敗計數各自獨立，T1 至 T8 的結果會變得不固定；基準用單一工作行程，並在報告註明。
4. 分析的 A2（執行分析）與 A4（萃取分數）在沒有外部分析套件時回 500，與預期相同。user 已決定正式基準要掛上 Analytical-Four。
5. 來源在標記轉檔完成之後才把收卷機編號寫回 CSV，腳本固定等 1.5 秒；三次試跑的 P2 轉檔輸出都有收卷機欄。
6. 預設站點代碼為 `P1`、`P2`、`P3`，與情境的假設相符。

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

## 9. 正式基準（2026-11-12）

結果檔：`docs/thesis-case/s4-baseline-source.json`（只含狀態碼與合成資料，不含金鑰、密碼、權杖）。部署配方：`tools/thesis-s4/source-baseline/`（`Dockerfile`、`compose.yml`、`constraints.txt`、`schema-adjust.sql`；金鑰與密碼只以環境變數名稱引用，實際值在執行當下產生，不進 repo）。

結果：57 個情境全部執行完成，沒有執行錯誤。同一環境上先做一次排練、再重建全新資料庫做正式基準，兩次比對 57 個情境全部相同。

環境（user 的決定經另一個 session 轉述，2026-11-12）：

| 項目 | 內容 |
|---|---|
| 位置 | 測試 VM（Ubuntu 22.04、Docker），`postgres:16`，全新空資料庫 |
| 來源程式碼 | commit 362cc7c 的 `backend/app`、`alembic`、`requirements.txt`；不含 `.env`、`uploads/`、`test-data/` 與任何資料檔。`app/api/sample_analysis_p2.json` 沒有被程式引用，也沒有放上 VM |
| 設定 | 第 7 節的建議值：`USE_GENERIC_SCHEMA=true`、`AUDIT_EVENTS_ENABLED=true`、`PDF_SERVER_TIMEOUT_SECONDS=5`、`AUTH_MODE=api_key`、`ENVIRONMENT=production`，轉檔服務指向假服務 |
| 工作行程 | 單一（來源的正式指令是 4 個；登入失敗計數每個行程各自獨立，會使 T 類結果不固定） |
| 依賴版本 | 依來源 `uv.lock`：FastAPI 0.121.0、Starlette 0.49.3、SQLAlchemy 2.0.44、Pydantic 2.12.4、pandas 2.3.3、NumPy 2.3.4；鎖定檔沒有列、由安裝工具決定的：asyncpg 0.32.0、scikit-learn 1.9.1、greenlet 3.2.4 |
| 資料庫結構 | 程式啟動時自動建表，之後執行 `schema-adjust.sql` 把 `p1_records`、`p2_records`、`p3_records` 的 `extras` 由 `json` 改為 `jsonb`（user 選定的做法） |
| 外部分析套件 | Analytical-Four commit f49cfd3（獨立專案，作者 ZHAO-XIAN，無 LICENSE；只掛載執行，沒有複製進本 repo；論文須標示來源） |
| 分析設定檔 | `september_v2/config/ut_config_v3.json`。檢查後只含參數（方法名稱與欄位名稱清單），沒有批號、量測值或人員名稱 |
| T4 的第二個來源位址 | 同一個服務，一次從開發機直接連線，一次經 SSH 通道從 VM 本機連線 |
| T6 | 主階段結束後以 SSH 重啟後端容器，55 秒內補跑 |

`september_v2` 資料夾的處理（user 決定：資料檔不讀、不上 VM）：

| 檔案 | 判斷依據 | 處理 |
|---|---|---|
| `config/ut_config_v3.json` | 設定檔；檢查鍵與值的型別後確認只有參數 | 原樣使用 |
| `merged_p1_p2_p3.csv` | 依檔名與大小判斷為資料檔，沒有打開 | 不使用。來源的分析端點從資料庫取資料，不讀這個檔 |
| `ut_*.json`、`topology_summary_output.json`（14 個） | 依檔名判斷為分析產出，沒有打開 | 不使用。基準中分析產出清單五項皆為不存在，檢視端點回 404 |
| `config/ut_topology.json`、`config/complect.txt` | 沒有打開 | 不使用 |

論文要揭露的限制（基準不等於正式環境的地方）：

1. 資料庫結構經過手動調整：來源的遷移在空資料庫上失敗，三個欄位的型別是手動改的；另有 10 個 `json` 欄位沒有核對是否與正式環境一致。
2. 依賴版本來自鎖定檔而非正式環境的實際安裝；鎖定檔沒有涵蓋的套件由安裝工具決定。
3. 單一工作行程，不是正式的 4 個。
4. 萃取分數（A4）沒有掛診斷基準檔（設定檔指向的檔案屬於分析產出，沒有使用）；合成資料列數少，各項分數為空。這一項的基準只能比「有回應、用到的特徵與樣本數」，比不到分數本身。
5. 分析產出（A5）的檢視端點因沒有產出檔而回 404，比不到內容。
6. PDF 轉檔品質不在比對範圍（假服務），轉檔服務未設定時的 503 沒有涵蓋。
7. 五個只在瀏覽器內發生的步驟與「改密碼後其他權杖失效」沒有涵蓋（第 5 節）。

與凍結清單的核對：權限表 21 列 × 5 種身分逐格相符；T1 至 T10 全部相符（T4：同位址第 6 次 429、換位址後 200；T6：重啟後由 429 變回 401）。清單不需要修訂。
