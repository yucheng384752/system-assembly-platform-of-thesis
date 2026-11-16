---
id: "20261112-canvas-layer-views"
title: "畫布的業務層與系統層檢視：展開、疊層、進入子流程（三批）"
status: "in_progress"
owner: "claude"
reviewer: "claude"
priority: "normal"
created_by: "claude"
created_at: "2026-11-12"
updated_at: "2026-11-12"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "codex / claude"
  requirements: "user"
artifacts:
  - path: "docs/canvas-layer-views.md"
    type: "file"
---

# Goal

依 `docs/canvas-layer-views.md` 做畫布的三種檢視：單層（進入子流程後顯示上一層的前後節點）、展開、疊層，展開與疊層中可編輯；之後加資料流虛線與缺口標示。分支 `feature/canvas-layer-views`，工作目錄 `C:\Users\gslab\Desktop\composer-refactor-layers-wt`（基底 main 0f5a742）。

# 批次

| 批 | 內容 | 負責 | 預計完成 |
|---|---|---|---|
| 一 | 檢視模型純函式與測試；單層檢視的「上一層」列 | Codex | 2026-11-12 派工後 60 分鐘 |
| 二 | 畫布接上展開與疊層、其中的編輯、「待開發」標記 | Codex | 批一審閱後 |
| 三 | 資料流連線與缺口標示 | Codex | user 確認契約第 4、5 節後 |

到期未完成由 Claude 接手（先確認 Codex 已停止再改檔）。

# 批一 Handoff（Codex）

**預計完成時間：派工後 60 分鐘。** cwd 必須是工作目錄根 `C:\Users\gslab\Desktop\composer-refactor-layers-wt`。Codex 只寫程式與測試，不執行 git、不連網、不裝依賴、不啟動伺服器或瀏覽器。契約唯一來源是 `docs/canvas-layer-views.md` 第 3.1、3.2、3.3 節與 `DESIGN.md`。第 4、5 節（資料流、缺口）本批不做。

可動的檔案：
- 新增 `apps/composer-gui/src/canvasView.ts` 與 `canvasView.test.ts`。
- 修改 `apps/composer-gui/src/WorkflowCanvas.tsx`（只加「上一層」列）、`WorkflowCanvas.test.tsx`（只新增案例）、`style.css`（只新增「上一層」列的樣式，沿用既有變數）。
- 不得動：`workflowGraph.ts` 的型別與既有函式、`canvasEditing.ts`、`libs/`、`schemas/`、`config/`、`kits/`、`services/`、`package.json`、`docs/`。

工作：
1. `canvasView.ts`（純函式，不 import React 與 `@xyflow/react`）：
   - `parentContext(doc, graphId)`：回傳 `{ parentGraphId, node, before: GraphNode[], after: GraphNode[] } | undefined`。`node` 是上一層圖中 `childGraphId === graphId` 的節點；`before`、`after` 是它在上一層圖中依連線的直接前置與直接後續節點（依上一層圖 `nodes` 的順序、不重複）。最上層的圖回傳 `undefined`。
   - `expandedView(doc, graphId)`：契約 3.2。回傳 `{ nodes: ViewNode[]; frames: ViewFrame[]; edges: ViewEdge[] }`。`ViewNode` 含 `id`、`graphId`（所屬圖）、`node`（原 `GraphNode`）、`position`（顯示用絕對座標）、`offset`（顯示座標減 `layout` 座標，供反向換算）。`ViewFrame` 含 `graphId`、`ownerNodeId`、`title`、`position`、`width`、`height`、`depth`。`ViewEdge` 含 `id`、`graphId`、`from`、`to`。有子流程的節點不出現在 `nodes`，改由 `frames` 表示（遞迴到底）。外框右側與下方的同層節點要平移到不重疊。缺少 `layout` 位置的節點沿用畫布現行預設（第 i 個節點 `{ x: i * 180, y: 0 }`）。
   - `layeredView(doc, graphId)`：契約 3.3。同樣的回傳形狀，另加 `bands: { depth: number; y: number; height: number }[]` 與 `links: { fromNodeId: string; toGraphId: string }[]`（上層節點到其子流程外框的對應線）。最上方列帶是 `graphId` 這張圖，節點保留 `layout` 的橫向位置；下方每層一列帶，子流程外框橫向對齊其上層節點，同列帶的外框不可重疊。
   - `toLayoutPosition(viewNode, displayPosition)`：把拖曳後的顯示座標換回該節點所屬圖的 `layout` 座標（減去 `offset`）。
   - 文件有壞掉的引用（`childGraphId` 指向不存在的圖、引用成環）時不得無窮迴圈或丟例外：略過該子流程，並在回傳值的 `issues: string[]` 以業務語言說明。
2. 「上一層」列：`WorkflowCanvas` 在目前的圖不是最上層時，於 `canvas-toolbar` 之後、`columns` 之前顯示一個 `nav`（`aria-label="上一層的前後節點"`）：文字「前置」加各前置節點名稱按鈕、目前節點名稱（`aria-current="true"`，不是按鈕）、文字「後續」加各後續節點名稱按鈕；沒有時顯示「（無）」。按下名稱按鈕：`setPath(path.slice(0, -1))` 並選取該節點。未命名節點顯示既有的「（未命名節點）」。
3. 測試：
   - `canvasView.test.ts`：三層文件的展開與疊層都沒有任兩個節點或外框重疊（寫一個檢查矩形相交的輔助函式）；`toLayoutPosition(n, n.position)` 等於原 `layout` 位置（往返）；每個 `ViewNode.graphId` 等於它在文件中所屬的圖；沒有子流程的圖，展開結果的節點位置等於 `layout`；壞掉的引用回報 `issues` 且不丟例外；`parentContext` 的前置、後續與最上層回傳 `undefined`。
   - `WorkflowCanvas.test.tsx`：進入子流程後出現「上一層的前後節點」並列出正確名稱；按前置節點名稱回到上一層且該節點被選取；最上層沒有這一列。
4. 不得用 `any`；不得用 `dangerouslySetInnerHTML` 或 `innerHTML`；不寫入任何瀏覽器儲存；文字一律業務語言，不出現程式或框架名稱。

停止條件：需要新增依賴；需要修改範圍外的檔案；契約與 `DESIGN.md` 或既有測試互相矛盾。遇到時停止並在 Notes 寫明，不自行取捨。

驗收（Codex 須在 Notes 如實列出）：`npm.cmd run typecheck`、`npm.cmd test` 的結果與數字；跳過或失敗的項目與原因（沙箱 EPERM 照實寫）；沒做的項目。

# Codex Notes

## 批一實作與驗證（2026-11-12）

批一程式與測試已實作，待 Claude 審閱；整套驗證尚未全數通過。未觸發 Handoff 停止條件：無新增依賴、無需修改範圍外的程式，未發現契約與 DESIGN.md 或既有測試的行為衝突。下列既有驗證失敗是權限／打包存取錯誤，不修改其測試或設定以繞過。

### 變更檔案

- 新增 `apps/composer-gui/src/canvasView.ts`：`parentContext`、`expandedView`、`layeredView`、`toLayoutPosition` 與檢視型別；保留節點所屬圖、原節點與反向座標偏移；純型別引用既有資料模型，沒有 React 或畫布套件依賴，也不寫回文件。
- 新增 `apps/composer-gui/src/canvasView.test.ts`：12 個案例，涵蓋三層版面、外框包含與非父子矩形不相交、往返及拖曳換算、圖歸屬、前後節點順序與去重、無子流程時保留位置、缺位置預設、空子流程、錯誤／循環引用、外框尺寸不受座標原點距離影響。
- 修改 `apps/composer-gui/src/WorkflowCanvas.tsx`：僅加入上一層列及所需引用／衍生值；前後名稱按鈕返回上一層並選取節點，目前所在用非按鈕文字與 `aria-current="true"` 標示。
- 修改 `apps/composer-gui/src/WorkflowCanvas.test.tsx`：只新增 2 個案例；驗證列的位置、名稱、前後按鈕返回與選取、不改文件、根圖不顯示、空前後節點與未命名文字。此檔共 16 個案例。
- 修改 `apps/composer-gui/src/style.css`：只新增上一層列的 2 條規則，使用既有色彩、間距、圓角變數與全域按鈕／焦點樣式。
- 依 user 明確要求更新本節；thread 的其他內容與 frontmatter、mailbox index 均未修改。

### 版面與後續串接說明

- 節點尺寸沿用 64px；外框左右／底部保留 32px，上方保留 64px 供標題。外框依內容實際範圍計算，包含負座標；空子圖仍保留外框。
- 展開時，以外框取代擁有子流程的節點；其前後連線仍保留原始端點識別，後續渲染可用 `ViewFrame.ownerNodeId` 對應外框。節點與框座標都是絕對顯示座標。
- 疊層的 depth 從目前圖的 1 起算；最上列保留橫向位置，橫向相交的節點在同列帶內分行。子流程框先對齊上層節點，遇同列框碰撞時向右讓開，並保留 links 對應。
- 重疊測試把「框完整包含其子節點／子框」視為必要包含關係；其他矩形必須不相交。展開的巢狀框與疊層的分帶框分別檢查。
- 不存在、循環或重複子圖引用會略過該次子流程、留下業務文字 issues；展開時該擁有節點仍可見。

### 實際驗證結果

所有指令 cwd 均為 `C:\Users\gslab\Desktop\composer-refactor-layers-wt`。

- `npm.cmd run typecheck`：共執行 3 輪，均完成兩個 TypeScript 設定的檢查，0 個診斷錯誤；最後一輪在下述最終測試前完成。
- `npm.cmd test`：共執行 3 輪，均因 Vitest 階段失敗而回傳 exit code 1。
  - 第 1 輪：76 檔中 73 通過、3 失敗；999 案例中 992 通過、2 失敗、5 跳過。新增 parentContext 案例先加了前置連線卻仍預期空陣列，已將空陣列檢查移至加線之前；沒有修改既有案例。
  - 第 2 輪：76 檔中 74 通過、2 失敗；999 案例中 993 通過、1 失敗、5 跳過。
  - 最終第 3 輪（17:19:46 開始，15.31 秒）：76 檔中 74 通過、2 失敗；1001 案例中 **995 通過、1 失敗、5 跳過**。此輪包含修正外框範圍後新增的 2 個案例。
- 批一相關的 `canvasView.test.ts` 12 案例與 `WorkflowCanvas.test.tsx` 16 案例均通過，共 28；其中本批新增 14 案例。

失敗及跳過原因：

1. `security.test.mjs` 的 CLI 簽章案例失敗：讀取暫存目錄中的 `keys/signing-private-key.pem` 回報 `EPERM: operation not permitted, open`；afterAll 清理該暫存目錄也回報 `EPERM, Permission denied`。未讀取或輸出私鑰內容，未嘗試繞過沙箱或另行清理。暫存清理未成功，不能宣稱已移除測試產物。
2. `evaluator.test.ts` 的「打包後的程序」suite 在準備階段失敗：esbuild 回報 `Cannot read directory "../..": Access is denied.` 及 `Could not resolve "./services/evaluator/src/main.ts"`，因此其 4 個案例未執行（兩次打包一致性、標準輸入輸出、過大請求、輸入關閉）。未修改範圍外的建置或測試檔。
3. 另 1 個跳過案例是既有 `App.test.tsx` 的身分授權檢查，原本以 `test.skip` 標示尚無身分機制；本批未改動。
4. 因 npm test 以 `&&` 串接，Vitest 非零退出後，`services/preview/tests/preview.test.mjs`、`libs/case-store`、`services/case-store`、`tools/thesis-s4/tests/thesis-s4.test.mjs` 四段均未執行；未把它們列為通過，也未另行啟動服務補跑。

### 未做與限制

- 未做批二的展開／疊層切換、畫布渲染與編輯串接、「公司需要，待開發」狀態文字；本批僅提供它們的純函式模型。
- 未做契約第 4、5 節資料流連線與缺口標示。
- 未執行 git、未連網、未安裝依賴、未啟動伺服器或瀏覽器；未做瀏覽器實際版面、縮放與操作驗證。
- 未手動寫入主資料夾 `C:\Users\gslab\Desktop\composer-refactor`；既有依賴由 junction 讀取。未變更 workflowGraph、canvasEditing、設定、schema、Kit 或其他文件。
- 最終風險：本批案例通過，但完整驗證仍受以上既有權限／打包失敗阻擋，且實際瀏覽器驗證與 Claude 審閱尚未完成。

## 2026-11-12 Claude：批一審閱

- 讀過 `canvasView.ts` 與畫布的差異；在沙箱外重跑：typecheck 通過；`npm.cmd test` 根目錄 76 檔 1000 通過、1 略過（既有），其餘各段通過。Codex 回報的 1 項失敗是沙箱 EPERM，沙箱外不存在。
- 未驗證：瀏覽器實際操作（批二完成後一起做）。批一已提交。

# 批二 Handoff（Codex）

**預計完成時間：派工後 90 分鐘。** cwd、禁止事項與批一相同。契約是 `docs/canvas-layer-views.md` 第 3 節全部（3.1 已完成）；第 4、5 節不做。

可動的檔案：`apps/composer-gui/src/WorkflowCanvas.tsx`、`WorkflowCanvas.test.tsx`、`canvasView.ts`、`canvasView.test.ts`、`style.css`、`DESIGN.md`（只在檔尾新增一節「2026-11-12 補充：畫布檢視（D208）」）；可新增 `apps/composer-gui/src/CanvasViewSwitch.tsx` 之類的小元件與其測試。`canvasEditing.ts` 只可新增函式，不改既有函式的行為。不得動 `workflowGraph.ts` 的型別、`libs/`、`schemas/`、`config/`、`kits/`、`services/`、`package.json`、`docs/`。

工作：
1. 檢視切換：`canvas-toolbar` 內新增 `role="radiogroup"`（`aria-label="檢視"`）三個選項「單層」「展開」「疊層」，預設「單層」。狀態放在 `Canvas` 元件內（`useState`），`resetKey` 改變或切換到另一張圖（`graph.id` 改變）時回到「單層」。不寫入文件與瀏覽器儲存。
2. 「展開」用 `expandedView`、「疊層」用 `layeredView` 產生 React Flow 的節點與連線：
   - 外框是一種新的節點型別（不可連線、不可選取成流程節點），顯示標題；樣式沿用既有變數，邊框 1px、`--card-border`，不用陰影與漸層。疊層另畫列帶背景與上層節點到外框的對應線（細實線、無箭頭、不可選取）。
   - 連線仍是單段直線加箭頭，樣式與單層相同。
   - `issues` 不為空時以既有的訊息區樣式用 `role="status"` 逐項列出。
3. 編輯（契約 3.4）：每個畫出的節點帶所屬 `graphId`。
   - 選取：`selected` 之外要知道所屬圖；節點細項、前置核取清單、建立或進入子流程、刪除，全部以該節點所屬的圖為準（目前程式碼用 `graph` 的地方要改成「選取節點所屬的圖」，沒有選取時是目前這張圖）。
   - 拖曳：用 `toLayoutPosition` 換回並寫入該節點所屬圖的 `layout`。外框本身不可拖曳。
   - 連線與重新連線：兩端屬於同一張圖才提交到該圖；否則不提交並把錯誤訊息設為「連線只能在同一個流程內。」。
   - 工具箱加入：加入到選取節點所屬的圖，沒有選取時加入到目前這張圖；拖放到外框範圍內時加入到該外框的圖，位置用 `toLayoutPosition` 的同一套換算（為此可在 `canvasView.ts` 新增「由顯示座標找出所在外框與其原點」的純函式並加測試）。
   - 節點上限檢查用所屬圖的節點數。
   - 「選取節點」清單在展開與疊層時依圖分組（每組標題是圖的名稱）。
4. 疊層檢視開啟時在檢視切換旁顯示 `role="status"` 的固定文字：「系統邏輯疊層：公司需要，待開發。僅供檢視與編輯流程，不影響計畫與工單。」
5. 單層檢視的行為與既有測試完全不變；既有測試不得修改預期，只能新增案例。
6. 測試（`WorkflowCanvas.test.tsx`，沿用 `src/testCanvas.ts`）：切到展開後子流程的節點出現在畫布且外框標題正確；在展開中選取子流程節點改名後，改到的是子圖的節點（檢查 `onChange` 收到的文件）；跨圖連線被拒絕且出現 `role="alert"` 訊息、文件不變；在展開中刪除子圖節點只影響子圖；切到疊層出現「待開發」文字；換圖後回到單層；單層既有案例全數通過。
7. `DESIGN.md` 新增一節，描述檢視切換、外框、列帶、對應線、「待開發」文字與鍵盤替代，寫法比照既有補充章節。

停止條件：同批一；另外，若 React Flow 12.12.0 在不新增依賴的情況下做不到某項行為，停止並寫明做不到的是哪一項、試過什麼。

驗收：同批一。

## 2026-11-12 Claude：批二接手收尾與驗證

- Codex 在批二最後一步（寫 Notes）前用量額度用完（`usage limit`），程式與測試已寫完，Notes 沒寫。確認 Codex 已停止後由 Claude 收尾，沒有改 Codex 的程式。
- Codex 改動：`WorkflowCanvas.tsx`、`WorkflowCanvas.test.tsx`、`canvasView.ts`、`canvasView.test.ts`、`style.css`、`DESIGN.md`；新增 `CanvasViewElements.tsx` 與測試。未動範圍外檔案。
- 沙箱外重跑：typecheck 通過；`npm.cmd test` 根目錄 77 檔 1019 通過、1 略過（既有），其餘各段通過。
- 瀏覽器（Chrome，`npm.cmd run dev -- --port 5183`，載入內建範例後在「配料」建立子流程並加兩個節點）：
  - 獨立 AoV 畫布：進入子流程後「上一層」列顯示前置「領料」、目前「配料」、後續「混合」；「展開」顯示外框與子流程節點；展開中選取子流程節點可改名；子流程節點連到上層節點被拒絕並顯示「連線只能在同一個流程內。」，連線數不變；同一子流程內連線成功；「疊層」顯示兩列帶、對應線與「待開發」文字；疊層中拖曳子流程節點後切回單層再切疊層，位置保留；工具箱「選取節點」依圖分組；主控台無錯誤。
  - Composer 流程畫布（步驟 01）：有檢視切換，切到疊層出現「待開發」文字。只確認到這裡，沒有重做上述每一項。
- 觀察到、尚未處理的外觀問題：（1）展開時進出外框的流程連線接在外框角落附近而不是左右邊中點；（2）疊層的對應線從上層節點右側接點出發，不是從節點下方；（3）檢視切換的單選圓點偏大、標籤在圓點下方。
- 未驗證：三層（孫流程）在瀏覽器的顯示；拖放工具到外框內；展開中刪除節點與建立子流程；鍵盤操作；獨立 AoV 畫布以外的頁面是否受樣式影響。

## 2026-11-16 Claude：批三交辦（Codex）

user 於 2026-11-16 確認：流程文件升第 6 版、缺口以表單為單位。設計見 `docs/canvas-layer-views.md` 第 4、5 節（已依 Codex 2026-11-15 的審閱改寫，含必須處理的讀取點清單 4.1 至 4.3）。預計 2026-11-16 內、交辦後 90 分鐘完成；逾時由 Claude 確認 Codex 已停止後接手。

範圍：
1. 資料模型先行：`workflowGraph.ts` 的 `GraphEdge`、`AovGraphDocument` 版本 6、`emptyGraph`、匯入（第 5 版無損載入、第 1 至 4 版路徑接到第 6 版）、匯出投影、`integrityErrors` 的新規則；`schemas/aov.schema.json` 加第 6 版並保留舊版定義。全專案搜尋寫死版本 5 的地方（測試、`kitExamples.ts`、`localData`、`libs/aov-integration`、`libs/case-store`、範例 JSON）逐一判斷該改成 6 還是保留為舊版輸入的測試資料，結果列在 Notes。
2. 集中的先後連線判定函式，並依 4.1 逐項套用；4.3 列的檔案不要改。
3. 顯示：資料流虛線（`canvasView.ts`、`CanvasViewElements.tsx`、`WorkflowCanvas.tsx`、`style.css`）。
4. 建立與編輯：4.4 的核取清單與種類切換；`canvasEditing.ts` 依種類精確建立與移除。
5. 缺口提示（第 5 節）：純函式放 `canvasView.ts` 或新檔，外框標題旁的警示與可展開清單。
6. 批二的三個外觀問題：進出外框的流程連線改接外框左右邊中點；疊層對應線從上層節點下方出發；檢視切換的樣式與工具列其他控制項一致（依 DESIGN.md，操作區至少 44px）。
7. `DESIGN.md` 補上虛線、缺口提示、連線種類切換的規範（接在「2026-11-12 補充：畫布檢視（D208）」之後）。

規則：
- 每個 4.1 的項目都要有會因為漏改而失敗的測試（測試要說明為什麼資料流不算先後順序）。
- 不用 `any`、不用 `innerHTML`；使用者文字一律純文字；錯誤訊息走既有的 `role="alert"` 區。
- 不改 `kits/`、`services/`、`docs/decision-log.md`；不做 git 寫入；不新增依賴。
- 第 6 版會影響別的分支（論文復現分支有第 5 版的案例檔），本分支不處理那些檔案，但第 5 版載入必須無損，並有測試。
- 完成後在本檔新增「Codex Notes（批三）」：改了哪些檔、4.1 每一項對應的測試名稱、`npm.cmd run typecheck` 與 `npm.cmd test` 的實際結果（沙箱 EPERM 失敗照實列）、沒做的事與原因。

## 2026-11-16 subagent：批三實作紀錄

Codex 用量額度用完、沒有寫入任何檔案，由 Claude 的 subagent 接手。沒有做任何 git 寫入；沒有新增依賴；沒有在瀏覽器驗證（見最後一段）。

### 改動與新增的檔案

程式：
- `apps/composer-gui/src/workflowGraph.ts`：`GraphEdge` 加 `kind?: 'dataflow'`、`formId?: string | null`；新增 `isSequence`、`sequenceEdges`；文件版本 6（型別、`emptyGraph`、匯出投影、`upgradeV4`、`listToGraph`）；`importAovGraph` 接受第 5、6 版，第 5 版只改版號；`orderedNodes`、`reach`（可達性與完成度）、成環檢查只看先後連線，重複鍵含種類；`integrityErrors` 新增資料流規則。
- `schemas/aov.schema.json`：新增 `sequenceEdge`、`dataflowEdge`、`v6`；`v5` 以下原樣保留。
- `apps/composer-gui/src/canvasEditing.ts`：`connectCanvasNodes` 多一個選填的 `kind` 參數（依種類建立與移除）；`setEdgeTransfer` 只作用於先後連線；新增 `setEdgeForm`、`clearEdgeForms`；刪節點、刪生產邏輯、刪工廠共用的 `removal` 會把指向被刪表單的 `edge.formId` 設為 `null`。`reconnectCanvasEdge` 本來就保留其他欄位，只補註解。
- `apps/composer-gui/src/canvasView.ts`：`ViewEdge` 帶 `kind`、`formId`；`parentContext` 只看先後連線；新增純函式 `formGaps`。
- `apps/composer-gui/src/CanvasViewElements.tsx`：資料流連線加 `canvas-dataflow-edge` 類別；與先後連線同一對節點時改用平移 6px 的自訂直線（`dataflowBeside`）；新增 `CanvasEdgeKindSwitch`、`gapSummary`、`frameGapSummaries`、`FrameGapList`；外框標題下顯示缺口文字；疊層對應線改由上層節點下方的接點（`sourceHandle: 'layer'`）出發。
- `apps/composer-gui/src/WorkflowCanvas.tsx`：前置核取清單只管先後連線；子流程節點多「資料來自哪些節點」清單與表單下拉；工具列的連線種類切換；拖曳新連線依切換建立種類；畫布下方的缺口清單；節點多一個只在疊層擁有外框時才出現的下方接點。
- `apps/composer-gui/src/graphGantt.ts`、`GanttPanel.tsx`、`WorkflowSimulation.tsx`、`NodeDetails.tsx`、`NodeForm.tsx`、`libs/aov-integration/canvasToProject.ts`：依 4.1 改為只看先後連線；`NodeForm.tsx` 刪表單時清掉連線上的表單。
- `apps/composer-gui/src/style.css`：虛線、缺口文字、隱藏的下方接點、兩組切換的樣式（單選圓點 1.25rem、標籤不換行、群組名稱與選項同列）。
- `apps/composer-gui/src/kitExamples.ts`：版本字面值 5 改 6（型別要求）。
- `libs/aov-integration/index.ts`：整合包入口仍只接受第 5 版平台文件，行為不變，只為通過型別檢查加上 `as number` 與註解。
- `DESIGN.md`：新增「2026-11-16 補充：資料流連線、連線種類與表單輸入輸出缺口（D208）」。
- `docs/thesis-case/analytical-four-before.aov.json`：由程式產生的檔案，`thesisAovCase.test.ts` 要求與程式輸出一致，以 `THESIS_CASE_UPDATE=1` 重新產生，差異只有版號 5 改 6。

測試（只新增案例；既有案例只改了寫死的版號）：`workflowGraph.test.ts`、`canvasEditing.test.ts`、`canvasView.test.ts`、`CanvasViewElements.test.tsx`、`WorkflowCanvas.test.tsx`、`graphGantt.test.ts`、`GanttPanel.test.tsx`、`production.test.tsx`、`exampleHints.test.ts`、`importAny.test.ts`、`libs/aov-integration/canvasToProject.test.ts`。

### 4.1 每一項對應的測試

每一項都做過變異檢查：把該處改回讀全部連線（或拿掉該判斷），確認下列測試會失敗，再復原。18 個變異全部被抓到。

| 4.1 項目 | 測試檔與名稱 |
|---|---|
| `orderedNodes` 排序 | `workflowGraph.test.ts`「閱讀順序不看資料流：資料由後面的節點傳回前面，前面的節點仍排在前面」 |
| `relations.ts` 間接依賴 | `workflowGraph.test.ts`「關聯候選的上下游方向不因資料流改變（relations.ts 依賴閱讀順序）」 |
| 可達性與完成度 | `workflowGraph.test.ts`「只接資料流不算接上開始與結束：資料流不是流程會走的路」 |
| 成環與重複 | `workflowGraph.test.ts`「資料流可以成環（資料可回傳），成環檢查只看先後連線」「同一對節點可各有一條先後與資料流連線；同種類重複才算重複」 |
| `graphGantt.ts` 拓撲、分支、可達、時間、選項 | `graphGantt.test.ts` `dataflow lines are not part of the estimate` 的四個案例（topological order、branches、reachability、time） |
| `GanttPanel.tsx` 分支選擇 | `GanttPanel.test.tsx`「a dataflow line is neither a branch point nor a branch option」 |
| `WorkflowSimulation.tsx` 失效傳播與前置完成 | `production.test.tsx`「資料流不是前置作業：只有資料流相連的站可以各自完成，也不因對方改填而失效」 |
| `canvasView.ts` `parentContext` | `canvasView.test.ts`「parent context lists sequence neighbours only; dataflow lines add none」 |
| `WorkflowCanvas.tsx` 前置核取清單 | `WorkflowCanvas.test.tsx`「the predecessor list manages sequence lines only: a dataflow line neither ticks it nor is removed by it」 |
| `NodeDetails.tsx` 移轉時間 | `WorkflowCanvas.test.tsx`「transfer time is offered for incoming sequence lines only」 |
| `canvasEditing.ts` 移轉時間 | `canvasEditing.test.ts`「transfer time applies to sequence lines only, and a form to dataflow lines only」 |
| `canvasEditing.ts` 建立與移除、重接 | `canvasEditing.test.ts`「a new dataflow line has no form yet…」「removing one kind between two nodes leaves the other kind in place」「reconnecting a dataflow line keeps its id, kind and form」 |
| `canvasToProject.ts` | `libs/aov-integration/canvasToProject.test.ts`「資料流連線不產生物料流」兩個案例 |
| 刪節點清表單 | `canvasEditing.test.ts`「deleting a node clears the form of the dataflow lines that passed its form, without removing those lines」 |
| `NodeForm.tsx` 刪表單 | `WorkflowCanvas.test.tsx`「deleting a form sets the data lines that passed it back to "not chosen yet" and keeps the lines」 |

其他要求的測試：第 5 版無損載入（`workflowGraph.test.ts`「第 5 版文件無損載入為第 6 版…」）；第 6 版往返（「第 6 版往返：匯出再匯入內容相同…」）；schema（「schema 接受第 6 版的兩種連線，拒絕不合規則的連線；第 5 版不接受資料流欄位」）；`integrityErrors` 各條規則（「資料流的結構規則：%s」七列）；Kit 推導（「加入資料流連線後，功能推導（graphActionIds）結果不變」）；缺口純函式（`canvasView.test.ts` 四個 `form gaps` 案例）；缺口畫面（`WorkflowCanvas.test.tsx`「%s shows the form gap count…」展開與疊層各一）。

清單外的讀取點：`canvasView.ts` 的 `formGaps` 取「直接先後前置節點」也用 `sequenceEdges`（有測試）。`exampleHints.ts` 照舊收全部連線（4.2），加了一個測試。沒有發現其他讀 `GraphEdge` 先後語意的地方。

### 寫死版本 5 的各處

| 位置 | 處理 |
|---|---|
| `workflowGraph.ts` 型別、`emptyGraph`、投影、`upgradeV4`、`listToGraph` | 改 6 |
| `workflowGraph.ts` `importAovGraph`、`importWorkflow` | 接受 5 與 6；錯誤訊息改「version 5 或 6」 |
| `kitExamples.ts` | 改 6 |
| `workflowGraph.test.ts`、`graphGantt.test.ts` 的測試文件與「輸出版號」斷言、`importAny.test.ts` 的斷言 | 改 6（代表目前文件或輸出）；另新增第 5 版輸入的測試 |
| `docs/thesis-case/analytical-four-before.aov.json` | 重新產生為 6 |
| `libs/aov-integration/index.ts` 整合包入口 `platform.version !== 5` | 保留只收第 5 版，行為不變 |
| `libs/aov-integration/migrate.ts` 的版本清單 `[1, 2, 3, 4, 5]` | 沒改（4.3 列為不要改），第 6 版文件走 `prepareImport` 會得到「未知平台版本」 |
| `fixtures/aov-merge/b/v5.valid.json`、`v5.broken-structure.json`、`bundle/v1.valid.json` | 保留，是第 5 版輸入的測試資料（整合包含雜湊） |
| `fixtures/aov-merge/b/v6.unknown-version.json` | 保留，`migrate.test.ts` 仍預期它是未知版本 |
| `TODO.md` 第 67 行 | 文字敘述，沒改 |

### 驗證結果（2026-11-16，實際執行）

- `npm.cmd run typecheck`：結束碼 0，沒有錯誤。
- `npm.cmd test`：結束碼 0。根目錄 Vitest 77 檔通過、1069 項通過、1 項略過（批二時為 1019 通過、1 略過，略過的那一項是既有的）；`services/preview` 14 通過、0 失敗；`libs/case-store` 1 檔 38 通過；`services/case-store` 1 檔 8 通過；`tools/thesis-s4` 13 通過、0 失敗。
- `npm.cmd run build`：結束碼 0，`built in 1.50s`；只有既有的區塊超過 500 kB 警告。
- 變異檢查：18 個變異（4.1 各處逐一還原）全部使至少一個測試失敗；檢查後檔案已復原，上面的三項驗證是在復原後跑的。

### 偏離設計文件或自行取捨的地方

1. 缺口的「可展開逐項清單」放在畫布下方的區塊（每個外框一個 `details`），不在外框裡。外框是 React Flow 的裝飾節點，設成不可選取、不接收指標事件，放可展開的內容會蓋住框內節點，也無法用鍵盤操作。外框標題下只顯示警示圖示與「缺口 N 項」「尚未指定表單 N 條」。
2. 連線種類切換的顯示條件是「畫布上有子流程」：進入子流程，或在最上層用展開、疊層而畫面上有外框。設計寫「最上層不顯示」，但展開與疊層時可以直接在外框內拖曳連線，不顯示就無法在那裡畫資料流。此時若在最上層的節點之間畫資料流，會被 `integrityErrors` 拒絕並顯示原因。
3. 同一對節點同時有先後與資料流連線時，兩條直線會完全重疊，虛線看不到。這種情況的資料流連線改用平移 6px 的自訂直線。設計沒有提到重疊，DESIGN.md 已補上這條。
4. `formId` 省略與 `null` 都視為「尚未指定」，schema 與 `integrityErrors` 都接受資料流連線不帶 `formId`；程式建立的資料流連線一律寫 `formId: null`。先後連線只要帶 `formId`（含 `null`）就拒絕。
5. 開始不可有前置連線、結束不可有後續連線（D80）、節點不可連到自己，這三條沿用既有程式，對兩種連線都檢查。設計沒有說資料流是否適用；影響是「資料來自哪些節點」清單與先後清單一樣不列「結束」，「開始」沒有清單。
6. 「尚未指定表單 N 條」計的是該子流程內所有 `formId` 為空的資料流連線，不限於接在開始或結束的那幾條。
7. 「傳遞的表單」下拉列出整份文件的全部表單，沒有依工廠篩選（設計沒有規定）。
8. `libs/aov-integration/migrate.ts` 沒有改（4.3）。後果：第 6 版文件經 `prepareImport` 會被判為未知版本；整合包入口也仍只收第 5 版。畫布的匯入匯出走 `importWorkflow`，不受影響。交辦第 1 點要求逐一判斷寫死的版本，這兩處我選擇保留並在此列出，需要決定是否另開工作。

### 沒做或做不到的事

- 沒有在瀏覽器驗證任何畫面。虛線、平移的資料流線、對應線的出發點、切換的外觀、缺口文字在外框內是否擠壓，都只有 jsdom 的結構測試。
- 批二外觀問題第 1 項（進出外框的流程連線接到左右邊中點）：沒有改程式。讀過 `FrameNode` 與 React Flow 12.12.0 的樣式與量測程式後，外框的左、右接點本來就宣告在邊的中點（`top: 50%`），找不出會接到角落的原因，沒有瀏覽器無法重現。需要在瀏覽器確認是否仍然發生；若仍發生，請看外框節點外層元素的實際高度與接點的實際位置。
- 重接資料流連線保留種類與表單，只在純函式層測試（`reconnectCanvasEdge`、`viewConnection`），元件層沒有測（測試用的 store 沒有重接的進入點）。
- `GanttPanel.tsx` 過濾過期分支選擇的那一行改成只看先後連線，但畫面上選不到資料流連線，這一行單獨還原無法由測試觀察到；分支選項本身有測試。
- 沒有改 `docs/decision-log.md`、`kits/`、`services/`。

### 注意到但沒處理的問題

- `docs/canvas-layer-views.md` 第 3.1 節與 3.3 節沒有因批三更新，文件狀態列也還寫著批三待做。
- 缺口提示在單層檢視不顯示（設計只要求展開與疊層），進入子流程單獨編輯時看不到自己的缺口。
- 外框標題區高 64px，放標題一行加缺口一行（0.75rem）估算剛好放得下；外框很窄時缺口文字會被截短，完整文字在 `title` 與畫布下方清單。
- `removal` 現在每次都經過 `clearEdgeForms`，會為每張圖建立新的物件（內容不變），對以參考相等判斷的地方理論上有影響；目前沒有這種用法，測試全數通過。
- `aov.schema.json` 的 `v6` 是複製 `v5` 再換掉連線定義，兩段大部分重複；沿用了檔案既有的寫法（`v4` 與 `v5` 也是如此），沒有抽共用定義。

## 2026-11-16 Claude：批三審查與瀏覽器驗證

- 沙箱外重跑：`npm.cmd run typecheck` 通過；`npm.cmd test` 根目錄 77 檔、1069 通過、1 略過，其餘各段通過。subagent 的程式未修改。
- 瀏覽器（Chrome，`http://127.0.0.1:5183/aov-canvas.html`）：以檔案匯入一份自製的第 6 版文件（三層：主流程、配料細項、投料細項；配料細項有四條資料流，其中一條未指定表單、一條與先後連線並存）。
  - 匯入成功；表單沒有欄位時 schema 拒絕（既有規則）。
  - 檢視切換與連線種類切換：標籤在圓點右側，與工具列按鈕同列同高。
  - 展開：三層外框都顯示；進出外框的連線接在外框左右邊中點（批二回報的「接在角落」未重現）；資料流是虛線，與先後連線並存時平移顯示。
  - 疊層：三個列帶；對應線由上層節點下方接到外框上緣；顯示「公司需要，待開發」文字。
  - 缺口：外框標題下顯示「缺口 2 項，尚未指定表單 1 條」，畫布下方清單逐項為「輸入多出秤重紀錄」「輸出缺少配料單」「尚未指定表單 1 條」，與測試文件的預期相符。
  - 在疊層中把種類切到「資料流」，於第三層拖出一條連線：成功，外框出現「尚未指定表單 1 條」；選取目的節點後「資料來自哪些節點」清單已勾選來源並可選表單，選定後外框改為「缺口 1 項」。
  - 在最上層拖資料流：被拒絕，訊息「「主流程」是最上層的流程，資料流連線只能畫在子流程裡。」
  - 主控台沒有錯誤。
- Composer 的流程畫布（`http://127.0.0.1:5183/`）：匯入兩層的第 6 版文件，疊層顯示正常，虛線兩條、缺口文字與清單都出現。沒有重做獨立畫布的每一項。
- 未驗證：下載第 6 版後再匯入（測試文件有未指派的表單，下載被既有的完成度檢查擋下；往返只有單元測試涵蓋）；匯入既有的第 5 版檔案（只有單元測試）；鍵盤操作；拖曳端點重接資料流；窄畫面；把工具拖放到外框內。
- 觀察到但未處理：匯入第 6 版文件後的狀態訊息仍含「舊版流程已轉換為畫布」字樣，是否為既有的通用訊息未查。
- 已知未做：`libs/aov-integration` 的 `prepareImport` 與整合包入口仍只收第 5 版（設計 4.3 排除），第 6 版文件走那兩個入口會被當成未知版本。
- 決議 D208 已寫入 `docs/decision-log.md`。
