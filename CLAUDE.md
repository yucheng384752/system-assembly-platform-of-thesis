# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本檔案內容源自 `初始專案開發設定與管理/輔助開發文件`，為專案通用 AI 協作規範。

## 專案背景與技術定義 (Project & Tech Stack)

- **專案名稱與目標**：Composer Platform 重構專案，是 Form System Kit Composer（基線版）的改良版，成果將撰寫成論文。設計須能說明相對基線版的差異與改良理由。規格唯一來源為 `docs/project-spec.md`，決議記錄於 `docs/decision-log.md`。
- **主要程式語言**：TypeScript（Composer GUI 與 `libs/ui-runtime`）。`kits/` 是基線版副本，含 Python（FastAPI）後端與 TSX 前端，目前不在 typecheck 與測試範圍。
- **套件管理與環境**：npm（`package-lock.json` 固定版本），Node 需 ^20.19.0 或 >=22.12.0；開發機為 Windows、Node 24.15.0。新增依賴須先經 user 核准。
- **核心框架與依賴**：React 18、Vite 7、Vitest 4 + jsdom + React Testing Library、Ajv（JSON Schema draft 2020-12）。預覽與產出系統共用同一套解析與 renderer（決策 D13）。

## 架構總覽 (Architecture)

- `apps/composer-gui/`：Composer 操作介面；使用者只看得到業務語言，不顯示程式、資料表或框架名稱。
- `libs/ui-runtime/`：驗證 → 合併有效設定（含來源追溯）→ 依元件 type 呈現；Recipe 匯入先在候選物件完成全部驗證才替換工作階段。
- `schemas/`：Kit、Recipe、UI definition 契約，擴充自基線版 schema；同概念沿用基線名稱（決策 D02）。
- `kits/`：基線版 Kit 原樣副本（來源見 `kits/BASELINE.md`）；`tenant-auth-kit` 已廢除，由 `entry-permission-kit` 取代（D03）。
- `.codex-claude-mailbox/`：Codex 與 Claude 的交接紀錄，每個功能一個 thread。

## 常用指令與環境陷阱 (Commands & Gotchas)

- 一鍵啟動：`start.cmd`（`-Check` 先跑 typecheck 與測試、`-Port`、`-NoBrowser`）。`scripts/start.ps1` 須存為 UTF-8 with BOM，否則 Windows PowerShell 5.1 會把中文訊息讀成亂碼。
- npm 一律用 `npm.cmd`（PowerShell 執行政策會擋 `npm.ps1`）：`npm.cmd run typecheck`、`npm.cmd test`（script 已含 `--configLoader native`）、`npm.cmd run build`、`npm.cmd run dev`。
- 專案資料夾擁有者是 Codex 沙箱帳號，git 指令須加 `-c safe.directory=C:/Users/gslab/Desktop/composer-refactor`，否則出現 dubious ownership。
- Codex 沙箱不能寫入 `.git`、沒有網路：Codex 只寫程式，依賴安裝與所有 git 寫入由 Claude 執行；啟動 Codex 時 cwd 必須是專案根目錄。
- 本機 dev server 與瀏覽器驗證由 Claude 執行（Codex 無法監聽連接埠）。

## 核心協作原則 (Core Collaboration Principles)

- **溝通與輸出風格**：回覆簡潔有力。以「引導思考」為主、「直接給答案」為輔；確認整體思考過程與邏輯正確後，再給出最終程式碼或答案。
- **需求釐清邊界**：遇到模糊、缺乏上下文或有潛在矛盾的要求時，**絕對不要自行腦補或猜測**。先主動提問，取得具體明確的要求後，再實作；提問時偏好開放式問題，不用選擇題方式提問。
- **嚴格的程式碼審查**：Code Review 或重構時採最嚴格標準。明確指出效能瓶頸、狀態管理風險或架構缺陷，並給出具體修改建議與替代方案。
- **卡關與除錯機制**：除錯過程若經 **三次對答** 仍未找到解法，立即停止盲目試錯。退一步條列目前的「思考過程與假設」，待確認邏輯盲區後再繼續。
- **回覆語言固定**：使用繁體中文回覆，禁止emoji、icon等內容輸出。

## 架構與實作守則 (Architecture & Implementation Rules)

- **Data-First（資料結構優先）**：實作任何業務邏輯前，先確認關聯式資料庫 Schema、API 介面或資料模型（Data Model）已定義完整。
- **單一職責與解耦**：確保模組獨立性。前端元件或後端服務都避免將與業務無關的邏輯硬編碼在核心模組中。
- **防禦性設計 (Defensive Programming)**：驗證所有外部輸入與邊界條件。遇非預期錯誤時優雅處理（Graceful Degradation），提供有意義的日誌或錯誤訊息，**嚴禁靜默失敗（Silent Failures）**。
- **型別優先**：TypeScript 不得以 `any` 蒙混通過。
- **資料流清楚**：UI state、domain state、derived state 分開管理。
- **錯誤處理一致**：UI 顯示、fallback、empty state 樣式須統一。

## 安全基準線 (Security Baseline)

- **資料去識別化為必做項目（M01）**：只用 mock 或已去識別化資料；未去識別化的實際製造資料不得進入 repo、論文、測試 fixture 或任何外部服務（含 LLM）。
- **秘密值不落地**：連線字串、密碼、token 以外部來源引用（`secret_ref`），不寫進設定、Recipe、UI 定義、手冊、套件或指令列；Recipe 匯出只含已選 Kit 的 UI 設定，不含資料列或連線設定。
- **角色只是提示**：Composer 尚無身分機制，`allowed_roles` 僅作顯示；不得宣稱已拒絕未授權修改，授權測試標為「未涵蓋」。
- **預覽無副作用**：預覽與 mock action 不得發出正式寫入請求；使用者可編輯的文字一律以純文字呈現（不用 `dangerouslySetInnerHTML` 或 `innerHTML`）。
- **基線版唯讀**：`C:\Users\gslab\Documents\New project\form-system-kit-composer` 只可讀取與複製，不得修改。

## 功能開發分支流程 (Feature Branch Workflow)

**每次開發「新功能」時，必須遵守：**

1. **開專屬分支**：為該功能開一個新的 git 分支處理（如 `feature/<name>`），不直接在 `main` 上開發。
2. **完整開發並留下記錄**：功能完成需包含 —— 開發內容記錄、目的、測試方式與結果記錄（寫入 commit / mailbox thread / docs）。
3. **提醒重置聊天**：功能**完整開發完成後**，主動提醒使用者使用 `/clear` 指令重製此聊天，並提供承接的prompt，再開始下一個功能。
4. **commit**：每次上傳git時，撰寫commit需要遵守**約定式提交**的格式內容，且不可加入emoji、icon等圖示，以純文字描述

## 開發與驗證流程 (Workflow & Validation)

開發新功能時依循 L2 規格驅動流程：

1. **規格對齊**：讀取對應的 PRD、Schema 或需求 Markdown。規格不完整時觸發「需求釐清」原則。
2. **計畫擬定**：撰寫程式碼前，先列出實作步驟（Step-by-step Plan）與預計修改的檔案清單。
3. **程式碼生成**：依計畫生成，符合本文件的技術定義與架構守則。
4. **測試與驗證**：為核心邏輯產出對應單元測試（Unit Test）或測試情境描述，確保行為與規格一致。

執行守則：
- **一次只做一件事**：一個 PR / commit 只解一個 bug 或一個 feature。
- **最小改動**：既有專案禁止大重構（除非使用者明確同意）。
- **每次改動可驗證**：提供 lint / typecheck / 測試或手動驗證清單。
- **即時性功能需驗證連線**：WebSocket / 即時刷新類功能完成後，需實際確認連線有被觸發（瀏覽器 Network 分頁或連線 log），不能只憑程式碼合理推斷就宣稱完成。
- **新增功能拆元件**：頁面 component 過長時抽出共用元件。
- **輸出格式固定**：先給變更摘要 → 再給檔案清單 → 最後給驗證方式。
