# analytical-four-kit：資料模型與介面

日期：2026-11-01
對應：決議 D154；來源專案 Analytical-Four（commit f49cfd3）；Kit 目錄 `kits/analytical-four-kit/`。
狀態：已實作並以後端測試、系統包組裝、Linux 映像建置、本機 LLM，以及在 Ubuntu 虛擬機用安裝引擎完整安裝後操作驗證；AI 診斷層在完整安裝中、離線無快取的模型下載與真實資料未驗證（見第 7、15 節）。

## 1. 範圍

把 Analytical-Four 的製造數據分析做成可選配的 Kit。分析分三層，由 Kit 設定開關：

| 層 | 內容 | 對應 Composer 子功能 |
|---|---|---|
| A 統計與異常診斷 | 讀取整理、基準統計、IQR 超界、相關性、PCA、T2 與 SPE、特徵貢獻排名、事件序列化 | `layer-a` |
| B 不良類型診斷 | 每日模式用 NG 樣本更新不良特徵分布庫；客訴模式用分布庫推估不良類型 | `layer-b`（依賴 A） |
| C 完整 AI 診斷 | 製程拓樸對應、SOP 檢索；客訴模式再加彙整、搜尋關鍵、相似案例、LLM 綜合診斷 | `layer-c`（依賴 A；客訴模式另需 B，設定驗證會擋下） |

規則：B、C 需要 A；客訴模式的 C 需要 B（彙整步驟讀 B 的預測）。每日模式的 C 不執行彙整、相似案例與 LLM（沿用原專案 `main()` 的行為），這些階段在執行紀錄標為 `skipped`。

不在範圍：預測模型（`analysis/predictive`）、繪圖、Gemini 直連分析、原專案 `ErrorAnalysis` 的誤判統計（回饋與案例庫見第 8 節，錯誤原因欄位目前留空）。

## 2. 資料模型

### 2.1 資料目錄

環境變數 `ANALYTICAL_FOUR_DATA_DIR`，未設定為 `/system/data/analytical-four`（系統包中的持久化資料卷）。目錄內：

| 路徑 | 內容 | 誰寫入 |
|---|---|---|
| `settings.json` | Kit 設定（2.2） | 設定路由 |
| `config/analysis_config.json` 等 | 分析設定檔，原 Analytical-Four 格式（2.3） | 維運人員 |
| `data/*.csv`、`cases/*.jsonl`、`config/*` | 資料與知識檔 | 維運人員，或示範資料 |
| `known_base.json` | 不良特徵分布庫（路徑由分析設定的 `baseline_data.prescriptive` 指定） | 每日模式的 B 層覆寫 |
| `rag/` | 向量庫（路徑由 `rag_setting.db_path` 指定） | C 層 |
| `runs/<run_id>/` | 每次分析（2.4） | 執行器 |

### 2.2 `settings.json`

```
schemaVersion  1
layers         { a: bool = true, b: bool = true, c: bool = false }
mode           "daily" | "complain"            預設 daily
analysisConfig 資料目錄內的相對路徑             預設 config/analysis_config.json
llm            { endpoint: string = "" (最長 500)，timeoutSeconds: 1..900 = 120，apiKeyEnv: 環境變數名稱或空字串 }
columnMapping  { 場域欄名: 引擎欄名 }，預設空（見第 10 節）
```

驗證（寫入時與讀取時相同，不合法一律 422）：B 或 C 開啟時 A 必須開啟；客訴模式開啟 C 時 B 必須開啟；`llm.endpoint` 空字串或 http／https 網址，不含空白、控制字元、帳號密碼；`apiKeyEnv` 須為大寫英數底線名稱（金鑰值只存在環境變數，`secret_ref`）；`analysisConfig` 不可是絕對路徑、不可含 `..`，解析後必須在資料目錄內。

### 2.3 分析設定檔

沿用原格式：`data_source`（`current_data`、`baseline_data`、`case_data`、`llm_setting`、`rag_setting`）、`method`、`mode`、`serializer`、`observer`、`feature`、`datetime`。Kit 不修改它，執行時衍生一份副本：`data_source` 內所有路徑欄位改為資料目錄內的絕對路徑（超出資料目錄即拒絕），`mode` 與 `llm_setting.api_endpoint` 以 Kit 設定覆蓋。衍生副本存於該次執行資料夾。

### 2.4 執行紀錄 `runs/<run_id>/status.json`

`run_id` 格式 `YYYYMMDDTHHMMSSZ-<8 位十六進位>`。

```
runId, state (queued|running|succeeded|failed), createdAt, startedAt, finishedAt, createdBy
mode, layers
stages[]  { id, layer, name, state (pending|running|done|skipped|failed|interrupted), detail }
error     null 或 { stage, message }
warnings[] { layer, code, message }：啟動時的資料檢查警告，加上執行中被引擎改動的事（見第 10 節）
llm       { endpointSet: bool, apiKeyEnv }      不保存位址本身與金鑰
```

同資料夾另有 `settings.snapshot.json`（當時的設定）、`analysis_config.derived.json`（衍生設定）、`results/`（結果檔）。階段 id 與順序：`read-data`、`descriptive`、`diagnostic`（A）；`ng-code`（B）；`topology`、`rag`、`compile`、`search-key`、`similarity`、`llm`（C）。AoV 與此一致，由測試檢查。

結果檔名是 `results/` 內實際存在的相對路徑清單（例如 `pca_spe_t2.json`、`serialized_events/event_<id>.json`）；讀取時名稱必須在清單內，不接受其他路徑。

## 3. 執行規則

- 啟動前逐層檢查就緒（資料檔、設定檔、LLM 位址等），任何未就緒即回 409 並逐項列出原因，不啟動。
- 同時間只有一次分析（409）；在 API 行程的背景執行緒執行。狀態存檔案，服務重啟時仍標為 `queued` 或 `running` 的執行改標 `failed`，階段標 `interrupted`。
- 任一階段失敗：記錄失敗階段與訊息，其餘階段不執行，已完成階段的結果檔保留。不自動重試。
- 資料讀取、選欄、寫檔失敗會丟出例外（原專案是記錄後回傳 None 或略過）。設定的數值特徵在資料中找不到時不中止，但在 `read-data` 階段的 `detail` 寫出數量；目標欄位找不到則中止。
- 引擎不得寫入工作目錄：已移除拓樸摘要的除錯寫檔，已知分布庫改寫到設定指定的路徑；測試以空的工作目錄驗證。

## 4. 介面

全部在 `/api/analytical-four` 下，身分取自入口權限中介層，沒有身分回 401。

| capability | 方法與路徑 | 入口（預設角色） |
|---|---|---|
| `analytical-four.settings.get` | GET `/settings` | `analytical_four.view`（admin、manager、operator、audit） |
| `analytical-four.status.get` | GET `/status` | 同上 |
| `analytical-four.data.check` | GET `/data-check` | 同上 |
| `analytical-four.templates.list` | GET `/templates` | 同上 |
| `analytical-four.templates.get` | GET `/templates/{name}` | 同上 |
| `analytical-four.runs.list` | GET `/runs` | 同上 |
| `analytical-four.runs.get` | GET `/runs/{run_id}` | 同上 |
| `analytical-four.results.list` | GET `/runs/{run_id}/results` | 同上 |
| `analytical-four.results.get` | GET `/runs/{run_id}/result?name=` | 同上 |
| `analytical-four.feedback.list` | GET `/feedback?status=&limit=` | 同上 |
| `analytical-four.library.versions` | GET `/library/versions` | 同上 |
| `analytical-four.runs.create` | POST `/runs`（202） | `analytical_four.run`（admin、manager、operator） |
| `analytical-four.feedback.submit` | POST `/feedback`（201） | `analytical_four.feedback_submit`（admin、manager、operator） |
| `analytical-four.feedback.import` | POST `/feedback/import`（201） | 同上 |
| `analytical-four.feedback.decide` | POST `/feedback/{feedback_id}/decision` | `analytical_four.feedback_approve`（admin、manager） |
| `analytical-four.library.publish` | POST `/library/publish`（201） | 同上 |
| `analytical-four.library.restore` | POST `/library/restore`（201），body `{version}` | 同上；把舊版本內容發布成新版本，不改寫歷史 |
| `analytical-four.settings.put` | PUT `/settings` | `analytical_four.configure`（admin） |
| `analytical-four.demo.load` | POST `/demo`（201） | 同上 |

錯誤：401 沒有身分；404 找不到該次分析、結果檔、事件或回饋；409 未就緒、另一次分析進行中、或操作與目前狀態衝突；413 匯入內容過大；422 設定或輸入不合法；500 回饋或版本檔損毀。

## 5. 示範資料

`app/analytical_four/demo_data/` 是合成資料，由 `demo/generate_demo.py` 以固定亂數種子產生，不含任何真實機台、批號或量測。包含每日與客訴兩份分析設定、基準與待分析 CSV、不良代碼、拓樸、SOP 知識、空白案例檔，以及用每日模式產生的 `known_base.json`。向量模型設為 `builtin-hash`（不需下載模型）。載入方式：`python -m app.analytical_four.seed_demo` 或 POST `/demo`；已存在的檔案不覆蓋。

## 6. 安全

- 資料目錄外的路徑一律拒絕（設定、分析設定檔內的每個路徑欄位、結果檔名）。
- LLM 位址會收到事件資料（含機台、批號、量測值），只可填寫信任的服務；位址不含憑證，金鑰用 `apiKeyEnv` 指向環境變數，執行紀錄與設定快照都不保存金鑰值。只有管理員可改。
- 角色清單由入口權限中介層執行；授權效果的整合測試未涵蓋。
- 示範資料全為合成。實際製造資料進入資料目錄後，不會被提交到 repo（資料目錄在執行環境，不在 repo）。

## 7. 未驗證與限制

- 映像已在 Linux、Python 3.12.8 建置並跑過測試（第 15 節）；完整部署堆疊（PostgreSQL、登入、授權閘門、Nginx）已由 `verify/kit-standalone` 在 Ubuntu 虛擬機用安裝引擎安裝並操作過（第 15 節），那次的 AI 診斷層預設關閉，沒有跑。
- 預設向量模型 `intfloat/multilingual-e5-large-instruct` 已用本機快取離線載入並跑完整流程（第 15 節）；自動化測試與示範用 `builtin-hash`，只比對字詞。沒有快取時要下載約 2 GB，這條路徑沒測。
- 真實 LLM 服務：2026-11-01 以本機 Ollama（qwen3:14b）經 Analytical-Four 的 `local_llm_server.py` 轉接層驗證過一輪（未修改該轉接層，只綁定回送位址），見第 9 節；自動化測試仍用本機假服務。公司內的實際 LLM 服務未連線。
- 引擎本身仍有未改的行為：序列化器把單一事件的失敗寫入事件而不丟例外（已由 `diagnostic_stage` 檢查）、不良診斷輸出大量 print、向量庫只以筆數判斷是否重建。
- 單一行程單一執行；多個 worker 同時服務時，執行互斥只在行程內有效（系統包的容器為單一 worker）。
- 推論品質只用合成資料驗證了「不良代碼推估能還原資料中植入的缺陷」，沒有真實資料的準確度數字。

## 8. 回饋與案例庫版本

分析後可對客訴診斷的事件提交「確認結果」，經核可後發布成案例庫新版本；下一次分析的相似案例搜尋與誤判提示讀的就是這份案例庫。

### 8.1 資料模型（資料目錄內，只追加、不修改、不刪除）

| 檔案 | 每行內容 |
|---|---|
| `feedback/entries.jsonl` | `feedbackId`（16 位十六進位）、`submittedAt`、`submittedBy`、`submittedRole`、`source`（`run` 或 `import`）、`runId`、`note`、`isNewCode`（確認的代碼不在不良代碼定義內為 true，定義讀不到為 null）、`record`（完整案例紀錄，格式見下） |
| `feedback/decisions.jsonl` | `feedbackId`、`approve`、`decidedBy`、`decidedRole`、`decidedAt`、`note` |
| `feedback/library/vNNNN/` | `llm_records.jsonl`、`llm_error_records.jsonl`、`manifest.json`（`version`、`createdAt`、`createdBy`、`baseVersion`、`startedFromExistingFile`、`addedFeedbackIds`、`replacedEventIds`、`recordCount`、`errorRecordCount`、各檔 sha256） |

案例紀錄沿用相似案例搜尋讀取的格式（`schema_version` 2.0 的事件紀錄）：`event_id`、`summary`（`anomaly_features`、`sop_keys`、`categorical`）、`diagnosis_results`（含 `score_breakdown` 的 `anomaly`、`metrics`、`env`）、`conclusion`、`feedback`（`confirmed_ng`、`actual_cause`、`confirmed_by`、`confirmed_at`、`was_correct`、`label_source`）、`error_analysis`（`was_correct`；`error_reasons` 與 `delta` 目前為空）。`was_correct` 由 `conclusion.final_ng`（沒有則 `suggested_ng_code`）與 `confirmed_ng` 比對得出。`confirmed_by` 一律取自提交者的身分，不採用匯入檔自己寫的。

### 8.2 規則

- 誰可提交：預設管理員、經理、操作員（入口 `analytical_four.feedback_submit`，可在入口權限調整）。誰可核可與發布：預設管理員、經理（入口 `analytical_four.feedback_approve`）。
- 經理或管理員提交的回饋在提交時同時核可，核可紀錄的備註註明；操作員提交的維持待核可，核可後才可進案例庫。經理與管理員可核可自己的提交（暫定規則，之後如要禁止，只需改核可處）。
- 每筆回饋只有一次決定（核可或駁回）；要更正請重新提交。同一個 `event_id` 在新版本中以最後核可者取代，舊版本不動。
- 確認的不良代碼可以是新的（不在定義內），只限英數字、底線與連字號、最長 50 字；新代碼要等每日模式的 B 層用該代碼的樣本訓練後，才會成為 B 層可推估的類別。
- 匯入：一次最多 500 筆、5 MB，每筆最多 100 KB；任何一筆不合法整批不寫入。匯入的紀錄走相同的核可規則。
- 發布：把「已核可且尚未發布」的回饋加進最新版本的內容，產生下一個版本；第一個版本以設定指定的案例檔現有內容為起點。發布後，分析設定指定的兩個案例檔（`case_data.llm_records`、`llm_error_records`）被替換為最新版本的內容。`llm_error_records` 只放 `was_correct` 為 false 的紀錄。分析進行中不可發布（409）；沒有新的已核可回饋也不可發布（409）。
- 歷史檔損毀（無法解析的行）時，讀取與發布都以 500 回報行號，不略過。

### 8.3 限制

- 沒有回復到舊版本的操作；舊版本檔案完整保留，需要時可由維運人員手動複製。
- LLM 服務若回傳完整填寫的事件紀錄，回饋會以它為底；否則以搜尋關鍵紀錄為底。真實 LLM 服務的回傳格式未驗證。
- 兩個案例檔的替換各自是原子的，兩個檔之間不是；因此發布時禁止分析進行。
- 單一行程內以鎖保護；多個 worker 同時發布不受保護（系統包為單一 worker）。

## 9. 以本機 LLM 的實測（2026-11-01）

環境：Ollama 的 qwen3:14b，Analytical-Four 的 `local_llm_server.py`（`POST /diagnose`，回傳完整事件紀錄，只改寫 `llm_analysis` 與 `conclusion`）。Kit 設定 `llm.endpoint` 指向它，`timeoutSeconds` 600，示範資料，客訴模式，A、B、C 全開。

| 項目 | 結果 |
|---|---|
| 第一輪（案例庫為空） | 成功，6 筆事件約 100 秒；6 筆回應都是模型產生的審核意見，無保底結果；模型引用了 SOP 條目，並指出沒有歷史案例可參考 |
| 對 6 筆事件提交確認結果並發布案例庫 v0001 | 成功；案例紀錄帶有模型的審核意見，`confirmed_by` 為提交者 |
| 第二輪 | 成功，約 36 秒；相似案例被帶進請求，模型引用歷史案例編號，`case_agreement` 為 true，信心度 high，不需人工 |

注意：這一輪第二次分析重用了同樣的產品編號，所以後來被發現的問題沒有露出——引擎的相似案例搜尋原本連產品編號一起比對，新的客訴（不同產品編號）永遠找不到案例。已於同日修正（機台限制比對排除產品編號，見 `SOURCE.md`），並把測試改成第二次分析使用不同的產品編號。

這證實：回傳完整事件紀錄是這個 LLM 服務的實際契約，回饋以它為底的假設成立；回饋進案例庫確實改變下一次的診斷內容。

已知風險與處理：轉接層原本在 Ollama 呼叫失敗時回 HTTP 200 加保底結果（已用不存在的模型名稱驗證），Kit 分辨不出失敗，`llm` 階段會顯示完成。同日已改轉接層：失敗、逾時或回應無法解析時回 HTTP 502。這份轉接層現在放在本專案的 `kits/analytical-four-kit/tools/local_llm_adapter.py`（開發與測試工具，不隨系統包出貨，不修改也不提交到 Analytical-Four 專案）；預設只綁 `127.0.0.1:8001`，可用 `ADAPTER_HOST`、`ADAPTER_PORT`、`OLLAMA_URL`、`OLLAMA_MODEL` 覆寫。啟動：`python kits/analytical-four-kit/tools/local_llm_adapter.py`，需要 `requests` 與本機 Ollama；把 Kit 設定的 `llm.endpoint` 填成 `http://127.0.0.1:8001/diagnose`。測試用假的 Ollama 驗證 502、模型回答的處理與預設綁定位址。以不存在的模型名稱重測：轉接層回 502，Kit 的 `llm` 階段標為失敗，錯誤訊息為「LLM 服務回應 HTTP 502」，前面階段的結果檔保留。Analytical-Four 自己的 `main.py` 的 `analyze_with_llm()` 沒有檢查狀態碼，收到 502 的內容會當成回應收下；那是該專案的程式，這次未改。

## 10. 欄位對照與資料檢查

新場域的欄位名稱通常和引擎讀取的不同，而引擎遇到不合的資料常常是悄悄略過或悄悄退化。這一節的功能把它們變成事前的明確回報（動機與實驗見 `docs/analytical-four-site-onboarding.md`）。

### 10.1 欄位對照

`settings.json` 的 `columnMapping`：`{ 場域欄名: 引擎欄名 }`。每個 CSV（待分析資料、正常基準）讀進來後立刻改名，所以分析設定檔的 `feature` 一律寫改名後的名稱。需要對照的主要是引擎寫死的情境欄位：`P1.Machine_No.`、`P1.Material`、`Slitting machine`、`Winder number`、`Quality inspection`、`Quality control`、`P3.Machine_No.`，以及不良代碼欄位（`P3.NG_code`，observer 為 P2 時是 `P2.NG_code`）。數值特徵的名稱可以是任何名字，不必對照，但拓樸檔裡的特徵 `name` 要和（改名後的）欄名一致。

規則：最多 200 筆；名稱不可空白、不可前後有空白、最長 100 字；兩個場域欄位不可對到同一個名稱（422）；對照後會與檔案裡已有的欄名重複則檢查報錯；對照中的欄位在某個檔案不存在只警告（不同檔案的欄位可以不同）。

### 10.2 資料檢查

`GET /data-check`（`analytical-four.data.check`）回傳 `{ ok, errors[], warnings[], summary }`，每項有 `layer`、`code`、`message`。啟動分析時會先做同一個檢查：有 error 回 409 並列出原因，不啟動；warning 存進該次執行紀錄的 `warnings`。檢查不寫任何檔案。

| 嚴重度 | code | 內容 |
|---|---|---|
| error | `observer`、`method`、`serializer`、`observer-group` | 引擎會悄悄改用預設值的設定，或 observer 指向不存在的特徵組 |
| error | `target`、`categorical`、`numeric` | 缺目標欄位、缺設定的類別欄位（一次列出全部）、數值特徵一個也找不到 |
| error | `not-numeric` | 數值欄位有文字（指出欄位與例子；CSV 讀入時 `n/a`、空字串等已被視為空值，不算文字） |
| error | `id-duplicate` | 會變成事件的列（客訴模式為全部待分析列，每日模式為待查組）ID 重複，引擎會把它們合併 |
| error | `baseline-empty-cells`、`baseline-missing-feature`、`baseline-rows` | 客訴模式的基準不會被引擎清理，有空值會讓 PCA 失敗（指出欄位與筆數）；基準缺待分析資料有的特徵；基準少於 2 列 |
| error | `target-groups` | 每日模式清理後目標欄位少於 2 種值 |
| error | `ng-column`、`known-base` | 每日模式 B 層缺不良代碼欄位；客訴模式 B 層的不良特徵分布庫不存在或是空的 |
| error | `case-json`、`mapping-collision`、`cleaning`、`csv`、`config` | 案例檔有無效 JSON 行、對照造成重複欄名、清理後沒有資料、CSV 無法讀取、設定無法使用 |
| warning | `rows-dropped` | 清理（刪除含空值的列）會刪掉幾列，哪些欄位有空值 |
| warning | `numeric-missing`、`id-missing` | 部分數值特徵不在資料中；沒有 ID 欄位（以列號識別） |
| warning | `baseline-small`、`baseline-constant` | 基準列數不多於特徵數；基準中整欄同一個值 |
| warning | `target-extra-groups` | 每日模式目標欄位多於兩種值，只用最小的兩組 |
| warning | `ng-labels` | 每日模式待查樣本沒有任何有效不良代碼，分布庫會是空的 |
| warning | `context-missing` | 事件情境欄位不在資料中或沒列入設定的類別欄位（B、C 層會退化） |
| warning | `topology-unmatched`、`topology-uncovered`、`topology-format` | 拓樸特徵名稱不是欄名（會被略過）；數值特徵不在拓樸中；拓樸結構不符 |
| warning | `sop-fields` | SOP 檔有列的欄位數與標題列不同（常見為欄位內含逗號） |
| warning | `mapping-unused` | 對照中的欄位在該檔案不存在 |

`summary` 含欄位數、列數、清理後列數；每日模式另有 `sampleGroup`、`baselineGroup`、`sampleRows`、`baselineRows`，也就是目標欄位的哪個值被當成待查、哪個值被當成基準（較小的值是待查，顛倒時整個結果會反過來，所以明講）。

### 10.3 執行紀錄的 `warnings`

`status.json` 多一個 `warnings`：啟動時檢查留下的警告，加上執行中引擎自己做了、使用者沒要求的事（目前是清理刪除的列數，`code` 為 `run-note`）。

### 10.4 限制

- 最少列數沒有固定標準：只擋 2 列以下（無法算標準差），基準列數不多於特徵數時警告；3 列的基準在實驗中仍然「成功」，檢查不會替你判斷統計意義。
- 檢查在每次啟動與每次呼叫 `/data-check` 時讀整個 CSV；很大的檔案會慢，狀態檢查（`/status`）不做資料檢查。
- 沒有上傳介面：檔案仍由部署端放入資料目錄。
- 檢查只涵蓋 UT 序列化器與現有引擎的假設；換序列化器需要重寫對應檢查。
- 引擎本身的行為沒有改（清理仍會刪除含空值的列），只是現在會說出來。

## 11. 範本

`GET /templates` 列出可下載的範本，`GET /templates/{name}` 下載（`analytical-four.templates.list`、`analytical-four.templates.get`，入口 `analytical_four.view`）。名稱只取自內建清單，不會被當成路徑。

| 範本 | 用途 |
|---|---|
| `requirements-form.md` | 導入需求表與最小資料清單 |
| `column-dictionary.csv` | 欄位字典（原始欄名、分析欄名、意義、型別、單位、缺值意義、角色） |
| `column-mapping.template.json` | 引擎寫死讀取的欄名清單，鍵是要換成場域欄名的佔位字串，貼進設定的 `columnMapping` |
| `analysis_config.template.json`、`ng_code.template.json`、`topology.template.json`、`knowledge.template.csv` | 各設定與知識檔的範例，取自合成示範資料 |
| `current-data.example.csv`、`baseline.example.csv` | 待分析與基準資料的範例（合成資料） |

測試要求：欄位對照範本的值必須恰好是引擎寫死的情境欄位加不良代碼欄位（引擎清單改了，範本就要跟著改）；六個範例檔放在一起必須通過資料檢查且沒有警告。

## 12. 設定與知識檔的格式檢查

`format_checks.py` 檢查除了量測 CSV 以外、場域提供的檔案。資料檢查（第 10 節）會呼叫它們，結果併入同一份報告；啟動分析前有 error 就不啟動。error 是引擎會當掉或結果會錯的情形，warning 是會被略過或變弱的情形。

| 檔案 | error | warning |
|---|---|---|
| 分析設定檔 | `feature` 不是物件，或某組的 `numerical`、`categorical`、`target`、`id` 型別不對 | 同一組的數值特徵重複列出 |
| 不良代碼定義（B 層） | 不是非空陣列；某筆沒有 `category`；`details` 不是非空的物件陣列；代碼重複定義（只有第一筆有效） | 第一筆 `details` 的機台、製程、現象、原因、處置有空白（診斷結果會是空的）；資料裡出現的不良代碼不在定義中 |
| 製程拓樸（C 層） | 缺 `process.stations`（需有 id、name、整數 order）、站點 id 重複、特徵缺 id／name／role／level 任一項、level 不是整數、特徵 id 重複、完全沒有特徵 | `topology` 的站點不在 `process.stations`（整站略過）；角色不在 `roles`；特徵名稱重複；拓樸名稱不是資料欄名；數值特徵不在拓樸中 |
| SOP 知識（C 層） | 只有標題列或是空的 | 標題列不是預期的七欄；某列欄位數與標題不同（常見為欄位內有逗號）；`Knowledge_ID` 重複；適用特徵空白 |
| 案例檔（C 層，客訴模式） | 某行不是 JSON；某筆缺相似案例搜尋讀取的欄位（`event_id`、`summary`、`diagnosis_results.score_breakdown`、`conclusion`、`feedback`），搜尋會在這筆失敗 | 無 |

案例紀錄驗證與回饋匯入共用同一個函式。這一節之前，案例檔裡可解析但缺欄位的紀錄會讓相似案例階段以 `KeyError` 失敗；現在在啟動前指出檔案與行號。

## 13. 上傳與驗證報告

檔案先上傳到暫存區、出驗證報告，通過後才由人接受並放到分析讀取的位置。放入前不會動到資料目錄裡的任何檔案。

### 13.1 資料模型

`uploads/<upload_id>/`（`upload_id` 為 16 位十六進位）內有 `content`（原始位元組）與 `meta.json`：

```
uploadId, kind, filename（只是標籤，取最後一段並清掉控制字元，最長 100 字）, bytes, sha256, createdAt, createdBy
status      staged | accepted | discarded
target      接受後會放的位置（資料目錄內的相對路徑，由分析設定決定，不由上傳者決定）
report      { ok, errors[], warnings[], otherIssues[], summary }
acceptedAt, acceptedBy, replacedBackup（被取代的檔案備份在 uploads/replaced/<upload_id>-<檔名>）
discardedAt, discardedBy
```

`kind` 與放置位置：`current-data`（`current_data.descriptive`）、`baseline-data`（`baseline_data.descriptive`）、`ng-code`、`topology`、`knowledge`（`rag_knowledge`）、`case-records`（`llm_records`）、`case-errors`（`llm_error_records`）、`analysis-config`（設定中的 `analysisConfig`）。分析設定沒有指定該類檔案的路徑時，報告列為 error。

### 13.2 規則

- **用該檔案自己的問題判斷。** 報告是把上傳檔當作已在位置上，跑完整的資料檢查（不論該層目前有沒有開）；每個發現都標示來自哪個輸入（`source`）。`errors` 與 `warnings` 只放這個檔案自己的；其他檔案的 error 放在 `otherIssues`，提醒要處理，但不擋這次上傳。這樣壞掉的基準不會擋住修好的待分析檔，反過來也一樣。
- **有 error 的檔案不能接受（409）。** 接受時會重新驗證一次，因為這段時間資料集可能變了。
- **取代既有檔案要明說。** 目標已存在時，`replace` 必須為 true（409 否則），原檔先備份到 `uploads/replaced/`。目標不存在時不需要 `replace`。
- **分析進行中不能放入檔案（409）。**
- **案例檔不能繞過版本。** 案例庫已有發布過的版本後，直接換 `case-records` 或 `case-errors` 會在下次發布時被最新版本蓋掉，所以拒絕（409），請改用匯入回饋。還沒有版本時可以放，它會成為第一個版本的起點。
- **每次上傳只有一個決定**：接受或丟棄。丟棄會刪掉暫存的內容，只留 `meta.json`。
- 單檔上限 100 MB，超過回 413 且不留半成品；空檔回 422；`kind` 不在清單回 422。

### 13.3 介面

| capability | 方法與路徑 | 入口（預設角色） |
|---|---|---|
| `analytical-four.uploads.create` | POST `/uploads?kind=&filename=`（本文為檔案位元組，201） | `analytical_four.upload`（admin、manager） |
| `analytical-four.uploads.accept` | POST `/uploads/{upload_id}/accept`（`{ "replace": bool }`） | 同上 |
| `analytical-four.uploads.discard` | DELETE `/uploads/{upload_id}` | 同上 |
| `analytical-four.uploads.list` | GET `/uploads` | `analytical_four.view` |
| `analytical-four.uploads.get` | GET `/uploads/{upload_id}` | 同上 |

### 13.4 限制

- 上傳是單次請求、整檔送出；沒有續傳。
- 報告以目前的設定與資料目錄為準；欄位對照改了之後，已暫存的檔案接受時會依新設定重新驗證。
- 暫存區不會自動清理；丟棄與備份都需要維運人員手動刪除舊檔。
- 沒有檔案內容的病毒或巨集掃描；CSV 只是被當成資料讀取，不被執行。

## 14. 前端畫面

系統前端（`services/frontend`，由 `services/package/frontend.mjs` 依所選 Kit 組裝）多一個「製造數據分析」頁籤，選了 `analytical-four-kit` 才會出現，登入後才顯示。頁面原始碼在 `kits/analytical-four-kit/src/frontend/src/`：`pages/AnalyticalFourPage.tsx`（頁籤與四個區塊）、`components/analyticalFour/`（各區塊與共用元件）、`services/analyticalFour.ts`（路由客戶端）、`styles/analytical-four.css`。頁籤名稱的語系鍵 `tabs.analyticalFour` 在共用語系檔，頁面本身的文字放在 Kit 內的 `labels.ts`（繁體中文與英文），所以 Kit 不需要改共用語系檔的其他部分。

| 區塊 | 內容 | 對應路由 |
|---|---|---|
| 資料準備 | 下載範本；上傳檔案並看驗證報告，通過後放入或丟棄（取代既有檔案要勾選）；最近的上傳；資料檢查；載入示範資料 | templates、uploads、data-check、demo |
| 分析設定 | 三層開關、模式、設定檔路徑、AI 服務位址與逾時與金鑰環境變數名稱、欄位對照表；儲存後顯示各層是否就緒 | settings、status |
| 執行分析 | 啟動、階段表（執行中每兩秒更新、結束即停止）、警告、失敗原因、結果檔清單與唯讀檢視、執行紀錄 | runs、results |
| 回饋與案例庫 | 對客訴分析的事件提交確認結果（代碼可為新代碼）、匯入 JSON、回饋清單與核可或駁回、發布新版本、版本清單 | feedback、library |

**介面約定**（沿用 `DESIGN.md` 的原則，系統前端沒有 Composer 的樣式檔所以另有一份 CSS）：原生控制項、可見標籤、按鈕與輸入至少 44px、3px 焦點框、狀態一律有文字且用 `role="status"` 或 `role="alert"`、不靠顏色表達狀態、表格在區塊內捲動、不用動畫、不使用 emoji。頁籤支援左右方向鍵。訊息放在區塊最上方並固定（sticky），避免操作在頁面下方時看不到結果。

**安全**：使用者可編輯的文字一律以文字節點呈現（測試禁止 `dangerouslySetInnerHTML`、`innerHTML`、`eval`）；範本下載用 `fetch` 加登入權杖後從記憶體存檔，不是帶權杖的網址；介面不判斷角色，沒有權限的操作由伺服器回 403 並顯示其訊息，真正的授權仍在入口權限中介層。

**驗證**（2026-11-03）：
- 組裝出的前端以嚴格 TypeScript 檢查與正式建置通過。
- 在 Chrome 對真實路由（以固定身分的測試殼層取代登入）走過：載入示範資料、資料檢查通過、設定三層與客訴模式與 AI 位址並儲存（顯示三層皆就緒）、啟動分析並看到階段更新到完成（約 51 秒，AI 診斷用本機 Ollama）、對事件提交確認結果（管理員提交即核可）、發布案例庫 v1、上傳檔案出報告、不勾選取代時被拒（顯示伺服器訊息）、勾選後放入並備份原檔；主控台沒有應用程式錯誤。
- 自動化測試（`services/package/tests/analytical-four-frontend.test.mjs`）檢查頁籤接線、語系鍵、組裝內容、不使用 HTML 注入，以及客戶端呼叫的路由與 Kit 宣告的路由完全一致（雙向）。

**限制**：
- 沒有元件層級的自動化測試（系統前端沒有測試框架）；互動行為靠上述瀏覽器走查，之後改畫面要重走。
- 頁面文字有英文版，但英文版畫面沒有逐頁走查。
- 沒有以非管理員角色在瀏覽器走過（授權效果仍為未涵蓋）。
- 結果檔檢視只顯示前 2 萬字元的 JSON 文字，沒有表格或圖表。
- 範本下載與檔案選擇器沒有在瀏覽器以真實點擊完整走過（上傳走查用程式設定檔案）。

## 15. 容器、模型與主機外服務的驗證（2026-11-03）

原本標為未驗證的三項，用同一份系統包實際做過。

**系統包與映像。** 以 8 個 Kit（含本 Kit）的 Recipe 用真實的 Python 檢查（不是 Node 測試的替身）組裝系統包，再 `docker build` 後端映像（`python:3.12.8-slim-bookworm`、Linux）。

| 項目 | 結果 |
|---|---|
| 組裝（真實 `check_tree.py`） | 通過；第一次失敗，原因見下 |
| 映像建置 | 成功，約 2 至 3 分鐘 |
| 映像大小 | 預設的 CUDA 版 PyTorch：10.1 GB（其中安裝依賴的一層 6.6 GB）；改用 PyTorch 的 CPU 版輪子（`torch==2.14.1+cpu`）：2.54 GB |
| 映像內匯入 | Python 3.12.8、pandas 2.2.3、numpy 2.1.3、scikit-learn 1.7.2、scipy 1.15.3；Kit 的路由模組載入，23 條路由 |
| 映像內跑 Kit 測試（掛入測試目錄，對映像內的後端） | 127 項通過（設定、執行、回饋、資料檢查、上傳、範本、格式檢查、轉接層） |

驗證過程發現並修正的三個問題：

1. **系統包檢查器拒絕引擎的匯入方式。** `services/preview/check_tree.py` 只認得套件 `__init__.py` 自己定義的名稱，不認得它重新匯出的名稱；`from ...engine.data_manager import JSONDataManager` 這類匯入在真實檢查下被判為缺少模組。Node 測試把這個檢查換成替身，所以先前沒有發現。已把這些匯入改成從定義名稱的模組匯入（6 行），並新增 `tests/test_package_imports.py` 保存這條規則。
2. **預設會安裝 CUDA 版 PyTorch。** 映像 10.1 GB，其他後端映像約 0.5 GB。系統包的依賴合併器現在支援 `--extra-index-url`（只收 https、不含帳密、其他 pip 選項一律拒絕），本 Kit 的 `requirements.txt` 指向 PyTorch CPU 輪子並固定 `torch==2.14.1+cpu`。取捨：多一個套件來源，pip 會對所有套件也查那個來源；PyTorch 的 CPU 索引只放 torch 相關檔案，但這仍是一個需要接受的供應鏈面。
3. **Linux 上路徑檢查比 Windows 寬鬆。** `C:/Windows/win.ini` 在 Linux 被當成資料目錄內的一般相對路徑而接受（不會逃出資料目錄，但不是設計意圖）。現在兩種路徑格式在所有平台都檢查（磁碟機代號、反斜線上層目錄、UNC 路徑都拒絕）。

**預設向量模型。** `intfloat/multilingual-e5-large-instruct` 用本機已快取的檔案（離線）在 Kit 內跑每日 A+B+C：成功，13 秒；SOP 檢索 95 次查詢的第一筆都是該特徵自己的 SOP。`builtin-hash` 在同一份資料上也是 95 次全中，所以這份合成資料分不出兩者的品質差異；驗證的是「真實模型在 Kit 內能載入並完成整個流程」，不是檢索品質。

**容器連主機上的 LLM。** 本 Kit 的轉接層（`tools/local_llm_adapter.py`）跑在一個容器裡（綁 0.0.0.0，但沒有發佈任何連接埠，只在專用的 Docker 網路內可達），它用 `host.docker.internal` 連到主機的 Ollama（qwen3:14b）；另一個容器（後端映像）跑客訴模式 A+B+C，LLM 位址是轉接層容器的名稱。結果：成功，50 秒；6 筆事件 6 筆都是模型的審核意見，沒有保底結果。驗證完畢後容器、網路與映像都已移除。

**完整安裝驗證（由另一個 session 在 `verify/kit-standalone` 做，2026-11-04，紀錄在 mailbox thread `20261104-kit-standalone-verification`、決議 D163）。** 以上一節修正後的提交（`519aff0`）在 Ubuntu 虛擬機用安裝引擎安裝「基底加 analytical-four-kit」：映像建置約 18 分鐘（映像 2.54 GB），封裝為 763 MB 的系統包；安裝 11 步全過含健康檢查；冒煙 32/32（22 條 GET 路由）；功能操作 31/32，唯一失敗是稽核事件的權限，與本 Kit 無關，之後在 D165 修正；後端 5xx 為 0。本 Kit 自己的流程：未載入示範資料時資料檢查回報找不到分析設定檔（預期）；載入示範資料後資料檢查通過（60 列、12 個數值特徵）；啟動分析回 202，輪詢到完成，讀資料、描述統計、診斷、不良碼四個階段全過。那次安裝裡 AI 診斷層預設關閉，沒有驗證。這證明上一節的映像在完整堆疊裡可安裝、可登入、可操作，也補上了我沒有為本 Kit 重跑的 PostgreSQL、入口權限、授權閘門與 Nginx。

**仍未驗證**：
- 完整安裝裡的 AI 診斷層（C 層）已由 `verify/kit-standalone` 在虛擬機以自製的模擬 AI 服務驗證（客訴分析十個階段、回饋、核可、發布、發布後再分析，20/20；紀錄在 mailbox thread 第五輪），只驗證收送行為。第 16 節的錯誤分析與回復已在 2026-11-09 於完整安裝驗證（見第 17 節）。（真實 LLM 與前端頁在虛擬機上的操作已於 2026-11-09 驗證，見第 18 節）。（非管理員角色與英文版畫面已於 2026-11-09 驗證，見第 19 節）。仍未驗證：公司內實際 LLM 服務與診斷品質（只在 Chrome 對測試殼層走過，見第 14 節）。
- 離線安裝：映像打包（`bundle-images.mjs`）、`docker save` 與載入在那次安裝中是由安裝引擎跑的，但離線環境（沒有外網）的 CPU 輪子來源仍需預先備妥，沒有在斷網下測。
- 真實 E5 模型在沒有本機快取的環境下載（約 2 GB）沒有測；`HF_HUB_OFFLINE=1` 時才驗證了離線載入。
- 公司內的實際 LLM 服務與真實製造資料。

## 16. 錯誤分析與案例庫回復（D184）

- **錯誤分析：** 回饋的確認結果與診斷不同（`was_correct` 為 false）且紀錄沒有自帶原因時，Kit 由紀錄內已有的欄位用規則寫入 `error_reasons`（固定句子，不呼叫模型）：確認的代碼不在分布庫、AI 綜合診斷改掉了規則推估的代碼、診斷已標示需人工確認，都不成立時寫「原因無法由紀錄判斷」。`delta` 記下 `predicted`、`confirmed`、`rule_suggested`、`final`。匯入的紀錄若已有自己的 `error_reasons` 則保留不覆蓋。
- **回復舊版本：** `POST /library/restore` 帶 `version`，檢查該版本兩個檔的 SHA-256 與 manifest 一致後，把內容發布成新的版本（manifest 的 `restoredFromVersion` 記來源），並更新分析讀取的兩個案例檔；舊版本全部保留。分析進行中、已是目前版本、版本不存在、檔案被改過都拒絕。限制：回復前已發布的回饋仍標為已發布，不會自己回到待發布，要再納入需重新提交。
- **前端：** 回饋頁的版本表對非最新版本有「回復此版本」，要再按一次確認（不用瀏覽器對話框）。2026-11-08 在 Chrome 對真實路由（固定身分的測試殼層、先造出 v1 與 v2）驗證：只有非最新版本有按鈕；第一次按變成「確定回復 v1」；確認後出現「已回復為新版本：v3」，版本表多出 v3（案例數 1，等於 v1），案例檔位元組與 v1 相同，v3 的 manifest 記 `restoredFromVersion` 為 1，主控台沒有錯誤。限制：那次瀏覽器的真實滑鼠點擊沒有送進頁面（連頁籤也點不動），改用頁面內的 `click()` 觸發，所以點擊的視覺與焦點行為沒有驗證。

## 17. 錯誤分析與回復在完整安裝的驗證（2026-11-09）

以 `main`（9134720 加上本節的測試腳本）在 Ubuntu 22.04 虛擬機用 `services/package/e2e/kit-matrix/run-config.sh analytical-four` 完整安裝（映像建置、簽署、授權、安裝 80 秒，健康檢查通過）：冒煙 32/32（22 條 GET 路由）、功能 35/35、後端 5xx 與 Traceback 為 0。再以 `a4_complaint.py`（模擬 AI 服務，含本次新增的回復檢查）29/29：客訴分析十個階段完成、回饋與核可、發布 v1 與 v2、操作員回復得 403、版本 0、字串、空值得 422、回復目前版本 409、不存在的版本 404、經理回復 v1 得新的 v3 且歷史 [3, 2, 1] 都在。在容器內讀案例庫的誤判檔，`error_reasons` 與 `delta` 有值（確認的代碼不在分布庫、規則推估與確認結果不同）。驗證後系統與容器已清除，映像與磁碟回到驗證前。

限制：AI 服務是模擬的，沒有驗證診斷品質或真實 LLM；前端的回復按鈕沒有在虛擬機的瀏覽器操作（只在本機測試殼層）；本輪沒有改 `workflow.aov.json`。

## 18. 真實 LLM 與前端頁在虛擬機完整安裝的驗證（2026-11-09）

同一份 `main`（a8ea788）在 Ubuntu 22.04 虛擬機完整安裝（冒煙 32/32、功能 35/35、後端 5xx 為 0）。AI 服務用本機轉接層 `tools/local_llm_adapter.py` 接本機 Ollama（模型 qwen2.5:7b；這台機器沒有 qwen3:14b）。連線方式全程不對區網開放任何服務：本機轉接層只綁 127.0.0.1，經 SSH 反向通道（`-R 127.0.0.1:18090:127.0.0.1:18090`）到虛擬機的回環位址，再由虛擬機上一個暫時的轉送程式綁在後端容器所在網路的閘道位址（172.19.0.1）轉進通道，設定的服務位址是 `http://172.19.0.1:18090/diagnose`。瀏覽器經 SSH 正向通道（`-L 127.0.0.1:18081:127.0.0.1:8080`）在本機的 Chrome 連系統前端。

在瀏覽器操作的結果：以安裝時測試用的管理員登入；載入示範資料（11 檔）；設定三層加客訴分析與上述位址、逾時 300 秒並儲存；啟動分析，十個階段全部完成，60 件事件由真實模型回應 60 件（每件約 2 秒），結果檔可在畫面查看，內容含 `llm_analysis` 與 `conclusion`；對兩個事件提交確認結果（管理員提交即核可）、發布 v1 與 v2；以真實滑鼠點擊按「回復此版本」再按「確定回復 v1」，畫面顯示「已回復為新版本：v3」，版本表出現 v3（案例數 1，等於 v1），v2 與 v1 仍各有按鈕；主控台沒有錯誤，後端 5xx 為 0。容器內案例庫誤判檔的 `error_reasons` 為「規則推估的代碼與確認結果不同」與「診斷已標示需人工確認」，`delta` 有預測與確認的代碼。

限制：驗證的是流程與收送行為，沒有評估 7B 模型的診斷品質（回應的信心多為 low、需人工確認，與小模型相符）；非管理員角色、英文版畫面沒有在這輪操作；先前在本機測試殼層用頁面內 `click()` 才點得動的現象，這輪改用依元素參照的真實點擊就正常，所以那次是座標點偏，不是頁面問題。驗證後虛擬機的系統、容器、轉送程式與通道都已移除，映像回到原狀。

## 19. 非管理員角色與英文版畫面在虛擬機的驗證（2026-11-09）

同一份 `main`（ce0720c）在虛擬機完整安裝（冒煙 32/32、功能 35/35、後端 5xx 為 0），先以 `a4_complaint.py` 造出分析與案例庫版本，再經 SSH 正向通道（只綁本機 127.0.0.1）用 Chrome 以測試用的操作員（`op`）與經理（`mgr`）帳號操作。

**操作員：** 看得到四個分頁；改逾時秒數後按儲存，顯示「設定未儲存：Forbidden」，設定沒有改；對事件提交確認結果成功，狀態為「等待」並有「核可」「駁回」按鈕；按核可顯示 Forbidden、狀態仍是等待；按「發布新版本」顯示 Forbidden；按「回復此版本」再按「確定回復」顯示 Forbidden，版本表沒有新增。
**經理：** 對同一筆等待中的回饋按核可成功；發布得到新版本 v4（新增回饋數 1）；回復舊版本成功，得到 v5（案例數 1，等於被回復的版本）；歷史 v5 到 v1 都在。
**英文版：** 切換後分頁、按鈕與提示為英文（"Feedback and case library"、"Restore this version"、"Confirm restore v3"、"Restored as a new version"），版本表欄名為英文。

**發現（未修）：** (1) 伺服器拒絕時畫面顯示的是閘道回的英文「Forbidden」，在中文介面也是；原因是畫面把伺服器的訊息原樣顯示。(2) 版本時間用瀏覽器的繁體中文地區格式，英文介面仍出現「下午」。(3) 英文提示中的冒號是全形「：」。這三點不影響功能，也沒有造成錯誤權限放行；這三點已在 2026-11-09 修正（第 20 節）。授權效果仍只驗證了這兩個角色對本 Kit 路由的拒絕與放行，沒有涵蓋其他角色或其他 Kit。

限制：帳號與密碼是專案測試腳本的測試值，不是真實帳號；角色驗證針對 `op` 與 `mgr` 兩個帳號。驗證後虛擬機的系統、容器與通道都已移除。

## 20. 三個畫面細節的修正（2026-11-09）

- **拒絕提示：** 閘道對被拒的角色只回英文「Forbidden」，`errorText` 現在把 403 且內容恰為 Forbidden 的回應換成頁面自己語言的句子（「你的角色沒有這項操作的權限」、"Your role is not allowed to do this"）；伺服器自己說明原因的訊息仍原樣顯示。
- **時間格式：** `formatTime` 改用頁面語言的地區（`L.locale`：zh-TW 或 en-US），不再跟著瀏覽器的地區；英文介面顯示 `11/9/2026, 3:25:24 PM`。
- **冒號：** 各處的全形「：」改為 `L.colon`（中文「：」、英文「: 」）。
- 自動化測試（`analytical-four-frontend.test.mjs`）檢查標籤有 locale 與 colon、時間用 `L.locale`、有 Forbidden 的處理、程式裡沒有寫死的全形冒號與漏帶標籤的 `formatTime`；刻意改壞後測試會失敗。
- 瀏覽器（本機測試殼層）：英文時顯示 "Restored as a new version: v5"，中文仍是「已回復為新版本：v6」；把發布路由的回應換成 403 加 Forbidden，中文與英文分別顯示各自的句子。
- 其他全形符號（括號、頓號、分號、逗號、全形空白）也改由標籤提供（`L.open`、`L.close`、`L.sep`、`L.list`、`L.comma`、`L.gap`），英文介面為半形並有適當空格；測試禁止頁面程式碼直接寫這些全形符號。
- 未處理：伺服器自己產生的中文文字（範本說明、資料檢查與階段說明、驗證訊息）不會隨介面語言翻譯，英文介面仍會出現其中的全形標點。

## 21. 真實閘道的拒絕提示與英文標點在虛擬機的確認（2026-11-09）

同一份程式在虛擬機完整安裝（冒煙 32/32、功能 35/35、後端 5xx 為 0）；`a4_complaint.py` 29/29。以測試用的操作員帳號、英文介面操作：按「Publish a new version」與「Restore this version」再確認，兩者都顯示 "Your role is not allowed to do this"（真實閘道回 Forbidden，已換成頁面自己的句子）；版本時間為 `11/9/2026, 7:24:53 PM`；回饋頁、分析設定頁的頁面文字沒有任何全形標點。準備資料頁與執行頁仍有的全形標點來自伺服器產生的中文文字（範本說明、階段說明）。

過程中映像內的 Kit 測試閘門有一次失敗：`test_only_one_run_at_a_time` 先送出一次分析、立刻再送第二次期待 409，機器忙時第一次分析可能先跑完而讓測試失敗（規則本身沒有錯）。改為在測試裡用事件擋住第一次分析的讀資料階段，等第二次請求被拒絕後才放行，不再依賴時間；本機 15 項執行測試與映像內閘門都通過。驗證後虛擬機的系統與通道已移除。

未做：公司內實際的 LLM 服務與診斷品質。

## 22. 驗證報告的多語言（D185）

資料檢查與格式檢查回報的「發現項」（`errors`、`warnings`、`otherIssues`，以及執行紀錄裡的 `warnings`）原本只有伺服器寫的中文 `message`。現在每個發現項多兩個欄位：`key`（是哪一句，例如 `not-numeric.1`）與 `params`（要填進句子的值）。`message` 與 `code` 不變，舊的呼叫端不受影響。

- **參數的形狀：** 一般值是字串或數字；固定的名詞用 `{"term": "baseline-data"}`；例子清單用 `{"items": [...], "total": N}`（頁面顯示前幾個並接「（共 N 個）」）；案例紀錄的問題用 `{"key": "event-id", "params": {...}}`。
- **頁面怎麼用：** 英文介面用 `key` 在 `labels.ts` 的 `findings` 表找英文句子，把 `{名稱}` 換成 `params` 的值；找不到 `key`（或沒有 `key`）就顯示 `message`，所以中文介面不變，也不會因為少一句翻譯而空白。翻譯放在 Kit 自己的 `labels.ts`，不放進共用的 locale 檔，Kit 才能獨立拿掉。
- **範圍：** 只做驗證報告（資料檢查 `data_checks.py` 與格式檢查 `format_checks.py`，共 63 句，每句一個 `key`）。沒有做：HTTP 錯誤訊息（`detail`）、分析階段與就緒說明、範本說明；這些在英文介面仍是中文。`config` 這一句的文字來自 `settings.py` 的錯誤，也沒有 `key`。
- **防止漂移：** pytest 用 AST 檢查每個 `Finding(...)` 都有 `key`（例外只有上述 `config`）、`key` 不重複，並檢查資料檢查路由實際送出的 `key` 與 `params`；套件測試檢查每個 `key` 都有英文句子、句子裡的 `{名稱}` 與伺服器送的 `params` 名稱完全相同、沒有多餘的英文句子，並檢查名詞與案例問題的翻譯齊全。刻意改壞一個名稱時測試會失敗。
- **驗證：** Kit pytest 143、套件測試 74、嚴格型別檢查與建置通過；在本機測試殼層用瀏覽器看到同一筆錯誤在中文是原句、英文是 "In the normal baseline data, the numeric column ..."，案例檔問題（名詞加問題的巢狀）也正確。沒有在虛擬機重跑，因為只多了回應欄位；下次裝到虛擬機時順便確認。
