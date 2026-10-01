---
id: "20261001-site-profile"
title: "Site Profile：匯入、解析層、硬性限制與設定交付包（D54–D60）"
status: "ready_for_codex"
owner: "codex"
reviewer: "claude"
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

（尚未開始）

# Open Questions

（無）
