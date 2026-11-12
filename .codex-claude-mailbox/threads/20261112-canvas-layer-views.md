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
