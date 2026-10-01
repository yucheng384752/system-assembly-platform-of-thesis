---
id: "20261001-kit-manuals"
title: "Kit 動態操作手冊（D48–D52）"
status: "ready_for_review"
owner: "user"
reviewer: "user"
priority: "high"
created_by: "claude"
created_at: "2026-10-01"
updated_at: "2026-10-01"
role_priority:
  implementation: "codex"
  review: "claude"
  tests: "codex"
  requirements: "user"
artifacts:
  - path: "schemas/manual.schema.json"
    type: "file"
  - path: "apps/composer-gui/src/manual.ts"
    type: "file"
  - path: "manuals/kits/"
    type: "dir"
  - path: "docs/project-spec.md"
    type: "file"
---

# Goal

依 spec §11 與 D48–D52，實作 Kit 動態操作手冊：12 個 Kit 各三份片段（共 36 份）、組裝器與檢查，並在手冊齊全時把手冊放進設定交付包。分支 `feature/kit-manuals`，由 main 開出。

# User 已確認（2026-10-01）

1. 13 個 Kit 全寫（實際為 12 個，見下）。
2. 片段 `status` 為 `draft`／`reviewed`；初稿一律 `draft`，正式發佈只接受 `reviewed`（D50）。
3. User、MIS、Developer 三份都要寫，內容短也可以（例如尚無程式的 Kit）。
4. 手冊接上設定交付包（D52）。
5. 工作交給 Codex。

# Claude Handoff

## 角色分工

- Codex：寫程式、手冊與測試。
- Claude：git 寫入、依賴安裝、瀏覽器驗證、審閱。
- Codex 沙箱不能寫 `.git`、沒有網路；不得新增任何依賴（需要的話停止並在 Codex Notes 提出）。
- 啟動 Codex 的 cwd 必須是專案根目錄 `C:\Users\gslab\Desktop\composer-refactor`。

## 必讀

`CLAUDE.md`、`DESIGN.md`、`docs/project-spec.md` §11、§12、§13（A13）、`docs/decision-log.md` D33、D34、D48–D52、`schemas/manual.schema.json`、`apps/composer-gui/src/deliveryPackage.ts`、`apps/composer-gui/src/OutputPage.tsx`、`apps/composer-gui/src/catalog.ts`、`apps/composer-gui/src/previewCatalog.ts`、`config/flows.json`、`config/kits/overlay.json`、`kits/BASELINE.md`。

## 範圍：12 個 Kit

Composer 目錄的 Kit（`loadKits`：基線 manifest 去掉 `tenant-auth-kit`，加入 `entry-permission-kit`）。目錄資料夾有 13 個，`tenant-auth-kit` 已廢除（D03）不寫手冊。

| Kit id | `kitVersion`（片段目錄名） |
|---|---|
| platform-core-kit、station-data-link-kit、upload-validation-kit、import-pipeline-kit、query-traceability-kit、analytics-kit、station-admin-kit、audit-edit-kit、logs-ops-kit、mod-subscription-kit、generic-forms-kit | `c4b2b7b-ui.1`（覆蓋層 `config/kits/overlay.json` 的 `version`） |
| entry-permission-kit | `0.1.0` |

版本一律從 `loadKits` 的結果讀取，不要在手冊程式裡寫死。

## 資料契約（已定，不得更動；需要改動請停止並提問）

- 片段路徑：`manuals/kits/<kitId>/<kitVersion>/<role>.md`，`role` 為 `user`、`mis`、`developer`。
- frontmatter（`schemas/manual.schema.json`）：`kitId`、`kitVersion`、`role`、`status`、`sources`。受限語法：第一行 `---`，之後為 `key: value`，`sources:` 後接多行 `  - kits/...`，以 `---` 結束；不引入 YAML 套件，自寫小型解析器，語法以外一律報錯。
- 正文必備六個二級標題，名稱與順序固定：`## 用途`、`## 前置條件`、`## 可設定項目`、`## 操作步驟`、`## 輸入輸出`、`## 常見錯誤與復原`。
- `kitId`、`kitVersion`、`role` 必須與路徑一致。

## 工作包

### WP1 契約註冊

- 在 `libs/ui-runtime/schema.ts` 註冊 `manual` schema（比照 `packageManifest`）。
- 測試：契約的正反例（缺欄位、未知欄位、`status` 非法、`sources` 空陣列或重複、路徑不在 `kits/` 下）。

### WP2 組裝器與檢查（`apps/composer-gui/src/manual.ts`）

純函式，不碰 DOM、不發網路請求。

1. `parseFragment(text)`：回傳 `{ meta, body }`；frontmatter 錯誤、六節缺漏或順序不對時丟出錯誤，訊息指出缺哪一節。
2. `loadFragments()`：以 `import.meta.glob('../../../manuals/kits/*/*/*.md', { query: '?raw', import: 'default', eager: true })` 載入並解析，鍵為路徑；單元測試可傳入替代的片段集合。
3. `checkManuals({ kits, enabledKits, fragments, mode })`：對每個已啟用的 Kit 與每個角色檢查，回傳問題清單，每項含 `kitId`、`role`、`path`、`reason`：缺片段、`kitVersion` 與 Kit 目錄版本不符、`kitId`／`role` 與路徑不符、frontmatter 或章節錯誤。`mode: 'release'` 時 `status` 不是 `reviewed` 也列為問題；`mode: 'package'` 時 `draft` 不算問題。
4. `assembleManual({ role, kits, enabledKits, selectedSubfeatures, flows, selectedFlows, fragments, catalog, overrides })`：產生 Markdown。
   - 只含已啟用的 Kit，依 `dependencies` 做拓撲排序（相依者在前，同層維持目錄順序）；循環時丟出錯誤並列出路徑。
   - 每個 Kit 一章：Kit 顯示名稱、版本、片段正文；其後附自動產生的「設定項目一覽」表，來源是 `catalog`（`previewCatalog`）中已選子功能的選項，欄位為名稱、可修改角色（`allowed_roles`）、風險（`risk`）、變更層級（`change_level`）、預設值。只列該角色有權修改的項目；沒有項目時寫「此角色沒有可修改的設定項目」。
   - 開頭「跨功能操作路徑」：依所選流程（`selectedFlows`）列出流程名稱與 `pages`，並說明所含的 Kit；不是單純串接。
   - 最前面標示：產生依據（Kit 與版本清單）；若任何片段為 `draft`，加上一行「本手冊含草稿內容，尚未經審閱」。
   - 不讀、不輸出連線設定或秘密值；輸出只可來自片段與選項定義。
5. 測試（Rule 9：測試要寫出原因）：
   - 只含已啟用 Kit 的內容（A13）：未啟用的 Kit 名稱不得出現。
   - 排序遵守相依，循環時報錯。
   - 設定項目表只列該角色可修改者；User 手冊不得出現 `allowed_roles` 不含 User 的項目。
   - 缺片段、版本不符、缺章節、`release` 下的 `draft` 都被列出，且訊息含 Kit、角色與路徑。
   - 含哨兵字串的連線設定（如 `password`）不會出現在輸出。
   - 突變檢查：拿掉相依排序、拿掉角色過濾、拿掉版本比對，對應測試必須失敗。

### WP3 手冊內容（12 個 Kit × 3 角色 = 36 份）

依下列順序分四批提交給 Claude 審閱，每批完成就跑 `checkManuals` 的測試（見 WP5）：

1. platform-core-kit、entry-permission-kit、station-data-link-kit
2. upload-validation-kit、import-pipeline-kit、query-traceability-kit
3. analytics-kit、generic-forms-kit、station-admin-kit
4. audit-edit-kit、logs-ops-kit、mod-subscription-kit

撰寫規則：

- 事實來源只有：Kit 的 `manifest.json`、`kit.contract.json`、`src/` 原始碼、`kits/form-analysis.kit-manifest.json`（子功能）、`config/ui/previews.json` 與 `previewCatalog.ts`（設定項目）、`config/kits/overlay.json`（顯示名稱）。檔案多為 UTF-8 含 BOM。
- 每個陳述都要能在 `sources` 列出的檔案找到依據；`sources` 只列真正用到的檔案，路徑為 `kits/...`。
- 查不到、程式沒有、或無法確認的內容寫「尚未提供」，不得推測、不得套用其他 Kit 的行為。
- `entry-permission-kit`：目前只有 `.gitkeep`、沒有子功能，覆蓋層註明僅提供功能設定、尚未接上實際驗證。三份手冊只寫這個現況與其影響（例如不得把它當成已啟用的權限控制），`sources` 列 `kits/entry-permission-kit/.gitkeep`（證明沒有程式）與 `kits/BASELINE.md`；此 Kit 在 `kits/form-analysis.kit-manifest.json` 中不存在，不要列入。
- 三個角色的差異：
  - User：做什麼、怎麼操作、看到什麼，不出現程式、資料表或框架名稱（與 Composer GUI 同一語言規則，DESIGN.md「Voice & copy」）。
  - MIS：安裝與設定前置、可設定項目與風險、依賴的其他 Kit、日誌與常見錯誤的處理。
  - Developer：capability 與 API（`kit.contract.json`）、模型、服務、路由、與其他 Kit 的介面、如何擴充或測試。
- 繁體中文，不使用 emoji；技術識別碼放在「進階」或 Developer 手冊。
- `status` 一律 `draft`。不得寫成 `reviewed`。
- 不修改 `kits/` 底下任何檔案。

### WP4 接上設定交付包

1. `schemas/package-manifest.schema.json`：產物 `role` 新增 `manual`；`artifacts` 數量改為 4 到 7；路徑模式須允許 `docs/manual-user.md`（現有 `path` 定義已允許子目錄，確認即可）。
2. `deliveryPackage.ts`：
   - `buildDeliveryPackage` 取得手冊所需的輸入（已啟用 Kit、子功能、流程選擇、選項覆寫）；呼叫 `checkManuals(mode: 'package')`。
   - 無問題：加入 `docs/manual-user.md`、`docs/manual-mis.md`、`docs/manual-developer.md`（role `manual`），並從 `notProvided` 移除 `docs/`；`README.md` 的包含清單同步。
   - 有問題：維持 `notProvided` 的 `docs/`，`reason` 列出缺少手冊的 Kit 與角色；不阻擋交付包（D34）。
   - 驗證報告 `staticChecks` 新增一項手冊檢查的結果；有草稿時在說明中註明。
3. `OutputPage.tsx` 與 `DESIGN.md`：在「設定交付包」區塊顯示手冊狀態（齊全或缺少哪些 Kit，皆以文字表示，不只靠顏色），遵守 DESIGN.md 的元件規則與 44px 目標。
4. 測試：手冊齊全時交付包含三份手冊且各自 SHA-256 與 manifest 相符；缺一份時 `docs/` 仍為未提供並指名缺少的 Kit；`draft` 不阻擋；現有 `deliveryPackage.test.ts` 與 `output.test.tsx` 的斷言依新行為更新，並說明為何改。

### WP5 驗證

- 一個測試走遍 36 份片段：全部通過 `parseFragment`，路徑、`kitId`、`kitVersion`、`role` 一致，`status` 皆為 `draft`，`sources` 的檔案皆存在（不是真的讀內容，而是確認路徑存在）。
- 一個測試以 Composer 目錄的全部 12 個 Kit 啟用，`checkManuals(mode: 'package')` 回傳空清單；`mode: 'release'` 回傳 36 項「尚未審閱」。
- `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build` 通過；`npm.cmd run test:kits` 不受影響。

## 停止條件

- 需要新增依賴、修改 `kits/` 原始碼、變更資料契約，或對事實來源有疑義時，停止並寫入 Codex Notes 與 Open Questions。
- 同一問題三次對答仍未解，停止並條列假設（CLAUDE.md）。

## 回報格式

完成每個 WP 後，在本檔「Codex Notes」依序寫：變更摘要、檔案清單、驗證方式與結果、未涵蓋項目。建議的提交訊息一併寫入，由 Claude 提交。

# Codex Notes

## WP1 契約註冊（完成）

- 變更摘要：以既有 Ajv 註冊 manual；未修改手冊契約。
- 檔案：libs/ui-runtime/schema.ts、apps/composer-gui/src/manualSchema.test.ts、本 thread。
- 驗證：npm.cmd test -- apps/composer-gui/src/manualSchema.test.ts：2 passed、0 skipped。
- 未涵蓋：組裝器及內容驗證屬後續 WP；完整 typecheck、build 與回歸留至 WP5。
- 建議提交訊息：feat(manuals): register fragment schema and contract checks


## WP2 組裝器與檢查（完成）

- 變更摘要：受限 frontmatter／六節解析、保留錯誤的片段載入、package/release 檢查、依相依層級與目錄順序組裝、流程頁面與角色設定表；不讀覆寫值、連線或資料列。
- 檔案：apps/composer-gui/src/manual.ts、apps/composer-gui/src/manual.test.ts、本 thread。
- 驗證：npm.cmd test -- apps/composer-gui/src/manual.test.ts：6 passed、0 skipped；npm.cmd run typecheck：通過。初次 typecheck 發現測試集合缺索引型別，已補 Fragments 並重跑通過。
- 突變檢查：逐一暫時移除排序、角色篩選、版本比對；相同測試命令每次均 1 failed、5 passed、0 skipped，分別命中對應斷言；已還原並重跑 6 passed。
- 未涵蓋：正式身分授權不是本功能範圍；真實手冊與交付包待 WP3／WP4。
- 建議提交訊息：feat(manuals): parse validate and assemble role manuals
## WP3 第一批（完成，供 Claude 審閱）

- 變更摘要：系統基本功能、入口與使用權限、站點資料串聯各三份 draft；未實作內容明列尚未提供。
- 檔案：manuals/kits/{platform-core-kit,entry-permission-kit,station-data-link-kit}/<目錄版本>/{user,mis,developer}.md（9 份）；apps/composer-gui/src/manualFiles.test.ts；本 thread。
- 驗證：npm.cmd test -- apps/composer-gui/src/manualFiles.test.ts -t 'manual batch 1'：1 passed、4 skipped（後續批次與全量檢查因名稱篩選未執行）；9 份均解析、版本／角色／來源存在檢查通過。
- 未涵蓋：沒有執行基線業務服務或確認現場操作；內容仍待人員審閱。
- 建議提交訊息：docs(manuals): add core permission and station link drafts
## WP3 第二批受阻；WP4／WP5 未完成

- 停止依據：Claude Handoff「對事實來源有疑義時，停止並寫入 Codex Notes 與 Open Questions」。未修改 Kit 或任何既定資料契約。
- 來源疑義：kits/query-traceability-kit/kit.contract.json:5 宣告 query.records.search 為 GET /api/v2/query/records；src/frontend/src/pages/QueryPage.tsx:49–51 使用 /api/v2/query/lot/{lot_no} 與 /api/v2/query/trace/{lot_no}；src/backend/app/api/routes_query_v2.py 實作 /lot/{lot_no} 與 /trace/{lot_no}。搜尋本 Kit 與總 manifest，未找到 GET /api/v2/query/records 的實作。不能自行認定宣告與目前操作介面等價。
- 問題：手冊可否明確分列「契約宣告」及「目前原始碼實作」，將 /records 標為尚未提供可核對實作，User 操作依目前 QueryPage 撰寫？或者需先由 Claude 修正來源後再續作？
- 完成範圍：WP1、WP2；WP3 僅第一批 9/36 份。第二批僅讀取來源，尚未建立片段。WP4 未開始；WP5 已建立供分批使用的檢查檔，但全量驗收未通過。
- 目前完整檔案清單：libs/ui-runtime/schema.ts；apps/composer-gui/src/manual.ts、manualSchema.test.ts、manual.test.ts、manualFiles.test.ts；manuals/kits/platform-core-kit/c4b2b7b-ui.1/{user,mis,developer}.md；manuals/kits/entry-permission-kit/0.1.0/{user,mis,developer}.md；manuals/kits/station-data-link-kit/c4b2b7b-ui.1/{user,mis,developer}.md；本 thread 與 .codex-claude-mailbox/index.md。
- 驗證：npm.cmd run typecheck：通過（exit 0）；npm.cmd run build：通過（exit 0）。此 build 尚未接入手冊交付功能。
- 驗證：npm.cmd test：63 passed、5 failed、1 skipped；18 個測試檔中 16 passed、2 failed。4 項失敗為第二至四批及 36 份完整性檢查，因尚缺 27 份；另 1 項既有 security CLI 測試在讀取暫存私鑰時 EPERM，afterAll 清除同一暫存目錄亦 EPERM。未改動安全測試或繞過檢查。既有 1 skipped 為身分授權測試。
- 驗證：npm.cmd run test:kits：exit 1，虛擬環境找不到 C:/Users/gslab/AppData/Local/Programs/Python/Python313/python.exe；測試未啟動，0 passed、0 skipped（無收集結果），不能宣稱保持綠燈。依不得新增依賴規則未修復環境。
- 未涵蓋：其餘 27 份手冊、交付包／輸出頁接線、完整手冊驗收；真實瀏覽器與基線業務操作驗證。安全測試的暫存目錄清除失敗需 Claude 處理，路徑 C:/Users/gslab/AppData/Local/Temp/composer-security-PF193P；未讀取或輸出私鑰內容。
- 建議提交訊息：docs(mailbox): record manual source conflict and blocked verification
- 交回 Claude：status 設為 ready_for_claude；其餘 frontmatter 保持原值。沒有執行 git 寫入、新增依賴或修改 kits/。
## WP3 第二批續作（完成，D53）

- 變更摘要：新增上傳驗證、匯入、查詢追溯的三角色 draft，共 9 份；依目前來源描述操作，另列契約宣告與尚未提供的實作。
- 檔案：manuals/kits/{upload-validation-kit,import-pipeline-kit,query-traceability-kit}/c4b2b7b-ui.1/{user,mis,developer}.md；本 thread。
- 驗證：npm.cmd test -- apps/composer-gui/src/manualFiles.test.ts -t 'manual batch 2'：1 passed、4 skipped（名稱篩選）；本批 9 份解析、路徑版本、draft 與來源存在檢查通過。
- 來源衝突／待清理清單：query-traceability-kit 宣告 /records，原始碼為 /lot 與 /trace；consumes 宣告資料 capability，但目前路由直接查詢模型；追溯只按批號匹配，未讀 keyMappings。upload-validation-kit 宣告的上傳／轉換 API 在副本只有樣式、無可核對路由；import-pipeline-kit 宣告的工作 API 尚無可核對路由，現有來源為追溯模型與 orchestrator。以上均依 D53 分列，未修改 kits/。
- 未涵蓋：基線服務啟動、現場操作及人工內容審閱；不把宣告視為已實作。
- 建議提交訊息：docs(manuals): add upload import and query role drafts
## WP3 第三批（完成，D53）

- 變更摘要：新增分析、通用表單、站點管理三角色 draft，共 9 份；明列統計上限、實際上傳入口與未知操作。
- 檔案：manuals/kits/{analytics-kit,generic-forms-kit,station-admin-kit}/c4b2b7b-ui.1/{user,mis,developer}.md；本 thread。
- 驗證：npm.cmd test -- apps/composer-gui/src/manualFiles.test.ts -t 'manual batch 3'：1 passed、4 skipped（名稱篩選）；9 份片段檢查通過。
- 來源衝突／待清理清單續：generic-forms-kit 原始碼有表單寫入、匯入及 dataflow links，contract 僅列兩個讀取 API；manifest.runtimeEnv 為空但原始碼讀取 GENERIC_FORMS_ASYNC_THRESHOLD_MB；資料 capability adapter 未在此 Kit 提供。station-admin-kit 宣告 GET /api/stations，但副本只有樣式、無可核對路由。analytics-kit 三個宣告路由與來源相符；記錄畫面摘要只讀每表 200 筆、數值趨勢最多 5000 筆的限制，未宣稱全量。
- 未涵蓋：現場執行、資料復原演練與人工內容審閱。
- 建議提交訊息：docs(manuals): add analytics forms and station admin drafts
## WP3 第四批（完成；四批共 36 份 draft）

- 變更摘要：新增稽核修正、日誌維運、訂閱串接各三角色手冊；描述實際操作、限制及未提供項目。
- 檔案：manuals/kits/{audit-edit-kit,logs-ops-kit,mod-subscription-kit}/c4b2b7b-ui.1/{user,mis,developer}.md；本 thread。
- 驗證：npm.cmd test -- apps/composer-gui/src/manualFiles.test.ts -t 'manual batch 4'：1 passed、4 skipped（名稱篩選）；本批 9 份檢查通過。全量檢查留至 WP5。
- 來源衝突／待清理清單續：audit-edit-kit 實作直接匯入 generic-forms-kit 的 _coerce，未反映在 capability consumes；資料 capability adapter 未在本 Kit 提供。logs-ops-kit 的 contract 只列 /api/logs，現行使用 /api/logs/ 並有 /summary；manifest 的清理／下載未找到實作。mod-subscription-kit 宣告 /api/mod-subscription，但實作為 /api/mod/subscriptions/*；manifest 未列出三個實際讀取的環境變數；通知依外部識別查詢但模型只保證租戶內唯一，權益函式未檢查到期時間。手冊如實標示，未改基線。
- 未涵蓋：基線服務實際執行、現場復原演練；所有片段仍待人工審閱，未標 reviewed。
- 建議提交訊息：docs(manuals): add audit logs and subscription drafts
## WP4 設定交付包整合（完成）

- 變更摘要：manifest 允許 4–7 個產物與 manual role；沿用既有 path 模式。交付前使用 WP2 檢查，齊全時打包三角色 Markdown、同步 README 並移除 docs/ 未提供項；缺漏／格式錯誤時維持四個產物，列出 Kit、角色、路徑。staticChecks 新增 manuals 結果並說明草稿。
- 輸出頁：共用同一手冊狀態計算，以業務名稱及角色顯示缺漏，status 區關聯下載按鈕；沿用既有 44px 控制項，無新增依賴。將目前流程選擇及相同片段傳入交付器。
- 檔案：schemas/package-manifest.schema.json、apps/composer-gui/src/deliveryPackage.ts、OutputPage.tsx、deliveryPackage.test.ts、output.test.tsx、DESIGN.md、本 thread。
- 驗證：npm.cmd test -- apps/composer-gui/src/deliveryPackage.test.ts apps/composer-gui/src/output.test.tsx：12 passed、0 skipped；npm.cmd run typecheck：通過。
- 測試斷言更新理由：D52 已允許 docs/ 的真實手冊產物，因此原本禁止所有 docs/ 的斷言改為要求三份 manual 與各自 SHA-256／bytes；仍禁止可部署程式產物。追加缺一份、格式錯誤、草稿說明、選取流程／子功能及覆寫值不外洩的情境。畫面測試確認缺手冊仍可下載設定，且不露出 Kit 技術識別碼。
- 未涵蓋：真實瀏覽器視覺與鍵盤驗收由 Claude 執行；本次僅自動化 DOM 與既有樣式規則。未修改已提交的 WP1／WP2 或第一批手冊。
- 建議提交訊息：feat(delivery): include available role manuals and show coverage
## WP5 全量驗證與交接（實作及沙箱內驗證完成）

- 變更摘要：manualFiles.test.ts 新增一次遍歷全部實際檔案的測試，直接 parseFragment、比對路徑／目錄版本／角色、確認 draft 及 sources 存在；另一測試以 12 個 Kit 確認 package 無問題、release 恰有 36 項尚未審閱。
- 檔案：apps/composer-gui/src/manualFiles.test.ts、本 thread、.codex-claude-mailbox/index.md。WP3 新增的 27 份檔案路徑見上述分批清單，總數 36；既有 9 份不變。
- 驗證：npm.cmd test -- apps/composer-gui/src/manualFiles.test.ts：6 passed、0 skipped（包含四批檢查、36 檔遍歷及全目錄 package/release 檢查）。
- 驗證：npm.cmd run typecheck：exit 0；npm.cmd run build：exit 0，274 modules transformed。git diff --check：exit 0，無空白錯誤。
- 完整驗證：npm.cmd test：71 passed、1 skipped、1 failed（73 tests；17 test files passed、1 failed）。唯一未通過為已知 security CLI 沙箱 EPERM，afterAll 清除暫存目錄也遭 EPERM；本次沒有任何手冊、交付包或輸出頁測試失敗。1 skipped 為既有身分授權情境，未調整任何 skip 或測試環境以繞過限制。
- 沙箱外項目：依 Claude 回覆與 user 本次指示，不重試／修復 test:kits 的 Python 可見性限制；沿用 Claude 已執行的 14 passed、1 skipped 紀錄，這不是本次沙箱重跑結果。security CLI 請 Claude 以最新含手冊交付包重跑；暫存目錄 C:/Users/gslab/AppData/Local/Temp/composer-security-5ZaYPV 需由 Claude 清理，未讀取或輸出私鑰內容。
- 保護範圍：git diff 確認 kits/、package.json、package-lock.json、已提交 WP1／WP2 與第一批手冊皆無修改；無 git 寫入、無新依賴、無實際製造資料與秘密值。
- 未涵蓋：真實瀏覽器視覺／鍵盤驗證、基線業務服務與現場操作、所有 draft 的人工審閱；正式 System Package 發佈仍由 release 檢查阻擋。來源差異依 D53 保留在手冊及各批待清理清單，未修正基線程式。
- 建議提交訊息：test(manuals): verify all draft fragments and release coverage
- 狀態：WP1／WP2 沿用已提交結果；WP3／WP4 實作完成；WP5 全部要求的命令已執行，手冊驗收通過，完整綠燈需 Claude 在沙箱外確認 security CLI。thread 設為 ready_for_claude，未標示 completed。
# Open Questions

本次續作：原問題 1 已由 D53 解決；原問題 2 已確認為沙箱限制，不再要求修復 Python 或變更測試。沒有新增阻擋問題。待 Claude 執行最新 security CLI／瀏覽器驗收、清理本次暫存目錄，以及人工審閱草稿；原始問題與回覆保留如下。


1. 查詢手冊的來源衝突：契約宣告 GET /api/v2/query/records，但目前前後端使用 /lot/{lot_no} 與 /trace/{lot_no}。是否允許手冊分列契約宣告與原始碼實作、未找到者寫「尚未提供」，User 操作依 QueryPage 撰寫？或請 Claude 先修正來源？詳見 Codex Notes。
2. 請 Claude 修復本機既有 test:kits 的 Python313 虛擬環境路徑（目前測試無法啟動），並在具有權限的環境重跑 security CLI 測試及清除其殘留暫存目錄。

## Claude 回覆（2026-10-01）

- Claude 已自行驗證：`npm.cmd run typecheck` 通過；`npm.cmd test` 64 passed、4 failed、1 skipped（4 項為尚缺的 27 份手冊所致）；`npm.cmd run test:kits` 14 passed、1 skipped。Codex 回報的 security CLI 測試 EPERM 與 `test:kits` 找不到 Python，是 Codex 沙箱限制（暫存目錄不可寫、看不到使用者 Python），非程式問題；沙箱留下的暫存金鑰目錄 `composer-security-PF193P` 已由 Claude 刪除。這兩項在沙箱內無須處理，由 Claude 在沙箱外驗證。
- 抽查第一批：安裝順序 10、無相依宣告、`GET /healthz`、`entry-permission-kit` 現況皆與來源相符。
- 回答問題：可以。決策 D53：契約宣告與原始碼實作不一致時，以原始碼描述目前行為，另分列「契約宣告」並標示無可核對實作者為「尚未提供」。User 手冊依 `QueryPage` 目前使用的 `/lot/{lot_no}`、`/trace/{lot_no}` 撰寫；Developer 手冊分列契約宣告的 `GET /api/v2/query/records` 並標「尚未提供可核對實作」。不修改 `kits/`。其他 Kit 若遇到同類不一致，比照處理，並在 Codex Notes 彙整清單。
- 請繼續：WP3 第二至四批、WP4、WP5。完成後跑 `npm.cmd test`（含 36 份完整性檢查）。

## Claude 審閱與驗證（2026-10-01）

- 沙箱外驗證：`npm.cmd run typecheck` 通過；`npm.cmd test` 18 個檔案、72 passed、1 skipped；`npm.cmd run test:kits` 14 passed、1 skipped；`npm.cmd run build` 通過。Codex 回報的 1 項失敗（security CLI 暫存目錄 EPERM）是沙箱限制，沙箱外通過；殘留的暫存金鑰目錄 `composer-security-5ZaYPV` 已刪除。
- 內容抽查：Codex 列出的契約與程式不一致項目，抽查 mod-subscription、logs-ops、station-admin、audit-edit、query-traceability 皆屬實；36 份沒有 emoji、沒有標 `reviewed`、User 手冊本文沒有技術識別碼。
- 突變檢查 4 項（缺手冊仍打包、完整時仍標未提供、草稿標示失效、正式發佈接受草稿）皆被測試攔到。
- Chrome 實測 05 輸出（dev server 5173）：手冊狀態文字顯示；下載的交付包含 7 個產物，SHA-256 全部相符；手冊只含選到的 5 個功能；`installable` 仍為 false；不含樣本值；下載按鈕 44px，`aria-describedby` 關聯手冊狀態；720 寬無水平溢出。
- 未涵蓋：36 份手冊的人工審閱（皆 `draft`）；以瀏覽器產出的交付包實際跑簽章工具（簽章測試以同一個 `buildDeliveryPackage` 產出的交付包執行，包含手冊）；實體鍵盤操作；console 監聽於操作中途才啟用。
- 基線版缺口清單見 Obsidian 筆記「23 Kit 動態操作手冊」。其中權益不檢查到期時間、通知來源在未設定密鑰時不驗證，屬安全相關缺口，是否修正待 user 決定。

# Closure

待 user 審閱後決定是否合併。
