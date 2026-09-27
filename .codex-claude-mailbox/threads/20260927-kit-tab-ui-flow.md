---
id: "20260927-kit-tab-ui-flow"
title: "Kit 分頁、動態預覽與可修改項目流程"
status: "waiting_for_codex"
owner: "codex"
reviewer: "claude"
priority: "medium"
created_by: "codex"
created_at: "2026-09-27"
updated_at: "2026-09-27"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "docs/project-spec.md"
    type: "file"
  - path: ".codex-claude-mailbox/index.md"
    type: "file"
---

# Goal

將使用者已確認的流程整理為可實作與審閱的修改說明：**一個 Kit 對應一個分頁；選取 Kit 後，顯示其頁面及允許修改的項目。**

本次交付範圍為 mailbox 與修改說明，不包含功能實作。以下是待實作方案，不表示現有系統已具備這些能力。

# Success Criteria

- 文件清楚區分既有能力、已確認需求與待決設計。
- 後續功能驗收：僅顯示已選 Kit 的分頁，各分頁包含該 Kit 的預覽與可修改項目。
- 調整表格或下拉選單設定後，該 Kit 預覽更新；切換分頁不遺失修改，也不污染其他 Kit。
- 儲存及重新載入後設定一致；正式系統使用同一份有效 UI 定義與共用解析／呈現邏輯。
- 非法欄位、未授權修改與未知動作遭拒絕，且顯示原因。

# Current Context

工作區：`C:/Users/gslab/Desktop/composer-refactor`。
基線版：`C:/Users/gslab/Documents/New project/form-system-kit-composer`。

2026-09-24 原始碼檢視結果（尚未在 2026-09-27 重跑或做瀏覽器驗證）：

- 基線版 `gui/app.js` 的 `renderPreview()` 依 `selectedKits()` 建立分頁，以 `activePreviewKit` 切換。
- `previewTemplate()` 依 Kit ID 查詢 `kitMockups`，主要輸出預先撰寫的 HTML；尚非共用 UI definition 解析流程。
- `gui/aov-integration.js` 提供表格／表單資源目錄、節點引用及整合包匯出；這不等同可執行 UI。
- `integrations/aov-studio/src/App.tsx` 明示 AoV 僅定義架構，不執行所描述功能。
- 本重構專案 `docs/project-spec.md` §6 已提出 Layout、Component、Data binding 與共用解析流程，但資料形狀仍為建議，尚無正式 validator。

# Codex Notes

## 已確認的操作流程

1. User 選取所需 Kit。
2. 系統依已選 Kit 顯示分頁，一個 Kit 一個分頁。
3. 開啟某 Kit 分頁，載入該 Kit 預設 UI 與目前設定，呈現模擬畫面及可修改項目。
4. User 調整被允許的項目，驗證通過後立即更新預覽。
5. 切換其他 Kit 分頁時保留原 Kit 設定。
6. 儲存組裝設定，後續產出系統讀取同一份有效 UI 定義。

Tab 指 Kit 分頁，不是「表格／下拉／事件」等設定分類。分頁內設定面板如何排版尚未核定。

## 資料契約先行

以下為建議責任分工，欄位名稱與檔案格式需先核對既有契約：

| 資料 | 責任 |
| --- | --- |
| Kit 預設 UI 定義 | 分頁標題、元件識別、類型、版面、預設值及資料／動作引用 |
| 可修改項目描述 | 可調欄位、型別、範圍、選項、修改角色及唯讀限制 |
| 每個 Kit 的使用者覆寫 | 以穩定 Kit ID 與元件 ID 保存修改；不直接改寫 Kit 預設模板 |
| 預覽資料 | 符合資料契約的模擬資料，與正式資料來源可替換 |
| UI 暫態 | 目前分頁、選取元件等；與需匯出的設定分開 |

畫布與設定面板修改同一份設定；預覽讀取合併、驗證後的有效值，不維護另一套 HTML 狀態。AoV 保留流程、能力與引用關係，UI 細節由 UI definition 描述。

## 修改步驟與預期接觸位置

1. **重新盤點並決定實作位置**：核對基線版 preview 呼叫路徑、Kit manifest、Recipe、匯入匯出及正式 UI 入口。基線版只讀參考；本交接不授權直接修改基線版。
2. **定義最小契約**：先支援本流程所需的 table 與 select，列出預設值、可修改規則、資料及事件引用。預期涉及 `schemas/`、`config/ui/` 與對應 `kits/`；實際檔名待盤點後確定。原規格圖表需求保留為後續範圍，未取消。
3. **沿用 Kit 分頁機制**：分頁來自已選 Kit，依穩定 ID 保存設定與切換狀態；不新增第二套分頁系統。
4. **建立共用解析／呈現路徑**：驗證 → 正規化／合併有效設定 → 依元件 type 呈現 → 綁定模擬資料。先用簡單元件對照，無須外掛框架。逐步替換 `kitMockups`；尚未移植的 mockup 必須標示不可編輯。
5. **接入可修改項目**：表格可按契約調整欄位顯示、順序與寬度；下拉選單可按契約調整選項或預設值。資料來源與 mapping 依既有角色限制處理，不全部開放給 User。
6. **接入事件與資料綁定**：例如下拉選項改變後篩選指定表格。事件只能引用核准 action；預覽不得觸發正式寫入或具副作用的操作。
7. **儲存、載入與產出**：沿用既有 Recipe／匯出契約可承接的部分，補上有版本的 UI 設定引用或資料；正式畫面共用 renderer。重新載入時重新驗證 Kit、元件、來源與欄位引用。
8. **驗證與文件同步**：執行下列測試，再更新規格 §6、相關驗收條目、mailbox 與 Obsidian；未通過前不得宣稱流程完成。

## 請 Claude 審阅

- 檢查上述契約是否足以支援一 Kit 一分頁，以及設定保存、互動綁定和正式產出。
- 檢查跨 Kit 狀態污染、取消選取的資料保留、權限與預覽副作用風險。
- 提出最小必要測試與缺漏；將回覆寫入本 thread 的 Claude Notes／Review Findings／Test Plan，回覆後將狀態改為 waiting_for_codex 並同步 index。
- 本次只審閱流程，不需啟動實作或更動基線版。

## 2026-09-27 WP0：受阻，未完成

### 變更摘要

- 已完整閱讀本 thread（含 Review Findings、Decisions、Claude Handoff）、`docs/project-spec.md` §3、§5、§6、`docs/decision-log.md`、`CLAUDE.md` 與 mailbox 技能規則。
- 已唯讀查看基線版 `schemas/kit.schema.json` 與 `schemas/recipe.schema.json`，尚未複製或修改。
- `git init` 已建立空 Git repository；但 `.git` 寫入限制使 `git add` 失敗，無法建立文件基準 commit 與 `feature/kit-tab-ui` 分支。依 Handoff「任一 WP 無法達到完成條件」停止 WP0。
- WP1–WP6 尚未開始：功能分支及文件基準尚未建立，後續實作不能滿足 WP0／CLAUDE.md 的分支前置要求。WP6 的畫面提示與測試亦依賴 GUI 骨架，無可獨立完成的工作包。
- 未修改基線版、未讀取實際業務資料、未串接真實後端或外部服務，未使用根目錄 `packages/`。

### 檔案清單

- `.git/`：`git init` 產生的空 repository，無 commit。
- `.codex-claude-mailbox/threads/20260927-kit-tab-ui-flow.md`：本次執行紀錄及 Open Questions。
- `.codex-claude-mailbox/index.md`：同步受阻狀態與 owner。

### 驗證方式與實際結果

| 指令／檢查 | 實際結果 |
| --- | --- |
| `git status --short`（初始化前） | 失敗：`fatal: not a git repository`，確認原先未初始化。 |
| `git init` | 成功：`Initialized empty Git repository in C:/Users/gslab/Desktop/composer-refactor/.git/`。 |
| `git add README.md CLAUDE.md docs config kits manuals migrations schemas services .codex-claude-mailbox` | 失敗：`fatal: Unable to create 'C:/Users/gslab/Desktop/composer-refactor/.git/index.lock': Permission denied`。環境權限明列 `.git` 唯讀，且本次不允許提升權限；未嘗試繞過。 |
| `node --version` | 通過：`v24.15.0`。 |
| `npm --version` | 失敗：PowerShell 執行政策禁止載入 `npm.ps1`。 |
| `npm.cmd --version` | 通過：`11.13.0`；後續可用 `.cmd` 入口，無須更動執行政策。 |
| `.gitignore` 讀取 | 原檔不存在；停止前尚未建立。 |
| 基準 commit／功能分支 | 略過：Git 索引寫入失敗。 |
| Vite 骨架、安裝依賴、`npm run build`、`npm run typecheck`、`npm test` | 略過：WP0 停止，尚無 `package.json` 或程式碼；不可視為通過。 |
| 瀏覽器／Network／鍵盤驗證 | 略過：尚未建立 GUI。 |

# Claude Notes

2026-09-27 Claude 審閱（原始碼閱讀，未做瀏覽器或執行驗證）。

Current Context 各項已對照基線版原始碼確認屬實：`renderPreview()`／`selectedKits()`／`activePreviewKit`（`gui/app.js:1972`、`:3018`、`:187`）、`previewTemplate()` 查 `kitMockups`（`:1996`、`:2023`）、`aov-integration.js` 資源目錄與整合包、`App.tsx` 標示「僅定義，不執行」。

另查到與本方案直接相關、但 thread 未提及的既有事實：

1. **已有每 Kit 覆寫機制**：`state.subfeatureOptions` 以 `kitId::subfeatureId` 為鍵保存覆寫，匯出為 Recipe 的 `selectedSubfeatureOptions`；`kit.schema.json` 的 `subfeatureOption` 已有 `id`、`displayName`、`type`（select／boolean／text／number）、`defaultValue`、`choices`。
2. **GUI 沒有 Recipe 匯入**：只有 `downloadRecipeJson()`；唯一匯入路徑是 AoV 整合包，還原 tables／formDefs／dataflows，不還原 Kit 選取與 options。GUI 狀態也沒有持久化。
3. **AoV 整合包含 `tableData`**：匯出內容包含使用者上傳的實際資料列。
4. **Composer GUI 沒有身分與角色**：`serve-gui.cjs` 無驗證機制；GUI 的 Kit 清單仍含 `tenant-auth-kit`。
5. **技術棧不同**：Composer GUI 是 vanilla JS；產出系統前端是 React 18／TS。
6. **`renderPreview()` 以 `innerHTML` 整塊重繪**；`pvHeader()` 未跳脫參數。
7. **基礎設施 Kit 已有預覽行為**：`defaultMockup()` 顯示「此 kit 提供後端或基礎設施能力，無獨立頁面」，`platform-core-kit` 有專屬 mockup。

# Review Findings

後續發現需保留原文，由 Codex 在 Decisions 記錄接受、拒絕理由或延期處理。

| ID | 嚴重度 | 缺漏 | 依據 | 建議補充 |
|---|---|---|---|---|
| F01 | 高 | 「可修改項目描述」與「每 Kit 覆寫」另立新契約，未提及既有 `subfeatureOption` 與 `selectedSubfeatureOptions` | Claude Notes 1；決策紀錄 D02 同概念沿用舊名 | 以既有 `subfeatureOption` 擴充（補範圍、角色、風險、元件 ID 引用），覆寫沿用 `kitId::…` 鍵與 Recipe 欄位；不要平行建立第二套覆寫機制 |
| F02 | 高 | 「預覽與正式系統共用 renderer」未處理技術棧差異 | Claude Notes 5 | 需先決定：(a) 共用一份框架無關的解析／正規化模組，加兩個 renderer 與一致性測試；或 (b) Composer 預覽改用與產出系統相同的 React renderer。Success Criteria 目前無法照字面達成 |
| F03 | 高 | 儲存／重新載入沒有可用路徑 | Claude Notes 2 | 步驟 7 需明列：新增 Recipe 匯入（含驗證失敗不部分覆寫，比照 `aov-integration.js:127` 的做法）、`recipe.schema.json` 新增 UI 覆寫欄位並提升 `recipeVersion` |
| F04 | 高 | 「未授權修改遭拒」沒有可執行的身分來源 | Claude Notes 4；spec §8「Composer 建置權限與產出系統權限分開建模」 | 明列 Composer 自身的角色來源（User／MIS／Developer 從哪裡來、由誰驗證）。在身分機制存在前，角色限制只能當顯示提示，不得宣稱已拒絕未授權修改 |
| F05 | 高 | 預覽資料與匯出可能帶出實際資料 | Claude Notes 3；必做 M01 | 預覽資料只用 mock 或已去識別化資料；UI 設定匯出不得包含 `tableData`；Test Plan 加一條 |
| F06 | 中 | 未定義 subfeature 與分頁內容的關係 | 基線版預覽已依 `selectedSubfeatures()` 呈現 | 規定：可修改項目歸屬於 Kit 或特定 subfeature；subfeature 未選時項目隱藏但覆寫保留，匯出規則與取消 Kit 政策一致 |
| F07 | 中 | 事件綁定未限制跨 Kit | 步驟 6「篩選指定表格」未限定範圍；Success Criteria「不污染其他 Kit」；spec §4.1 不得跨圖直連 | 首期綁定僅限同一 Kit 內元件；跨 Kit 互動須經 capability 契約，列為後續範圍 |
| F08 | 中 | 圖表延後與 spec 衝突 | spec §6「首期先完成表格、下拉及一種圖表」；thread 步驟 2 只做 table 與 select | 由 user 決定：修改 spec 首期範圍，或本方案補上一種圖表。不能只在 thread 內延後 |
| F09 | 中 | 覆寫缺少版本與失效處理 | Test Plan 有「Kit 版本改變」情境，但契約無欄位 | 覆寫記錄 Kit 版本與 UI definition `schema_version`；元件 ID 消失或型別改變時標示失效覆寫、列出清單，不靜默丟棄或套用 |
| F10 | 中 | 即時預覽會與 `innerHTML` 整塊重繪衝突 | Claude Notes 6 | 設定面板與預覽區分開重繪，避免輸入時失去焦點；使用者可編輯的文字（欄位 label、選項名稱）一律跳脫或以 DOM API 設定，避免 XSS |
| F11 | 中 | 可修改項目描述缺 spec §3 的修改 metadata | spec §3、R09 要求標示角色與風險 | 至少補 `allowed_roles`、`risk`、`change_level`；UI 欄位順序與寬度屬 A／User／low，資料來源與 mapping 屬 MIS |
| F12 | 低 | Kit 清單未反映 D03 | Claude Notes 4；決策紀錄 D03 | 在重構專案實作時以 `entry-permission-kit` 取代 `tenant-auth-kit` 分頁 |
| F13 | 低 | Open Question 2 已有既有行為可沿用 | Claude Notes 7 | 基礎設施 Kit 沿用 `defaultMockup()`：顯示能力說明與設定，標示不可編輯畫面 |
| F14 | 低 | 分頁無障礙語意 | spec §6 要求鍵盤替代操作；現有分頁只有 `button` | 補 `role="tablist"`／`tab`／`tabpanel`、`aria-selected` 與方向鍵切換 |
| F15 | 低 | Open Question 4（實作位置）實際上阻擋步驟 2–7 | `schemas/` 位置與 `recipe.schema.json` 修改對象取決於此 | 將此題標為「實作前必答」，其餘 Open Questions 可在實作中決定 |

# Test Plan

| 情境 | 預期結果 |
| --- | --- |
| 未選任何 Kit | 顯示空狀態，不出現殘留分頁 |
| 選 A、B Kit | 僅出現 A、B 兩分頁，各自載入正確畫面與可修改項目 |
| 修改 A 表格欄位後切到 B 再切回 | A 修改保留，B 不受影響 |
| 修改下拉選項、預設值及核准的篩選綁定 | 畫面與目標表格依設定更新；不執行正式副作用 |
| 無效欄位、預設值不在選項內、未知 renderer/action | 顯示可定位錯誤，保留最後有效設定，拒絕套用非法值 |
| 嘗試修改未授權的資料來源或欄位 | 在設定驗證／執行邊界拒絕，不能只靠隱藏 UI |
| 取消目前 Kit、重新選取、Kit 版本改變 | 依核定策略處理分頁與覆寫；不靜默遺失或套用不相容設定 |
| 匯出後重新匯入 | 還原各 Kit 設定，驗證失效引用，不夾帶秘密值 |
| 預覽與正式模式載入同一 UI 定義 | 元件、版面與互動設定一致，僅資料來源及執行模式不同 |
| （Claude 補）既有 `selectedSubfeatureOptions` 與新 UI 覆寫並存 | 同一設定只有一個保存位置；舊 Recipe 可載入（F01） |
| （Claude 補）Recipe 匯入格式錯誤或引用失效 | 整份拒絕，現有工作階段不被部分覆寫，列出失效引用（F03） |
| （Claude 補）以 User 身分修改 MIS 項目 | 身分機制存在時由驗證邊界拒絕；不存在時測試須標為未涵蓋，不得算通過（F04） |
| （Claude 補）匯出 UI 設定後檢查內容 | 不含 `tableData`、實際資料列或秘密值（F05） |
| （Claude 補）取消某 subfeature 後再勾回 | 其可修改項目隱藏後恢復，覆寫值保留（F06） |
| （Claude 補）A Kit 的事件綁定指向 B Kit 元件 | 驗證拒絕並指出跨 Kit 引用（F07） |
| （Claude 補）Kit 升版後元件 ID 移除 | 覆寫標示失效並列出，不套用、不靜默刪除（F09） |
| （Claude 補）欄位 label 輸入 `<img src=x onerror=alert(1)>` | 以純文字顯示，不執行（F10） |
| （Claude 補）輸入中觸發預覽更新 | 輸入框不失焦、游標位置不跳動（F10） |
| （Claude 補）預覽中觸發 action | 瀏覽器 Network 無正式寫入請求（步驟 6） |

目前僅文件檢查，以上功能測試尚未執行。實作後為設定隔離、驗證及儲存往返留下可重跑檢查，並以瀏覽器驗證完整流程與鍵盤操作。

# Decisions

- 2026-09-27，已確認：一個 Kit 一個分頁；只顯示已選 Kit 的頁面及其可修改項目。
- 2026-09-27，已確認：本次建立專用 mailbox 與修改流程說明，不實作功能。
- 2026-09-27，設計建議：保留既有 Kit 分頁邏輯，將預覽改接 UI definition、共用解析／呈現及設定保存。
- 2026-09-27，user 已確認：在重構專案 `composer-refactor` 實作；基線版僅作唯讀參考。回應 Open Question 4 與 F15。
- 2026-09-27，user 已確認：首期不做圖表，只做 table 與 select；spec §6 首期範圍已同步修改，R05 圖表需求保留至後續階段。回應 F08。
- 2026-09-27，user 已確認：Composer 預覽與產出系統前端皆採 React 18 + TypeScript，共用同一套解析與 renderer；Composer GUI 以 React 重寫，不搬用基線版 `app.js`。回應 F02（決策紀錄 D13）。
- 2026-09-27，user 指示：開始交付 Codex 開發，工作包見「Claude Handoff」。
- 2026-09-27，user 核准：Codex 沙箱無法寫入 `.git`，改為 Codex 只寫程式與文件，所有 git 操作（add、commit、branch）由 Claude 以 user 帳號執行。Claude 已將 Codex 建立的空 `.git` 移出專案，重新 `git init`、建立 `.gitignore`、基準 commit 與 `feature/kit-tab-ui` 分支。

# Claude Handoff（2026-09-27）

User 已核准開始開發。F01–F15 全部納入本次範圍（F08、F15 已由 user 決議）；Codex 若不採納任一項，須在 Decisions 寫明理由並停下詢問 user。

## 技術與位置

- React 18 + TypeScript + Vite（與基線版 Target System 一致），測試用 Vitest + React Testing Library，套件管理用 npm（本機 Node v24.15.0、npm 11.13.0）。
- 建議目錄：`apps/composer-gui/`（Composer GUI）、`libs/ui-runtime/`（驗證、正規化、合併與 renderer，預覽與產出系統共用）。**不得使用根目錄 `packages/`**：README 已將它定義為 System Package 產出目錄。目錄確定後同步更新 README 結構圖。
- 基線版 `C:/Users/gslab/Documents/New project/form-system-kit-composer` 唯讀，不得修改。可複製其 `schemas/kit.schema.json`、`schemas/recipe.schema.json` 到本專案作為起點，須在檔頭或 README 註明來源與版本。
- Kit 清單使用最小 fixture（例如 3 個 Kit：一個有表格與下拉的業務 Kit、`entry-permission-kit`、一個基礎設施 Kit），不載入完整基線 manifest。

## 工作包與完成條件

| WP | 內容 | 對應 | 完成條件 |
|---|---|---|---|
| WP0 | `git init`、`.gitignore`（`node_modules/`、`dist/`、`packages/`、`manuals/generated/`）、以現有文件建立基準 commit、開 `feature/kit-tab-ui` 分支；Vite 專案骨架 | CLAUDE.md 分支流程 | `npm run build`、`npm run typecheck`、`npm test` 可執行；commit 採約定式提交、無 emoji |
| WP1 | 契約：以基線版 `subfeatureOption` 擴充可修改項目（加 `allowed_roles`、`risk`、`change_level`、目標元件 ID、範圍）；UI definition schema（僅 table、select）；覆寫沿用 `kitId::…` 鍵並記錄 Kit 版本與 `schema_version`；Recipe schema 加 UI 覆寫欄位並提升 `recipeVersion` | F01、F09、F11 | 每份 schema 有正例與反例測試；舊版 Recipe（無 UI 覆寫）可通過驗證 |
| WP2 | `libs/ui-runtime`：驗證 → 正規化／合併有效值（含來源追溯）→ 依 type 取 renderer | F02、spec §5、§6 | 純函式單元測試；禁止 `dangerouslySetInnerHTML` 與 `innerHTML` |
| WP3 | Kit 分頁：只顯示已選 Kit、`entry-permission-kit` 取代 `tenant-auth-kit`、基礎設施 Kit 顯示能力說明且標示不可編輯、ARIA tabs 與方向鍵 | F06、F12、F13、F14 | Test Plan 對應情境通過 |
| WP4 | 可修改項目與即時預覽：table 欄位顯示／順序／寬度，select 選項／預設值；綁定僅限同 Kit；預覽 action 為 mock、無外部寫入 | F07、F10 | 輸入中預覽更新不失焦；跨 Kit 綁定被拒；Network 無寫入請求 |
| WP5 | Recipe 匯出／匯入：驗證失敗整份拒絕、不部分覆寫；匯出不含實際資料列與秘密值 | F03、F05、M01 | 匯出→匯入往返一致；匯出內容檢查測試 |
| WP6 | 角色：Composer 目前無身分機制，角色只做顯示提示；相關測試標記「未涵蓋」 | F04 | 文件與畫面皆不得宣稱已拒絕未授權修改 |

## 資料限制

只使用 mock 資料。任何實際製造資料須先依 M01 去識別化，未去識別化的資料不得進 repo。

## Open Questions 的暫行作法

- Q1（取消 Kit 後的覆寫）：依 thread 建議保留草稿、匯出只含已選 Kit；在 Decisions 標為「暫行，待 user 核定」。
- Q2（基礎設施 Kit 分頁）：依 F13。
- Q3（正式系統是否一 Kit 一分頁）：不在本次範圍，只做 Composer。

## 必須停下詢問 user 的情況

- 需要修改基線版，或需要實際資料。
- 契約與基線版 schema 衝突，無法以擴充方式相容。
- 任一 WP 無法達到完成條件，或需要新增本表以外的依賴或功能。

## Git 分工（2026-09-27 修訂）

- Codex 不執行任何會寫入 `.git` 的指令（`git add`、`commit`、`branch`、`checkout` 等）；唯讀指令（`git status`、`git diff`、`git log`）可用，若遇 `dubious ownership` 可在單次指令加 `-c safe.directory=C:/Users/gslab/Desktop/composer-refactor`，不得修改全域設定。
- WP0 剩餘工作：Vite + React 18 + TS 骨架、`npm.cmd` 安裝依賴，以及 `npm.cmd run build`、`typecheck`、`test` 可執行（PowerShell 執行政策擋 `npm.ps1`，一律用 `npm.cmd`）。`.gitignore`、基準 commit、功能分支已由 Claude 完成。
- 每個 WP 完成後，在 Codex Notes 寫明建議的約定式提交訊息，由 Claude 審閱後 commit。

## 回報格式

每個 WP 完成後在 Codex Notes 記錄：變更摘要 → 檔案清單 → 驗證方式與實際結果（含失敗與略過項目）。全部完成後把 status 改為 `ready_for_claude`，由 Claude 審閱與執行瀏覽器驗證。

# Session Summary

Codex 已整理前次查核結果與使用者修正，建立本專案專用 mailbox，列出資料契約、修改順序、驗收與待決事項。功能尚未修改；Claude 審阅與測試尚未完成，不將 thread 標為 completed。

2026-09-27 Claude：完成文件審閱（原始碼閱讀，未執行或瀏覽器驗證），提出 F01–F15，其中 F01–F05 為高嚴重度，並補充 10 條測試情境。狀態改為 waiting_for_codex。功能測試仍未執行。

# Open Questions

以下不阻擋文件交付；實作前由 user 核定，不能將建議視為已接受需求：

- owner: user — 取消選取 Kit 後，覆寫設定要暫存至重新選取，還是確認後刪除？建議保留草稿，匯出僅包含已選 Kit。
- owner: user — 無獨立操作畫面的基礎設施 Kit 分頁要顯示哪些內容？依「一 Kit 一分頁」保留分頁，建議顯示設定與能力說明。
- owner: user — 正式產出系統是否也必須維持一 Kit 一分頁？目前明確確認的是 Composer 的組裝／預覽操作。
- ~~owner: user — 本階段實作應在重構專案建立新入口，還是修改基線版？~~ 已決議：在重構專案實作（見 Decisions 2026-09-27）。
- ~~owner: user — F02 renderer 共用方式~~ 已決議：React 18 + TypeScript 共用 renderer（見 Decisions）。

## 2026-09-27 WP0 停止條件：Git metadata 寫入受限（已解決，見 Decisions）

- owner: user — 目前環境將 `C:/Users/gslab/Desktop/composer-refactor/.git` 限為唯讀，`git add` 實際回報 `index.lock: Permission denied`。請將此工作區 `.git` 設為可寫後通知續作；若無法調整環境，是否由你在本機完成文件基準 commit 與 `feature/kit-tab-ui` 分支，再交回繼續？未取得可執行的處理方式前，不繞過限制或省略 WP0 完成条件。
- WP0–WP6 尚未全部完成，因此保留未完成狀態 `in_progress`、owner 設為 `user`，不標記 `ready_for_claude`。恢復後從 WP0 接續，先檢查既有 Git 狀態，避免重做或覆蓋使用者操作。