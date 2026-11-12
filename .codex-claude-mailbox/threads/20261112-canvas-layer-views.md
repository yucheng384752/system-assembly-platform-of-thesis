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

（待 Codex 填寫）
