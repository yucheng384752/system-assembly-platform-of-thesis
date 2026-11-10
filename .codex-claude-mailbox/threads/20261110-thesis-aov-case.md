# 論文案例：Analytical-Four 使用 AoV 前後

契約：`docs/thesis-aov-case.md`。決議：D200、D201。分支：`feature/thesis-aov-case`。

## 批一：Kit 量測腳本

### Claude Handoff

做契約第 4 節。只新增 `kits/analytical-four-kit/tools/measure_kit.py` 與 `kits/analytical-four-kit/tests/test_measure_kit.py`，不改 4.1 列的禁改檔案、不新增依賴、不 git 寫入。完成後把摘要寫在下面的 Codex Notes：做了什麼、跑了哪些測試與結果、做不到的與原因。Kit 測試需要 pandas、chromadb、sentence-transformers、fastapi，你的沙箱可能跑不了，跑不了就明說，不要假裝通過；統計函式等純邏輯的測試請寫成不依賴這些重套件。

### Codex Notes

2026-11-10 Codex：批一腳本與測試已寫入，純邏輯驗證通過；尚未完成 Kit 環境驗收。

實作內容：

- `tools/measure_kit.py` 提供必要的 `--out`、預設 5 次的 `--repeats` 與 `--only G,I,A`。拒絕 repo 內輸出；資料使用 repo 外暫存目錄及 `seed_demo`，每個情境／檔案／調整均隔離，避免每日分析改寫分布庫影響後續情境。
- G 使用 TestClient、`perf_counter` 與 20 ms 輪詢，量每日 A/B、客訴 A/B/C 的總時間與階段時間。保留第一次 running／終止觀察；skipped 不計時。沒有觀察到 running 的完成階段記錄輪詢區間上限並在 notes 列明。失敗分析整次不納入統計。
- 假診斷服務以程序內替換 `pipeline.requests.post` 回傳與既有 FakeLlm 相同結構的資料，不開監聽埠、不呼叫真實 LLM；輸出說明不代表真實模型時間。
- I 逐檔執行上傳、讀取驗證報告、接受與 data-check，記錄 bytes、CSV 列／欄數；不支援或檢查失敗的檔案留下失敗紀錄，不假裝導入成功。
- A 固定四項依原順序：關閉 C、daily 改 complain、timeoutSeconds 30 改 60、timestamp 對照 measurement_timestamp。每項還原同一份 daily、A/B/C 啟用的起始設定；PUT 後讀取 status 與 data-check，檢查不通過會記錄失敗。依設定模型與檢查程式閱讀，未發現四項本身無法設定的情形；實際 Kit 冒煙仍待執行。
- JSON／Markdown 包含環境、全部成功原始樣本、最近排名 p95、可靠性旗標、逐次失敗與限制說明；有失敗即非零結束碼。

本次異動僅三個檔案：

1. `kits/analytical-four-kit/tools/measure_kit.py`（新增）
2. `kits/analytical-four-kit/tests/test_measure_kit.py`（新增）
3. 本 thread（填入 Codex Notes）

未修改 `src/`、`kit.contract.json`、`manifest.json`、`workflow.aov.json`；未新增依賴、未 git 寫入。既有未追蹤 `Claude outputs/` 未動。未更新 mailbox index，以遵守此次限定檔案範圍。

測試與結果：

- 使用既有 `C:/Users/gslab/AppData/Roaming/uv/python/cpython-3.10.20-windows-x86_64-none/python.exe -B kits/analytical-four-kit/tests/test_measure_kit.py -v`：10 項中 **9 通過、1 略過**。直接執行 unittest，避免載入 Kit 的重套件 conftest；也可由完整 Kit pytest 環境收集。
- 已驗證統計／無效樣本、首次階段狀態與短階段上限、G 輪詢及總時間、分析失敗排除與非零碼、輸出格式與 git 缺失 null、拒絕 repo 內輸出、四項調整及還原順序、檢查失敗不納入成功樣本、I 四步與不支援種類拒絕。
- `git diff --check` 通過（當時新增檔尚未追蹤，此命令不涵蓋新檔）；新 Python 檔已由上列測試實際載入執行。
- 測試報告僅寫入系統暫存目錄，測試結束清除；沒有量測輸出寫進 repo。

尚未做到與原因：

- A 端到端冒煙測試已寫好，但本環境缺少 pandas、chromadb、sentence_transformers、fastapi、httpx，因此明確 skip。沒有跑 Kit 完整測試、G／I 端到端或實際 `--repeats 5`，不可視為通過。PATH 的 python 是無法啟動的 Windows Apps 別名；改用上述現有 Python，未安裝套件。
- **契約與現有 API 缺口**：示範檔 `known_base.json` 不在 `data_checks.KIND_TARGETS`／`uploads.KINDS` 支援種類內。不能經要求的 POST uploads → GET report → accept 路徑導入。腳本逐次在 `failures` 記錄原因及檔案資料，因此包含 I 的完整執行預期非零；沒有改 API、沒有另換清單或跳過此檔。此缺口需由契約負責人決定處理，批一完整驗收尚未成立。
- `manifest.json` 只有 kit 名稱，沒有版本欄位；輸出保留 `environment.version: null` 並在 notes 說明，未捏造版本。git 讀不到時同樣保留 `environment.git: null`。

交接：請 Claude 在既有 Kit 測試環境執行本測試與 A 冒煙，確認四項的實際資料檢查結果；處理上述 I 契約缺口後，再按 4.6 跑完整測試與 `--repeats 5`，僅把外部 JSON／Markdown 摘要貼回 thread。

#### Follow-up

2026-11-10：依修訂後 4.2，I 僅量測六種允許種類對應的八個非空示範檔；排除每日模式產生、不能上傳的 `known_base.json` 與 writer 拒絕的 0 位元組案例檔，原因寫入輸出 notes，不記為 failures。另拒絕直接呼叫 `import_file` 上傳空檔。前述「I 預期非零／契約缺口」已由此次契約修訂解除。

修改 `tools/measure_kit.py`、`tests/test_measure_kit.py` 與本 thread，未改 src、未新增依賴或 git 寫入。新增回歸測試，以實際示範檔副本及模擬 API 跑兩輪 I，驗證八檔／32 個量測點、零失敗與報告結束碼 0；再清空允許種類的 topology.json，確認空檔與 known_base.json 均不會送至上傳 API。新增真實 I 冒煙測試。

執行既有 Python 3.10.20：`C:/Users/gslab/AppData/Roaming/uv/python/cpython-3.10.20-windows-x86_64-none/python.exe -B kits/analytical-four-kit/tests/test_measure_kit.py -v`，結果 **12 項：10 通過、2 略過**。A／I 真實冒煙因缺少 pandas、chromadb、sentence_transformers、fastapi、httpx 而略過；完整 Kit I 執行仍待依賴齊全的環境驗證，未宣稱實測通過。`git diff --check` 通過；測試資料與報告僅放 repo 外暫存目錄並清除。

#### Follow-up 2

2026-11-10：已檢查 manifest、requirements.txt 與 requirements-test.txt；前兩者未直接宣告 Python 最低版本，requirements-test.txt 明確要求 Python 3.10+，符合 `ignore_cleanup_errors` 的支援版本。`demo_client` 改用 `TemporaryDirectory(prefix='measure-kit-', ignore_cleanup_errors=True)`，避免 Windows 向量資料庫仍開啟檔案造成清理錯誤，進而把已完成量測誤列失敗。報告 notes 明列系統暫存資料夾下的 measure-kit- 目錄可能因此殘留。

新增純邏輯回歸測試：替換重套件匯入，保留實際 demo_client 與 TemporaryDirectory 清理流程，讓 shutil.rmtree 的錯誤回呼收到 NotADirectoryError 267；確認成功樣本保留、failures 為空、報告有殘留目錄說明，最後由測試清除暫存目錄。執行 `C:/Users/gslab/AppData/Roaming/uv/python/cpython-3.10.20-windows-x86_64-none/python.exe -B kits/analytical-four-kit/tests/test_measure_kit.py -v`：**13 項，11 通過、2 略過**；A／I 冒煙仍因缺少 pandas、chromadb、sentence_transformers、fastapi、httpx 而略過。`git diff --check` 通過。未重跑真實 chromadb 的完整五輪量測，待協調端驗證。

僅修改 measure_kit.py、test_measure_kit.py 與本 thread；未修改 src、依賴或 git。

#### Follow-up 3

2026-11-10：僅在 generation 的輪詢 GET /runs/{id} 加入暫時讀取失敗重試：TestClient 例外或 HTTP 5xx 最多重試三次，每次間隔 10 ms（含原始請求共四次）；HTTP 4xx 與 POST 不重試，I／A 流程不變。成功或耗盡重試都將實際重試次數以量測點名稱寫入 notes；重試等待保留在總耗時內，耗盡仍由原有 failures 流程記錄。

新增測試驗證：PermissionError 與 HTTP 503 連續兩次後成功，樣本保留且含重試耗時與 notes；連續四次讀取失敗，沒有成功樣本且記錄失敗與三次重試；POST 例外及 HTTP 404 不重試。執行 `C:/Users/gslab/AppData/Roaming/uv/python/cpython-3.10.20-windows-x86_64-none/python.exe -B kits/analytical-four-kit/tests/test_measure_kit.py -v`：**16 項，14 通過、2 略過**。A／I 真實冒煙仍因缺少 pandas、chromadb、sentence_transformers、fastapi、httpx 而略過；未重跑真實 Kit 五輪量測。`git diff --check` 通過。僅修改指定腳本、測試與本 thread；未修改 src、依賴或 git。

### Claude Review（批一）

2026-11-10 Claude：已驗收。

- 契約修正：4.2 的 I 原本寫「每個示範資料檔」，但 `known_base.json` 由每日模式產生、不能上傳，兩個案例檔是 0 位元組會被上傳 writer 拒絕。這是契約寫錯，不是 Codex 的錯，已改契約，沒有改 Kit。
- 實測找到兩個工具缺陷，各經一次修正：（1）Windows 上 chromadb 佔住檔案，暫存目錄清除失敗，使成功的客訴模式樣本被當成失敗；改為忽略清除錯誤並在報告備註說明暫存資料夾可能殘留。（2）輪詢分析狀態時，Kit 正在取代 `status.json`，Windows 上讀取會被拒；改為只對 G 的輪詢重試至多 3 次並把次數寫進備註（Kit 實際在 Linux 執行，不會發生）。
- 驗證環境：Analytical-Four 的 venv（Python 3.10，有 pandas、chromadb、sentence-transformers）加上暫存資料夾裡的 fastapi 與 pytest（只在 scratchpad，未動原專案環境）。
- 結果：`tests/test_measure_kit.py` 16 通過、0 略過；`--repeats 20` 全部量測點 n=20、失敗 0、結束碼 0，p95 標為可靠。禁改檔案（`src/`、`kit.contract.json`、`manifest.json`、`workflow.aov.json`）未變動。
- 量測摘要（示範資料、系統回應時間、非真實場域）：每日模式分析總時間中位數約 0.18 秒；客訴模式約 0.36 秒，其中 RAG 約 0.11 秒；導入每步約 0.006 至 0.03 秒；四項設定調整約 0.03 至 0.04 秒。完整 JSON 與 Markdown 在 scratchpad，不進 repo。
- 已知限制：Kit 的 manifest 沒有版本欄位（環境記錄的版本為 null）；LLM 為假回應；階段耗時精度約 20 毫秒，多個階段只能報上限。

## 批二：使用前的 AoV 與結構差異

### Claude Handoff

做契約第 5 節。依據檔 `docs/thesis-case/analytical-four-original.json` 不得修改。範圍、禁改項與要求見契約 5.2 至 5.4。

Claude 用獨立的 Python 腳本對真實資料算出預期值，你的測試必須以這些值檢查實際輸出（算法不同，所以是獨立對照；若你的結果不同，先查你的實作，確定我的值有誤時在 Codex Notes 說明，不要改測試去遷就）：

- Kit：23 節點、22 條連線。
- 使用前：每日 15 節點 14 邊；客訴 20 節點 19 邊；事後回饋 4 節點 3 邊；節點合計 39；不重複的函式 24。
- 被使用前節點對應到的 Kit 節點 13 個：configure 2、read-data 7、descriptive 6、diagnostic 10、topology 2、rag 2、ng-code 2、compile 1、search-key 1、similarity 1、llm 1、submit-feedback 3、publish-library 1（數字是「被幾個使用前節點對應」，以節點個數計）。
- 以不重複函式計，每個 Kit 節點對應幾個函式：read-data 4、descriptive 3、diagnostic 5、submit-feedback 3，其餘 1。
- 沒有任何使用前節點對應的 Kit 節點 10 個：accept-upload、approve-feedback、check-data、check-ready、get-templates、load-demo、start-run、upload-files、view-results、view-run。
- 沒有對應 Kit 節點的使用前節點：0 個。
- 順序差異恰好 2 筆：每日的 d-rag→d-ng-code，與客訴的 c-rag→c-ng-code（Kit 的順序是 ng-code 先於 topology 與 rag）。

### Codex Notes

（待填）
