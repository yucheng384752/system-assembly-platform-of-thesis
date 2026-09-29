---
id: "20260927-kit-tab-ui-flow"
title: "Kit 分頁、動態預覽與可修改項目流程"
status: "waiting_for_user"
owner: "user"
reviewer: "claude"
priority: "medium"
created_by: "codex"
created_at: "2026-09-27"
updated_at: "2026-09-29"
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

## 2026-09-27 WP0 續作：完成；WP1 前因額外依賴停止

### 變更摘要

- 已完整重讀本 thread（包含 Decisions、Claude Handoff、Git 分工修訂）、spec §3／§5／§6、decision-log 及 CLAUDE.md；唯讀核對基線版兩份 schema。
- 唯讀確認目前分支為 `feature/kit-tab-ui`。未執行任何寫入 `.git` 的指令，未更動 `.gitignore` 或既有 Git 基準。
- 建立 React 18 + TypeScript + Vite GUI 骨架與空狀態、Vitest 可重跑檢查，安裝 Handoff 技術棧及其 React 型別／Testing Library peer dependencies。
- 測試預設的設定載入器發生目錄存取錯誤；使用工具既有 `--configLoader native` 後通過，已固定於 test script。
- README 同步 GUI 目錄及開發指令。`libs/ui-runtime/` 僅標示後續 WP2 預定位置，尚未建立；未使用根目錄 `packages/`。
- WP1 尚未開始：基線 schema 使用 JSON Schema draft 2020-12，計畫使用 Ajv 實作正式驗證；後續 RTL 互動測試計畫使用 jsdom。兩者均未列入 Handoff 核准技術棧，依停止條件交由 user 核定，未安裝。WP2–WP6 未開始。

### 檔案清單

- `package.json`、`package-lock.json`：依賴與 dev／build／typecheck／test 指令。
- `tsconfig.json`、`vite.config.ts`：嚴格型別檢查、GUI 入口與 dist 輸出。
- `apps/composer-gui/index.html`、`apps/composer-gui/src/main.tsx`、`apps/composer-gui/src/App.tsx`：應用程式骨架。
- `apps/composer-gui/src/App.test.tsx`：空狀態呈現 smoke test。
- `README.md`：目錄與執行方式。
- 本 thread 與 `.codex-claude-mailbox/index.md`：執行結果及待決事項。
- 安裝產生 `node_modules/`，build 產生 `dist/`，兩者皆由既有 `.gitignore` 排除。

### 驗證方式與實際結果

| 指令／檢查 | 實際結果 |
| --- | --- |
| `git -c safe.directory=C:/Users/gslab/Desktop/composer-refactor symbolic-ref --short HEAD` | 通過：`feature/kit-tab-ui`；僅唯讀查詢。 |
| `npm.cmd install --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000` | 通過：新增 77 個套件，exit 0；未執行 audit。 |
| `npm.cmd ls --depth=0` | 通過：React／React DOM 18.3.1、TypeScript 5.9.3、Vite 7.1.7、Vitest 3.2.4、RTL 16.3.0 等依賴均已安裝。 |
| `npm.cmd run build` | 通過：tsc + Vite 建置，26 modules，輸出 `dist/`，exit 0。 |
| `npm.cmd run typecheck` | 通過：`tsc --noEmit`，exit 0。 |
| 初次 `npm.cmd test` | 失敗：設定打包階段 `Cannot read directory "../..": Access is denied`／無法 resolve `vite.config.ts`，未執行測試。 |
| `npm.cmd test -- --configLoader native` | 通過：1 file／1 test。 |
| 修正 script 後 `npm.cmd test` | 通過：1 file／1 test，exit 0；原樣指令可重跑。 |
| 瀏覽器／鍵盤／Network／RTL 互動驗證 | 略過：目前僅 WP0 空骨架；1 個測試為 SSR 呈現檢查，不代表 DOM 互動已驗證。 |
| WP1 schema、WP2–WP6 功能測試 | 略過：額外依賴待核定，未開始實作，不算通過。 |

建議約定式提交訊息：`chore(gui): scaffold React 18 Vite app and runnable checks`。由 Claude 審閱後執行 Git 提交。

## 2026-09-27 WP1 續作：專案寫入範圍受限，停止

### 變更摘要

- 已讀取 Decisions、Claude Handoff、Git 分工修訂、WP0 Codex Notes、spec §3／§5／§6、decision-log 與 CLAUDE.md。
- 唯讀確認分支 `feature/kit-tab-ui`，HEAD 為 `f952801`，不重做 WP0。
- Ajv／jsdom 已獲 user 核准；本次阻礙不是依賴授權，而是環境只允許寫入 `.codex-claude-mailbox`（及暫存目錄），不包含專案根目錄。approval policy 為 never，不能提升權限或繞過限制。
- 安裝需修改根目錄 package.json、package-lock.json、node_modules；WP1 需寫入 schemas 等目錄，均超出可寫範圍。依 Handoff「任一 WP 無法達到完成條件」停止，WP1–WP6 未實作。

### 檔案清單

- `.codex-claude-mailbox/threads/20260927-kit-tab-ui-flow.md`：停止紀錄、Open Questions、status／owner。
- `.codex-claude-mailbox/index.md`：同步受阻狀態。

### 驗證方式與實際結果

| 指令／檢查 | 實際結果 |
| --- | --- |
| `git -c safe.directory=C:/Users/gslab/Desktop/composer-refactor symbolic-ref --short HEAD` | 通過：`feature/kit-tab-ui`。 |
| `git -c safe.directory=C:/Users/gslab/Desktop/composer-refactor log -1 --format="%h %s"` | 通過：`f952801 chore(gui): scaffold React 18 Vite app and runnable checks`。 |
| 讀取 package.json | 通過：尚未宣告 ajv／jsdom。 |
| 初次文件讀取 | 預設編碼顯示亂碼；改以 `Get-Content -Encoding utf8` 重讀，文字正常。 |
| 環境權限檢查 | WP1 前置條件不成立：專案根目錄不在 writable roots；未嘗試越界寫入，沒有安裝失敗的實際執行紀錄。 |
| `npm.cmd` 安裝及固定版本 | 略過：安裝目的地不可寫；未安裝、未選定版本。 |
| build／typecheck／test、瀏覽器／Network／鍵盤驗證 | 略過：停止於實作前，未以 WP0 歷史結果代替本次驗證。 |

建議約定式提交訊息：`docs(mailbox): record WP1 workspace permission blocker`。未執行任何寫入 `.git` 的指令。

## 2026-09-27 WP1 續作：npm registry 存取失敗，停止

### 變更摘要

- 本次 cwd 與可寫根已為 C:/Users/gslab/Desktop/composer-refactor；前次工作區範圍阻礙已解除，.git 仍唯讀。
- 已讀取指定交接內容、spec §3／§5／§6、decision-log、CLAUDE.md 及基線版 kit／recipe schema。確認 feature/kit-tab-ui、HEAD f952801，未重做 WP0。
- 嘗試安裝固定版本 ajv@8.17.1，registry 請求回報 EACCES。環境限制網路且不允許提升權限，未繞過限制。
- 依 Handoff「任一 WP 無法達到完成條件」停止；jsdom 未安裝或固定版本，WP1–WP6 未完成。未修改基線版、未使用實際資料或根目錄 packages/，未執行寫入 .git 的指令。

### 檔案清單

- 本 thread 與 .codex-claude-mailbox/index.md：停止紀錄、Open Questions、狀態同步。
- package.json／package-lock.json：唯讀 diff 確認無變更。

### 驗證方式與實際結果

| 指令／檢查 | 實際結果 |
| --- | --- |
| git -c safe.directory=C:/Users/gslab/Desktop/composer-refactor symbolic-ref --short HEAD | 通過：feature/kit-tab-ui。 |
| git -c safe.directory=C:/Users/gslab/Desktop/composer-refactor log -1 --oneline | 通過：f952801 chore(gui): scaffold React 18 Vite app and runnable checks。 |
| npm.cmd install --save-exact ajv@8.17.1 --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000 | 失敗，exit 1：request to https://registry.npmjs.org/ajv failed，code／errno EACCES；另回報 C:/Users/gslab/AppData/Local/npm-cache/_logs 無法寫入。 |
| git -c safe.directory=C:/Users/gslab/Desktop/composer-refactor diff -- package.json package-lock.json | 通過，無輸出，兩檔無變更。 |
| 文件讀取 | 預設編碼亂碼，改以 UTF8 重讀。 |
| 紀錄寫入工具 | Python 無法啟動（登入工作階段不存在）；apply_patch 因 index 比對失敗未套用；改以 PowerShell 原生檔案 API 寫入。 |
| jsdom 安裝、WP1 schema 測試、WP2–WP6 | 略過：觸發停止條件。 |
| build／typecheck／test、瀏覽器／Network／鍵盤驗證 | 略過：停止於安裝，不以 WP0 歷史結果代替本次驗證。 |

建議約定式提交訊息：docs(mailbox): record WP1 npm registry access blocker。由 Claude 審閱後提交。

## 2026-09-29 WP1：完成

### 變更摘要
- 擴充基線 subfeatureOption 的角色、風險、修改層級、目標與範圍。Recipe 0.3.0 的 uiOverrides 只存版本，值沿用 selectedSubfeatureOptions 的 kitId::subfeatureId 鍵。
- schema 的 $comment 記錄唯讀基線來源與快照日期。舊版 Recipe 仍相容；三個 Kit 皆為 mock fixture。

### 檔案清單
- schemas/kit.schema.json、schemas/recipe.schema.json、schemas/ui-definition.schema.json。
- libs/ui-runtime/types.ts、libs/ui-runtime/schema.ts。
- apps/composer-gui/src/fixtures.ts、apps/composer-gui/src/schema.test.ts；thread 與 index。

### 驗證方式與實際結果
- npm.cmd run typecheck：通過，exit 0。
- npm.cmd test -- src/schema.test.ts：通過，1 file / 3 tests；涵蓋三份 schema 正反例、舊版 Recipe。
- Git 唯讀確認 feature/kit-tab-ui、badb30b；初始工作樹乾淨。全域 ignore 存取警告未影響查詢。
- 預設編碼讀取及首次 Node stdin 中文紀錄出現亂碼／問號；已使用 UTF8 重讀並重寫本次紀錄，保留原有紀錄。
- 略過 build、瀏覽器／Network，待整合階段。未安裝依賴、未寫入 .git。

建議約定式提交訊息：feat(schema): extend baseline options and version UI overrides。

## 2026-09-29 WP2：完成

### 變更摘要
- 共用純函式解析器執行 schema、版本、來源、欄位、元件、subfeature 與同 Kit action 驗證；覆寫限定契約列出的項目，回傳有效設定及每個 option 的來源。
- 不變更輸入；陣列整份取代，失效覆寫顯示原因、不靜默套用。React renderer 使用純文字輸出與傳入的 mock rows，沒有網路或寫入動作。

### 檔案清單
- libs/ui-runtime/resolve.ts、libs/ui-runtime/Renderer.tsx。
- apps/composer-gui/src/runtime.test.tsx；本 thread。

### 驗證方式與實際結果
- npm.cmd test -- src/schema.test.ts src/runtime.test.tsx：通過，2 files / 5 tests。
- npm.cmd run typecheck：初次失敗 TS2322（測試案例陣列推導出 optional undefined），明確標記 Record<string, Value>[] 後重跑通過，未用 any。
- 涵蓋不變性、來源追溯、陣列取代、XSS 純文字、錯誤型別／範圍、失效版本、移除引用、跨 Kit 綁定及隱藏 subfeature。
- 略過：瀏覽器／Network 交互留待 WP4／Claude；完整 build 留待整合。

建議約定式提交訊息：feat(ui-runtime): resolve validated settings with shared React renderer。

## 2026-09-29 WP3：完成

### 變更摘要
- 實作已選 Kit 分頁、單一 active tab、ARIA 對應與左右／Home／End 鍵；subfeature 取消後隱藏元件，取消 Kit 保留草稿。
- 入口權限與平台 Kit 顯示能力說明且標示不可編輯；只載入三個 mock Kit。

### 檔案清單
- apps/composer-gui/src/App.tsx、App.test.tsx；本 thread。

### 驗證方式與實際結果
- npm.cmd run typecheck：通過。
- npm.cmd test：初次 5 通過、1 失敗；getByLabelText 同時找到 checkbox 與有 aria-labelledby 的 tabpanel，改以 checkbox role 精確查詢。
- npm.cmd test -- src/App.test.tsx：重跑 1 file / 1 test 通過，涵蓋空狀態、選取、鍵盤焦點、基礎設施與 subfeature 暫存。
- apply_patch 初次因同一路徑 delete/add 被拒，沒有套用；改為 Update File 成功。
- 略過：真實瀏覽器鍵盤操作留待 Claude；覆寫保留測試於 WP4 增補。

建議約定式提交訊息：feat(gui): add accessible selected Kit tabs and subfeature controls。

## 2026-09-29 WP4：實作與自動化檢查完成，Network 驗證受阻；停止

### 變更摘要
- 加入 table 欄位名稱、顯示、順序、寬度與 select 選項／預設值編輯。輸入草稿與最後有效 Recipe 分離，非法輸入顯示原因且不覆寫有效預覽。
- 編輯面板顯示修改 metadata 與來源；React 保留輸入節點。mock action 僅篩選記憶體資料，同 Kit 引用由共用解析器驗證。
- 自動化測試發現 renderer 與 editor 使用重複 React key，已加 preview 前綴修正，重跑無警告。
- 無法完成 Handoff 指定 Network 條件：本機 Vite 監聽遭 EACCES，瀏覽器工具 inventory 沒有可用瀏覽器。未以 fetch／XHR spy 冒充真實瀏覽器 Network 驗證。
- 依「任一 WP 無法達到完成條件」停止，WP4 未完成，WP5／WP6 未開始。未標記 ready_for_claude。

### 檔案清單
- apps/composer-gui/src/SettingsEditor.tsx、style.css。
- apps/composer-gui/src/App.tsx、App.test.tsx。
- 本 thread、.codex-claude-mailbox/index.md。

### 驗證方式與實際結果
- npm.cmd run typecheck：通過，exit 0。
- npm.cmd test：3 files / 7 tests 通過，但有重複 React key 警告；修正後 npm.cmd test -- src/App.test.tsx：1 file / 2 tests 通過，無該警告。
- RTL 已驗證焦點／selectionStart、有效表頭即時更新、非法寬度保留最後有效值、顯示與順序、mock 篩選、Kit／subfeature 草稿保留；fetch 與 XMLHttpRequest.open 呼叫皆為 0。
- cua.getState()：apps=[]、browsers=[]，無可用瀏覽器。
- npm.cmd run dev -- --configLoader native：失敗，exit 1，Error: listen EACCES: permission denied 127.0.0.1:5173。未提升權限或改監聽位址繞過限制。
- 略過：真實瀏覽器 Network／鍵盤驗證、完整 build 與最終整合驗證；WP5 匯入匯出、WP6 身分提示與未涵蓋測試尚未實作。不得以歷史 build 結果代表本次。
- 未安裝依賴、未寫入 .git、未修改基線版、未使用實際資料或根目錄 packages/。

建議約定式提交訊息（待 WP4 驗收後）：feat(gui): edit validated Kit settings with mock live preview。

## 2026-09-29 WP5：完成，含 R01／R02

### 變更摘要
- 新增獨立 Recipe 匯入／匯出邊界，沿用 schema 與 resolveKit；所有驗證完成後才一次替換工作階段，成功匯入重設編輯草稿、錯誤與預覽暫態，失敗保留原設定。
- R01：僅 Recipe 0.2.0 以目前 Kit／UI 定義補版本資訊，逐項顯示遷移來源，再驗證全部引用及覆寫（包含隱藏草稿）；0.3.0 缺版本或版本失配仍拒絕。不以補版本宣稱原始版本相容。
- 匯出採明列欄位投影，只含已選 Kit／subfeature；取消項目草稿留在目前工作階段，不進匯出。僅保留 UI Recipe 範圍，匯入其他欄位時明示不保留；不載入／匯出 tableData、deploymentConfig 或資料庫連線憑證。
- JSON 文字區提供複製儲存及貼上載入；未增加檔案套件或後端。自由文字仍為使用者輸入，畫面提醒不得輸入真實資料或秘密值；不是自動去識別化工具。
- R02：在 recipe schema 的 uiOverrides 補上版本 metadata 註解，維持既有名稱及單一覆寫值儲存位置。

### 檔案清單
- libs/ui-runtime/recipe.ts。
- apps/composer-gui/src/RecipeTransfer.tsx、App.tsx、App.test.tsx、recipe.test.ts。
- schemas/recipe.schema.json；本 thread。

### 驗證方式與實際結果
- npm.cmd test -- src/recipe.test.ts src/App.test.tsx：通過，2 files／6 tests，exit 0。涵蓋舊版遷移後 resolve、往返一致、未知 Kit／subfeature／option、版本失效、來源與元件引用失效、非法型別、隱藏草稿驗證、匯出資料排除及 GUI 失敗不部分覆寫／成功清除舊暫態。
- npm.cmd run typecheck：通過，exit 0。
- 本 WP 無失敗的驗證指令。初次交接文件讀取預設編碼顯示亂碼，已以 UTF8 重讀指定內容。
- 略過：本機 dev server、真實瀏覽器、Network 與 JSON 複製到檔案再載入操作，依分工交由 Claude；不視為停止條件。完整 build／全部 tests 留至 WP6 整合檢查。
- 唯讀 git log 確認 HEAD de6087a；初始 git diff --stat 無差異。未安裝依賴、未修改基線、未寫入 .git。

建議約定式提交訊息：`feat(recipe): add atomic UI recipe transfer and legacy migration`。

## 2026-09-29 WP6：完成；交回 Claude

### 變更摘要
- Composer 首頁明示尚無身分驗證與授權檢查；每項 metadata 改標「角色提示」。契約／範圍驗證不等同身分授權，沒有宣稱拒絕未授權修改。
- README 與 spec §3／§6 同步首期實作、Recipe 範圍、遷移、草稿及角色限制；新增 skipped 測試明列身分授權「未涵蓋」。
- R03 延後：目前首期 UI 的 width／order 仍受 UI schema 的整數契約限制，尚無需小數的 fixture；共用 checkValue 的 number 整數限制確實過廣。後續擴充數值設定時應增加明確 integer metadata 並測試小數，不將本次當作已修正。
- R04 延後：保留基線 schema 編譯行為，避免在 Recipe 交付中混入所有 schema 的 strict 相容性調整；後续需盤點 Ajv strict 警告，再改 strict: 'log' 或僅關閉必要規則。目前 strict: false 的風險仍在，未宣稱修復。

### 檔案清單
- apps/composer-gui/src/App.tsx、SettingsEditor.tsx、App.test.tsx。
- README.md、docs/project-spec.md。
- .codex-claude-mailbox/threads/20260927-kit-tab-ui-flow.md、.codex-claude-mailbox/index.md。

### 驗證方式與實際結果
- npm.cmd test：通過，4 files／12 passed／1 skipped，exit 0。略過案例為「未涵蓋：以 User 身分修改 MIS 項目由授權邊界拒絕（尚無身分機制）」，不計入通過。
- npm.cmd run build：通過，含 tsc --noEmit 與 Vite production build，211 modules，exit 0；輸出 dist/（既有忽略目錄）。
- npm.cmd run typecheck：WP5 完成時通過；WP6 最終型別檢查由 build 的同一 tsc --noEmit 再次通過。
- git symbolic-ref --short HEAD（單次 safe.directory）：feature/kit-tab-ui；git diff --check 通過，只有 LF／CRLF 提示，無空白錯誤。
- 功能驗證無失敗。最後紀錄查核的 rg 指令因 PowerShell 引號傳遞失敗（os error 123，exit 1），改以 Get-Content／Select-String 查核成功，確認 thread／index 狀態與 Decisions／Session Summary 均已同步。git status 另有全域 ignore 讀取權限警告，但已列出 8 個修改檔與 3 個新檔。未執行 npm install、網路查詢、dev server 或任何寫入 .git 的 Git 指令；基線唯讀，只使用 mock。
- 略過：真實瀏覽器／Network／鍵盤及 JSON 複製儲存往返，交由 Claude；WP4 歷史驗收不當作 WP5／WP6 已驗證。
- 略過：Obsidian vault 同步。技能 C:/Users/gslab/.codex/skills/form-system-kit-composer-obsidian/SKILL.md 要求「When repo docs are needed, also add or update an Obsidian note that links to the repo file.」但 vault 不在本次可寫根且不能提升權限，未嘗試越界。請 Claude 更新既有導航／待辦與 GUI 筆記並連回本 thread、README 及 spec；此為文件同步限制，不影響已完成的 WP5／WP6 功能條件。

建議約定式提交訊息：`docs(gui): clarify advisory roles and uncovered authorization checks`。

### Claude 驗收交接
- 審閱新增 recipe.ts 的投影與 0.2.0 遷移政策，以及 R03／R04 延後。
- 真實瀏覽器：修改設定後匯出 JSON，複製至檔案再貼回匯入；確認預覽／編輯器一致；非法 Kit、版本或引用拒絕整份匯入且保留目前畫面；成功匯入清除舊錯誤／篩選暫態。
- 檢查匯出排除未選 Kit／subfeature 與 mock 資料列；角色提示清楚；操作 Network 無正式寫入請求。
- 完成 Obsidian 同步，依兩個 WP 的建議約定式訊息審閱後提交；Codex 未執行 Git 提交。

# Claude Notes

2026-09-29 Claude：WP5–WP6 審閱與瀏覽器驗證。

- 重跑：`npm.cmd run typecheck` 通過；`npm.cmd test` 4 files / 12 passed / 1 skipped（身分授權「未涵蓋」，不計入通過）；`npm.cmd run build` 通過。
- 瀏覽器（Chrome，`127.0.0.1:5173`）實測：
  - 修改 name label 為「批號」後匯出：JSON 只含已選 Kit／subfeature 與覆寫值、版本資訊，不含 mock 資料列、`tableData` 或連線設定。
  - 匯入含未知 Kit 的 Recipe：顯示「未知 Kit：unknown-kit」，分頁、設定與預覽維持原狀。
  - 將 label 改為「暫時名稱」後貼回先前匯出的 JSON 匯入：label 與表頭還原為「批號」，錯誤訊息清除，顯示匯入成功。
  - 首頁明示尚無身分驗證，metadata 標為「角色提示」。
  - Network 0 筆請求；Console 無錯誤。
- 審閱：`importRecipe` 先在獨立候選物件完成全部驗證再替換工作階段；`exportRecipe` 以明列欄位投影並回經匯入驗證；0.2.0 遷移會顯示來源提示。R03、R04 延後理由合理，保留為待辦。
- 小問題（不阻擋）：Recipe JSON 文字區只有約 181px 寬，貼上長 JSON 不易閱讀，建議改為全寬。
- 結論：WP5、WP6 由 Claude 驗收通過；WP0–WP6 全部完成。
- 未完成／待 user 決定：Obsidian 筆記同步（vault 不在專案內，未經 user 同意不寫入）、Vitest 升級至 4.1.11、`feature/kit-tab-ui` 是否合併回 `main`。

2026-09-29 Claude：WP1–WP4 審閱與 WP4 瀏覽器驗證。

- 重跑：`npm.cmd run typecheck` 通過；`npm.cmd test` 3 files / 7 tests 通過；`npm.cmd run build` 通過。
- 瀏覽器（Chrome，Vite dev server `127.0.0.1:5173`）實測：
  - 勾選兩個 Kit 後出現兩個分頁；在 name label 以鍵盤實際輸入 `批號<b>x</b>`，輸入框保持焦點、游標在末端（10），表頭即時更新且以純文字顯示，DOM 中無注入的 `<b>` 元素。
  - 篩選下拉改為 closed，表格只剩 Mock B。
  - name width 輸入 10：顯示「name-width 超出範圍」，表頭寬度維持最後有效值 180px。
  - 分頁上按 ArrowRight 切到「入口權限 Kit」，焦點與 aria-selected 同步；ArrowLeft 回到「紀錄 Kit」，先前修改保留。
  - Network：操作期間 0 筆請求；另以一次同源 `fetch` 當對照，確認記錄器可捕捉請求。Console 無錯誤。
- 結論：WP4 完成條件達成，WP4 由 Claude 驗收通過。

審閱發現（WP5 前處理）：

| ID | 嚴重度 | 內容 | 建議 |
|---|---|---|---|
| R01 | 中 | 舊版 Recipe 0.2.0 通過 schema，但 `resolveKit` 在沒有 `uiOverrides` 版本時一律拋出「失效覆寫版本」，實際上無法載入舊 Recipe（F01 測試情境「舊 Recipe 可載入」只驗到 schema 層） | WP5 匯入時定義舊版遷移規則（例如以目前 Kit 版本補版本資訊並標示來源），並加上 resolve 層測試 |
| R02 | 低 | `uiOverrides` 實際只存版本資訊，名稱易誤解為覆寫值 | 改名為 `uiOverrideVersions` 或在 schema `$comment` 說明；需同步 recipe schema |
| R03 | 低 | `checkValue` 對所有 number 型別要求整數，基線 `subfeatureOption` 的 number 允許小數 | 改由 option 宣告（例如 `range.integer`）控制，或在 schema 註明 |
| R04 | 低 | `schema.ts` 以 `strict: false` 編譯，會隱藏 schema 內的拼字錯誤 | 評估改為 `strict: 'log'` 或只關閉必要規則 |

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

- 2026-09-29，Codex 接受並完成 R01／R02；R01 僅於 0.2.0 匯入邊界補目前版本並重新驗證，R02 以 schema 註解澄清。R03／R04 延後，理由見 WP6 Codex Notes。WP5／WP6 已完成自動化檢查，交由 Claude 審閱與瀏覽器驗收。

- 2026-09-29，Codex 接受 F01–F15，依 Handoff 全數納入；Q1 暫行保留取消 Kit／subfeature 的草稿，匯出只含已選 Kit，待 user 核定。Q2 依 F13；Q3 正式系統分頁不在範圍。

- 2026-09-27，已確認：一個 Kit 一個分頁；只顯示已選 Kit 的頁面及其可修改項目。
- 2026-09-27，已確認：本次建立專用 mailbox 與修改流程說明，不實作功能。
- 2026-09-27，設計建議：保留既有 Kit 分頁邏輯，將預覽改接 UI definition、共用解析／呈現及設定保存。
- 2026-09-27，user 已確認：在重構專案 `composer-refactor` 實作；基線版僅作唯讀參考。回應 Open Question 4 與 F15。
- 2026-09-27，user 已確認：首期不做圖表，只做 table 與 select；spec §6 首期範圍已同步修改，R05 圖表需求保留至後續階段。回應 F08。
- 2026-09-27，user 已確認：Composer 預覽與產出系統前端皆採 React 18 + TypeScript，共用同一套解析與 renderer；Composer GUI 以 React 重寫，不搬用基線版 `app.js`。回應 F02（決策紀錄 D13）。
- 2026-09-27，user 指示：開始交付 Codex 開發，工作包見「Claude Handoff」。
- 2026-09-27，user 核准：Codex 沙箱無法寫入 `.git`，改為 Codex 只寫程式與文件，所有 git 操作（add、commit、branch）由 Claude 以 user 帳號執行。Claude 已將 Codex 建立的空 `.git` 移出專案，重新 `git init`、建立 `.gitignore`、基準 commit 與 `feature/kit-tab-ui` 分支。
- 2026-09-27，user 核准：新增 `ajv`（JSON Schema draft 2020-12 驗證）與 `jsdom`（Vitest DOM 互動測試）；由 Codex 安裝後從 WP1 繼續。WP0 已由 Claude 驗證（typecheck、test 1/1、build 通過）並提交為 `f952801`。
- 2026-09-29，Codex 沙箱無 npm registry 網路存取，改由 Claude 安裝依賴：`ajv@8.20.0`（dependencies）、`jsdom@30.1.1`（devDependencies）。同時因 npm audit 將 `vite` 升至 7.3.6、`vitest` 升至 3.2.7（同 major 修補版，修正 high／critical 漏洞；ajv 8.17.1 有 ReDoS，改用 8.20.0）。剩餘 1 項 moderate（`@vitest/mocker`，僅測試期），修正需 vitest 5 破壞性升級，暫不處理並回報 user。typecheck、test 1/1、build 通過。Codex 後續不得自行安裝依賴；需要新依賴時依停止條件停止。
- 2026-09-29，Claude 驗收 WP4（含瀏覽器 Network 驗證），WP1–WP4 已提交；Codex 從 WP5 繼續，並處理審閱發現 R01（R02–R04 可一併處理或記錄延後理由）。本機監聽與瀏覽器驗證屬 Claude 分工，Codex 無法執行時記為略過並交由 Claude，不視為停止條件。

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

2026-09-29 Codex：WP5／WP6 完成，R01／R02 已處理，R03／R04 已記錄延後。完整測試 12 passed／1 skipped，build／typecheck 通過；status=ready_for_claude、owner=claude。真實瀏覽器、Obsidian 同步與 Git 提交交由 Claude。下列為歷史摘要。

Codex 已整理前次查核結果與使用者修正，建立本專案專用 mailbox，列出資料契約、修改順序、驗收與待決事項。功能尚未修改；Claude 審阅與測試尚未完成，不將 thread 標為 completed。

2026-09-27 Claude：完成文件審閱（原始碼閱讀，未執行或瀏覽器驗證），提出 F01–F15，其中 F01–F05 為高嚴重度，並補充 10 條測試情境。狀態改為 waiting_for_codex。功能測試仍未執行。

# Open Questions

## 2026-09-29 WP4 停止條件：本機監聽與瀏覽器 Network 驗證受阻（已解決：由 Claude 驗證通過）

- owner: user — WP1–WP3 已完成，WP4 尚缺真實 Network 驗證。npm.cmd run dev -- --configLoader native 回報 listen EACCES: permission denied 127.0.0.1:5173；cua.getState() 的 browsers 為空。
- 需提供允許 localhost 監聽且可操作瀏覽器的執行環境，或明確指示由 Claude 執行 WP4 Network 驗證後再交回續作。未要求新依賴，也不需重新安裝既有套件。
- 本次依 Handoff「任一 WP 無法達到完成條件」停止；WP5–WP6 未開始，status=in_progress、owner=user。不得改為 ready_for_claude。
- 後續文件同步注意：Obsidian vault 不在本次可寫根，尚未同步、未嘗試越界寫入；README 目錄、spec 實作狀態亦待後續整合更新，不可視為已完成。
- 停止後紀錄檢查：git diff --check 無空白錯誤；只有 LF／CRLF 提示，git status 另有全域 ignore 讀取警告。thread／index 均已同步 in_progress、user。

## 2026-09-27 WP1 停止條件：npm registry 存取受限（已解決，見 Decisions 2026-09-29）

- owner: user — 工作區可寫範圍已修正，但 npm.cmd 安裝 Ajv 的 registry 請求遭 EACCES 拒絕。請提供允許 npm registry 存取的執行環境，或由本機完成固定版本 ajv／jsdom 安裝後交回續作；不需重新核准依賴。
- 另有預設 npm cache 日誌不可寫訊息；可指定工作區內可寫快取，但不能據此認定 registry 存取已恢復。
- WP1–WP6 未完成，status 為 in_progress、owner 為 user；不標為 ready_for_claude。


## 2026-09-27 WP1 停止條件：專案目錄不在可寫範圍（已解決：改由專案根目錄啟動）

- owner: user — 請將工作區開在 `C:/Users/gslab/Desktop/composer-refactor`，並讓此專案目錄成為可寫範圍；`.git` 仍可保持唯讀。當前工作區與可寫根僅為 `.codex-claude-mailbox`，因此無法完成依賴安裝及 WP1。
- 這是環境權限阻礙，不需重新核准 ajv／jsdom。恢復後先確認分支與檔案狀態，再以 `npm.cmd` 安裝並固定版本，依序接續 WP1–WP6。
- WP1–WP6 未完成，status 設為 `in_progress`、owner 設為 `user`，不標為 `ready_for_claude`。


## 2026-09-27 WP1 前停止條件：額外依賴待核定（已核准，見 Decisions）

- owner: user — 是否核准新增 `ajv`（draft 2020-12 JSON Schema 驗證，供 WP1／WP2／WP5）與 `jsdom`（Vitest 中執行 React Testing Library 的 DOM 互動測試，供 WP3／WP4）？Handoff「需要新增本表以外的依賴或功能」要求停止詢問；兩者尚未安裝。
- 理由：目前核准並安裝的依賴沒有 JSON Schema validator，也沒有瀏覽器 DOM 模擬環境。採用現成 validator 避免自行重寫 `$ref`、型別、範圍及組合 schema 驗證；jsdom 讓分頁、焦點與輸入互動檢查可由 `npm.cmd test` 重跑。仍保留 Claude 的真實瀏覽器／Network 驗證。
- WP0 已完成；WP1–WP6 未完成，故 status 為 `in_progress`、owner 為 `user`，未標為 `ready_for_claude`。依 user 指示停止，不自行猜測依賴核准範圍。

以下不阻擋文件交付；實作前由 user 核定，不能將建議視為已接受需求：

- owner: user — 取消選取 Kit 後，覆寫設定要暫存至重新選取，還是確認後刪除？建議保留草稿，匯出僅包含已選 Kit。
- owner: user — 無獨立操作畫面的基礎設施 Kit 分頁要顯示哪些內容？依「一 Kit 一分頁」保留分頁，建議顯示設定與能力說明。
- owner: user — 正式產出系統是否也必須維持一 Kit 一分頁？目前明確確認的是 Composer 的組裝／預覽操作。
- ~~owner: user — 本階段實作應在重構專案建立新入口，還是修改基線版？~~ 已決議：在重構專案實作（見 Decisions 2026-09-27）。
- ~~owner: user — F02 renderer 共用方式~~ 已決議：React 18 + TypeScript 共用 renderer（見 Decisions）。

## 2026-09-27 WP0 停止條件：Git metadata 寫入受限（已解決，見 Decisions）

- owner: user — 目前環境將 `C:/Users/gslab/Desktop/composer-refactor/.git` 限為唯讀，`git add` 實際回報 `index.lock: Permission denied`。請將此工作區 `.git` 設為可寫後通知續作；若無法調整環境，是否由你在本機完成文件基準 commit 與 `feature/kit-tab-ui` 分支，再交回繼續？未取得可執行的處理方式前，不繞過限制或省略 WP0 完成条件。
- WP0–WP6 尚未全部完成，因此保留未完成狀態 `in_progress`、owner 設為 `user`，不標記 `ready_for_claude`。恢復後從 WP0 接續，先檢查既有 Git 狀態，避免重做或覆蓋使用者操作。
