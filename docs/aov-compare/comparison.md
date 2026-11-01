# Analytical-Four 原始版本與 Kit 版 AoV 比較

## 摘要

原始版本由 `Analytical_Four_System.main()` 同步串接分析，Kit 保留主要統計與診斷計算，另以可選配的 A／B／C 層和背景執行紀錄管理流程。原始處方段是「拓樸 → RAG → NG」，Kit 改為「NG（B）→ 拓樸 → RAG（C）」，兩者都只有 `complain` 會繼續彙整、搜尋案例與呼叫 LLM。Kit 加強讀寫、JSONL 與 HTTP 失敗回報，加入回饋核可和版本化案例庫，但沒有搬入原始 `ErrorAnalysis` 的完整誤判統計。出貨 AoV 的十個分析階段沒有漏列，但部分邊表達的是資料依賴而非實際執行順序，也省略模式／層級出口與自動核可路徑。以下為程式碼推導及 JSON 結構驗證，沒有重新執行分析或 LLM。

## 來源與讀圖規則

- 原始來源固定為 `C:/Users/gslab/Desktop/Analytical-Four` 的 `f49cfd3a31727fd4733db5f081830063eeb0497a`，以 `git -c safe.directory=... -C ... show f49cfd3:<path>` 讀取。以下 `O:<path>:<line>` 都指這個 commit，不是工作樹行號。
- Kit 來源是本分支工作樹；以下 `P` 指 [pipeline.py](../../kits/analytical-four-kit/src/backend/app/analytical_four/pipeline.py)，`R` 指 [runs.py](../../kits/analytical-four-kit/src/backend/app/analytical_four/runs.py)，`S` 指 [settings.py](../../kits/analytical-four-kit/src/backend/app/analytical_four/settings.py)，`F` 指 [feedback.py](../../kits/analytical-four-kit/src/backend/app/analytical_four/feedback.py)，`API` 指 [routes_analytical_four.py](../../kits/analytical-four-kit/src/backend/app/api/routes_analytical_four.py)。`E` 指同目錄下的 `analytical_four/engine/`。
- 能力來源為 [registry](../../config/registry/analytical-four-kit.json)，與 [kit.contract.json](../../kits/analytical-four-kit/kit.contract.json) 及路由核對。子功能來源另核對 [overlay.json](../../config/kits/overlay.json) 的 `layer-a/b/c`。
- 已閱讀並以程式核對 [Kit 說明](../analytical-four-kit.md) 與 [SOURCE.md](../../kits/analytical-four-kit/SOURCE.md)。文件與程式不一致處列於後文，採程式為準。
- **來源缺口：** `git show f49cfd3:data/raw/config/ut_config_v7.json` 回報該檔在磁碟上但不在 commit；`git ls-tree` 在該設定目錄只列出 `config_manager.py`。不能確認當時設定檔的 mode、observer、特徵、實際路徑或 LLM 位址。`ConfigManager.load_config()` 的程式預設 mode 是 `daily`，不等於缺失的設定檔實際採用 `daily`；README 的範例也不視為實際設定。

兩份 AoV 使用 `composer-kit-workflow` v1，`status: draft`。原始圖只包含 `main()` 實際步驟，以細節節點呈現模式分支；Kit 圖以十個 stage 為主要粒度，再加入執行管理及獨立 API。兩圖的節點數不能直接當成功能增減數；下表將原始細節映射至 Kit stage。

邊表達具條件的先後關係，條件寫在 `scope`／節點名稱，沒有新增 schema 欄位。多條出邊不表示全部執行，多條入邊不表示 AND 閘；模式必須前後一致。Kit 的查詢、設定、demo 是獨立操作，不與分析硬接成一條必經路徑；回饋邊只表示另外操作的前置條件，不表示分析自動送出回饋。發布後的案例供下一次 run 使用，不接回同一次 run 形成環。

## 步驟對照與程式追溯

「保留」指主要計算／輸入輸出意圖保留，仍受共同的寫檔、例外及執行目錄改寫影響。「移除」若原本不在 `main()` 路徑，明確標為未搬入，不能解讀成刪掉原始自動步驟。

| 原始 AoV 節點／步驟 | Kit 階段／節點 | 判定 | 核對結果與程式依據 |
|---|---|---|---|
| `main()` 外的 logging、設定載入、建構 system | `settings`、`create-run`、`derive-config` | 改寫 | O:main.py:958 由固定設定檔建構 system，呼叫 `main(output_folder="outputs/complain/")`；R:110 `create` 保存設定快照，R:156 `_execute` 衍生設定、建構引擎，S:166 `derive_config` 改寫 mode、路徑與 LLM endpoint。前者不放進 original 圖的 main 邊界內。 |
| `select-mode`、`unknown-mode-return` | `settings` 的模式驗證、`read-data` | 改寫 | O:main.py:787 `main` 遇未知 mode 記錯後 return；P:807 `prepare_data` 改丟 `PipelineError`，S:83 `Settings` 限 daily／complain。原始 ConfigManager 另會把無效 mode 正規化為 daily，所以原始 unknown 分支不代表一般設定載入必然可達。 |
| `daily-read-current` → `daily-clean` → `daily-split` | A／`read-data` | 保留／加檢查 | O:main.py:96、101、109、787 與 P:807：讀 current、選欄、刪全空欄／有空值列、`split(..., threshold=5)`，取 `split_data[0]` 為 sample、`[1]` 為 baseline。Kit 新增目標欄、可用數值特徵及非空資料檢查。 |
| `complain-read-current` → `complain-read-baseline` → `complain-clean` → `complain-align` | A／`read-data` | 保留／加檢查 | O:main.py:128、787 與 P:146、807：另讀 descriptive baseline，只清理 current，baseline 取共同欄位；sample=current。沒有把 baseline 也清理一遍。 |
| `ensure-output` | `create-run` 建 results、各方法 `output_data` | 改寫 | O:main.py:787 必要時建立 output_folder；R:110 建 `runs/<id>/results`，P:140 每次寫檔先建父目錄並讓錯誤往上傳。 |
| `basic-statistics` | A／`descriptive` 的 `basic_statistics` | 保留 | O:main.py:140 → P:158、831：對 baseline 數值欄呼叫 `BasicStatistics.calculate_summary`，輸出 baseline.json。 |
| `categorical-statistics` | A／`descriptive` 的 `categorical_statistics` | 保留 | O:main.py:161 → P:179、831：使用 current、normalize=True，輸出 categorical_statistics.json。 |
| `compare-outliers` | A／`descriptive` 的 `compare_outliers` | 保留 | O:main.py:176 → P:194、831：sample 對 baseline 統計，`base_line=None`；兩邊 main/stage 都沒有讀取 `diagnostic_baseline_path` 作為此參數。 |
| `correlation`、`sample-ids` | A／`diagnostic` 的前兩步 | 保留 | O:main.py:198、main 內 diagnostic_analysis → P:216、836：Pearson 比較；id 欄存在則轉字串，否則用 `row_<index>`。 |
| `pca` | A／`diagnostic` 的 `contribution_analysis` | 保留 | O:main.py:224 → P:242：以 baseline fit scaler／PCA，計算 loading、T²／SPE 控制界限與樣本貢獻，alpha=0.05，輸出 pca_loadings.json 與 pca_spe_t2.json。 |
| `extract-features` | A／`diagnostic` 的 `extract_feature_importance` | 保留 | O:main.py:319 → P:337、836：合併 delta correlation 與 loadings，alpha=0.6、threshold=0.8；另一份 boundary／SPE／T² 融合結果仍寫出，但未拿來做下一步 weighted rank。 |
| `weighted-rank` | A／`diagnostic` 的 `calculate_weighted_contributions` | 保留 | O:main.py:361 → P:379、836：逐事件呼叫 CalculateRank，使用前述全域 feature scores。 |
| `serialize` | A／`diagnostic` 的 `serialization` 與後續檢查 | 改寫 | O:main.py:385 → P:403、836：序列化與事件寫檔保留；Kit 額外拒絕空事件及 `ranked_features.error`，避免將內嵌的失敗當成功。 |
| `topology` | C／`topology` | 改寫 | O:main.py:412 → P:430：拓樸計算保留；順序移到 NG 之後。E:analysis/prescriptive/topology_generator.py 的 `summarize_serialized` 刪除工作目錄 `topology_summary_output.json` 除錯覆寫。 |
| `rag` | C／`rag` | 保留／新增替代 builder | O:main.py:431 → P:449：載知識 CSV、`build_vector_database_if_needed`、逐事件 top_k=1。Kit 新增 offline_vectors.py 的 `builtin-hash`，以字詞／字元特徵雜湊為 512 維向量，供無模型下載的示範使用；沒有把原有 builder 移除。 |
| `ng-daily` | B／`ng-code` 的 daily 分支 | 改寫 | O:main.py:455 寫死 `outputs/known_base.json`；P:473 寫設定的 prescriptive baseline，R:156 的內部 `ng()` 再複製到本次 results/known_base.json。Kit 不再等 topology／rag 成功才訓練。 |
| `ng-complain` | B／`ng-code` 的 complain 分支 | 改寫 | 原始與 Kit 都載既有分布庫、逐事件 `predict_complain_mode`；Kit 先於 C 執行，且 R 的 `ng()` 對預測結果中的 error 中止並要求先累積分布庫。 |
| `compile` | C／`compile` | 改寫 | O:main.py:480 的 `compilation_events` 固定讀 `outputs/complain/topology/`；P:498 新增 `topology_folder`，R:156 傳入本次 results/topology/。top3 加權、同分並列、NG／RAG 彙整保留。此改寫未列入 SOURCE.md 的修改表。 |
| `compile-write-again` | 無對應重複步驟 | 移除 | 原始 main 在 `compilation_events(output_path=...)` 已寫檔後，再呼叫一次 `output_data` 寫同一檔；Kit 只留方法內的第一次寫檔，不是移除彙整結果。 |
| `search-key`、`search-key-write` | C／`search-key` 與 stage 後的 `output_data` | 保留 | O:main.py:594、787 → P:599、R:156：產生 schema 2.0 事件後寫 search_key_results.json。Kit 是 stage 先標 done，再寫檔；寫檔若失敗，catch 仍會把目前 search-key 標 failed。 |
| `similarity` | C／`similarity` | 改寫 | O:main.py:711 → P:716：top_n=3、min_score=0.3、error min_overlap=2 保留；非空無效 JSONL 改為中止。E:SimilarSearcher.find_similar_cases 排除產品編號的硬匹配；`find_error_hints` 原本只比 Slitting machine，並未需要同樣修正。 |
| `llm` | C／`llm`，之後 `run-succeeded` | 改寫 | O:main.py:759 的裸 requests.post／response.json → P:764、790 `_post_llm`，加入 timeout、Bearer header、HTTP 狀態檢查與錯誤轉換。逐事件呼叫仍是循序，payload 仍是 new_event／top3_cases／error_hints。 |
| 無 | `readiness`、`demo`、`run-history`、`results` | 新增 | S:194 `readiness`、API:89/97/112/118/127/137、seed_demo.seed；原始 main 沒有對應 API。 |
| 無背景狀態機 | `create-run` → `derive-config` → stages → `run-succeeded`／`run-failed` | 新增 | R:110、156 建立 queued，背景轉 running，完成／例外留結果狀態；原始只同步呼叫、寫檔及 logging。 |
| `event_feedback_record`（main 未呼叫） | `feedback-submit/import/list/decide`、`library-publish/versions` | 改寫／新增 | O:main.py:945 的獨立手動工具不是原始 AoV 節點；Kit 另以 F:169–258 保存身分、核可、版本。沒有完整複製 ErrorAnalysis，詳見未搬入項目。 |

engine 檔案核對方式：將 Kit 匯入前綴 `app.analytical_four.engine.` 及 CRLF 正規化後，與 commit 逐檔比較。除套件初始化／匯入整理外，發現的內容差異是 contribution／correlation 刪繪圖匯入、topology_generator 刪除錯寫檔、similar_searcher 排除產品編號。沒有依 SOURCE.md 的「方法本體沿用」一句就推定所有行為相同；pipeline 與 runner 的改動另以上表核對。

## 流程結構差異

### 模式與連線

原始每日主線：`daily-read-current → daily-clean → daily-split → ensure-output → 描述三步 → 診斷六步 → topology → rag → ng-daily`，到此隱式回傳 None。客訴主線改用「讀 current、讀 baseline、清 current、對齊」，共享描述／診斷／topology／rag，再走 `ng-complain → compile → 重複寫彙整 → search-key → 寫搜尋鍵 → similarity → llm`，最後回傳 LLM 回應。原始沒有 A／B／C runtime 開關。

Kit 依 `R.STAGES` 和 `RunStore._execute()` 的實際呼叫順序：

| 啟用層／模式 | 成功時實際階段順序（不含共用背景初始化） |
|---|---|
| A；兩種 mode | read-data → descriptive → diagnostic → succeeded |
| A+B；兩種 mode | read-data → descriptive → diagnostic → ng-code → succeeded |
| A+C；daily | read-data → descriptive → diagnostic → topology → rag → succeeded |
| A+B+C；daily | read-data → descriptive → diagnostic → ng-code → topology → rag → succeeded |
| A+B+C；complain | read-data → descriptive → diagnostic → ng-code → topology → rag → compile → search-key → similarity → llm → succeeded |
| A+C；complain | Settings 拒絕，C 需要 B |
| 三層全部關閉 | Settings 沒有禁止；若衍生設定及引擎初始化成功，可直接 succeeded，沒有分析 stage |

每日模式在 C 開啟時仍將 compile／search-key／similarity／llm 放進 status.stages，但狀態從建立時就是 `skipped`；不是執行了空的 LLM 呼叫。停用層的 stage 不加入紀錄。所有 stage 正常呼叫為循序，沒有把描述／診斷／NG／拓樸／RAG 平行化。

原始及 Kit 的 daily 切分都直接取 DataSplitter 回傳清單的前兩組；`threshold=5` 在數值高基數時只觸發警告，不是「NG 值大於 5」的二元分類規則。缺少第二組會在索引時出錯，多於兩組時只取前兩組，Kit 也沒有改成自動推斷正常／異常標籤。因此圖只標 sample／baseline，不猜業務標籤。（E:data_preprocessor/data_splitter.py `split`／`_execute_split`；O／P `data_splitting`。）

### 層級與子功能

A 含資料準備、描述、診斷；B 是 NG 分布庫訓練／預測；C 是拓樸、RAG 與客訴後段。`subfeatureId` 只標在十個 stage 上。回饋與案例庫 API 不檢查目前 layers.c，外部匯入也不要求有本次分析，故 derived 沒有替這些節點加上 C 必開的暗示。

`Settings.layers_are_consistent()` 允許 daily 的 A+C；但 Composer `config/kits/overlay.json` 對 layer-c 的子功能依賴固定列 A+B，文件第 1 節的表格也寫 C 依賴 A、B，下段文字則說只有 complain 的 C 需要 B。這是選配中繼資料與 runtime 規則的差異，derived 描述 runtime，沒有修改任何一邊。

### 前置與後置

原始入口在 main 外讀設定，無就緒 API；`main` 假設 system 已可用。Kit 的 POST runs 本身會重新做 readiness，GET status／PUT settings 並非每次啟動必經 API；沒有先開設定畫面也可以使用已保存的設定執行。示範資料載入不是依賴，seed 只複製不存在的檔案。

Kit 對結果的 GET 只檢查 run 存在及結果名稱是否實際在 results 清單，沒有要求 state=succeeded；因此執行中或失敗後也能取得已產出的檔案。GET runs／run 的查詢不會推動 stage，也不是拿結果的必經操作。

回饋是另外的請求：submit_from_run 要求成功 run、有 search_key_results.json 及對應事件；import_records 沒有 run 成功的前提。admin／manager 提交或匯入時 `_commit` 自動核可，operator 需另行 decide；決定可核可或駁回，已決定的項目不能再決定。publish 只處理已核可且尚未發布的回饋，且 active run 存在時拒絕；相同 event_id 在新版本被後來加入的回饋取代，舊版本保留。實作迭代 entries 的順序，並非以 decidedAt 排序，所以文件的「最後核可者」更精確應讀為本次待發布清單中最後套用的 entry。

## 行為差異與仍會略過的情況

| 面向 | 原始 f49cfd3 | Kit 程式碼行為 |
|---|---|---|
| 讀檔／選欄失敗 | DataManager 用 `{success:false,data:None}`；main.read_data 直接取 data，之後可能以較不清楚的例外中斷 | StrictCSVManager／StrictJSONManager 在 `_response(False,...)` 立即丟 PipelineError。缺少部分欄位仍屬 select 成功，不等同所有缺欄都丟例外。 |
| 寫結果失敗 | output_data 捕捉所有 Exception，只記 log 後繼續；可能缺檔卻繼續下一步 | output_data 建父目錄後直接寫，錯誤交 runner 記錄；結果 JSON 本身不是原子寫入。status／snapshot 使用臨時檔＋atomic_replace。 |
| 一般 stage 失敗 | 無 run 狀態，未捕捉例外往外傳；之前結果檔仍在共用 output_folder | runner 標目前 stage failed、run failed、保留已產出的結果，不重試；之後 stage 不執行但原本 pending 的欄位不會全部改成 interrupted。 |
| 背景／重啟 | 同步執行，沒有持久化 queued/running 狀態 | daemon thread；單一 RunStore 的 active 與 lock 限制同時一次，非跨行程鎖。`_sweep` 在 list／create 才執行，把前行程遺留的 queued/running 改 failed、待執行階段改 interrupted；不是服務剛啟動即保證完成掃描。 |
| LLM 位址與金鑰 | __init__ 從原設定取 api_endpoint；requests.post 未提供 timeout、認證 header 或 raise_for_status；實際位址因設定檔未入 commit 而未知 | derive_config 以 Kit llm.endpoint 覆蓋來源設定；timeoutSeconds 預設 120、範圍 1–900。apiKeyEnv 指向環境變數，執行時讀取後作 Bearer token，不保存金鑰值。status 只記 endpointSet／apiKeyEnv，但 settings snapshot 和 derived config 仍含 endpoint 本身。 |
| LLM 失敗與回應 | HTTP 錯誤若 body 是 JSON，會被當回應收下；連線／JSON 解碼例外可中斷 | HTTP 非成功、連線錯誤、逾時、JSON 解碼錯誤轉 PipelineError；**只檢查可解碼 JSON，沒有驗證回應一定是完整事件或沒有業務 error 欄位**。HTTP 200 的保底／錯誤物件仍可能讓 llm stage done。 |
| 案例 JSONL | similarity_search 遇壞行 print 後跳過；手動 indexer 的讀既有 ID 遇壞行直接 pass | similarity_search 對非空壞行中止，空白行仍略過；FeedbackStore._read_lines 遇壞行回含行號的 FeedbackError。這是 JSON 語法檢查，不能推論任意有效 JSON 都有正確業務結構。 |
| 寫入位置 | 相對工作目錄的 output_folder；CLI 固定 outputs/complain/；daily known_base 和 compile 拓樸讀取另有硬編碼；topology 摘要另寫 CWD | 以 ANALYTICAL_FOUR_DATA_DIR（預設 /system/data/analytical-four）為根，設定路徑用 resolve_inside；每 run 結果隔離，已知分布庫、向量庫、活動案例仍是共享資源。不是所有檔案都在 run results 裡。 |
| 特徵／資料清理 | select 缺欄會警告後忽略；刪去缺值列；切分只取前兩組 | 保留這些行為，另在 read-data detail 報告缺少數值特徵的數量，全部數值特徵缺失、目標欄缺失或 sample/baseline 空時中止。不能把「失敗要大聲」解讀成沒有資料被略過。 |
| 序列化及 SOP | 無 event_id 的事件輸出警告後跳過；SOP 不足七欄 print 後跳過 | P.serialization 仍警告並跳過缺 event_id 的檔案；P.extract_search_key 改 logger.warning 但仍跳過短 SOP。diagnostic_stage 只補空事件與 ranked_features.error 檢查，不是每個事件欄位的完整 schema 驗證。 |
| 向量庫更新 | build_vector_database_if_needed 以既有筆數和新知識筆數判斷是否重建 | 演算法未改；筆數相同但內容變更可能沿用舊向量。沒有聲稱 hash builder 解決此問題。 |
| 回饋不完整 | 手動 ErrorAnalysis／indexer 的欄位假設 | _known_codes 讀不到定義時回 None，entry.isNewCode=null，不阻擋提交；submit_from_run 的 LLM 紀錄不合格式時退回搜尋鍵紀錄，不將此情況標為 run 失敗。publish 合併既有資料時略過非物件或無 event_id 的列；壞 JSON 語法仍會中止。 |

寫入／鎖限制按程式界線描述：背景例外要能成功寫 status 才會留下 failed；儲存本身不可用時，catch 內的再次寫檔也可能失敗。publish 的兩個活動案例檔分別原子替換，版本目錄先發布，再替換活動檔；兩檔不是一個交易。它檢查 active 時持有 feedback.lock，而 create 使用另一把 run.lock，不能僅憑「分析中禁止發布」就宣稱排除所有啟動競態。這些屬靜態可見限制，本次沒有做故障注入或並發驗證。

## 原始專案有、Kit 未完整搬入的項目

| 項目 | 原始的實際位置與用途 | Kit 狀態及對 AoV 的影響 |
|---|---|---|
| ErrorAnalysis | O:analysis/prescriptive/error_analysis.py：sort_by_feedback 按確認 NG 分組；statistics_ng_code_feature 計算 T²／SPE／量測值 Min/Max/Mean/Count；compute_error_analysis 比較最終與確認 NG，計算距離、stability、解釋、consistency_warning 與誤判原因 | 未複製。F._store 只重算 was_correct，若缺 error_reasons／delta 才補空值；不計算這些統計，也不一定清空匯入者已提供的內容。 |
| event_feedback_record 完整鏈 | O:main.py:945：ErrorAnalysis 分組 → 統計 → 逐筆填 error_analysis → index_records；main 與 CLI 沒呼叫它 | Kit 沒有此函式，新增 API 流程替代其中的保存與使用案例部分，不能標成完整保留；original 圖不虛構 llm → feedback 邊。 |
| 原始 indexer | O:analysis/prescriptive/indexer.py `index_records`：有 confirmed_ng 才 append 主檔；was_correct=False 另 append 誤判檔；各檔相同 event_id 去重；預設是 CWD 的 llm_records.jsonl／llm_error_records.jsonl | 未複製，Kit 改成 entry／decision 追加歷史、核可後發布 vNNNN、manifest 雜湊與活動檔替換；允許更正同 event_id，並非原始去重跳過。原始 README 說 indexer 路徑從 config 讀取，實際函式預設常數不是如此。 |
| 預測模型 | O:analysis/predictive/prediction.py 的 Predictor（scikit-learn／XGBoost 模型路徑）、transformer.py；未由 main 呼叫 | 未複製。B 層的 NG 分布庫預測仍存在，不能把「未搬預測模型」誤寫成沒有 NG 預測。 |
| Gemini 直連 | O:analysis/prescriptive/gemini_analyzer.py `analyze_with_gemini` 使用 google.genai、傳入 API_KEY、prompt template、gemini-2.5-flash；main 只有 import，沒有呼叫 | 未複製，也沒有 Gemini 專用節點／憑證流程；Kit 的通用 HTTP endpoint 可以連任何相容轉接服務，但本次沒有驗證 Gemini。 |
| diagnostic_aggregation | O:main.py:580 與 analysis/prescriptive/diagnostic_aggregator.py `DiagnosticAggregator.run`，依 context 維度彙整；CLI 後段只有註解範例 | 未複製／方法移除，沒有從 original 主圖刪除真正在跑的節點。 |
| 額外標準化／前處理、services | O:main.py import DataStandardizerFactory／DataPreprocessorFactory，但 main 沒呼叫；其他模組見 SOURCE.md 的未複製清單 | Kit 保留本流程所需的 DataSplitter，未宣稱那些未使用模組已搬入；不畫成原始 main 的前置步驟。 |
| 獨立繪圖／離線實驗及來源資料 | main 未呼叫那些離線路徑；README 描述繪圖、baseline_comparison 及實際資料檔 | Kit 未把整個原始工作目錄或模型／資料資產帶入；contribution／correlation 的未使用 matplotlib／seaborn import 已刪。沒有對全部離線實驗逐檔建立 AoV。 |

## 出貨 AoV 與獨立推導 AoV

已先完成 [kit.derived.aov.json](kit.derived.aov.json)，才首次讀取 [出貨 workflow.aov.json](../../kits/analytical-four-kit/workflow.aov.json)。讀取前 derived SHA256 為 `4ee1f8c385151877de8fb80249a20f7f4449f33c9f92427306147c4ef5af2523`，過程記於 Codex Notes。出貨為 19 節點／19 邊，derived 為 25 節點／34 邊；下列採語意映射，不把改名當遺漏。

### 節點映射、遺漏及多列

| 出貨節點 | derived 節點 | 判定與依據 |
|---|---|---|
| load-demo、configure、check-ready、start-run | demo、settings、readiness、create-run | 名稱／id 不同，能力相同，沒有多餘功能。API.load_demo／get_settings／put_settings／get_status／create_run 均存在。 |
| read-data、descriptive、diagnostic、ng-code、topology、rag、compile、search-key、similarity、llm | 同 id 的十節點 | 兩份都對應 R.STAGES 與 _execute，**沒有漏掉分析 stage**。derived 的名稱／scope 補 mode 與內部步驟；細節粒度差異不是出貨缺少 PCA 等功能。 |
| view-run、view-results | run-history、results | 都有 API；derived 明示結果不需等 run 完成，且 run-history 不是分析 stage。依 R.get/list/result_names/result。 |
| submit-feedback | feedback-submit、feedback-import | 出貨合併兩條不同來源的操作；derived 拆開較準確，F.import_records 不要求有成功 run。出貨功能存在，並非虛構節點。 |
| approve-feedback | feedback-list、feedback-decide | 出貨把讀取與決定合併，且名稱只說核可；derived 區分只讀與可核可／駁回，依 API.list_feedback／decide_feedback、F.decide。 |
| publish-library | library-publish、library-versions | 出貨合併發布及查版本，derived 拆開；API.library_versions 不會發布，也不用先做本次 publish。 |
| 無 | derive-config | 出貨省略背景初始化與衍生設定存檔；R._execute 明確存在。以概覽可折入 start-run，以細部執行流程 derived 較完整。 |
| 無 | run-succeeded、run-failed | 出貨沒有成功／失敗出口，難以表達 A-only／daily 提早完成；R._execute 有兩種狀態與 finally。derived 補足，但不是新增兩個 API。 |

出貨沒有「程式完全不存在」的額外節點。只按字串比較會得到不同 id 的假陽性；真正需要修正的是條件、分組與邊的語意。

### 邊的逐類比較

下表對出貨的全部 19 條邊分組判定；另列 derived 新增的邊。以**實際先後順序**為比較準則；資料依賴本來可以跨過中間步驟，但不能拿來證明執行會平行或跳步。

| 出貨邊（使用出貨 id） | derived 的處理 | 哪一份較準確、程式依據 |
|---|---|---|
| configure → check-ready；check-ready → start-run | 不設強制邊；create-run 節點內包含 readiness | 若作建議操作順序，出貨可理解；若作 runtime 必經路徑，derived 正確。API.create_run 直接讀設定，R.create 自行 readiness，不要求曾呼叫 GET status 或 PUT settings。 |
| start-run → read-data | create-run → derive-config → read-data | 出貨略去初始化。derived 較細；R._execute 先標 running、衍生及載入設定、設定 LLM，再 prepare_data。A 關閉時不會到 read-data。 |
| read-data → descriptive；descriptive → diagnostic；diagnostic → ng-code | 保留 | 兩份都正確，但最後一條僅 B 開啟。R._execute 中相鄰 stage 呼叫。 |
| diagnostic → topology | 保留，明訂 daily、C 開、B 關 | derived 的條件較準確。B 開時需經 ng-code；complain 的 C 不能跳過 B。依 S.layers_are_consistent、R._execute。 |
| diagnostic → rag | 移除；用 topology → rag | 作序列邊出貨不準確，R._execute 必先完成 topology 才呼叫 rag。作資料依賴則 serialized events 確由 diagnostic 供給 rag，但不是直接下一步。 |
| ng-code → compile；topology → compile | 不作直接序列邊；用 ng-code → topology → rag → compile | compile 確實讀 NG、拓樸與 RAG 資料，出貨兩邊可解作資料依賴；但出貨缺 ng-code → topology 和 topology → rag，無法表達實際串行順序。R._execute 及 P.compilation_events 支持 derived 的順序。 |
| rag → compile | 保留，僅 complain | 兩份主線一致；daily 在 rag 後成功，不應進 compile。R.COMPLAIN_ONLY、_execute。 |
| compile → search-key；search-key → similarity；similarity → llm | 保留，僅 complain+C | 兩份都符合 R._execute；search-key 包含在 runner 額外寫檔之後才進 similarity。 |
| start-run → view-run；view-run → view-results | 不作強制執行邊，兩種查詢獨立 | 出貨是可能的使用者操作順序；API.get_result 只需要 run_id、name，沒有「先 GET run」或「run 已成功」的檢查。derived 更準確描述 API 前提。 |
| view-results → submit-feedback | run-succeeded → feedback-submit；import 為另一入口 | 出貨誤把外部匯入也綁到取結果；F.submit_from_run 必查 succeeded 與搜尋鍵檔，但使用者不必先透過 GET results 讀取，F.import_records 不依賴 run。derived 較準確。 |
| submit-feedback → approve-feedback | submit/import → decide 或直接 → publish | 出貨只呈現人工核可路徑，漏自動核可。F._commit 依 AUTO_APPROVE_ROLES 寫決定；derived 兩分支各依角色擇一，非兩條都跑。 |
| approve-feedback → publish-library | feedback-decide → library-publish，僅核可且未發布 | 出貨概覽合理但沒呈現駁回終止；F.decide 允許 approve=False，F.publish 只取 approve=True。derived 條件較精確；核可也不會自動呼叫 publish。 |

derived 額外的邊與涵義：

- `ng-code → topology`、`topology → rag`：補實際順序，來源 R._execute。
- `derive-config → run-succeeded`（全層關）、`diagnostic → run-succeeded`（僅 A）、`ng-code → run-succeeded`（A+B）、`rag → run-succeeded`（daily+C）、`llm → run-succeeded`（complain+C）：把模式／層級出口展開。來源 R._execute 的條件與最後 `_update(succeeded)`。
- `derive-config` 和十個 stage 各自 `→ run-failed`：共同 catch 的例外出口，共 11 條，來源 R._execute。不是在出錯後還繼續跑後續 stage。
- `feedback-import → feedback-decide`、`feedback-submit/import → library-publish`：外部匯入入口與 admin／manager 自動核可捷徑，來源 F.import_records／_commit／publish。拒絕、未核可或已發布均不走發布邊。

### 能力編號與子功能差異

兩份的能力集合皆為 registry 的 **15 個能力，沒有未知、漏掉或拼錯的能力編號**。差異在節點歸屬：

| 差異 | 判定 |
|---|---|
| 出貨十個內部 stage 都附 `analytical-four.runs.create`；derived 只在 create-run 附一次 | registry／contract 只定義一個 POST /runs，API.create_run 啟動一次背景工作，沒有十個可單獨呼叫的 stage API。若 capabilityIds 表示「此 API 可觸發該內部步驟」，出貨屬可理解的關聯標示，非未知能力；若表示節點自己的 API，derived 較精確。schema 沒定義這兩種語意，所以不將重複掛載一概稱 schema 錯誤。 |
| 出貨將 feedback.submit+import、feedback.list+decide、library.publish+versions 各合併於一節點 | derived 分成六節點，以免把讀取當寫入、匯入當依賴本次 run。能力本身兩份都正確，函式依據見上一節映射表。 |
| 出貨對 submit-feedback／approve-feedback／publish-library 標 layer-c；derived 不標 | 可作產品分類，但不能當 runtime 啟用門檻。API／FeedbackStore 沒有檢查 layers.c；匯入、查看、核可與發布可針對既有資料，不必目前開 C。 |

## 文件與程式不一致的核對紀錄

| 文件陳述 | 程式事實／本次處理 |
|---|---|
| SOURCE.md 說「只改匯入與下列行為」，修改表未列 compile 拓樸路徑參數 | O:main.py:480 固定路徑，P:498 新增 topology_folder，R._execute 傳本次結果目錄。已列為額外改寫，未修改 SOURCE.md。 |
| Kit 說明第 1 節表格及 overlay 把 C 依賴 A+B；同節文字又限 complain | S.layers_are_consistent 對 daily 只要求 A；derived 按 runtime 明訂 daily A+C 分支。 |
| Kit 說明第 2.2 節將 analysisConfig 路徑驗證也描述為讀寫設定時一律 422 | Settings 僅限制此字串長度；put_settings 先 save_settings，再 readiness。resolve_inside 在 read_analysis_config／derive_config 才呼叫，非法路徑可能保存後以 readiness 問題回報，create 再以 409 阻擋。不能聲稱模型讀寫時已拒絕所有非法路徑。 |
| Kit 說明第 3 節「服務重啟時」標 failed | R._sweep 只由 list／create 觸發，GET 單一 run 或 status 本身不掃描；文件是概述，實際是延後清理。 |
| 出貨 scope「結果檔在執行完成後取得」 | API.list_results/get_result、R.result 未限制完成狀態；derived 標為獨立讀取已存在結果。 |
| Kit 說明第 8 節稱 error_reasons／delta 目前為空 | F._store 使用 setdefault，會保留已存在內容；只是沒有生成原始 ErrorAnalysis 的統計。已在未搬入清單區分「不計算」與「強制清空」。 |
| Kit 說明第 8 節稱同 event_id 以「最後核可者」取代 | F.publish 以 entries 順序套用 pending，沒有依決定時間排序。本文採實作的最後套用 entry。 |
| Kit 說明開頭及第 8.3 節稱真實 LLM／回傳格式未驗證，第 7／9 節又記本機 Ollama 實測 | 文件的驗證敘述未完全同步。程式只能證明 payload、JSON 解析與回饋 fallback；本次未重跑，不能把第 9 節報告當成本次測試證據。 |
| O:README §12.13 說每次重建向量庫；§12.20 說 indexer 路徑來自 config；§9.A 說 main 直接讀 compilation_events.json | O:main.py.rag_analysis 實際呼叫 build_vector_database_if_needed；indexer 用預設常數；main 的重讀片段是註解。原始 AoV 一律按程式。 |

## 工作樹變體（不屬於 original AoV）

唯讀 `git diff --no-ext-diff f49cfd3 -- main.py` 顯示來源工作樹已將 `compilation_events` 加上 `topology_folder` 參數、main 傳入 output_folder/topology，並把 CLI 輸出從 `outputs/complain/` 改成 `outputs/daily/`。這解決了自訂輸出目錄與彙整重讀位置不一致的一部分問題，但不改 `main()` 的 mode 分支順序；CLI 輸出資料夾叫 daily 也不能證明設定檔 mode=daily。

來源工作樹另有 `analysis/prescriptive/local_llm_server.py`，`git ls-tree f49cfd3` 沒有此檔。唯讀核對 `diagnose`／`DiagnoseHandler.do_POST`：它呼叫 Ollama，成功時複製 new_event 並填 llm_analysis／conclusion，捕捉 UpstreamError 時回 HTTP 502。此轉接層不是原始 commit 內的服務，沒有加進 original 圖；其註解說「Kit 或 main.py 會標為失敗」也不能改變 main.py 未做 raise_for_status 的事實。Kit 可識別這個 502，但原始及目前 main.py 的 analyze_with_llm 仍只解析 JSON，可能把錯誤 body 收為回應。本次未呼叫轉接層，沒有驗證其當前可用性。

## 驗證與限制

在專案根目錄執行：

```powershell
node docs/aov-compare/validate.mjs
```

使用現有 Ajv 2020 與原 schema，檢查兩圖 schema、節點 id 唯一、邊端點存在及無環；另核對 original metadata／空能力及 Kit 能力屬於 registry。腳本的記憶體自我檢查包含有效 DAG、schema 錯誤、重複節點／邊、兩端懸空、自環、斷開子圖內的環；不寫 fixture、快取或來源檔。實際輸出亦貼於 Codex Notes。

| 交付物 | 驗證結果 |
|---|---|
| original.aov.json | 通過；29 節點、29 邊、0 能力 |
| kit.derived.aov.json | 通過；25 節點、34 邊、15 能力 |
| validate.mjs 自我檢查 | 通過上述有效／無效案例 |

限制：

1. 原始設定 JSON 不在指定 commit；無法還原實際資料、特徵、模式與服務位址。main 的控制流程可確認，某次真實執行會走哪支則不能確認。
2. 沒有啟動 Python 引擎、API、背景 worker、資料庫／向量庫、Ollama 或任何外部服務，沒有改動或複製原始製造資料。數學結果、效能、角色授權整合及真實診斷品質未由本次驗證。
3. schema 沒有邊條件／分支閘／迴圈語意；模式、層級、失敗及人工操作條件在 scope 與本文中說明，逐事件迴圈折成一節點。DAG 檢查不代表此圖可當執行計畫，也不能自動證明所有路徑組合可達。
4. stage 的錯誤出口假設狀態儲存可寫，沒有展開每個磁碟／網路／並發錯誤。API 4xx、授權拒絕和使用者重複操作的完整狀態機也沒有逐個節點化。
5. Kit 圖先獨立推導、後看出貨圖；本次未修正出貨圖、程式、schema、registry、其他文件或 Git 資料。Claude 仍需依交接驗收，這些 draft 不代表已審查通過。
