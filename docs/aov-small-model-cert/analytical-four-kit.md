# analytical-four-kit 認證審查表

狀態：Claude 驗證通過；user 覆核通過（2026-11-10）。認證只代表「建模與訓練可用」，不代表執行可用（D195）。

## 認證對象

| 項目 | 內容 |
|---|---|
| 檔案 | `kits/analytical-four-kit/workflow.aov.json` |
| SHA-256 | `a11237b90717cf75b6bc8ab4734ef6842634c150f90aeef1929442c57cfc7a02` |
| 來源 commit | 本分支 `3b762be` 之上的工作樹（流程於 CHANGELOG #8 至 #10 修改） |
| Kit 版本 | 0.1.0 |
| 狀態欄 | draft（是否改成 reviewed 由 user 決定） |
| 動作目錄 | `config/actions.json`，認證時 30 個動作（D199）；之後增至 55 個（D203），新增的 25 個與本 Kit 無關，其涵蓋與推導測試仍通過 |
| 工具 | `parseKitWorkflow`、`kitWorkflowToCanvas`、`integrityErrors`、`graphErrors`、`exportAovGraphDraft`／`importWorkflow`（均為 main 上的程式） |

任何對上列檔案的修改，都使本認證失效，需要重新審查。

## 覆核歷程

| 日期 | 內容 |
|---|---|
| 2026-11-10 | 初版審查表（雜湊 `20405c6f1160`，23 步、22 條連線）：user 覆核通過，並要求兩項修改 |
| 2026-11-10 | 依 user 指示補 `check-data` 到 `start-run`（CHANGELOG #9），並在確認 `load-demo` 不是系統啟動必要步驟後移除（CHANGELOG #10）；重新驗證並產生本版 |

user 覆核的是前一版；本版與前一版的差異只有上述兩項，皆依 user 的指示。若要把本版雜湊正式視為覆核對象，請在簽核欄確認。

## Claude 驗證結果（本版）

| 檢查 | 結果 |
|---|---|
| 流程規格與登錄一致（schema、子功能、能力皆已登錄、無循環） | 通過 |
| 轉成畫布（`kitWorkflowToCanvas`） | 通過，22 步、23 條連線，另加開始與結束連線 |
| 畫布完整性（`integrityErrors`） | 0 項 |
| 畫布待補項（`graphErrors`） | 0 項 |
| 下載再匯入（`exportAovGraphDraft`、`importWorkflow`）節點與動作標籤 | 相同 |
| 動作對應 | 12 步對應 12 個不同動作，10 步無對應（階段） |
| 能力涵蓋 | 24 個登錄能力每個恰好被一個動作涵蓋；其中 `demo.load` 刻意不在流程內（測試有明列例外） |
| 專案檔轉換（`convertCanvas`） | 不適用：它需要逐節點的物料設定（ProjectDetails），Kit 流程描述的是軟體功能而非物料流，未涵蓋 |
| 執行驗證 | 未涵蓋：Kit 流程仍是草稿（`workflow.aov.json` 的 scope 寫明尚未完成執行驗證） |
| 全部測試 | `npm test` 929 通過、1 略過；typecheck 乾淨；CHANGELOG 檢查一致 |

## 步驟標籤

標籤欄的「動作」是訓練時的正確答案；「無對應動作」是拒答類別的答案。

| # | 步驟 | 名稱 | 標籤 | 依據 | 前置 | 後續 | 覆核 |
|---|---|---|---|---|---|---|---|
| 1 | `get-templates` | 下載範本與需求表 | `get-analysis-templates`（下載分析範本與需求表） | 與動作所需能力完全吻合 | 開始 | upload-files、configure | 通過 |
| 2 | `upload-files` | 上傳資料與設定檔並看驗證報告 | `upload-analysis-files`（上傳分析資料與設定檔） | 與動作所需能力完全吻合 | get-templates | accept-upload | 通過 |
| 3 | `accept-upload` | 接受或丟棄上傳的檔案 | `decide-analysis-upload`（接受或丟棄上傳的檔案） | 與動作所需能力完全吻合 | upload-files | check-data | 通過 |
| 4 | `configure` | 調整分析設定 | `configure-analysis`（調整分析設定） | 與動作所需能力完全吻合 | get-templates | check-ready、check-data | 通過 |
| 5 | `check-ready` | 確認資料與設定就緒 | `check-analysis-ready`（確認分析就緒） | 與動作所需能力完全吻合 | configure | start-run | 通過 |
| 6 | `check-data` | 檢查資料檔與欄位對照 | `check-analysis-data`（檢查分析資料檔與欄位對照） | 與動作所需能力完全吻合 | accept-upload、configure | start-run | 通過 |
| 7 | `start-run` | 啟動分析 | `start-analysis-run`（啟動分析） | 與動作所需能力完全吻合 | check-ready、check-data | read-data、view-run | 通過 |
| 8 | `read-data` | 讀取並整理資料 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | start-run | descriptive | 通過 |
| 9 | `descriptive` | 描述性分析 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | read-data | diagnostic | 通過 |
| 10 | `diagnostic` | 診斷性分析 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | descriptive | ng-code | 通過 |
| 11 | `ng-code` | 不良類型診斷 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | diagnostic | topology | 通過 |
| 12 | `topology` | 製程位置對應 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | ng-code | rag | 通過 |
| 13 | `rag` | SOP 檢索 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | topology | compile | 通過 |
| 14 | `compile` | 彙整事件 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | rag | search-key | 通過 |
| 15 | `search-key` | 擷取搜尋關鍵 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | compile | similarity | 通過 |
| 16 | `similarity` | 相似案例搜尋 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | search-key | llm | 通過 |
| 17 | `llm` | AI 綜合診斷 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | similarity | 結束 | 通過 |
| 18 | `view-run` | 查看執行狀態 | `view-analysis-runs`（查看分析執行狀態） | 與動作所需能力完全吻合 | start-run | view-results | 通過 |
| 19 | `view-results` | 取得分析結果 | `get-analysis-results`（取得分析結果） | 與動作所需能力完全吻合 | view-run | submit-feedback | 通過 |
| 20 | `submit-feedback` | 提交確認結果 | `submit-analysis-feedback`（提交確認結果） | 與動作所需能力完全吻合 | view-results | approve-feedback | 通過 |
| 21 | `approve-feedback` | 核可回饋 | `decide-analysis-feedback`（核可分析回饋） | 與動作所需能力完全吻合 | submit-feedback | publish-library | 通過 |
| 22 | `publish-library` | 發布案例庫新版本，必要時回復舊版本 | `publish-case-library`（發布案例庫版本） | 與動作所需能力完全吻合 | approve-feedback | 結束 | 通過 |

## 連線

| # | 從 | 到 | 依據 | 覆核 |
|---|---|---|---|---|
| 1 | `get-templates` | `upload-files` | scope 文字：先下載範本再上傳 | 通過 |
| 2 | `upload-files` | `accept-upload` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 3 | `accept-upload` | `check-data` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 4 | `get-templates` | `configure` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 5 | `configure` | `check-ready` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 6 | `configure` | `check-data` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 7 | `check-ready` | `start-run` | `runs.py:113-116` 建立執行前檢查就緒，未就緒回 409 | 通過 |
| 8 | `check-data` | `start-run` | `runs.py:117-119` 建立執行時檢查資料，未通過回 409（user 於 2026-11-10 同意補上，CHANGELOG #9） | 通過 |
| 9 | `start-run` | `read-data` | 階段在同一次執行內展開（`runs.py` 的 `STAGES`） | 通過 |
| 10 | `read-data` | `descriptive` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 11 | `descriptive` | `diagnostic` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 12 | `diagnostic` | `ng-code` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 13 | `rag` | `compile` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 14 | `compile` | `search-key` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 15 | `search-key` | `similarity` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 16 | `similarity` | `llm` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 17 | `start-run` | `view-run` | 建立後以執行狀態查看（scope 文字） | 通過 |
| 18 | `view-run` | `view-results` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 19 | `view-results` | `submit-feedback` | scope 文字：分析之後可對客訴診斷事件提交確認結果 | 通過 |
| 20 | `submit-feedback` | `approve-feedback` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 21 | `approve-feedback` | `publish-library` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 22 | `ng-code` | `topology` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |
| 23 | `topology` | `rag` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | 通過 |

## 已知限制（不影響認證，訓練時需注意）

1. 每日模式不產生客訴診斷（`runs.py` 的 `COMPLAIN_ONLY` 階段會被略過），流程連線沒有條件欄位，只在 scope 文字說明；訓練時不要把這些階段的連線當必經路徑。
2. 同時只能有一個分析執行（`runs.py:121-123` 回 409），流程無法表達。
3. 載入示範資料已從流程移除，但功能仍在 Kit 內；`docs/aov-compare/kit.derived.aov.json` 是比較用的衍生檔，仍含 `load-demo`，未修改。
4. 新增的動作沒有宣告參數（D92 精神），所以「畫布待補項 0 項」不代表不需要輸入；實際執行時的必填值尚未建模。
5. 除 `runs.py` 的就緒檢查、資料檢查、單一執行三處外，其餘連線依據來自 scope 文字、D183 與 `docs/aov-compare/comparison.md`，沒有逐條重讀程式。

## 簽核

| 項目 | 內容 |
|---|---|
| Claude 驗證 | 完成，日期 2026-11-10 |
| user 覆核 | 前一版通過（2026-11-10）；本版雜湊待確認 |
| 適用範圍 | 完整流程 |
