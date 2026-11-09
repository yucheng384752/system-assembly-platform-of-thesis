# AoV 小模型設計

狀態：設計階段，尚無程式與依賴。決議 D194 至 D198。討論紀錄見 `.codex-claude-mailbox/threads/20261109-aov-small-model.md`。

## 目標

把有缺漏或錯誤的 AoV 流程修正到能在 Composer 跑（轉成專案檔並通過驗證），並提示錯誤。論文比較對象是 analytical-four 的原專案 AoV 與改良後 AoV：差在哪、是否更快完成設定與部署。

## 任務

1. 動作／型別建議：由節點名稱、描述與上下文，提出候選動作（`actionId`）與 port 型別。`actionId`、`NodeCategory`、port 的 artifact type 是三種不同分類，分開預測。
2. 合理性提示：規則版（`libs/aov-core/validate/validator.ts`）負責硬性違規；模型只補語意候選與語意警示（型別形式相容但用途不符，屬待人工標註驗證的假設）。

## 認證資料

- 單位：完整流程、局部節點、子流程皆可（D195）。
- 條件：Claude 驗證加 user 人工覆核，兩者都過。Claude 驗證含：能轉成專案檔、完整 validator 零 error、往返通過、warning 逐項處置或記錄接受理由。
- 紀錄：來源 commit、檔案雜湊、審查者、適用範圍；修改後重新認證。
- 認證結果只代表「建模與訓練可用」，不代表執行可用。
- 順序：先補現有 Kit 流程並認證，仍不足才用變異資料。變異資料必須標明來源與操作，不算認證流程。

## 拒答策略（user 已確認，D196）

接受拒答，理由：修正的目標是能跑 Composer，一個通過驗證但語意錯誤的自動修正，比要求人工定義更糟。

- 模型輸出候選、分數與是否拒答；低於門檻或目錄沒有適當動作時輸出「需人工定義」。
- 門檻由驗證集決定（目標精確率），並同時報告覆蓋率與精確率曲線。
- 任何採納的修正必須再通過 validator 與專案檔轉換，否則丟棄。
- 拒答不算錯誤，但覆蓋率是論文指標。D185 顯示 analytical-four 當時 23 個節點都無對應動作，這是目錄覆蓋不足，必須與模型能力分開報告。

## 模型

- 基線：字元／詞彙特徵加線性分類；結構特徵加梯度提升。D187 的能力交集法保留為規則基線。
- 主線：小型 encoder（Google 多語 BERT 類），先凍結訓練分類頭，再視驗證結果微調。
- 不做：生成式模型加 LoRA、GNN（資料不足），除非基線結果支持。
- 非中國來源只看開發機構（D197）；固定模型 revision。

## 評估

- 三組：規則組、模型組、規則加模型組，輸入、候選目錄與人工答案相同。
- 指標：macro-F1、top-k 命中率、各類支持量、診斷 precision／recall、拒答覆蓋率、人工採納率、修正時間、延遲。結構變異集與人工語意測試集分開報分。
- 切分：依 Kit／來源血緣，同 Kit 的版本、改名、變異留在同一組；盡量做 leave-one-Kit-out。
- 可重現：固定切分、套件版本、驅動版本、超參數，報告多個 seed。固定 seed 不保證跨環境逐位元一致。
- 論文：凍結最新版本，比較原專案 AoV 與改良 AoV 的差異與設定部署時間（D198）。原始版與 Kit 版同時改了流程順序與錯誤處理，不可把改善全歸於 AoV。

## 與 D190

D190 研究 CHANGELOG 修改序列，本案研究目前快照；不互相餵資料，不把修改原因當本案標籤。

## 目錄與整合（提案）

- `tools/aov-small-model/`：匯出、訓練、評估、環境鎖定；資料與權重放排除版本控制的位置。
- 資料 UTF-8 JSONL，含來源血緣、雜湊、認證編號、標註者。
- 推論先用只綁本機位址的 Python 服務，TypeScript 驗格式與候選白名單，模型失敗時規則版照常。ONNX 待 encoder 穩定後再評估。
- 依賴（torch、transformers、scikit-learn、模型權重）user 已核准（D197）；PEFT、FastAPI、onnxruntime-node 不在核准範圍內，需要時再問。

## 阻塞

Kit 流程轉畫布與專案檔轉換（D185 至 D189）在 `feature/aov-standalone-canvas`，尚未合併；補 Kit 流程與認證依賴它。

## 盤點（2026-11-09，唯讀，不改 Kit）

方法：以 main 的 `parseKitWorkflow` 讀 13 份 `kits/*/workflow.aov.json`，按 D187 的能力交集規則對應 `config/actions.json` 的 17 個動作。結果與 D185 一致。

| Kit | 狀態 | 步驟 | 連線 | 可對應 | 未對應 | registry 能力不在任何動作 |
|---|---|---|---|---|---|---|
| analytical-four-kit | draft | 23 | 22 | 0 | 23 | 24 |
| analytics-kit | draft | 3 | 0 | 3 | 0 | 0 |
| audit-edit-kit | draft | 7 | 0 | 5 | 2 | 2 |
| entry-permission-kit | draft | 16 | 2 | 0 | 16 | 16 |
| factory-core-kit | draft | 15 | 7 | 0 | 15 | 15 |
| generic-forms-kit | draft | 9 | 3 | 7 | 2 | 2 |
| import-pipeline-kit | draft | 6 | 2 | 4 | 2 | 3 |
| logs-ops-kit | draft | 1 | 0 | 1 | 0 | 0 |
| mod-subscription-kit | draft | 4 | 0 | 3 | 1 | 3 |
| platform-core-kit | draft | 9 | 0 | 3 | 6 | 7 |
| query-traceability-kit | draft | 2 | 0 | 2 | 0 | 1 |
| station-data-link-kit | draft | 4 | 0 | 0 | 4 | 4 |
| upload-validation-kit | draft | 2 | 1 | 2 | 0 | 2 |
| 合計 | | 101 | 37 | 30 | 71 | |

發現：
- 未對應的 71 步，主因是動作目錄只有 17 個動作、覆蓋範圍小，不是流程寫錯。四個 Kit（analytical-four、entry-permission、factory-core、station-data-link）共 58 步完全沒有對應動作。
- 13 份全是 draft，連線很少（13 份中 7 份沒有連線、4 份只有 1 至 3 條，只有 analytical-four 與 factory-core 較完整），模型要學連線合理性幾乎沒有素材。
- 要讓這些步驟「能在 Composer 跑」，有兩條路：新增動作到 `config/actions.json`（屬產品範圍，需 user 決定），或接受它們為無對應動作的業務節點（這正好是拒答類別的素材，但不等於能跑）。
