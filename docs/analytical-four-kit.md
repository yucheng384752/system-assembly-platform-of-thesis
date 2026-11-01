# analytical-four-kit：資料模型與介面

日期：2026-11-01
對應：決議 D142；來源專案 Analytical-Four（commit f49cfd3）；Kit 目錄 `kits/analytical-four-kit/`。
狀態：已實作並以後端測試與系統包組裝測試驗證；容器映像未建置、實際 E5 向量模型與真實 LLM 服務未驗證（見第 7 節）。

## 1. 範圍

把 Analytical-Four 的製造數據分析做成可選配的 Kit。分析分三層，由 Kit 設定開關：

| 層 | 內容 | 對應 Composer 子功能 |
|---|---|---|
| A 統計與異常診斷 | 讀取整理、基準統計、IQR 超界、相關性、PCA、T2 與 SPE、特徵貢獻排名、事件序列化 | `layer-a` |
| B 不良類型診斷 | 每日模式用 NG 樣本更新不良特徵分布庫；客訴模式用分布庫推估不良類型 | `layer-b`（依賴 A） |
| C 完整 AI 診斷 | 製程拓樸對應、SOP 檢索；客訴模式再加彙整、搜尋關鍵、相似案例、LLM 綜合診斷 | `layer-c`（依賴 A、B） |

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

- 容器映像未建置；依賴固定版本（pandas 2.2.3、numpy 2.1.3 為系統包既有，其餘見 `requirements.txt`）只在 Windows、Python 3.10 的測試環境以相同版本驗證過，Linux、Python 3.12 未驗證。
- 預設向量模型 `intfloat/multilingual-e5-large-instruct` 未在測試中載入（需下載約數 GB）；測試與示範用 `builtin-hash`，只比對字詞。
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

已知風險與處理：轉接層原本在 Ollama 呼叫失敗時回 HTTP 200 加保底結果（已用不存在的模型名稱驗證），Kit 分辨不出失敗，`llm` 階段會顯示完成。同日已改轉接層（在 Analytical-Four 專案，未提交）：失敗、逾時或回應無法解析時回 HTTP 502。以不存在的模型名稱重測：轉接層回 502，Kit 的 `llm` 階段標為失敗，錯誤訊息為「LLM 服務回應 HTTP 502」，前面階段的結果檔保留。Analytical-Four 自己的 `main.py` 的 `analyze_with_llm()` 沒有檢查狀態碼，收到 502 的內容會當成回應收下；那是該專案的程式，這次未改。
