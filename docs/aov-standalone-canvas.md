# 獨立 AoV 畫布、Kit 範例庫、節點細項與專案檔（D185 至 D189）

分支 `feature/aov-standalone-canvas`。契約唯一來源是本文件；Codex 遇到不明處或與現有程式衝突就停工，寫進交接紀錄，不自行裁決。

## 1. 目的與範圍

user 要求（2026-11-08）：

1. 各 Kit 的 AoV 可匯出到「範例庫」；範例庫是已驗證流程的 AoV 參考庫，工程師載入後稍改流程或參數，即可直接生成系統。現有內容就是各 Kit 的 `workflow.aov.json`。
2. 節點細項與專案檔下載也要做，並測試下載的檔案能匯入 Composer 的畫布。
3. 可以單獨啟動 AoV 畫布，不必啟動整份 Composer。
4. 順序：獨立畫布，再 Kit 範例庫，最後節點細項與專案檔。

不在範圍：產生 `composer-aov-bundle`（案例庫保存版本所需，仍無程式能產生，另案）；改動各 Kit 的 `workflow.aov.json`；改動 aov-core。

## 2. 名詞

| 名詞 | 意義 | 與誰區別 |
|---|---|---|
| 範例庫 | 隨產品提供的唯讀參考流程，載入畫布後才可修改；內容由各 Kit 的流程定義轉換而來 | 案例庫（D175）是使用者自己保存的版本史，會增長；範例庫不增長，不存使用者資料 |
| 流程規格檔 | `composer-aov-list` 版本 5，畫布的匯入匯出格式 | 專案檔、Kit 流程檔 |
| 專案檔 | aov-core 的 `ProjectFile`（`formatVersion` 1），由 `convertCanvas` 從畫布一個生產邏輯轉出 | 整合包 |
| Kit 流程檔 | `kits/<kit>/workflow.aov.json`，`composer-kit-workflow` 版本 1 | 流程規格檔 |

## 3. 實測事實（2026-11-08，決定做法的依據）

- 13 個 Kit 有流程檔；`station-admin-kit` 無檔，`tenant-auth-kit` 已廢除（D03）。
- 13 份全部 `status: "draft"`，範圍說明皆寫「尚未完成執行驗證」。範例庫因此不得宣稱「已驗證」，只顯示 Kit 自己標的狀態。
- 畫布匯入函式 `importWorkflow` 只收 `composer-aov-list`（版本 5、4 與更舊的清單）；對 13 份 Kit 檔逐一匯入，13 份全部被拒（「流程規格格式不正確」）。
- 動作目錄（`config/actions.json`）共 17 個動作；每個動作以 `requires` 列出所需能力。Kit 節點的 `capabilityIds` 與動作的 `requires` 有交集者共 30 個，全部 Kit 節點 101 個。analytical-four-kit（23）、entry-permission-kit（16）、factory-core-kit（15）、station-data-link-kit（4）為 0 個。
- 13 份中 7 份沒有任何連線（`edges` 為空），其餘連線也稀疏。
- 畫布節點的 `actionId` 可為 `null`（不含功能的業務節點，`GraphNode.actionId` 型別即為 `string | null`）。

## 4. 獨立畫布（D186）

- 第二個入口：`apps/composer-gui/aov-canvas.html` → `src/aovCanvasMain.tsx` → `AovCanvasApp.tsx`。同一個 Vite 專案的多頁，不新增依賴，不另建 package。
- 啟動：`npm run aov-canvas`（`vite --host 127.0.0.1 --port 5175 --open /aov-canvas.html`，`--strictPort`）；另附 `aov-canvas.cmd`（比照 `start.cmd` 的檢查 Node 與依賴，但只開此頁）。
- 內容：`WorkflowCanvas`（含 `ExampleHintProvider`）、「匯入流程規格」、「下載流程規格」、之後批次加入範例庫、節點細項、專案檔下載。
- 不含：Recipe、Kit 選配、站點、輸出頁、案例庫、預覽後端。畫面文字業務語言，遵守 `DESIGN.md`。
- 狀態由 `AovCanvasApp` 持有（`graph`、`path`），初始 `emptyGraph`；流程、表單與節點細項不寫入任何瀏覽器儲存（重新整理即清空）。畫布既有的「顯示填寫提示」偏好是每位使用者的顯示設定，沿用 `ExampleHintProvider` 原有的 localStorage 行為，不改共用元件。
- 下載流程規格：呼叫既有 `exportAovGraph`（未完成的流程以 `role="alert"` 說明原因，不下載）。
- 不得從 `App.tsx`、`OutputPage.tsx`、`RecipeTransfer.tsx` 匯入；測試以靜態檢查（讀原始碼的 import 清單）確保獨立頁不依賴整份 App。

## 5. 匯入入口的格式辨識（D187、D188）

新增 `importAny(text)`（放 `apps/composer-gui/src/importAny.ts`，因為它要呼叫 `importWorkflow` 這個應用層執行碼，D102 不允許 libs 反向依賴；Kit 轉換放 `apps/composer-gui/src/kitExamples.ts`，因為它要用 `workflowGraph` 與 `kitWorkflows` 的執行碼；專案檔轉換視相依另定）：簽章與 `importWorkflow` 相同，回傳 `{ value, notices }`，失敗丟業務語言的 `Error`。依內容辨識：

| 辨識條件 | 轉換 |
|---|---|
| `format: "composer-aov-list"` | 既有 `importWorkflow` |
| `format: "composer-kit-workflow"` | `kitWorkflowToCanvas`（第 6 節） |
| `formatVersion: 1` 且有 `nodes`、`flows` | `projectToCanvas`（第 7 節） |
| 其他 | 拒絕，訊息「無法辨識的檔案格式」，原流程保留 |

`WorkflowTransfer` 與獨立畫布共用 `importAny`；既有行為（版本 4 升級、舊清單轉換、整合性檢查、失敗保留原流程）不變。

## 6. Kit 流程轉畫布與範例庫（D187）

轉換函式 `kitWorkflowToCanvas(workflow, kit)`（放 `apps/composer-gui/src/kitExamples.ts`，動作目錄用 `workflow.ts` 匯出的 `actionCatalog`）的規則（確定性、同輸入同輸出）：

1. 一份 Kit 流程 = 一個工廠 + 一個生產邏輯。工廠與生產邏輯的 id 為 `kit-<kitId>`，名稱為 Kit 顯示名稱。
2. 節點 id 沿用 Kit 節點 id；名稱沿用 Kit 節點名稱。
3. 動作對應：對每個 Kit 節點，找動作目錄中 `requires` 與節點 `capabilityIds` 交集最大的動作（交集為空不算）；交集數相同取目錄順序在前者。找不到則為不含功能的業務節點（`actionId: null`）。
4. 連線沿用 Kit 的 `edges`。起點連到沒有前置的節點，沒有後續的節點連到終點（比照 `upgradeV4` 的做法）。Kit 沒有定義連線者（整份 `edges` 為空），所有節點並列在起點與終點之間，並以提示說明「此功能未定義步驟先後」。
5. 版面座標：依連線深度分層，左到右；同層由上到下，間距取畫布既有常數。
6. 提示（`notices`，業務語言）：Kit 名稱與版本、狀態（草稿或已審閱，沿用 `workflowStatus` 文字，並註明「不代表已通過執行驗證」）、有幾個步驟找不到對應動作並逐一列出、是否缺連線。
7. 轉換結果須通過 `integrityErrors`。範例載入後一定有待補項：對應到「需要表單」的動作或有必填參數的動作，`graphErrors` 會要求補齊表單與參數，這正是「稍改參數後才能生成」的設計，不得為了通過檢查而預填虛構的表單或參數。提示（`notices`）要寫出「尚有 N 項待補」。失敗的 Kit 在範例庫列為「無法載入」並顯示原因，不隱藏。
8. 範例的「下載為流程規格檔」不能用 `exportAovGraph`（它會因待補項而拒絕）。新增 `exportAovGraphDraft(doc)`（放 `workflowGraph.ts`，與 `exportAovGraph` 共用同一個欄位投影函式，只檢查 `integrityErrors`），檔案內容格式不變，匯入端本來就只驗結構與完整性，所以草稿檔可再匯入。按鈕文字為「下載範例流程規格（尚待補齊）」。

範例庫畫面：

- 位置：畫布工具箱旁的折疊區「範例庫」（獨立畫布與整份 Composer 的畫布皆有）。每筆顯示 Kit 名稱、版本、狀態、「N 個步驟中 M 個可對應功能」。
- 動作：「載入到畫布」（會替換目前流程，先以確認區說明，不用 `window.confirm`）；「下載為流程規格檔」（即「匯出」）。
- 資料來源：以 `import.meta.glob` 讀 `kits/*/workflow.aov.json`，載入時轉換；不另存副本（避免與 Kit 檔漂移；analytical-four-kit 的流程在 2026-11-06 剛改過連線）。
- 載入後使用者修改的是畫布上的複本，不寫回 Kit 檔。

## 7. 節點細項、專案檔下載與反向匯入（D188）

- 節點細項：獨立畫布加入既有 `NodeDetailsStep`（物料型別、節點物料流類別、表單庫），狀態由 `AovCanvasApp` 持有，不改 `NodeDetailsStep` 的行為。
- 專案檔下載：在獨立畫布與「發布準備」頁各加「下載專案檔」。選一個生產邏輯、填專案名稱、英文識別碼、版本；呼叫 `convertCanvas`，成功則下載 `<識別碼>.aov-project.json`，失敗則逐條顯示 `ConvertIssue`（業務語言）。不下載半成品。
- 反向匯入 `projectToCanvas(project)`：專案檔轉為畫布流程與節點細項。
  - 節點：名稱沿用；節點類別（領料、入庫、出庫、填單）由 `NodeDef.category`、`boundary`、`form` 反推；物料型別由 `artifactTypes` 還原成節點細項的物料清單。
  - 連線由 `flows` 還原；加起點與終點；版面同第 6 節。
  - 專案檔沒有的資料不可憑空補：`when`、`owner`、`actionId`、`params` 還原為空，並以提示說明「專案檔不含這些設定」。
  - 反推不出類別（資料不足）的節點：整個匯入失敗並指出節點，不猜。
- 往返驗收（核心）：
  - 畫布 → 流程規格檔 → 畫布，內容相同（既有行為，補測）。
  - 畫布 → 專案檔 → 畫布 → 專案檔，兩個專案檔語意相同（節點、連線、物料型別、表單）；不比對 `meta.version` 以外的時間欄位。
  - 每份 Kit 範例轉成畫布後，下載流程規格檔再匯入，相同。
  - 負向：缺欄位、類別不明、連到不存在的節點的專案檔被拒，原流程保留。

## 8. 批次與驗收（D189）

| 批 | 內容 | 負責 |
|---|---|---|
| 一 | 獨立畫布：入口、啟動指令與 cmd、匯入匯出、`importAny` 骨架（先只辨識 `composer-aov-list` 並拒絕其他）、測試 | Codex，Claude 審閱與瀏覽器實測 |
| 二 | Kit 範例庫：`kitWorkflowToCanvas`、範例庫畫面（獨立與整份 Composer）、`importAny` 加 Kit 格式、13 份全部轉換與往返測試 | Codex，Claude 審閱與實測 |
| 三 | 節點細項（獨立畫布）、專案檔下載（獨立與發布準備）、`projectToCanvas`、`importAny` 加專案檔格式、往返與負向測試 | Codex，Claude 審閱與實測 |

每批：Codex 只寫程式與測試，不執行 git、不連網、不裝依賴、不啟動伺服器或瀏覽器；Claude 在沙箱外跑 `npm.cmd run typecheck`、`npm.cmd test`，在 Chrome 實測，再提交。每個測試須在對應規則被拿掉時失敗（規則 9）；關鍵規則（動作對應的交集與平手、起點終點連線、反推類別）以變異檢查驗證。

最終驗收：`npm run aov-canvas` 只開獨立畫布；從範例庫載入任一份 Kit 流程、改一個節點、下載流程規格檔與專案檔，兩者都能匯入整份 Composer 的畫布。

## 9. 已知限制（README 與回報須如實寫出）

- 範例庫內容全是 Kit 標示的草稿，不代表已通過執行驗證；本功能沒有新增驗證。
- 101 個 Kit 步驟中只有 30 個能對應到現有動作；其餘載入後是不含功能的業務節點，生成系統時不產生對應功能。analytical-four-kit、entry-permission-kit、factory-core-kit、station-data-link-kit 目前全部無法對應。
- 7 份 Kit 流程沒有定義連線，載入後為並列。
- 專案檔不含 `when`、`owner`、`actionId`、`params`；經專案檔往返會失去這些設定，流程規格檔不會。
- 一次只轉一個生產邏輯的最上層；子流程不轉。
- 此功能不產生整合包，案例庫仍只能保存匯入的整合包檔。
