# Analytical-Four 使用前後結構比較

節點粒度不同：使用前是函式呼叫，使用後 Kit 的分析階段把多個函式合成一個節點。對應關係是人工判斷，節點數差異不代表效能或操作時間差異。

## 結構統計

使用前的統計只計函式節點及其連線；畫布另有開始、結束節點及邊界連線。

| 使用前邏輯 | 節點數 | 連線數 | 不重複函式數 |
| --- | --- | --- | --- |
| 每日模式（設定 mode = daily） | 15 | 14 | 15 |
| 客訴模式（設定 mode = complain） | 20 | 19 | 19 |
| 事後回饋（event_feedback_record，main() 不會呼叫它） | 4 | 3 | 4 |

使用前節點合計：39；跨邏輯不重複函式：24。

| 使用後 | 節點數 | 連線數 |
| --- | --- | --- |
| Kit | 22 | 23 |

## 節點對應

| 邏輯 | 使用前節點 | 名稱 | 函式 | 來源檔案 | 定義行 | Kit 節點 |
| --- | --- | --- | --- | --- | --- | --- |
| daily | d-load-config | 載入設定檔（路徑寫死在程式裡） | ConfigManager.load_config | main.py（程式入口，第 964 行） | 未提供 | configure |
| daily | d-read-current | 讀取待分析資料 | read_data | main.py | 96 | read-data |
| daily | d-clean | 清理資料（選欄位、去空值） | data_cleaning | main.py | 101 | read-data |
| daily | d-split | 依目標欄位切成待查與基準 | data_splitting | main.py | 109 | read-data |
| daily | d-basic | 基本統計（基準資料） | basic_statistics | main.py | 140 | descriptive |
| daily | d-categorical | 類別統計 | categorical_statistics | main.py | 161 | descriptive |
| daily | d-outliers | 基準線異常檢測 | compare_outliers | main.py | 176 | descriptive |
| daily | d-correlation | 相關係數比對 | correlation_analysis | main.py | 198 | diagnostic |
| daily | d-contribution | PCA 貢獻度（SPE、T2） | contribution_analysis | main.py | 224 | diagnostic |
| daily | d-importance | 特徵重要性萃取 | extract_feature_importance | main.py | 319 | diagnostic |
| daily | d-weighted | 特徵貢獻加權計算 | calculate_weighted_contributions | main.py | 361 | diagnostic |
| daily | d-serialize | 診斷結果序列化成事件 | serialization | main.py | 385 | diagnostic |
| daily | d-topology | 製程位置對應（拓樸） | topology_analysis | main.py | 412 | topology |
| daily | d-rag | SOP 檢索（RAG） | rag_analysis | main.py | 431 | rag |
| daily | d-ng-code | 不良類型診斷 | ng_code_analysis | main.py | 455 | ng-code |
| complain | c-load-config | 載入設定檔（路徑寫死在程式裡） | ConfigManager.load_config | main.py（程式入口，第 964 行） | 未提供 | configure |
| complain | c-read-current | 讀取待分析資料 | read_data | main.py | 96 | read-data |
| complain | c-read-baseline | 讀取正常基準資料 | read_data | main.py | 96 | read-data |
| complain | c-clean | 清理資料（選欄位、去空值） | data_cleaning | main.py | 101 | read-data |
| complain | c-align | 基準資料欄位與待分析資料對齊 | align_features | main.py | 128 | read-data |
| complain | c-basic | 基本統計（基準資料） | basic_statistics | main.py | 140 | descriptive |
| complain | c-categorical | 類別統計 | categorical_statistics | main.py | 161 | descriptive |
| complain | c-outliers | 基準線異常檢測 | compare_outliers | main.py | 176 | descriptive |
| complain | c-correlation | 相關係數比對 | correlation_analysis | main.py | 198 | diagnostic |
| complain | c-contribution | PCA 貢獻度（SPE、T2） | contribution_analysis | main.py | 224 | diagnostic |
| complain | c-importance | 特徵重要性萃取 | extract_feature_importance | main.py | 319 | diagnostic |
| complain | c-weighted | 特徵貢獻加權計算 | calculate_weighted_contributions | main.py | 361 | diagnostic |
| complain | c-serialize | 診斷結果序列化成事件 | serialization | main.py | 385 | diagnostic |
| complain | c-topology | 製程位置對應（拓樸） | topology_analysis | main.py | 412 | topology |
| complain | c-rag | SOP 檢索（RAG） | rag_analysis | main.py | 431 | rag |
| complain | c-ng-code | 不良類型診斷 | ng_code_analysis | main.py | 455 | ng-code |
| complain | c-compile | 彙整事件 | compilation_events | main.py | 480 | compile |
| complain | c-search-key | 擷取搜尋關鍵 | extract_search_key | main.py | 594 | search-key |
| complain | c-similarity | 相似案例搜尋 | similarity_search | main.py | 711 | similarity |
| complain | c-llm | AI 綜合診斷 | analyze_with_llm | main.py | 759 | llm |
| feedback | f-sort | 依回饋把診斷結果分類 | ErrorAnalysis.sort_by_feedback | analysis/prescriptive/error_analysis.py | 未提供 | submit-feedback |
| feedback | f-stats | 統計各不良類型的特徵 | ErrorAnalysis.statistics_ng_code_feature | analysis/prescriptive/error_analysis.py | 未提供 | submit-feedback |
| feedback | f-compute | 計算每筆案例的錯誤分析 | ErrorAnalysis.compute_error_analysis | analysis/prescriptive/error_analysis.py | 未提供 | submit-feedback |
| feedback | f-index | 把結果寫入案例索引 | index_records | analysis/prescriptive/indexer.py | 未提供 | publish-library |

## 粒度比

| Kit 節點 | 名稱 | 對應的使用前節點數 | 不重複函式數 |
| --- | --- | --- | --- |
| get-templates | 下載範本與需求表 | 0 | 0 |
| upload-files | 上傳資料與設定檔並看驗證報告 | 0 | 0 |
| accept-upload | 接受或丟棄上傳的檔案 | 0 | 0 |
| configure | 調整分析設定 | 2 | 1 |
| check-ready | 確認資料與設定就緒 | 0 | 0 |
| check-data | 檢查資料檔與欄位對照 | 0 | 0 |
| start-run | 啟動分析 | 0 | 0 |
| read-data | 讀取並整理資料 | 7 | 4 |
| descriptive | 描述性分析 | 6 | 3 |
| diagnostic | 診斷性分析 | 10 | 5 |
| ng-code | 不良類型診斷 | 2 | 1 |
| topology | 製程位置對應 | 2 | 1 |
| rag | SOP 檢索 | 2 | 1 |
| compile | 彙整事件 | 1 | 1 |
| search-key | 擷取搜尋關鍵 | 1 | 1 |
| similarity | 相似案例搜尋 | 1 | 1 |
| llm | AI 綜合診斷 | 1 | 1 |
| view-run | 查看執行狀態 | 0 | 0 |
| view-results | 取得分析結果 | 0 | 0 |
| submit-feedback | 提交確認結果 | 3 | 3 |
| approve-feedback | 核可回饋 | 0 | 0 |
| publish-library | 發布案例庫新版本，必要時回復舊版本 | 1 | 1 |

## 沒有對應的節點

| 分類 | 節點 |
| --- | --- |
| Kit 新增的環節 | get-templates、upload-files、accept-upload、check-ready、check-data、start-run、view-run、view-results、approve-feedback |
| 使用前沒有對應 | 無 |

## 順序差異

只檢查使用前相鄰邊；當對應的兩個 Kit 節點不同，且 Kit 可從後者到達前者時列出。

| 邏輯 | 使用前相鄰邊 | Kit 反向可達 |
| --- | --- | --- |
| daily | d-rag → d-ng-code | ng-code → rag |
| complain | c-rag → c-ng-code | ng-code → rag |

## 原專案觀察

| 編號 | 觀察 | 依據 |
| --- | --- | --- |
| O1 | 設定檔路徑（main.py 第 964 行）與輸出資料夾（第 968 行）寫死在程式入口；切換設定檔或模式要改程式。 | main.py:964, 968；README 5.3 |
| O2 | compilation_events 讀拓樸結果的路徑寫死為 outputs/complain/topology/（第 560 行），而拓樸結果寫到 main() 的 output_folder；兩者不同資料夾時讀不到。 | main.py:557-560, 893-895 |
| O3 | 兩個模式由同一個 main() 內的 if 分支串接，模式差異不在流程上顯示，只能讀程式或設定才知道。 | main.py:787-943 |
| O4 | event_feedback_record 是獨立函式，main() 沒有呼叫它；回饋要另外執行。 | main.py:945-956 |

## 來源

| 項目 | 內容 |
| --- | --- |
| project | Analytical-Four |
| author | ZHAO-XIAN |
| commit | f49cfd3 |
| entry | main.py |
| license | 原專案沒有 LICENSE 檔 |
| note | 節點是 main.py 在該提交實際呼叫的函式；順序依 Analytical_Four_System.main() 的呼叫順序。kitNodes 是人工判斷這個函式在 Kit 的 workflow.aov.json 中對應哪個節點。 |

本文件與 analytical-four-before.aov.json 由 thesisAovCase.test.ts 產生。更新：在專案根目錄以 THESIS_CASE_UPDATE=1 執行 npx vitest run --configLoader native thesisAovCase.test.ts；一般 npm test 會檢查兩個產生檔是否過期。
