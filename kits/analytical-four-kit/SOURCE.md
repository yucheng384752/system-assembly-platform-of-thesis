# analytical-four-kit 來源

分析引擎複製自 Analytical-Four（`C:\Users\gslab\Desktop\Analytical-Four`，commit `f49cfd3`，Python 3.10）。來源專案未修改。複製日期：2026-11-01。

## 複製的檔案

`src/backend/app/analytical_four/engine/` 內：`analysis/models.py`、`analysis/descriptive/{statistical_calculator,categorical_analyzer}.py`、`analysis/diagnostic/{comparator,correlation,contribution,extraction}.py`、`analysis/prescriptive/{calculate_rank,ng_diagnosis,similar_searcher,topology_generator}.py`、`analysis/prescriptive/RAG/`、`serializer/`、`data_manager/`、`data_preprocessor/data_splitter.py`，以及 `config_manager.py`（原為 `data/raw/config/config_manager.py`）。

`src/backend/app/analytical_four/pipeline.py` 取自 `main.py` 中 `Analytical_Four_System` 類別的方法本體。

## 未複製

`data/`、`outputs/`、`my_project_v3_db/`、`llm_*.jsonl`（可能含真實製造資料）、`analysis/predictive`、`analysis/prescriptive/{gemini_analyzer,local_llm_server,error_analysis,indexer,diagnostic_aggregator}.py`、`standardizers/`、`data_preprocessor/` 其餘檔案、`services/`、`main.py` 的入口與 `event_feedback_record`。

## 對複製內容的修改

只改匯入路徑與下列行為：

| 檔案 | 修改 | 原因 |
|---|---|---|
| 全部 | 頂層匯入（`analysis`、`serializer`、`data_manager`、`data_preprocessor`、`data.raw.config.config_manager`）改為 `app.analytical_four.engine.*` | 放進系統後端的套件 |
| `analysis/diagnostic/contribution.py`、`correlation.py` | 刪除未使用的 `matplotlib`、`seaborn` 匯入 | 伺服器不需要繪圖套件，避免多兩個依賴 |
| `analysis/prescriptive/topology_generator.py` | 刪除 `summarize_serialized` 結尾寫 `topology_summary_output.json` 到工作目錄的除錯程式 | 容器工作目錄不可寫，且每個事件都覆寫同一檔 |
| `analysis/prescriptive/similar_searcher.py` | 機台限制比對時排除產品編號欄位（`Produce_No._or_Semi_produce_No.`） | 原寫法連產品編號一起比，只有同一個產品重新分析才找得到案例，新的客訴永遠找不到相似案例 |
| `pipeline.py` | 資料管理器失敗時丟 `PipelineError`；`output_data` 寫檔失敗時丟例外；每日模式分布庫寫到設定的路徑；LLM 呼叫加逾時、狀態碼與 JSON 檢查、金鑰標頭；`print` 改為記錄或錯誤；無效 JSONL 行改為中止（空白行仍略過）；移除 `diagnostic_aggregation`（依賴的模組未複製） | 失敗要大聲、不寫工作目錄 |
| `pipeline.py`（欄位對照與清理揭露） | `read_data` 在 CSV 讀入後依 `column_mapping` 改欄名；`prepare_data` 把清理刪掉的列數記入 `notes` | 讓場域欄名不必等於引擎欄名，並說出被刪的列 |
| `pipeline.py`（新增） | `prepare_data`、`descriptive_stage`、`diagnostic_stage`、`_post_llm` | 把 `main()` 拆成可由 A、B、C 層個別執行的階段 |

Kit 自己新增（不是複製）：`settings.py`、`runs.py`、`offline_vectors.py`、`seed_demo.py`、`demo_data/`、`api/routes_analytical_four.py`、`tests/`、`demo/generate_demo.py`。
