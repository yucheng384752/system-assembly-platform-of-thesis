# 論文案例：Analytical-Four 使用 AoV 前後（契約）

日期：2026-11-10
決議：D200、D201（見 `docs/decision-log.md`）
分支：`feature/thesis-aov-case`（自 `feature/aov-standalone-canvas` 的 c08e5a2 開出）
性質：論文證據的產生工具與案例材料。不改任何產品行為。

## 1. 目的

論文要以 `analytical-four-kit` 為標的，說明「使用 AoV 前後」的差異。本功能提供兩樣東西：

1. 一支獨立的量測腳本，量出 Kit 在示範資料上的系統回應時間（批一）。
2. 一份「使用前」的 AoV（由獨立專案 Analytical-Four 的流程轉出）與它和 Kit 版 AoV 的結構差異表（批二，另寫細則）。

## 2. 名詞

- 使用前：獨立專案 Analytical-Four（作者 ZHAO-XIAN，`C:\Users\gslab\Desktop\Analytical-Four`，commit f49cfd3），唯讀。流程依其 `README.md` 第 4 節與 `main.py`。
- 使用後：`kits/analytical-four-kit/workflow.aov.json`（22 個節點、23 條連線；2026-11-12 併入 D199 的流程修改後更新，D205）與 Kit 的 API。
- 系統回應時間：從送出請求到系統回應或工作結束的牆鐘時間，不含任何人的操作與思考時間。

## 3. 已量得的事實（2026-11-10，作為設計依據）

- Kit 的 AoV：22 節點，其中 10 個是分析階段，12 個是操作步驟（D199 移除「載入示範資料」並補「檢查資料」到「啟動分析」的連線，D205）。
- 示範資料（合成）：`baseline.csv` 80 列 25 欄、`current_daily.csv` 60 列 25 欄、`complaint.csv` 6 列 25 欄、`knowledge.csv` 12 列 7 欄，另有 `analysis_config.json`、`analysis_config_complaint.json`、`ng_code.json`、`topology.json`、`known_base.json`。
- 執行紀錄（`runs.py` 的 `status.json`）：只有 `createdAt`、`startedAt`、`finishedAt`，精度到秒，各階段只有狀態、沒有時間。所以階段耗時必須由外部輪詢狀態量得。
- Kit 的路由在 `src/backend/app/api/routes_analytical_four.py`：`GET/PUT settings`、`GET status`、`GET data-check`、`POST/GET runs`、`POST/GET uploads`、`POST uploads/{id}/accept` 等。
- 測試已有的輔助：`tests/conftest.py` 的 `data`、`client`（FastAPI TestClient，不開埠）、`FakeLlm`、`wait_for`、`run_and_wait`。

## 4. 批一：Kit 量測腳本

### 4.1 範圍

- 新增 `kits/analytical-four-kit/tools/measure_kit.py` 與 `kits/analytical-four-kit/tests/test_measure_kit.py`。`tools/` 是開發與測試工具，不進系統包（見 `SOURCE.md`）。
- 不修改 `src/` 下任何檔案、`kit.contract.json`、`manifest.json`、`workflow.aov.json`。
- 不新增依賴。只用標準函式庫與 Kit 已有的依賴（FastAPI TestClient、pandas 等）。
- 程序內執行（TestClient），不監聽連接埠。資料目錄用暫存資料夾並以 `seed_demo` 灌入示範資料，絕不碰真實資料。

### 4.2 量三件事

| 代號 | 量什麼 | 怎麼量 |
|---|---|---|
| G 生成 | 一次分析從送出到結束的總時間，以及每個階段的耗時 | `POST runs` 後以不超過 20 毫秒的間隔輪詢 `GET runs/{id}`，用 `time.perf_counter` 記錄每個階段第一次出現 `running` 與第一次出現 `done`（或 `failed`、`skipped`）的時刻 |
| I 導入 | 示範資料中「Kit 允許上傳的種類」（`data_checks.KIND_TARGETS` 的 `current-data`、`baseline-data`、`ng-code`、`topology`、`knowledge`、`analysis-config`；客訴用的待分析資料也屬 `current-data`）每個檔的上傳、驗證報告、接受三步的時間，以及之後資料檢查的時間。`known_base.json` 由每日模式產生、不能上傳，不在量測內；空的案例檔（0 位元組）上傳會被拒，也不量，兩者都要在 `notes` 說明為何排除 | 逐檔 `POST uploads`、`GET uploads/{id}`、`POST uploads/{id}/accept`，再 `GET data-check`；同時記錄檔案位元組數，CSV 另記列數與欄數 |
| A 調整 | 一組固定的設定變更，每一項從送出到系統回報就緒的時間 | 固定清單（見 4.3）逐項 `PUT settings`，接著 `GET status` 與 `GET data-check` |

G 預設兩組情境：每日模式啟用 A、B；客訴模式啟用 A、B、C。客訴模式需要診斷服務，腳本內建一個固定回應的假服務（比照 `tests/conftest.py` 的 `FakeLlm`，可直接重用或複製其寫法），所以 LLM 階段的時間只是假服務的時間，不代表真實模型。報告必須把這一點寫在輸出裡（欄位 `notes`）。

### 4.3 調整清單

固定四項，順序固定，每項前都先還原成同一份起始設定：

1. 關閉 C 層（`layers.c = false`）。
2. 由每日模式切到客訴模式。
3. 改 `llm.timeoutSeconds`。
4. 加入一條欄位對照（`columnMapping`）：以示範資料中的一個欄名為例，對照到另一個名稱。若該改動使資料檢查失敗，這項照實記為「檢查未通過」，不得調整成通過。

Codex 若在實作時發現其中一項在 Kit 現況下無法成立，須在 Codex Notes 說明並停下，不得自行改清單。

### 4.4 輸出

- 命令列：`python tools/measure_kit.py --out <資料夾> [--repeats N] [--only G,I,A]`。`--out` 必填；`--repeats` 預設 5；不得把輸出寫進 repo 內。
- 寫出兩個檔：`measure-<UTC 時間>.json` 與同名 `.md`。
- JSON 頂層：`format: "composer-measure"`、`version: 1`、`environment`、`repeats`、`results`、`failures`、`notes`。
  - `environment`：作業系統、Python 版本、CPU 數、Kit 的 `manifest.json` 的 `kit` 與版本、`git rev-parse HEAD`（取不到就寫 `null`，不得省略欄位）、UTC 時間。
  - `results`：每個量測點一筆，含 `id`、`unit: "seconds"`、`n`、`min`、`median`、`p95`、`max`、`samples`（全部原始值）。p95 用最近排名法：排序後取第 `ceil(0.95 * n)` 個。
  - 當 `n < 20`，該筆加 `p95Reliable: false`；否則為 `true`。
  - `failures`：每次失敗一筆，含量測點、第幾次、原因。有任何失敗，程序結束碼非 0，且 Markdown 開頭要列出失敗數。失敗的樣本不得混進統計，也不得靜默丟掉。
- Markdown：一張表，欄位為量測點、n、中位數、p95、最大、備註；開頭一段說明這是「系統回應時間，不含人的操作時間」與「示範資料為合成，規模很小」。

### 4.5 測試

`tests/test_measure_kit.py`，測試要能在條件改變時失敗（見 CLAUDE.md 規則 9）：

1. 統計函式：已知輸入的 min、median、p95（最近排名）、`n < 20` 時 `p95Reliable` 為 false；空輸入要明確丟錯。
2. 階段計時：用一個假的輪詢序列驗證「第一次 running」與「第一次 done」的時刻被正確取出，且 `skipped` 階段不產生耗時。
3. 失敗要大聲：模擬一次分析失敗，驗證 `failures` 有紀錄、結束碼非 0、該次不進統計。
4. 輸出格式：JSON 欄位齊全（含 `git` 取不到時為 `null`）；Markdown 含「不含人的操作時間」字樣。
5. 端到端冒煙：在示範資料上以 `--repeats 1 --only A` 跑一次，確認兩個檔寫出、結束碼 0。其餘 G 與 I 的端到端由 Claude 在 Kit 測試環境執行。
6. 不得把輸出寫進 repo：`--out` 指向 repo 內時要拒絕並說明。

### 4.6 驗收

- `tools/measure_kit.py` 與其測試完成，不改 4.1 列的禁改檔案。
- Claude 在 Kit 測試環境跑完測試，並實際跑一次 `--repeats 5`，把輸出的 JSON 與 Markdown 留在 mailbox thread 的紀錄中（只貼摘要，不貼全文）。

## 5. 批二：使用前的 AoV 與結構差異

### 5.1 決定（user 2026-11-10）

「使用前」的節點畫到「`main.py` 實際呼叫的函式」：一個節點對應一個函式呼叫，不補 Kit 才有的功能，也不把 README 推出來的人工步驟畫成節點。來源檔是 `docs/thesis-case/analytical-four-original.json`（Claude 依 Analytical-Four 提交 f49cfd3 的 `main.py` 寫成，唯讀依據）：

- 三個生產邏輯：每日模式（15 節點）、客訴模式（20 節點）、事後回饋 `event_feedback_record`（4 節點，`main()` 不呼叫它）。邊依 `Analytical_Four_System.main()` 的呼叫順序串成一條線。
- 每個節點記 `function`、`file`、`defLine`、`kitNodes`（人工判斷它對應 Kit `workflow.aov.json` 的哪個節點，可多個）。
- `observations` 記四項從程式讀到的事實（O1 至 O4），原樣帶進比較文件。

Codex 不得修改這個 JSON 的內容（它是依據）；發現與 `kits/analytical-four-kit/workflow.aov.json` 對不上（例如 `kitNodes` 的 id 不存在）時，寫在 Codex Notes 並停下。

### 5.2 要做的

1. 轉換模組：把上述 JSON 轉成 `composer-aov-list` 版本 5 的畫布文件（一個工廠、三個生產邏輯，節點都是 `actionId: null` 的業務節點，名稱用 JSON 的 `name`）。仿 `apps/composer-gui/src/kitExamples.ts` 的 `kitWorkflowToCanvas` 與其共用的 `canvasWithLayout`；不得複製貼上它們的邏輯，能共用就共用。
2. 產生檔 `docs/thesis-case/analytical-four-before.aov.json`：轉換結果，必須能由獨立畫布（`aov-canvas.html`）的 `importAny` 載入且零錯誤。
3. 結構比較：純函式計算下列各項，輸出成 `docs/thesis-case/analytical-four-comparison.md`（繁體中文、表格）：
   - 使用前：每個邏輯的節點數、連線數；不重複的函式數（`function` 去重）。
   - 使用後：Kit 的節點數 23、連線數 22（由 `workflow.aov.json` 實際讀取，不得寫死）。
   - 對應：每個使用前節點對應到哪些 Kit 節點；每個 Kit 節點被幾個使用前節點對應（粒度比）；沒有任何使用前節點對應的 Kit 節點清單（Kit 新增的環節）；沒有任何對應的使用前節點清單（應為空，若不為空照實列出）。
   - 順序差異：使用前每條相鄰邊 a→b，若 a、b 對應到不同的 Kit 節點 ka、kb，且 Kit 的邊中從 kb 可到達 ka（反向），就列為順序差異。
   - 原專案觀察 O1 至 O4 與來源標示（作者 ZHAO-XIAN、提交 f49cfd3、無 LICENSE 檔）原樣列出。
   - 文件開頭一段說明：節點粒度不同（使用前是函式、使用後 Kit 的分析階段是把多個函式合成一個節點），對應關係是人工判斷。
4. 產生方式：仿 `scripts/kit-changelog.mjs` 的作法（Node 型別剝除）寫一支腳本，或在 vitest 中提供更新模式，二選一，在 Codex Notes 說明理由。要有「檢查」模式：產生檔與重新計算的結果不同時失敗，並納入 `npm test`。

### 5.3 測試

1. 轉換結果通過 `exportAovGraphDraft` 且經 `importAny` 往返內容相同；三個邏輯各自的節點數與邊數符合 JSON（15、20、4 個節點，各自節點數減一條邊）。
2. 參照完整性：所有 `kitNodes` 的 id 都存在於真實的 `workflow.aov.json`；Kit 的 22 個節點數由檔案讀得。
3. 比較函式用一份小型手算輸入驗證每一項（含順序差異的反向判斷、沒有對應的節點）；這些測試要在判斷條件改動時失敗。
4. 實際資料的預期值先由 Claude 手算，寫在 mailbox 的 Claude Handoff，Codex 的測試必須以這些值檢查實際輸出（見該 thread）。
5. 產生檔過期檢查（5.2 第 4 點）。

### 5.4 不做

- 不改 Kit、不改 `libs/case-store`、不改畫布的行為；不新增依賴。
- 不寫入 Analytical-Four 專案；不把原專案的任何程式碼複製進來，只引用函式名稱、檔案與行號。

## 6. 不在範圍內

- 速度的「使用前後比較」暫緩（user 2026-11-10：細節還要思考）。批一只量 Kit 這一側。
- 人的操作時間、可用性與易用性量表、受試者設計。
- 真實 LLM 服務的耗時（假服務取代）、真實場域資料。
- 修改原專案 Analytical-Four（唯讀）。

## 7. 已知限制

- 示範資料極小，量到的是固定開銷為主，不代表真實場域。
- 輪詢精度約 20 毫秒，短於此的階段只能得到上限。
- 程序內 TestClient 不含網路與瀏覽器時間。
