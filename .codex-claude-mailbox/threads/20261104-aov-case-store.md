---
id: "20261104-aov-case-store"
title: "AoV 管理系統：案例庫、淘汰與合併（三批）"
status: "in_progress"
owner: "claude"
reviewer: "claude"
priority: "normal"
created_by: "claude"
created_at: "2026-11-04"
updated_at: "2026-11-04"
role_priority:
  implementation: "codex (批一) / claude (批二、批三、審閱、git)"
  review: "claude"
  tests: "codex / claude"
  requirements: "user"
artifacts:
  - path: "docs/aov-case-store.md"
    type: "file"
  - path: "docs/decision-log.md"
    type: "file"
---

# Goal

依 `docs/aov-case-store.md`（D175 至 D179）做 AoV 管理系統：保留已驗證流程的歷次版本與修改原因、淘汰舊 node 與 node 組合、合併功能重複的 node。分支 `feature/aov-case-store`。三批全部完成後才向 user 回報。

# 批次

| 批 | 內容 | 負責 | 預計完成 |
|---|---|---|---|
| 一 | `libs/case-store/` 儲存層、migration、觸發器、測試 | Codex | 2026-11-05 12:00 |
| 二 | 本機 Node 服務 API（伺服器端自跑驗證與模擬）、備份匯出匯入、連線驗證 | Claude | 批一審閱後 1 日 |
| 三 | 管理畫面：歷史時間軸、淘汰、合併、修改原因 | 視批二後再定 | 另訂 |

到期未完成由 Claude 接手（先確認 Codex 已停止再改檔）。

# 批一 Handoff（Codex）

cwd 必須是專案根目錄。Codex 只寫程式與測試，不執行 git、不連網、不裝依賴、不啟動伺服器。契約唯一來源是 `docs/aov-case-store.md`，有不明處或與現有程式衝突就停工並寫進 Codex Notes，不自行裁決。

檔案範圍（只能動這些）：新增 `libs/case-store/`（含測試與舊版資料庫 fixture 的產生方式）。不得修改 `libs/aov-integration/`、`schemas/`、`config/`、`apps/`；需要的函式只能從 `libs/aov-integration` 匯入。

工作：
1. 依第 3 節建立資料表、觸發器、`schema_meta` 與 migration 機制（第一版 = 版本 1；測試用的「較舊版本」可在測試內以 SQL 自行建出，並在測試中模擬一個 v1 到 v2 的虛構 migration 以驗證機制，不要把虛構欄位帶進正式 schema）。
2. 依第 4 節實作 `saveVersion` 的四項檢查與錯誤碼。
3. 依第 5 節實作全部函式，型別明確、不得用 `any`。使用 `node:sqlite`；測試檔需 `// @vitest-environment node`。
4. 依第 6 節每一列寫至少一個測試，且每個測試必須在對應規則被拿掉時會失敗（規則 9）。
5. 在 `libs/case-store/README.md` 寫已知限制（第 7 節）與用法，不得宣稱未涵蓋的能力。

停止條件：需要新增依賴；`node:sqlite` 的行為與契約衝突；需要修改範圍外的檔案；`validateAovBundle` 無法以所需方式呼叫。

驗收（Codex 須在 Notes 如實列出）：`npm.cmd run typecheck`、`npm.cmd test` 結果與數字；跳過或失敗的項目與原因（已知沙箱 security CLI 的 EPERM 照實寫）。

# 批三 Handoff（Codex）

**預計完成時間：2026-11-05 12:00。** 到期未完成由 Claude 接手（先確認 Codex 已停止）。cwd 為專案根目錄；Codex 只寫程式與測試，不執行 git、不連網、不裝依賴、不啟動伺服器或瀏覽器。規格唯一來源：`DESIGN.md` 最後一節「案例庫頁」、`services/case-store/README.md`（路由與回應）、D181；有不明處或衝突就停工並寫進 Codex Notes，不自行裁決。

可動的檔案：新增 `apps/composer-gui/src/caseStoreClient.ts`、`CaseLibraryPage.tsx` 與其測試；修改 `AppShell.tsx`（`PageId`、`pages`）、`App.tsx`（接線）、`WorkflowCanvas.tsx`（工具箱停用已淘汰動作，改動要最小）、`Icons.tsx`（若需要一個新圖示，手寫 SVG）、`style.css`。不得動 `libs/`、`services/`、`vite.config.ts`、`DESIGN.md`、`schemas/`、`config/`。

工作：
1. `caseStoreClient.ts`：以可注入的 `Fetcher`（型別沿用 `previewBackend.ts`）包裝服務，基底路徑 `/case-store-api`（同源，不寫死埠）；每個方法回傳 `{ ok: true, value } | { ok: false, errors }`，網路失敗與非 JSON 回應也要變成可顯示的錯誤，不丟例外、不吞錯。連線探測要驗證回應本體是陣列，不能只看狀態碼（Vite 對不存在路徑可能回 HTML）。型別明確，不得用 `any`，包含測試檔。
2. `CaseLibraryPage.tsx`：照 DESIGN.md 該節實作全部項目（案例清單與建立、版本時間軸、保存新版本、下載、節點與組合管理、淘汰前的引用查詢、服務未啟動的說明）。UI state、服務資料與衍生資料分開管理；`aria` 與鍵盤、44px、狀態文字依 DESIGN.md。動作清單來自 `config/actions.json`（用 `libs/ui-runtime/registry` 既有的 `parseActionCatalog`），不要另抄一份。使用者可編輯的文字一律以純文字節點呈現。
3. 工具箱：App 取得現況後傳給 `WorkflowCanvas`，淘汰與合併的動作停用「加入到畫布」並標示原因；服務連不上時工具箱行為與現在完全相同（既有測試不得改動預期）。
4. 測試（規則 9）：每個行為至少一個測試，且在規則被拿掉時會失敗，例如：服務連不上顯示說明而不是空清單；原因空白時淘汰與保存按鈕停用；驗證未通過時顯示逐條原因且不顯示成功；過期版本顯示重新載入；已合併的節點沒有操作按鈕；淘汰前顯示引用數；工具箱在已淘汰時停用而在服務離線時不停用；頁面沒有任何編輯或刪除已保存版本的控制項。

停止條件：需要新增依賴；需要改動範圍外檔案；服務回應與 README 不符；既有測試需要修改預期才能通過。

驗收（如實列出）：`npm.cmd run typecheck`、`npm.cmd test` 的實際數字；跳過與失敗項目及原因（沙箱 EPERM 照寫，不要宣稱通過）。瀏覽器實測由 Claude 做，Codex 不要宣稱已目視確認。

# Codex Notes
## 2026-11-04：批三進度（用量重置後續作）

已完成並存在：caseStoreClient.ts、CaseLibraryPage.tsx，以及 App.tsx、AppShell.tsx、WorkflowCanvas.tsx、style.css 的導覽、資料接線與工具箱停用改動。上一輪 npm.cmd run typecheck 退出碼 0；尚不可據此宣稱批三完成。

未完成：用戶端與管理頁測試、案例切換的舊回應隔離測試、工具箱所有新增路徑與離線相容測試、三項關鍵規則的變異驗證、最終 typecheck 與 npm.cmd test、最終檔案清單與索引更新。將先讀現有實作再補，不重寫已完成部分；每完成一大項更新本節後續紀錄。預計完成時間 2026-11-05 12:00。未啟動伺服器或瀏覽器，未目視確認。


### 批三進度：新增測試完成（2026-11-04 18:26）

已新增 caseStoreClient.test.ts 與 CaseLibraryPage.test.tsx，包含用戶端路由／回應驗證、離線與重新連線、案例建立、版本時間軸與下載、保存限制與驗證失敗／過期、引用數與淘汰／啟用／合併／有序組合、案例切換舊回應隔離、延遲讀檔不誤存、工具箱按鈕／拖放／範本／建議入口、既有節點保留及 App 離線恢復。未改既有測試預期。

實際檢查：npm.cmd run typecheck 退出碼 0（兩組 tsc，0 型別錯誤）；npm.cmd exec --offline -- vitest run --configLoader native src/caseStoreClient.test.ts src/CaseLibraryPage.test.tsx 退出碼 0，2 檔通過、59 項通過、0 失敗、0 跳過。尚待三項變異驗證、完整 npm.cmd test 與最終交接；沒有目視驗證。

### 批三進度：三項變異驗證完成（2026-11-04 18:27）

逐項暫時移除規則、執行單項測試，再以 finally 還原原始位元組；三次還原比對均為 True。

| 規則 | 移除後實際結果 | 檢出證據 |
|---|---|---|
| 用戶端成功回應格式驗證 | exit 1；1 失敗、29 因名稱篩選跳過 | 原本應拒絕的物件回應變成 ok: true，probe rejects 測試失敗 |
| 舊請求回應隔離（current 檢查） | exit 1；1 失敗、28 因名稱篩選跳過 | 舊案例離線回應把新案例畫面換成離線區塊，case switch ignores stale list 測試失敗 |
| 新增動作共同入口的淘汰檢查 | exit 1；1 失敗、28 因名稱篩選跳過 | 偽造拖放觸發 onChange 並新增已淘汰節點，forged drop 測試失敗 |

合計 3/3 變異被測試抓到；以上失敗是刻意移除規則造成，不是還原後正式程式的測試結果。尚待還原後完整 npm.cmd test 與最終 typecheck。

### 批三進度與停工交接：完整測試發現既有規則衝突（2026-11-04 18:29）

批三尚未完成驗收。依 Handoff「既有測試需要修改預期才能通過」與 user「遇規格不明、衝突……就停工」停止程式修改；未修改任何既有測試預期，沒有為避開測試而改用其他傳輸方式或隱藏第六個導覽項。以下一次列出本輪已發現的全部問題。

#### 待裁決與修復清單

1. **導覽需求與既有預期衝突（owner: user）**：DESIGN.md／D181 要求「案例庫」為第六個導覽項、位於流程之後；shell.test.tsx:14 卻精確要求只有「首頁、流程、資料集、執行記錄、系統設定」五項。需要需求方決定如何更新既有驗收基準；目前禁止修改預期，不能自行裁決。
2. **現況查詢與既有請求預期衝突（owner: user）**：App 依 Handoff 取得現況，會發出同源 GET /case-store-api/lifecycle；localData.test.tsx:49、output.test.tsx:109 與 :226 均只排除 /preview-api/healthz，要求其他 fetch 呼叫為空。本輪三項因此失敗（各看見 2 次 lifecycle GET）。這些 GET 沒有帶樣本資料，但既有斷言禁止該請求；需明確裁決現況探測是否為允許的讀取並更新相應驗收基準，或另定探測時機。未修改這三項測試、未自行規避 fetch 偵測。
3. **工具卡片 DOM 回歸（實作待修，不需放寬既有測試）**：WorkflowCanvas.test.tsx:169 要求 h4 後緊接圖示按鈕，且按鈕是最後一個子元素；本批為顯示停用原因增加 div 包住 h4，離線時也改了 DOM，造成失敗。可在允許範圍內恢復原本 h4 與按鈕相鄰結構，將原因放在 h4 之前或保持離線原結構；因上述停止條件已觸發，本輪未繼續改程式。此項不能歸因沙箱。
4. **security CLI 沙箱失敗**：security.test.mjs:128 的簽章步驟讀取暫存 signing-private-key.pem 得到 EPERM，exit 1；afterAll :107 清理暫存目錄也 EPERM。實際路徑 C:\Users\gslab\AppData\Local\Temp\composer-security-ZkmwtP。未繞過權限、未改 security 程式；暫存清理未完成，需外部環境處理。
5. **evaluator 打包沙箱失敗**：beforeAll 的 esbuild 無法讀取 ../..（Access is denied），且無法解析 ./services/evaluator/src/main.ts；該套件失敗，四項程序測試未執行。未修改 evaluator 或 build 設定。

#### 實際驗證數字

| 指令／檢查 | 結果 |
|---|---|
| 新增兩檔定向 Vitest | exit 0；2 檔通過；59 通過、0 失敗、0 跳過（client 30、頁面／工具箱／App 29） |
| 三項關鍵規則變異 | 3/3 被抓到；每次測試 exit 1、1 項預期失敗，其他 29／28／28 項因名稱篩選跳過；三次均逐位元組還原成功 |
| 變異還原後 npm.cmd run typecheck | exit 0；兩組 tsc 通過、0 型別錯誤 |
| 變異還原後根目錄 npm.cmd test | exit 1；Vitest：45 檔通過、6 檔失敗（共 51）；696 項通過、6 項失敗、5 項跳過（共 707）；另列 2 個 suite hook 失敗（evaluator beforeAll、security afterAll） |
| 新增檔案靜態檢查 | caseStoreClient.ts、CaseLibraryPage.tsx 與兩個測試檔無 any、dangerouslySetInnerHTML、innerHTML；rg 無命中退出碼 1，非檢查失敗 |

完整 Vitest 的 6 項測試失敗：shell 導覽 1、localData 請求斷言 1、output 請求斷言 2、WorkflowCanvas DOM 1、security CLI 1。新增 59 項在完整測試中亦通過。

5 項跳過／未執行：
- App.test.tsx 原有 1 項「未涵蓋：以 User 身分修改 MIS 項目由授權邊界拒絕（尚無身分機制）」是明確 test.skip。
- evaluator 因 beforeAll 失敗，4 項未執行：「打包兩次位元組相同，且不含建置機的絕對路徑」、「經標準輸入輸出逐行回應；stdout 只有回應，結果與直接呼叫相同」、「過大的請求被拒絕且之後的請求仍正常處理」、「標準輸入關閉就結束」。Vitest 本次將它們列為 skipped。
- 根目錄 test 以 && 串接，Vitest exit 1 後，preview 的 Node tests、libs/case-store tests、services/case-store tests 均未執行；本輪未另補跑，不把以往通過數字當成本次結果。

#### 檔案清單與工作樹狀態

本次續作實際新增：
- apps/composer-gui/src/caseStoreClient.test.ts
- apps/composer-gui/src/CaseLibraryPage.test.tsx

本批前輪已存在、這輪只讀及暫時變異後完整還原：
- apps/composer-gui/src/caseStoreClient.ts
- apps/composer-gui/src/CaseLibraryPage.tsx
- apps/composer-gui/src/WorkflowCanvas.tsx

本批前輪已完成接線、這輪未更動：
- apps/composer-gui/src/App.tsx
- apps/composer-gui/src/AppShell.tsx
- apps/composer-gui/src/style.css

進度與停工紀錄：
- .codex-claude-mailbox/threads/20261104-aov-case-store.md
- .codex-claude-mailbox/index.md

Icons.tsx 未需修改。未改 libs、services、vite.config.ts、DESIGN.md、schemas、config 或既有測試。未執行 git、未連網、未新增依賴、未啟動伺服器或瀏覽器；分支未以 git 驗證，沒有目視確認。預計完成時間仍為 2026-11-05 12:00，須先解除導覽／現況查詢與既有測試預期的衝突，再修復 DOM 回歸並重跑完整驗證。狀態保留 in_progress，不宣稱全部完成。
## 2026-11-04：批三契約核對停工，尚未實作

已完整閱讀批三 Handoff、DESIGN.md（含案例庫頁）、services/case-store/README.md、D175 至 D181 與 CLAUDE.md。依 user 與 Handoff「有不明處或衝突就停工並寫進 Codex Notes，不自行裁決」停止於契約核對階段。

待釐清事項（owner: user）：D181 第 6 項要求 GET /lifecycle；services/case-store/src/handler.ts 已呼叫 store.listLifecycle()，但 Handoff 指定作為「路由與回應」來源的 services/case-store/README.md 未列出此路由，也沒有其成功回應欄位契約。批三需要該回應顯示節點與組合現況、替代者及原因，並控制工具箱停用。請先補齊 README 的路由與回應契約，或明確指定可依現有 listLifecycle 型別與實作作為契約；本次不自行裁決。README 位於禁止修改的 services/，未更動。

已確認 vite.config.ts 存在 /case-store-api 同源轉送，這部分沒有缺口；未更動設定。未新增或修改應用程式及測試，既有測試預期未動。

驗證實際紀錄：
- npm.cmd run typecheck：未執行，0 次；因規格釐清停工，無本次通過或失敗數字。
- npm.cmd test：未執行，0 次；執行測試 0 項，無本次通過、失敗或測試框架跳過數字。整項驗證未進行的原因為上述停工條件；未將先前 security CLI EPERM 當成本次結果。
- 新增行為測試與規則移除驗證：未執行，尚無實作。
- 未執行 git、未連網、未新增依賴、未啟動伺服器或瀏覽器、未目視確認。分支僅沿用 user 提供資訊，未以 git 核對。

本次變更檔案僅有：
- .codex-claude-mailbox/threads/20261104-aov-case-store.md
- .codex-claude-mailbox/index.md

批三未完成；預計完成時間仍記為 2026-11-05 12:00，待上述契約釐清後再續作。


## 2026-11-04：契約核對後停工，尚未實作

已完整閱讀 `docs/aov-case-store.md`、本 thread 與 `docs/decision-log.md`（含 D175 至 D179）。依 user 與批一 Handoff「有不明處或與現有程式衝突就停工」要求，以下問題未裁決前不新增程式或測試：

1. **父版本輸入與並行衝突的判準未定。** 契約 §4.4 要求檢查 `parent_version`，且並行存同一案例時一方須得到 `E-VERSION-CONFLICT`；但 §5 的 `saveVersion({ caseId, content, verifiedReport, changeReason, author })` 沒有父版本或預期版本參數。§3.3 只規定父版本指向同案例既有版本，未規定由誰選定、是否必須為最新版。需明訂父版本來源，以及並行衝突是依呼叫者預期版本、交易快照或鎖競爭判定；不能自行新增參數或採自動選最新版。
2. **合併後的狀態檢查順序需明訂。** §4.3 要求「比對前先把 node 的 actionId 以別名解析到終點」，但 §6 與 D178 又要求以舊 id 儲存必須拒絕並指出保留方。若只檢查解析終點，原 id 的 merged 狀態會消失。需確認是否同時檢查原 id 的 merged 狀態與終點的淘汰狀態，以及組合兩端是否也要解析別名；未自行選定處理方式。

驗證紀錄：
- `npm.cmd run typecheck`：未執行（0 次）；契約核對階段即停工，無本批程式可驗證，無通過／失敗數字。
- `npm.cmd test`：未執行（0 次）；同上，測試案例執行 0 項，沒有可回報的通過／失敗數字。未將 security CLI EPERM 當成本次實測結果。
- 第 6 節九項驗收、規則移除後測試必須失敗的驗證：全部未執行，原因為上述契約阻塞。
- 未執行 git、未連網、未安裝依賴、未啟動伺服器；分支未以 git 驗證。

本次變更檔案僅為授權的交接紀錄：
- `.codex-claude-mailbox/threads/20261104-aov-case-store.md`
- `.codex-claude-mailbox/index.md`

`libs/case-store/` 尚未新增；批一未完成，原預計完成時間 2026-11-05 12:00 保留為目標，須先釐清以上契約。請由需求方修訂唯一契約後再續工。

## 2026-11-04：批一實作與驗證交接

已重讀更新後的契約第 4、5 節。前次兩項阻塞已依 user 裁決解除：必填 `expectedParent` 在交易內與最新版本全等比較；先檢查 node 自身 merged／deprecated，通過後將內容序列與紀錄組合兩側解析別名再比對。

實作內容：
- `node:sqlite` 正式 schema v1、只追加觸發器（含防 INSERT OR REPLACE 覆蓋）、別名循環檢查、按步交易 migration；每一步重新取得版本，失敗只回復該步。
- 第 5 節全部 API 與型別；整合包沿用 `validateAovBundle`、`canonicalJson`，內容 SHA-256 與既有 `contentSha256` 同法；歷史讀取保持原文並核對雜湊。
- 儲存交易內檢查淘汰狀態與父版本、遞增版本；兩個 worker／兩條連線同時儲存的測試確認一成功一衝突，重試後版本連續。
- README 說明用法、錯誤、migration、已知限制及獨立測試入口。未新增依賴、未使用 `any`；未執行 git、未連網、未啟動伺服器。分支及 user 提供的提交雜湊未以 git 查證。

實際驗證（Node 24.15.0）：

| 指令 | 實際結果 |
|---|---|
| 根目錄 `npm.cmd run typecheck` | 退出碼 0；兩組 tsc 均通過，0 診斷錯誤 |
| `npm.cmd test --prefix libs/case-store` | 1 測試檔通過；38 通過、0 失敗、0 跳過 |
| `node libs/case-store/check-mutations.mjs` | 21／21 項規則移除被對應測試攔截，覆蓋 38／38 項測試；0 未涵蓋；原始碼恢復檢查通過，證據在 `mutation-results.json` |
| 根目錄 `npm.cmd test` | 退出碼 1；Vitest：47 檔通過、2 檔失敗；642 項通過、1 項失敗、5 項跳過（共 648） |
| 補跑 `node --test services/preview/tests/preview.test.mjs` | 退出碼 0；14 通過、0 失敗、0 跳過 |

失敗與跳過項目：
1. `security.test.mjs` 的 CLI 簽章測試失敗：讀取暫存私鑰被沙箱 EPERM 阻擋；afterAll 清理同一目錄也 EPERM，因此另列套件失敗。實際暫存路徑：`C:\Users\gslab\AppData\Local\Temp\composer-security-xLfYNC`。未修改 security 程式，也未宣稱通過；該外部暫存目錄清理未完成。
2. `evaluator.test.ts` 的「打包後的程序」beforeAll 被 esbuild 目錄存取限制擋下（`Cannot read directory "../..": Access is denied`、無法解析 `./services/evaluator/src/main.ts`）。因此四項程序測試未執行：打包可重現與路徑、逐行 stdin/stdout、過大請求後續處理、stdin 關閉退出。
3. 另一項跳過是既有 `App.test.tsx` 的 User／MIS 授權邊界測試，原本即因尚無身分機制而 skip。
4. 根指令的 `&&` 導致 preview 段未執行，已另行補跑 14／14 通過；不能據此把整個 `npm.cmd test` 記為通過。
5. 案例庫最初測試為 33 通過、1 失敗：esbuild 無法解析 worker 的絕對路徑。已移除這個測試打包步驟，改以既有 TypeScript 在 worker 內載入同一份 API，後續完整測試與變異驗證皆通過；沒有略過並行測試。

測試收集限制：根目錄 Vitest 的 root 是 `apps/composer-gui`，不會收集本目錄測試。依檔案限制未修改根設定或新增 GUI 轉接測試；必須另跑 `npm.cmd test --prefix libs/case-store`。正式服務與 UI、備份匯出匯入均未實作，留批二／三。作者與原因仍是自填，hash 不是簽章，報告是否真的驗證與模擬須由批二保證。

新增檔案清單（全部位於 `libs/case-store/`）：
- `.gitignore`
- `index.ts`
- `migrations.ts`
- `graph.ts`
- `case-store.test.ts`
- `concurrent-worker.ts`
- `worker-loader.cjs`
- `vitest.config.ts`
- `package.json`（只有本地測試 script，沒有 dependencies）
- `check-mutations.mjs`
- `mutation-results.json`
- `README.md`

另依交接要求更新本 thread 與 `.codex-claude-mailbox/index.md`。測試用 SQLite 暫存資料夾已清除；Vitest 自產 `node_modules/.vite` 快取由本目錄 `.gitignore` 排除，不列為交付原始碼。批一交 Claude 審閱與沙箱外根測試驗證；整個三批 thread 保持 in_progress，未標為全部完成。原預計完成時間為 2026-11-05 12:00。

# Claude Notes

- 2026-11-04 批一審閱：Codex 第一次依停止條件停工（契約漏了 `expectedParent` 與 merged／別名檢查順序），已由 Claude 裁決並補進契約（f283e06）。Codex 續做後自述全過；Claude 在沙箱外重驗：根目錄 typecheck 通過、`libs/case-store` 38 項通過、根目錄 `npm.cmd test` 的 Vitest 結束碼 0 且 preview 14／14 通過。Codex 回報的 security CLI 與 evaluator 失敗是沙箱 EPERM，沙箱外不再出現。逐行審閱 `index.ts`：交易、觸發器、順序與契約一致。已知限制：`scanUsage` 會逐版本解析整份內容，版本很多時成本線性成長，批二若有效能需求再加索引表；組合比對以紀錄當下的 JSON 全等，不跨別名合併同一組合的不同寫法。Claude 補：根目錄 `test` script 接上 `libs/case-store` 的測試，否則回歸時不會被跑到。批一完成，待批二。
- 2026-11-04 批二（Claude 自做，D180）：`libs/case-store/backup.ts` 加邏輯 JSON 備份匯出匯入；`services/case-store/` 為本機 HTTP 服務（純函式 handler 加 node:http 轉接、`npm run case-store` 啟動）。驗證：根目錄 typecheck 通過；`npm test` 全過（Vitest 49 檔 647 通過 1 跳過、preview 14／14、case-store 38／38、service 7／7）；實際以 esbuild 打包啟動並用 curl 打過（建立與列出案例、UTF-8 往返、外來 Origin 得 403），已停止該行程。發現並處理：Codex 夾具的 `aov` 是空殼，伺服器端 compile 正確地拒絕，測試改用 C 的通用範例專案。變異驗證：拿掉欄位白名單時原測試仍綠（SQLite 自己也會拒），故改斷言錯誤出自白名單後才能抓到。已知限制：服務測試的回應型別用了 `any`（僅測試檔，違反「不用 any」的精神，批三前補正）；驗證範圍不含瀏覽器互動模擬（D180 已明寫）。
- 2026-11-04：分支已建，D175 至 D179 與契約文件已寫入。技術選型 `node:sqlite`（D176）是 Claude 建議，user 回覆未特別提及，若有異議可改。
