# analytical-four-kit 認證審查表

狀態：待 user 人工覆核。認證只代表「建模與訓練可用」，不代表執行可用（D195）。

## 認證對象

| 項目 | 內容 |
|---|---|
| 檔案 | `kits/analytical-four-kit/workflow.aov.json` |
| SHA-256 | `20405c6f1160e89858d83d87b317db45ebc719895f5bd1b6ada7ab03f9702142` |
| 來源 commit | 本分支 `2000630` 之上的工作樹（流程於 `2000630` 修改，CHANGELOG 第 8 筆） |
| Kit 版本 | 0.1.0 |
| 狀態欄 | draft（認證通過前不改成 reviewed，由 user 決定） |
| 動作目錄 | `config/actions.json`，30 個動作（D199） |
| 工具 | `parseKitWorkflow`、`kitWorkflowToCanvas`、`integrityErrors`、`graphErrors`、`exportAovGraphDraft`／`importWorkflow`（均為 main 上的程式） |

任何對上列檔案的修改，都使本認證失效，需要重新審查。

## Claude 驗證結果

| 檢查 | 結果 |
|---|---|
| 流程規格與登錄一致（schema、子功能、能力皆已登錄、無循環） | 通過 |
| 轉成畫布（`kitWorkflowToCanvas`） | 通過，23 步、22 條連線，另加開始與結束連線 |
| 畫布完整性（`integrityErrors`） | 0 項 |
| 畫布待補項（`graphErrors`） | 0 項 |
| 下載再匯入（`exportAovGraphDraft`、`importWorkflow`）節點與動作標籤 | 相同 |
| 動作對應 | 13 步對應 13 個不同動作，10 步無對應（階段） |
| 能力涵蓋 | 24 個登錄能力，每個恰好被一個動作涵蓋（`analyticalFourActions.test.ts`） |
| 專案檔轉換（`convertCanvas`） | 不適用：它需要逐節點的物料設定（ProjectDetails），Kit 流程描述的是軟體功能而非物料流，未涵蓋 |
| 執行驗證 | 未涵蓋：Kit 流程仍是草稿（`workflow.aov.json` 的 scope 寫明尚未完成執行驗證） |

## 步驟標籤（請逐項覆核）

標籤欄的「動作」是訓練時的正確答案；「無對應動作」是拒答類別的答案。

| # | 步驟 | 名稱 | 標籤 | 依據 | 前置 | 後續 | 覆核 |
|---|---|---|---|---|---|---|---|
| 1 | `load-demo` | 載入示範資料 | `load-analysis-demo`（載入分析示範資料） | 與動作所需能力完全吻合 | 開始 | 結束 | [ ] |
| 2 | `get-templates` | 下載範本與需求表 | `get-analysis-templates`（下載分析範本與需求表） | 與動作所需能力完全吻合 | 開始 | upload-files、configure | [ ] |
| 3 | `upload-files` | 上傳資料與設定檔並看驗證報告 | `upload-analysis-files`（上傳分析資料與設定檔） | 與動作所需能力完全吻合 | get-templates | accept-upload | [ ] |
| 4 | `accept-upload` | 接受或丟棄上傳的檔案 | `decide-analysis-upload`（接受或丟棄上傳的檔案） | 與動作所需能力完全吻合 | upload-files | check-data | [ ] |
| 5 | `configure` | 調整分析設定 | `configure-analysis`（調整分析設定） | 與動作所需能力完全吻合 | get-templates | check-ready、check-data | [ ] |
| 6 | `check-ready` | 確認資料與設定就緒 | `check-analysis-ready`（確認分析就緒） | 與動作所需能力完全吻合 | configure | start-run | [ ] |
| 7 | `check-data` | 檢查資料檔與欄位對照 | `check-analysis-data`（檢查分析資料檔與欄位對照） | 與動作所需能力完全吻合 | accept-upload、configure | 結束 | [ ] |
| 8 | `start-run` | 啟動分析 | `start-analysis-run`（啟動分析） | 與動作所需能力完全吻合 | check-ready | read-data、view-run | [ ] |
| 9 | `read-data` | 讀取並整理資料 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | start-run | descriptive | [ ] |
| 10 | `descriptive` | 描述性分析 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | read-data | diagnostic | [ ] |
| 11 | `diagnostic` | 診斷性分析 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | descriptive | ng-code | [ ] |
| 12 | `ng-code` | 不良類型診斷 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | diagnostic | topology | [ ] |
| 13 | `topology` | 製程位置對應 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | ng-code | rag | [ ] |
| 14 | `rag` | SOP 檢索 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | topology | compile | [ ] |
| 15 | `compile` | 彙整事件 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | rag | search-key | [ ] |
| 16 | `search-key` | 擷取搜尋關鍵 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | compile | similarity | [ ] |
| 17 | `similarity` | 相似案例搜尋 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | search-key | llm | [ ] |
| 18 | `llm` | AI 綜合診斷 | 無對應動作（階段業務節點） | 同一次背景執行內的階段，不是獨立操作（D199） | similarity | 結束 | [ ] |
| 19 | `view-run` | 查看執行狀態 | `view-analysis-runs`（查看分析執行狀態） | 與動作所需能力完全吻合 | start-run | view-results | [ ] |
| 20 | `view-results` | 取得分析結果 | `get-analysis-results`（取得分析結果） | 與動作所需能力完全吻合 | view-run | submit-feedback | [ ] |
| 21 | `submit-feedback` | 提交確認結果 | `submit-analysis-feedback`（提交確認結果） | 與動作所需能力完全吻合 | view-results | approve-feedback | [ ] |
| 22 | `approve-feedback` | 核可回饋 | `decide-analysis-feedback`（核可分析回饋） | 與動作所需能力完全吻合 | submit-feedback | publish-library | [ ] |
| 23 | `publish-library` | 發布案例庫新版本，必要時回復舊版本 | `publish-case-library`（發布案例庫版本） | 與動作所需能力完全吻合 | approve-feedback | 結束 | [ ] |

## 連線（請逐項覆核）

| # | 從 | 到 | 依據 | 覆核 |
|---|---|---|---|---|
| 1 | `get-templates` | `upload-files` | scope 文字：先下載範本再上傳 | [ ] |
| 2 | `upload-files` | `accept-upload` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 3 | `accept-upload` | `check-data` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 4 | `get-templates` | `configure` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 5 | `configure` | `check-ready` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 6 | `configure` | `check-data` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 7 | `check-ready` | `start-run` | `runs.py:113-116` 建立執行前檢查就緒，未就緒回 409 | [ ] |
| 8 | `start-run` | `read-data` | 階段在同一次執行內展開（`runs.py` 的 `STAGES`） | [ ] |
| 9 | `read-data` | `descriptive` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 10 | `descriptive` | `diagnostic` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 11 | `diagnostic` | `ng-code` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 12 | `rag` | `compile` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 13 | `compile` | `search-key` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 14 | `search-key` | `similarity` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 15 | `similarity` | `llm` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 16 | `start-run` | `view-run` | 建立後以執行狀態查看（scope 文字） | [ ] |
| 17 | `view-run` | `view-results` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 18 | `view-results` | `submit-feedback` | scope 文字：分析之後可對客訴診斷事件提交確認結果 | [ ] |
| 19 | `submit-feedback` | `approve-feedback` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 20 | `approve-feedback` | `publish-library` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 21 | `ng-code` | `topology` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |
| 22 | `topology` | `rag` | scope 文字與 D183 對齊 `runs.py` 的階段順序 | [ ] |

## Claude 的發現（需要你判斷）

1. **`check-data` 沒有接到 `start-run`。** `runs.py:117-119` 建立執行時也會做資料檢查（`inspect`），未通過回 409，所以啟動分析同時需要「就緒」與「資料檢查通過」兩者。目前流程只有 `check-ready` 到 `start-run`，`check-data` 是葉節點。建議補一條 `check-data` 到 `start-run` 的連線，並在 CHANGELOG 記錄（dependency）。這會改變流程描述，所以我沒有擅自改，等你決定。
2. **模式差異未表達。** 每日模式不產生客訴診斷（`runs.py` 的 `COMPLAIN_ONLY` 階段會被略過），流程連線沒有條件欄位，只在 scope 文字說明。這是流程規格的限制，不是這份資料的錯誤；訓練時不要把這些階段的連線當成必經路徑。
3. **同時只能有一個分析執行**（`runs.py:121-123` 回 409）。流程描述無法表達，列為已知限制。
4. **`load-demo` 沒有連線**，畫布上由開始直接到結束之間獨立存在，與 scope 文字「載入示範資料不是前置條件」一致。
5. **我只重新核對了上述 3 處程式依據**（就緒檢查、資料檢查、單一執行）。其餘連線的依據來自 scope 文字與 D183 對 `runs.py` 階段順序的對齊，以及 `docs/aov-compare/comparison.md`，我這次沒有逐條回頭讀程式。

## 簽核

| 項目 | 內容 |
|---|---|
| Claude 驗證 | 完成（見上表），日期 2026-11-10 |
| user 覆核 | 待填：覆核人、日期、是否通過、適用範圍（完整流程／僅局部節點） |
| 發現 1 的處理 | 待 user 決定：補連線並重新認證，或維持現狀並記錄為已接受 |
