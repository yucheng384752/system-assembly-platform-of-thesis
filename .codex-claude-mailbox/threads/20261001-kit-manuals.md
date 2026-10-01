---
id: "20261001-kit-manuals"
title: "Kit 動態操作手冊（D48–D52）"
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

（尚未開始）

# Open Questions

（無）
