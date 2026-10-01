---
id: "20261001-site-profile"
title: "Site Profile：匯入、解析層、硬性限制與設定交付包（D54–D60）"
status: "ready_for_review"
owner: "claude"
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
  - path: "schemas/site-profile.schema.json"
    type: "file"
  - path: "libs/ui-runtime/site.ts"
    type: "file"
  - path: "docs/project-spec.md"
    type: "file"
---

# Goal

依 spec §9、§5 與 D54–D60，實作 Site Profile：匯入式 JSON、驗證、Site 解析層（含來源追溯與「由場域鎖定」）、硬性限制，並接上 Recipe 與設定交付包。分支 `feature/site-profile`，由 main 開出。

# User 已確認（2026-10-01）

1. 只做匯入 JSON，不新增編輯 GUI 步驟；一個交付包對應一個 Site Profile（D54）。
2. Site 值優先於使用者在 04 選的值，GUI 顯示「由場域鎖定」（D56）。
3. 只實作「Site 硬性限制套用到任何值」，Runtime 覆寫待可執行組裝（D57）。
4. 分析偏好暫不做；站點／設備對應 Workflow 表單暫不做（D55）。
5. 工作交給 Codex。

# Claude Handoff

## 角色分工

- Codex：寫程式、示範檔與測試。
- Claude：git 寫入、瀏覽器驗證、審閱、在沙箱外執行完整驗證。
- Codex 沙箱不能寫 `.git`、沒有網路；不得新增依賴；不得修改 `kits/`；啟動 cwd 必須是專案根目錄。
- Codex 沙箱的已知限制：`security.test.mjs` 的 CLI 測試會因暫存目錄不可寫而 EPERM、`npm.cmd run test:kits` 找不到 Python。這兩項由 Claude 在沙箱外驗證，不要嘗試繞過，也不要回報為程式失敗。

## 必讀

`CLAUDE.md`、`DESIGN.md`、`docs/project-spec.md` §5、§9、§12、§13（A02、A03、A09）、`docs/decision-log.md` D13、D29、D33、D54–D60、`schemas/site-profile.schema.json`、`libs/ui-runtime/resolve.ts`、`libs/ui-runtime/recipe.ts`、`libs/ui-runtime/schema.ts`、`libs/ui-runtime/types.ts`、`apps/composer-gui/src/App.tsx`、`FlowPage.tsx`、`SettingsEditor.tsx`、`OutputPage.tsx`、`RecipeTransfer.tsx`、`fileTransfer.ts`、`deliveryPackage.ts`、`workflow.ts`（`importAov`／`sha256Hex` 的作法）、`config/README.md`。

## 資料契約（已定；需要改動請停止並提問）

- 檔案：`composer-site-profile` version 1，契約 `schemas/site-profile.schema.json`（Claude 已寫好，已提交）。
- 欄位：`siteId`、`siteVersion`、`displayName`、`domain` 必填；`optionOverrides`、`optionLimits`（鍵為 `<kitId>::<subfeatureId>`，再以選項 id 為鍵）、`fieldSemantics`、`dataSources` 選填。
- 優先序：Kit 預設 < System（Recipe 的 `selectedSubfeatureOptions`）< Site（`optionOverrides`）。
- 限制（`optionLimits`）：`minimum`、`maximum`、`allowedValues`；套用到所有層的值（Kit 預設、Recipe、Site）；超出即報錯，訊息指出 Kit、選項與限制；不截斷。
- 別名：整份檔案內唯一；重複時報歧義並指出兩個欄位；不做單位換算；`confirmed: true` 才生效，其餘列為「待 MIS 確認」。
- 秘密值：只可引用。欄位名稱與值的型態雙重檢查，違者整份拒絕。`secretRef` 是引用名稱，必須明確放行（見 WP2）。
- Recipe：選填 `siteRef { path, sha256 }`，`path` 固定為 `site.profile.json`，`sha256` 為匯入文字（去除 BOM）的 UTF-8 位元組的 SHA-256。
- 設定交付包：`config/site/site.profile.json`，位元組與匯入文字相同，role `site-profile`。

## 工作包

### WP1 契約註冊與示範檔

- 在 `libs/ui-runtime/schema.ts` 註冊 `site`（比照 `manual`、`packageManifest`）。
- 新增兩個去識別化的示範檔 `config/site/examples/demo-site-a.site.json`、`demo-site-b.site.json`（M01：模擬資料、不含真實場域名稱）。兩者針對同一個 Kit 的同一批選項給不同的值與限制，供 A09 測試與使用者試用。選項 id 與 Kit 取自目前 `previewCatalog` 的實際內容，不得憑空編造；在 `config/README.md` 加一列說明。
- 測試：契約正反例（缺必填、未知欄位、`siteId`／`siteVersion` 格式、鍵格式、`limit` 為空物件、`secretRef` 含 `:`／`/`／`@`、別名重複的陣列項等）。

### WP2 驗證與解析（`libs/ui-runtime/site.ts`）

純函式，不碰 DOM、不發網路請求。

1. `parseSite(text, catalog)`：去除 BOM、限制 2 MB、解析 JSON、套 schema，回傳 `{ site, notices }`。額外檢查（錯誤訊息為繁體中文，指出位置）：
   - `optionOverrides`、`optionLimits` 的 Kit、子功能、選項都存在於 `catalog`；
   - Site 值符合選項自身的型別、範圍、`choices`（重用 `resolve.ts` 的 `checkValue`，需要的話只將它匯出，不改行為）；
   - 每個 `limit` 的 `minimum <= maximum`；`allowedValues` 的型別與選項一致；
   - Site 值本身符合同一選項的 `optionLimits`；
   - `fieldSemantics` 別名全域唯一（比對時去除前後空白、不分大小寫），歧義訊息列出兩個欄位名稱與該別名；id 重複也拒絕；
   - `dataSources` 的 `id` 不重複；
   - 秘密值檢查：沿用 `deliveryPackage.ts` 的 `sensitiveKeys` 概念（欄位名稱），但明確放行 `dataSources[].secretRef` 這個鍵（其他位置的 `secretRef` 或任何 `password`、`token` 等仍拒絕）；另檢查所有字串值不得像連線字串或憑證（例如含 `://` 加 `@`、`BEGIN PRIVATE KEY`、`Bearer `）。違者整份拒絕。
   - `confirmed: false` 的語意項目放入 `notices`（「待 MIS 確認：…」）。
2. `resolveKit` 新增選填輸入 `site`：依序套用 Kit 預設、`overrides`（Recipe）、Site；`provenance` 的 `source` 記錄 `kit-default`／`system`／`site`（沿用現有字串格式，先讀 `resolve.ts` 目前如何記錄，維持向後相容並更新既有測試的斷言，說明原因）。`optionLimits` 檢查每一層的有效值，錯誤訊息含 Kit、選項、限制與該值的來源層。不得改變沒有 `site` 時的既有行為。
3. `siteLockedOptions(site)`：回傳 Site 已設定值的選項集合（供 GUI 鎖定）。
4. `effectiveSemantics(site)`：只回傳 `confirmed: true` 的項目。
5. 測試（Rule 9：測試要寫出原因）：
   - A09：同一 Kit、同一 Recipe，套用示範 Site A 與 B，只有 Site 宣告的設定不同，Kit 定義物件不被修改。
   - A03 的函式層級：Recipe 的值超出 Site 限制 → 拒絕並指出選項與限制；Kit 預設值超出限制 → 拒絕；Site 值自身超出限制 → `parseSite` 拒絕。
   - 優先序與來源：同一選項在三層都有值時，有效值為 Site 的，來源為 `site`；移除 Site 後回到 `system` 或 `kit-default`。
   - 別名歧義、未確認項目不生效、秘密值（欄位名稱與值型態各一）被拒；`secretRef` 的合法引用通過。
   - 突變檢查：拿掉限制檢查、拿掉優先序、拿掉別名唯一性、拿掉秘密值檢查，對應測試必須失敗。

### WP3 Recipe `siteRef`

- `schemas/recipe.schema.json` 新增選填 `siteRef`（比照 `workflowRef`，`path` 固定 `site.profile.json`）；`types.ts`、`importRecipe`／`exportRecipe` 同步（比照 `workflowRef` 的投影方式）。向後相容：沒有 `siteRef` 的舊檔照常匯入。
- 測試：有／無 `siteRef` 的往返、非法 `path` 或 `sha256` 被拒。

### WP4 GUI

遵守 `DESIGN.md`（原生控制項、44px、標籤有文字、不只靠顏色、`aria-describedby`、繁體中文業務語言、不顯示技術名稱）。

- 狀態：`App.tsx` 保存目前 Site（原文字、解析結果、`sha256`），僅存工作階段，不寫 localStorage。
- 05 輸出：新增「場域設定」區塊（原生 file input 加 label 按鈕，樣式沿用現有檔案選擇）：匯入 Site Profile、顯示場域名稱與版本、「待 MIS 確認」清單、錯誤訊息、「移除場域」按鈕。匯入失敗保留原場域（原子替換，比照 Recipe 匯入）。
- 04 功能選配：預覽與設定改用含 Site 的解析結果（D13，同一套解析）；被 Site 設定的選項控制項停用，旁邊以文字標示「由場域鎖定（場域名稱）」並顯示鎖定的值；有限制的選項顯示限制說明（例如「場域限制：最大 300」）；使用者在 04 輸入超出 Site 限制的值時，顯示錯誤並指出限制，不可靜默截斷。
- 載入或移除 Site 後，已存在的使用者選擇若與新限制衝突，要明確顯示衝突，並阻擋 05 的下載（沿用既有「步驟未完成」機制），不要靜默丟棄使用者的值。
- `DESIGN.md` 的 Components 新增一行說明場域設定與鎖定的呈現。

### WP5 設定交付包

- `schemas/package-manifest.schema.json`：產物 role 新增 `site-profile`；`artifacts` 上限 8。
- `deliveryPackage.ts`：`buildDeliveryPackage` 接受選填的 Site 文字；有 Site 時，確認 Recipe 的 `siteRef.sha256` 等於該文字的 SHA-256（不符則拒絕，訊息指出原因）；加入 `config/site/site.profile.json`（位元組與匯入文字相同）；`README.md` 的包含清單同步；驗證報告新增 Site 檢查（通過與否、有無待確認的語意項目）。沒有 Site 時行為與目前完全相同（manifest 與位元組不變）。
- `OutputPage.tsx`：交付包下載使用目前 Site；`exportRecipe` 的 Recipe 帶 `siteRef`；Site 解析或限制衝突時不產生交付包並說明原因。
- 測試：有 Site 時交付包含 `config/site/site.profile.json` 且位元組與匯入文字一致、SHA-256 與 manifest 及 `siteRef` 相符；無 Site 時產物與先前相同（可用既有測試證明）；`siteRef` 不符被拒；含 `password` 欄位的 Site 在匯入階段就被拒；`security.test.mjs` 仍通過（簽章與驗證流程需接受含 `site-profile` 的交付包，確認 `scripts/security/lib.mjs` 不需修改；若需修改請停止並提問）。

### WP6 驗證

- 整合測試：匯入示範 Site A → 04 的設定顯示鎖定與限制 → 05 下載交付包；換成 Site B 結果不同；移除後回到使用者的值。
- `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build` 通過；`test:kits` 不受影響（沙箱無法執行時在 Notes 註明，由 Claude 驗證）。

## 停止條件

- 需要新增依賴、修改 `kits/`、變更已定資料契約、修改 `scripts/security/lib.mjs`，或對需求有疑義時，停止並寫入 Codex Notes 與 Open Questions。
- 同一問題三次對答仍未解，停止並條列假設（CLAUDE.md）。

## 回報格式

完成每個 WP 後，在本檔「Codex Notes」依序寫：變更摘要、檔案清單、驗證方式與結果（含確切的 passed／failed／skipped 數）、未涵蓋項目、建議的約定式提交訊息（純文字、無 emoji）。完成或受阻時把本檔 frontmatter 的 `status` 改為 `ready_for_claude`。不得宣稱任何被略過或未驗證的項目已完成。

# Codex Notes

## WP1 完成（2026-10-01）

- 變更：註冊 site schema；新增 M01 模擬場域 A／B，引用 previewCatalog 實際的資料驗證欄位；加入契約正反例。
- 檔案：libs/ui-runtime/schema.ts、config/site/examples/demo-site-a.site.json、config/site/examples/demo-site-b.site.json、config/README.md、apps/composer-gui/src/siteSchema.test.ts。
- 驗證：`npm.cmd test -- apps/composer-gui/src/siteSchema.test.ts`：13 passed、0 failed、0 skipped（1 test file passed）。
- 未涵蓋：語意驗證、解析、GUI、交付包於後續 WP；身分授權不在本期。
- 建議提交：feat(site): register profile schema and mock examples

## WP2 完成（2026-10-01）

- 變更：純函式匯入驗證（UTF-8 2 MB、BOM、契約、引用、型別／限制、別名歧義、秘密值）、有效語意與鎖定集合；共用 resolveKit 依三層解析且逐層檢查限制。
- 來源相容性：source 仍是字串，保留原 Recipe 路徑與 Kit 版本內容，加上 system／kit-default／site 前綴以辨識層級；既有測試同步檢查前綴，不改無 Site 時的有效設定。
- 檔案：libs/ui-runtime/site.ts、libs/ui-runtime/resolve.ts、apps/composer-gui/src/site.test.ts、apps/composer-gui/src/runtime.test.tsx、apps/composer-gui/src/recipe.test.ts。
- 驗證：`npm.cmd test -- apps/composer-gui/src/site.test.ts apps/composer-gui/src/siteSchema.test.ts apps/composer-gui/src/runtime.test.tsx apps/composer-gui/src/recipe.test.ts`：31 passed、0 failed、0 skipped（4 files）；突變還原後重跑相同結果。
- 型別：`npm.cmd run typecheck` 首次 exit 1（1 個 TS2352，Ajv unknown 邊界型別轉換），已修正；重跑 exit 0（1 command passed、0 failed、0 skipped）。
- 突變：分別停用限制檢查、Site 優先序、別名唯一性、秘密值檢查後，`npm.cmd test -- apps/composer-gui/src/site.test.ts` 每次皆 12 passed、1 failed、0 skipped；4/4 突變被攔截，原檔均以 finally 還原。
- 未涵蓋：Runtime 授權覆寫與身分授權依 D57 延後；GUI／交付包由後續 WP 驗證。
- 建議提交：feat(site): validate profiles and resolve constrained site overrides

## WP3 完成（2026-10-01）

- 變更：Recipe 新增選填 siteRef；固定 path，匯入／匯出以明確投影保留，舊檔不受影響。
- 檔案：schemas/recipe.schema.json、libs/ui-runtime/types.ts、libs/ui-runtime/recipe.ts、apps/composer-gui/src/recipe.test.ts。
- 驗證：`npm.cmd test -- apps/composer-gui/src/recipe.test.ts apps/composer-gui/src/schema.test.ts`：9 passed、0 failed、0 skipped（2 files）。
- 未涵蓋：引用與實際檔案雜湊核對於 WP5。
- 建議提交：feat(recipe): preserve optional site profile references

## WP4 完成（2026-10-01）

- 變更：App 工作階段保存原文／解析／SHA-256；05 原子匯入、通知與移除場域；04 共用解析、停用鎖定控制項並顯示有效值／限制；既有或新輸入的場域衝突保留使用者值，阻擋步驟確認及設定下載。缺少引用檔案或雜湊不符亦阻擋。
- 檔案：apps/composer-gui/src/{App.tsx,FlowPage.tsx,KitPreview.tsx,SettingsEditor.tsx,OutputPage.tsx,SiteTransfer.tsx,siteSession.ts,siteUi.test.tsx}、DESIGN.md。
- 驗證：`npm.cmd test -- apps/composer-gui/src/siteUi.test.tsx apps/composer-gui/src/Frontend.test.tsx apps/composer-gui/src/output.test.tsx` 初次 8 passed、1 failed、0 skipped（測試誤用 input.disabled 判斷父 fieldset 的停用狀態，過早完成等待）；改以 :disabled 後重跑 9 passed、0 failed、0 skipped（3 files）。
- 型別：`npm.cmd run typecheck` exit 0（1 command passed、0 failed、0 skipped）。
- 未涵蓋：真實瀏覽器視覺／鍵盤／縮放驗證依交接由 Claude 執行；交付包內場域檔案於 WP5 接入。
- 建議提交：feat(gui): import site settings and show locked options and conflicts

## WP5 完成（2026-10-01；CLI 沙箱外驗證待 Claude）

- 變更：manifest 新增 site-profile／上限 8；交付包重驗 Site、每層限制與引用雜湊，保留去 BOM 原文位元組；README 與報告加入 Site 檢查及待確認語意；無 Site 時不新增產物或報告項目；05 使用目前 Site 產生引用與交付包。
- 檔案：schemas/package-manifest.schema.json、apps/composer-gui/src/{deliveryPackage.ts,OutputPage.tsx,deliveryPackage.test.ts,security.test.mjs}。scripts/security/lib.mjs 未修改，既有簽章／驗證直接接受含 Site 的包，竄改 Site 會被拒絕。
- 驗證：`npm.cmd test -- apps/composer-gui/src/deliveryPackage.test.ts apps/composer-gui/src/security.test.mjs`：14 passed、1 failed、0 skipped（1 file passed、1 file failed）；唯一測試失敗為已知 security CLI 沙箱限制，另 afterAll 清理同目錄 EPERM，非本次程式失敗。
- 原文錯誤：`EPERM: operation not permitted, open 'C:\Users\gslab\AppData\Local\Temp\composer-security-tBKdJf\keys\signing-private-key.pem'`；清理為 `Error: EPERM, Permission denied`，殘留目錄 `C:\Users\gslab\AppData\Local\Temp\composer-security-tBKdJf`，未嘗試繞過或清理。
- 型別：`npm.cmd run typecheck` 首次 exit 1（1 個 TS7006：新增安全測試回呼缺 JSDoc 型別），補上明確型別後重跑 exit 0（1 command passed、0 failed、0 skipped）。
- 未涵蓋：security CLI 完整流程由 Claude 沙箱外重跑；端到端場域交付下載於 WP6。
- 建議提交：feat(package): include validated site profiles with matching checksums

## WP6 自動化驗證完成（2026-10-01；沙箱外與真實瀏覽器待 Claude）

- 變更：新增 A09／D60 整合測試，從場域 A 匯入、04 鎖定／限制／預覽、05 Recipe 與交付包下載，切換 B，再移除場域還原使用者值；驗證原文位元組、兩份 Recipe 一致、引用雜湊、無網路請求及無 localStorage 寫入。安全 CLI 情境改用含 Site 的交付包供 Claude 沙箱外驗證；契約錯誤位置補上未知欄位名稱。
- 本 WP 檔案：apps/composer-gui/src/output.test.tsx、apps/composer-gui/src/security.test.mjs、libs/ui-runtime/site.ts，以及本 thread 與 mailbox index。
- 聚焦整合：`npm.cmd test -- apps/composer-gui/src/output.test.tsx apps/composer-gui/src/siteUi.test.tsx`：9 passed、0 failed、0 skipped（2 files）。
- 最終型別：`npm.cmd run typecheck` exit 0（1 command passed、0 failed、0 skipped）。
- 最終完整測試：`npm.cmd test`：104 passed、1 failed、1 skipped，共 106 tests；20 files passed、1 file failed。唯一 failed 是已知 security CLI 沙箱 EPERM，不是本次程式失敗；1 skipped 是既有身分授權未實作測試（App.test.tsx）。安全函式測試（包含 Site 簽章、驗證、竄改偵測）均通過。
- 最終 build：`npm.cmd run build` exit 0（1 command passed、0 failed、0 skipped）；含 TypeScript 與 Node 腳本型別檢查，Vite 278 modules。
- 基線測試：`npm.cmd run test:kits` exit 1，原文 `did not find executable at 'C:\Users\gslab\AppData\Local\Programs\Python\Python313\python.exe': ?????`。pytest 未啟動，0 tests executed，passed／failed／skipped 測試數不可取得；此為交接已知環境限制，未嘗試繞過，由 Claude 沙箱外驗證。
- 最終 security CLI 原文：`EPERM: operation not permitted, open 'C:\Users\gslab\AppData\Local\Temp\composer-security-Aef0Sl\keys\signing-private-key.pem'`；afterAll 亦為 `Error: EPERM, Permission denied`。本次留下的暫存目錄共兩個：`C:\Users\gslab\AppData\Local\Temp\composer-security-tBKdJf`、`C:\Users\gslab\AppData\Local\Temp\composer-security-Aef0Sl`，請 Claude 沙箱外清理；未讀取私鑰內容。
- 範圍檢查：`git -c safe.directory=C:/Users/gslab/Desktop/composer-refactor diff --check` exit 0；分支 feature/site-profile；無 Git 寫入、無新依賴，kits/、schemas/site-profile.schema.json、scripts/security/lib.mjs 均未變更。無新增 any 型別。
- 未涵蓋／交接：Claude 需執行 security CLI、test:kits、真實瀏覽器檔案選擇／鍵盤操作／200% 縮放與視覺驗證、程式審閱及 Git 提交；未宣稱以上已通過。Runtime 覆寫、真實身分授權與現場部署仍不在本期。
- 建議提交：test(site): verify profile switching and exact delivery artifacts

### 最終檔案清單（8 新增、21 修改）

- 新增：libs/ui-runtime/site.ts；apps/composer-gui/src/SiteTransfer.tsx、siteSession.ts、site.test.ts、siteSchema.test.ts、siteUi.test.tsx；config/site/examples/demo-site-a.site.json、demo-site-b.site.json。
- 修改：libs/ui-runtime/schema.ts、resolve.ts、recipe.ts、types.ts；schemas/recipe.schema.json、package-manifest.schema.json；apps/composer-gui/src/App.tsx、FlowPage.tsx、KitPreview.tsx、SettingsEditor.tsx、OutputPage.tsx、deliveryPackage.ts、deliveryPackage.test.ts、output.test.tsx、recipe.test.ts、runtime.test.tsx、security.test.mjs；config/README.md、DESIGN.md；.codex-claude-mailbox/index.md、threads/20261001-site-profile.md。

# Open Questions

（無）

## Claude 審閱與驗證（2026-10-01）

- Codex 第一次派工（task-mup9qler）因 Codex 使用額度上限在 1 分 14 秒失敗，沒有改任何檔案；第二次（task-mupd5tjl，16 分 20 秒）完成。
- 沙箱外驗證：`npm.cmd run typecheck` 通過；`npm.cmd test` 21 個檔案、105 passed、1 skipped；`npm.cmd run test:kits` 14 passed、1 skipped；`npm.cmd run build` 通過。Codex 回報的 1 項失敗（security CLI 暫存目錄 EPERM）與 `test:kits` 無法執行是沙箱限制，沙箱外皆通過；沙箱留下的兩個暫存金鑰目錄（`composer-security-tBKdJf`、`composer-security-Aef0Sl`）已由 Claude 刪除。
- 程式審閱：`site.ts` 的秘密值檢查只放行 `dataSources[n].secretRef`；Site 未載入時限制檢查直接略過，有效值不變；Kit 預設、Recipe、Site 三層皆檢查限制；Site 鎖定仍會檢查被覆蓋的 Recipe 值是否有效。
- 突變檢查 6 項：5 項被測試攔到；`secretRef` 放行範圍放寬那一項為等價變體（schema 的 `additionalProperties: false` 已拒絕 `dataSources` 以外的 `secretRef`）。
- Chrome 實測見 Obsidian 筆記「24 Site Profile」：危險檔案被拒；場域 A、B 的鎖定、限制、預覽、交付包位元組與校驗碼、移除還原；720 寬、44px 皆正常。
- 已知限制：有效值來源字串多了層級前綴；`site.ts` 與 `resolve.ts` 循環相依（目前可運作）；手冊設定項目一覽尚未反映 Site 的值；console 監聽未在整個流程期間啟用。
- 未涵蓋：實體鍵盤操作；Runtime 覆寫、分析偏好、站點對應 Workflow 表單（D55、D57）；用瀏覽器產出的交付包實際跑簽章工具（簽章測試以含 Site 的交付包執行）。

## 檢查結果與人工驗證清單（2026-10-01）

自動化與瀏覽器驗證結果已如上，沒有失敗項目。以下項目無法由 Claude 代為完成，需 user 親自驗證；第 1 至 3 項是本分支特有的驗收，通過前不合併。

| # | 項目 | 為什麼需要人 | 操作與預期 | 是否阻擋合併 |
|---|---|---|---|---|
| 1 | 以作業系統的原生檔案對話框匯入場域 | Claude 的瀏覽器驗證是以程式帶入檔案，無法操作作業系統的檔案選擇視窗 | `npm.cmd run dev -- --host 127.0.0.1 --port 5173`；到 05 輸出，按「匯入場域設定」，選 `config/site/examples/demo-site-a.site.json`。預期：顯示「目前場域：模擬場域 A，版本 1.0.0」與「待 MIS 確認：模擬說明」；改選 `demo-site-b` 後顯示場域 B；按「移除場域」後顯示「尚未匯入場域設定」 | 是 |
| 2 | 實體鍵盤操作 | 目前只驗證了滑鼠與程式觸發的事件 | 只用 Tab、Shift+Tab、Enter、空白鍵：能聚焦「匯入場域設定」並開啟選擇器；焦點框清楚（3px）；04 的「檔案上傳與驗證」分頁中，被鎖定的欄位會被跳過、可修改的欄位可輸入；輸入超過限制的值時錯誤文字出現 | 是 |
| 3 | 200% 縮放的實際外觀 | Claude 以 720 寬的視窗模擬，未實際縮放 | 瀏覽器縮放到 200%：05 與 04 單欄顯示、無水平捲軸，文字不重疊，鎖定與限制說明可讀 | 是 |
| 4 | 36 份手冊審閱（`draft` 改 `reviewed`） | 內容依程式整理，是否符合現場操作需人判斷 | 逐份閱讀 `manuals/kits/`，確認後把 `status: draft` 改成 `reviewed` | 否（只阻擋正式發佈） |
| 5 | 基線版兩個安全缺口是否在重構版修正 | 屬於範圍決策：訂閱權益不檢查到期時間、未設定通知密鑰時不驗證通知來源 | 見 Obsidian 筆記「23 Kit 動態操作手冊」的缺口表 | 否 |
| 6 | 瀏覽器實際下載的交付包跑簽章與驗證工具（選做） | Claude 的下載被攔截而沒有寫入磁碟，簽章測試用的是同一個產生函式的結果 | 在 05 下載交付包，再依 Obsidian 筆記 22 的指令 `generate-keys`、`sign-package`、`verify-package`；預期驗證通過，改一個位元組後失敗 | 否 |

# Closure

待 user 完成第 1 至 3 項後決定是否合併。
