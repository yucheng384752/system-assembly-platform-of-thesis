---
title: Composer Platform 重構專案決策紀錄
date: 2026-09-24
---

# 決策紀錄

記錄規格討論的決議與待決事項。已決議且影響設計者同步寫入 `docs/project-spec.md`，本檔不取代規格。

## 已決議

| ID | 日期 | 決議 | 原因 | 寫入位置 |
|---|---|---|---|---|
| D01 | 2026-09-24 | 本專案是 Form System Kit Composer（基線版）的改良版，成果撰寫成論文 | 論文需說明相對基線版的差異與改良理由 | spec §1、README、CLAUDE.md |
| D02 | 2026-09-24 | 命名原則：與基線版同一概念者沿用舊名，只有新增機制才取新名 | 避免以改名充當改良，論文貢獻可逐項對照基線版 | spec §1 |
| D03 | 2026-09-24 | 廢除 `tenant-auth-kit`，由 `entry-permission-kit` 取代；權限模型為單租戶、多使用者 | 現行權限只有單租戶內的多使用者隔離 | spec R06、§8、README |
| D04 | 2026-09-24 | Kit 層沿用 capability（對外完整功能）；Function 層改稱 primitive（原子能力，名稱暫定），僅限同 Kit 內 mService 引用 | 一個 Kit 由多個 Function 協調完成完整功能；維持基線版「不得跨圖直連內部 Function」規則 | spec §4、§4.1、A17–A19 |
| D05 | 2026-09-24 | 新增 capability 完整性檢查：所需 primitive 須齊全且 I/O 可依 mService 順序串接 | 基線版只檢查 consumes 有無 provider，不檢查功能完整性；可作為論文貢獻 | spec §4.1 |
| D06 | 2026-09-24 | 基線版未曾發表；論文以整套系統為研究成果，改良點為貢獻核心，基線版作為實驗對照組 | 無自我抄襲疑慮；檢核表 III.1.1 要求對照組 | 本檔 |
| D07 | 2026-09-24 | 論文章節依「最基礎的科技八股論文自我檢核表 v1.0」，格式為 IEEE；章節內容暫不寫入檔案 | 學校指定 | 本檔 |
| D08 | 2026-09-24 | 論文問題範圍不收斂，保留規格全部需求 | 使用者決定 | 本檔 |
| D09 | 2026-09-24 | 基線版沒有任何公司或計畫案的智財權與保密義務 | 論文可完整公開基線版的系統設計與程式細節 | 本檔 |
| D10 | 2026-09-24 | 資料去識別化列為必做項目 | 實驗與開發使用的製造表單資料可能來自實際場域；D09 只涵蓋基線版程式與設計 | 本檔「必做項目」 |
| D11 | 2026-09-27 | Kit 分頁與可修改項目功能在重構專案實作，基線版僅作唯讀參考 | 回應 mailbox thread `20260927-kit-tab-ui-flow` 的 F15 | thread Decisions |
| D12 | 2026-09-27 | UI 首期只做表格與下拉，不做圖表；R05 的圖表需求保留至後續階段 | 回應同一 thread 的 F08 | spec §6、thread Decisions |
| D13 | 2026-09-27 | Composer 預覽與產出系統前端皆採 React 18 + TypeScript，共用同一套解析與 renderer；Composer GUI 以 React 重寫，不搬用基線版 `app.js` | 與 Target System 技術棧一致，預覽與正式畫面由同一解析路徑保證一致；回應 F02 | spec §6、§15、thread |
| D14 | 2026-09-30 | Composer GUI 步驟改為 01 資料上傳 → 02 功能選配 → 03 輸出下載套件 → 04 AoV 設定（非必要填寫）；「功能選配」採汽車選配式三欄（左選項、中即時預覽、右調整），即時預覽只出現在此步驟 | 使用者指定；選項與預覽並排，修改後不必捲動即可看到結果。AoV 只是說明用途、不影響組裝，因此標為非必要 | DESIGN.md、thread `20260930-ui-design` |
| D15 | 2026-09-30 | 依設計圖「Composer-A 四頁示意圖」改版：四頁皆為三欄，步驟名稱改為 03 輸出下載、04 AoV 設定（選填），已確認步驟以打勾加文字表示；AoV 改為「步驟清單＋編輯選中步驟」。取代 D14 的步驟名稱與「只有功能選配為三欄」部分；即時預覽仍只在功能選配 | user 提供設計圖並指定照圖改名 | DESIGN.md、thread `20260930-ui-design` |
| D16 | 2026-09-30 | AoV 驅動只做「設定期」：以 Workflow 組織表單、表單關聯與功能建議；「執行期」（產出系統依流程派工）列為未來工作 | 執行期需流程引擎、權限與 migration，基線版亦無；設定期可在現有架構完成 | spec §4.2 |
| D17 | 2026-09-30 | AoV 由「選填、純說明、排最後」改為「設定入口、必填、排最前」；取代 D14 的步驟順序，以及 D15 的「04 AoV 設定（選填）」與「純說明用途，不影響系統組裝」 | 表單須依步驟組織，關聯與可追溯性才有步驟脈絡；介面與 DESIGN.md 待實作時調整 | spec §4.2、R14 |
| D18 | 2026-09-30 | 本功能使用基線版 AoV 的 Workflow 文件（業務視圖）；§4 四層屬 Dataflow（技術視圖），兩者不混用 | 依 D02 沿用基線名稱；基線版規範 Workflow 步驟與 Kit 不必一對一 | spec §4.2 |
| D19 | 2026-09-30 | 表單關聯首期只支援「共用識別欄位」；系統依欄位名稱與型別提出候選，一律由使用者確認，未確認者不輸出 | 步驟順序不代表資料關係，自動關聯易誤連；推測規則以程式判斷 | spec §4.2、§13 A21 |
| D20 | 2026-09-30 | 表單定義與關聯存於 Workflow 文件；Recipe 只記錄 Workflow 的 reference 與 checksum | 不變更 Recipe schema；對應 spec §4 System 的「AoV reference」 | spec §4.2、§12、§13 A22 |
| D21 | 2026-09-30 | 可執行組裝完成前，Composer 輸出的壓縮檔稱「設定交付包」，不稱「安裝」 | spec §12 不能宣稱套件自包含卻缺失依賴 | spec §12 |
| D22 | 2026-09-30 | 表單關聯不記錄基數；限制為：同一對表單最多一條、不得自連、整體不成環、單一欄位對 | 共用識別欄位以值相同連結，紀錄層級天然支援一對多與多對多；限制與基線版 `StationLink` 一致（唯一 `(from, to)`、`_would_create_cycle`、`keyMappings` 單一欄位對），日後可一對一轉換 | spec §4.2 |
| D23 | 2026-09-30 | 一個 Workflow 步驟含 0..N 張表單；每張表單恰屬一個步驟 | A23 須唯一回答「在哪個步驟填寫、由哪個職務負責」；一表單多步驟需執行期資訊，已由 D16 排除 | spec §4.2、A20 |
| D24 | 2026-09-30 | 研究結論：「站點資料串聯」可承接 FormRelation（對應 `Station`／`StationSchema`／`StationLink`），但模型與建立關聯的 API 位於 `generic-forms-kit`；基線版追溯查詢只比對 `GenericRecord.lot_no`、不讀 `keyMappings`，任意共用欄位在執行期不生效，列為未來工作 | 讀 `kits/` 副本（基線 commit `c4b2b7b`）與基線 thread `20260819-station-data-link-genericization`；執行期不在 D16 範圍 | spec §4.2 |
| D25 | 2026-09-30 | 多檔上傳：單檔維持 2 MB／100 欄／10000 筆；一次最多 10 檔、合計 20 MB；Workflow 最多 50 張表單；各檔獨立推測，失敗逐檔列出原因 | 沿用既有單檔上限；逐檔回報避免一檔失敗就全部重選，且不靜默略過 | spec §4.2 |
| D26 | 2026-09-30 | 「查詢追溯」流程綁定「通用表格管理」（`query-trace` 的 `requiresFlows` 加入 `generic-forms`） | user 指定：需要追溯就需要管理表格，不論是否修改；D24 亦顯示 `StationLink` 位於 `generic-forms-kit` | `config/flows.json`、`config/README.md` |
| D27 | 2026-09-30 | 上傳建立的表單，預設名稱為原始檔名（去副檔名），並提醒使用者去識別化；取代 spec §4.2 FormDefinition「不含原始檔名」 | user 指定；名稱可編輯，去識別化責任以提示落實（M01） | spec §4.2、A22 |
| D28 | 2026-09-30 | 「設定交付包」壓縮檔另開 `feature/install-package`；本功能只分別下載 Workflow 文件與 Recipe | user 同意；壓縮檔內容範圍尚未定 | spec §12 |
| D29 | 2026-09-30 | Recipe schema 新增選填 `workflowRef { path, sha256 }`；修正 D20「不變更 Recipe schema」的措辭，改為「只新增選填欄位、向後相容」 | `importRecipe` 拒絕未知欄位、`exportRecipe` 以明確投影輸出，不改契約則無處記錄 reference；user 同意 | spec §4.2、schemas/recipe.schema.json |
| D30 | 2026-09-30 | GUI 步驟改為 01 流程步驟 → 02 表單 → 03 表單關聯 → 04 功能選配 → 05 輸出，皆為必填；取代 D15 的步驟名稱與順序 | 落實 D17 的建議流程 | DESIGN.md |
| D31 | 2026-09-30 | 設定交付包以自寫的 zip（store，不壓縮，含 CRC32）在瀏覽器產生，不新增依賴；固定檔案順序與時間戳（1980-01-01），相同設定產出相同位元組 | user 指定自寫；檔案皆為小型 JSON，壓縮效益低。基線版以內嵌 JSZip 與 `Compress-Archive` 產生，且寫入產生時間，無法以位元組比對（A12、A15） | spec §12 |
| D32 | 2026-09-30 | 設定交付包只放實際產物：`package-manifest.json`、`README.md`、`config/system.recipe.json`、`aov/workflow.aov.json`、`validation/report.json`；§12 其餘目錄不建立，於 manifest `notProvided` 逐項列出原因；不含 Kit 原始碼與安裝腳本，Kit 只以 id 與版本記錄。包內 Recipe 的 `workflowRef.path` 仍為檔名，以 manifest 的 `role` 與 sha256 定位 | 空目錄或安裝腳本會讓交付包看似可安裝，違反 D21；不改 Recipe 契約（D29） | spec §12 |
| D33 | 2026-09-30 | manifest 沿用基線名稱 `package-manifest.json`，契約為 `schemas/package-manifest.schema.json`；不記錄產生時間，改記錄各產物的 sha256 與位元組數 | 依 D02 同概念沿用舊名；去除時間使 manifest 可重現（D31） | spec §12 |
| D34 | 2026-09-30 | 缺少手冊不阻擋設定交付包，於 `notProvided` 標示；§11 的阻擋規則適用於正式 System Package | 設定交付包依 D21 不是正式發佈；`manuals/kits/` 尚無任何手冊 | spec §11、§12 |
| D35 | 2026-09-30 | 驗證報告列出靜態檢查（兩份檔案的 schema、`workflowRef` 相符、敏感鍵名掃描），測試環境演練與現場驗證標為「未執行」；任一靜態檢查未通過即不產生交付包 | §12 要求三類分列；不得宣稱已部署驗證 | spec §12 |
| D36 | 2026-09-30 | 保留流程規格與系統設定檔的分別下載（設定檔亦用於載入）；本期只輸出交付包，不支援匯入；檔名為 `<Recipe name>-delivery-<manifest sha256 前 12 碼>.zip` | 最小改動；客戶代稱為任意文字，不放進檔名 | spec §12 |
| D37 | 2026-10-01 | 防篡改與授權沿用基線版方式：RSA-2048、RSA-PSS-SHA256（salt 32）簽 `license.lic` 與 `<zip>.sig.json`，產出系統啟動時驗證，失敗即拒絕啟動；移除 TPM 驗證（EK 指紋與 challenge-response） | user 指定沿用基線、移除 TPM；TPM 需硬體與 tpm2-tools，現場不一定具備 | spec §12.2 |
| D38 | 2026-10-01 | 單機綁定改用作業系統機器識別：Windows `MachineGuid`、Linux `/etc/machine-id`，取小寫去空白後的 SHA-256；授權檔必須綁定機器並記錄 `fingerprintSource`，不再發不綁機器的授權 | 修正基線版 H1（指紋來源未記錄、兩平台算法不同導致誤拒）；user 接受此識別會隨 VM／磁碟映像複製，只防「把檔案搬到另一台機器」；Docker 部署須唯讀掛載主機 `/etc/machine-id` | spec §12.2 |
| D39 | 2026-10-01 | 授權 payload 升為 `schemaVersion` 2.0，新增 `packageManifestSha256` 綁定設定交付包；`licensee` 只記客戶代稱，不記 email | manifest 已記錄各產物 SHA-256（D33），一個簽章即可涵蓋整包；email 屬個資，Recipe 匯出亦不含 | spec §12.2、`schemas/license.schema.json` |
| D40 | 2026-10-01 | 金鑰產生、簽章與驗證為本機離線 Node 工具（`scripts/security/`，只用內建 crypto）；私鑰必須存放在 repo 以外，目標路徑位於 repo 內即拒絕；新增驗證工具，檢查 zip 簽章、授權簽章與整包 SHA-256 | 依「秘密值不落地」私鑰不可進瀏覽器或 repo；補上基線版 `.sig.json` 無任何程式驗證的缺口 | spec §12.2 |
| D41 | 2026-10-01 | `platform-core-kit` 的 `license.py`：公鑰仍為佔位值時拒絕啟動；舊版授權（無 `fingerprintSource`、含 `machinePublicKey`、或未綁機器）明確拒絕並說明原因 | 防止基線版公鑰與金鑰不符造成的 crash-loop 被誤判為授權問題；不靜默接受舊格式 | `kits/platform-core-kit`、`kits/BASELINE.md` |
| D42 | 2026-10-01 | 授權有效期預設 365 天，不設離線寬限期 | 沿用基線版 `expiresAfterDays` 預設值；驗證完全離線，無需寬限 | spec §12.2 |
| D43 | 2026-10-01 | Python 測試環境為專案內 `.venv`，固定 pytest 9.1.1、cryptography 50.0.2（`kits/platform-core-kit/requirements-test.txt`）；首次將 `license.py` 納入測試 | user 核准；`kits/` 原不在測試範圍 | `package.json`、`.gitignore` |
| D44 | 2026-10-01 | 威脅模型：簽章與授權可防一般使用者修改設定、搬移到他機；無法防止擁有本機管理員權限並能修改程式或複製整機映像者 | 純軟體授權只能提高成本；論文與規格不得宣稱更強保證 | spec §12.2 |
| D45 | 2026-10-01 | 資料庫與後端同機部署時不啟用資料庫 TLS，前提為資料庫與後端只監聽 127.0.0.1（PostgreSQL `listen_addresses='localhost'`、`pg_hba` 只允許本機且用 scram-sha-256）；資料庫在他機時必須 TLS 且 `sslmode=verify-full`；秘密值沿用 `.env`＋檔案權限；前後端認證歸 `entry-permission-kit`（§8）。部署檔於 P2 產生，本期只定規格 | loopback 流量不離開主機，能攻擊者已有本機權限，可直接讀資料檔與 `.env`，TLS 無額外保護且憑證過期會使離線現場無法啟動；基線版實際風險為後端 port 對外開放 | spec §12.2 |
| D46 | 2026-10-01 | 產出系統預設所有使用者只經內網連入，不對外網開放；瀏覽器到伺服器是否改用 HTTPS 及憑證來源仍待決，方案比較記錄於本檔「待決／HTTPS 憑證來源」 | user 指定先以內網為前提；保留決策紀錄，避免日後對外開放時默默沿用內網假設 | spec §12.2、§15 |
| D47 | 2026-10-01 | 新增 `@types/node` 22.20.4（鎖定版本，對應支援的最低 LTS）；新增 `tsconfig.node.json`，讓 `scripts/**/*.mjs` 與 `security.test.mjs` 以 JSDoc 型別納入 `npm run typecheck`；`build` 改為先跑完整 typecheck | user 核准；原本這些檔案只由 vitest 執行，型別錯誤不會被發現（納入後立即抓到測試檔缺少型別）。已知限制：vite 自己的型別宣告會引用 `@types/node`，前端程式因此看得到 Node 全域型別，無法以 tsconfig 隔離 | `package.json`、`tsconfig.node.json` |
| D48 | 2026-10-01 | 手冊片段位於 `manuals/kits/<kit-id>/<kit-version>/{user,mis,developer}.md`，路徑由命名規則推得，不修改基線 manifest；每份為 Markdown 加受限 frontmatter（`kitId`、`kitVersion`、`role`、`status`、`sources`），契約為 `schemas/manual.schema.json`；必備六節：用途、前置條件、可設定項目、操作步驟、輸入輸出、常見錯誤與復原 | 依 spec §11 建議；沿用命名規則避免 manifest 與手冊兩處來源漂移；`sources` 記錄內容所依據的 Kit 檔案，使每項說明可追溯 | spec §11、`schemas/manual.schema.json` |
| D49 | 2026-10-01 | 為 Composer 目錄的 12 個 Kit 各寫 user、mis、developer 三份（共 36 份）；`tenant-auth-kit` 已廢除（D03）不寫；`entry-permission-kit` 尚無程式，手冊只寫目前現況，不描述未實作的行為。內容只依 Kit 的 manifest、contract 與原始碼，查不到的寫「尚未提供」，不得推測 | user 指定 13 個 Kit 全寫；目錄資料夾有 13 個，其中一個已由 D03 取代；R08 要求手冊與實際功能一致 | spec §11 |
| D50 | 2026-10-01 | 片段 `status` 為 `draft` 或 `reviewed`；初稿一律 `draft`，由 user 審閱後改為 `reviewed`；正式發佈只接受 `reviewed`，設定交付包接受 `draft` 並在手冊首頁標示草稿 | 手冊內容依程式整理，無法保證符合現場操作；由人確認後才能對外發佈 | spec §11、§12 |
| D51 | 2026-10-01 | 手冊組裝器為純函式：只含已啟用的 Kit 與子功能，依 Kit 相依排序；「可設定項目」表格取自選項定義的角色、風險、變更層級，不另寫一份；跨 Kit 操作路徑由所選流程的頁面清單組出；缺片段、版本不符、缺必備章節、frontmatter 不合契約時列出 Kit、角色與路徑並阻擋正式發佈；不讀連線設定或秘密值 | 對應 A13；避免僅串接片段造成流程斷裂；選項定義已是設定的唯一來源 | spec §11 |
| D52 | 2026-10-01 | 設定交付包在所選 Kit 的手冊齊全時加入 `docs/manual-<role>.md`（三個角色）；不齊全時 `docs/` 維持列於 `notProvided` 並列出缺少的 Kit；manifest 契約新增產物 role `manual` | 手冊缺少不阻擋設定交付包（D34），齊全時就應交付；修改 D33 的產物數量限制 | spec §12、`schemas/package-manifest.schema.json` |
| D53 | 2026-10-01 | Kit 的契約宣告（`kit.contract.json`、manifest）與原始碼實作不一致時，手冊以原始碼為準描述目前可操作的行為，另分列「契約宣告」並對找不到可核對實作的項目標示「尚未提供」；不修改 `kits/`，不一致項目列入 Kit 手冊的 Developer 版與 mailbox 待清理清單。首例：`query-traceability-kit` 契約宣告 `GET /api/v2/query/records`，後端只實作 `/lot/{lot_no}` 與 `/trace/{lot_no}`，前端 QueryPage 使用後兩者 | 對應 D49「只依事實、不推測」；手冊不得把宣告當成已實作，也不得把某一方悄悄當作等價；`kits/` 為基線副本（D03、`kits/BASELINE.md`），不同步修正 | spec §11 |
| D54 | 2026-10-01 | Site Profile 首期為匯入式 JSON（`composer-site-profile` version 1，契約 `schemas/site-profile.schema.json`），由 MIS 編輯檔案、Composer 驗證並顯示結果；不新增編輯用 GUI 步驟；一個設定交付包只對應一個 Site Profile | user 同意建議；編輯畫面需另行設計，先讓契約與驗證可用；多 Site 同時輸出需求未出現 | spec §9 |
| D55 | 2026-10-01 | 首期內容：場域識別（`siteId`、`siteVersion`、`displayName`、`domain`）、Site 層選項值（`optionOverrides`）、硬性限制（`optionLimits`）、欄位別名與單位語意（`fieldSemantics`）、資料來源引用（`dataSources`，只含 `sourceRef`／`secretRef`）。分析偏好（§10）與站點／設備對應 Workflow 表單暫不做 | user 指定分析偏好暫不做；站點對應需引用 Workflow 表單與 StationSchema（見待決表），待組裝引擎一併設計 | spec §9 |
| D56 | 2026-10-01 | 選項值優先序為 Kit 預設 < System（Recipe）< Site；Site 設定的選項在 GUI 顯示為「由場域鎖定」，使用者不可改，並顯示來源；有效值的來源追溯需含 Site | 依 spec §5 優先序；預覽與輸出共用同一解析（D13） | spec §5、§9 |
| D57 | 2026-10-01 | `optionLimits` 套用到所有層的值（Kit 預設、Recipe、Site）；超出限制一律報錯並指出選項與限制，不自動截斷；Site 值自身也須符合選項定義的範圍與限制。Runtime 覆寫（有效期間、授權角色，§15 第 5 項）待可執行組裝時再設計，A03 目前以「任何值超出 Site 限制即拒絕」涵蓋 | user 同意；目前無執行期，無法定義覆寫期限與授權 | spec §9、§13 A03 |
| D58 | 2026-10-01 | `fieldSemantics`：別名在整份 Site Profile 內須唯一，重複時報歧義並指出兩個欄位；不做自動單位換算；只有 `confirmed: true` 的項目生效，未確認者顯示為「待 MIS 確認」 | spec §9：別名與換算須確認，多重映射歧義須回報；沿用 D19「未確認不生效」的原則 | spec §9 |
| D59 | 2026-10-01 | `dataSources` 只可含引用（`sourceRef`、`secretRef`），整份 Site Profile 不得出現連線字串、帳密、金鑰或憑證；以欄位名稱與值的型態雙重檢查，違者整份拒絕；`secretRef` 的值只是外部秘密的名稱（不含 `:`、`/`、`@`） | 安全基準線「秘密值不落地」；`secretRef` 是引用，不是秘密值，但既有敏感欄位名稱檢查須明確放行此欄位 | spec §9、§12 |
| D60 | 2026-10-01 | Recipe 新增選填 `siteRef { path, sha256 }`（比照 D29）；`sha256` 為匯入文字（去除 BOM）的 UTF-8 位元組；設定交付包加入 `config/site/site.profile.json`（位元組與匯入文字相同，role `site-profile`），manifest 產物上限改為 8，驗證報告新增 Site 檢查；有匯入 Site 但 Recipe 的 `siteRef` 不符時不產生交付包 | 保持與 workflowRef 一致的記錄方式；保留原始位元組使校驗碼可核對 | spec §9、§12、`schemas/recipe.schema.json` |
| D61 | 2026-10-01 | 表單關聯頁在候選區下方列出「未成為候選的原因」：只針對標為識別欄位的欄位，只有兩種確定性規則（名稱相同但型別不同；名稱相近但不相同，相近＝一方名稱包含另一方且較短者至少 2 字）；只提示不生效，不改變 D19 的候選條件；每對欄位只列一次，最多顯示 10 項；已相連或已是候選的配對不列 | user 回報三張表單只出現一個候選，實際是 production 的識別欄位名稱與型別和其他表單不同，畫面卻沒有說明；沿用 D19 的確定性原則，不用 LLM | spec §4.2、`apps/composer-gui/src/relations.ts` |
| D62 | 2026-10-02 | 組裝驅動改為「Workflow 的 Action 決定所需 capability，再由 Registry 找出可行的 mService 與 Function」；Kit 保留為 capability 的封裝單位（D04 不變），不再由使用者從固定清單選配。取代 D14 的「功能選配」概念，以及 D26、D30 中「04 功能選配為使用者選擇」的部分；選配結果改為由 Workflow 推導，使用者可檢視並調整。本決議只定方向，推導規則與 Registry 契約由後續功能定義，目前程式行為不變 | user 與 Codex 討論後指定拋棄固定式功能；完全移除 Kit 會失去 D02、D06 的基線版對照，且 D05 的完整性檢查需要 Kit 邊界 | 本檔；spec §4 待實作時同步 |
| D63 | 2026-10-02 | Composer GUI 新增應用殼層：左側導覽含 5 項（首頁、流程、資料集、執行記錄、系統設定；Migration 為系統設定內的分頁，依設計圖），頁首顯示專案與場域；設計圖第 7 張「實際系統表單頁」屬產出系統（摘要 §14.1），不放進 Composer 導覽，仍由 04 步驟的預覽呈現；D30 的 5 個必填步驟與驗證原封不動，收進「流程」頁。尚未實作的頁面只做骨架，內容標「尚未提供」，不以擬真資料冒充功能 | 參照 user 提供的 7 頁設計圖與討論摘要 §14.1；先建結構再逐頁填入，符合最小改動；D16 仍限制只做設定期 | `DESIGN.md`、`apps/composer-gui/src/` |
| D64 | 2026-10-02 | 視覺沿用 DESIGN.md：主色 #075e54、無陰影、對比與 44px 觸控區規範不變，不採設計圖的深藍側欄與藍色主色；設計圖只作為版面與資訊架構參考。側欄為淺底（沿用 `--surface`），選取項以 `--selected` 加文字標示，不只靠顏色。設計圖中的表情符號與歡迎語不採用 | user 指定保留現有綠色；DESIGN.md 要求文字對比至少 4.6:1 並禁止 emoji | `DESIGN.md` |
| D65 | 2026-10-02 | 「下一步建議」首期只提供規則式候選（依輸出契約與相容條件篩選），不實作 Markov 排序；畫面不顯示機率或信心分數，資料不足時標示「資料不足」。Markov 待有已發布流程的歷史資料與最小樣本條件後再議（摘要 §9 的建議不視為決議） | 目前沒有任何已發布流程可統計，顯示百分比等於虛構；沿用 D61 的確定性原則，推薦不得突破相容與權限限制 | 本檔；摘要 §9.1 |
| D66 | 2026-10-02 | Workflow 步驟新增 `actions[]`（0..N），Action 依「業務動作」分類（建立表單、匯入紀錄、串聯表單、查詢追溯），分類表為資料檔 `config/actions.json`，每個 ActionType 宣告所需 capability（沿用基線版 capability 名稱）。Workflow 文件升至 version 3，version 1、2 仍可匯入 | user 指定依一般使用者直覺分類；步驟含 0..N 張表單（D23），Action 比照辦理；分類放資料檔使新增動作不需改程式（Data-First） | `config/actions.json`、`schemas/` |
| D67 | 2026-10-02 | Registry 一個 Kit 一個檔，放 `config/registry/<kit-id>.json`，涵蓋 capability → mService → Function 三層（D04）。每個 capability 同時記錄「契約是否宣告」`declared` 與「實際實作所在」`implementedBy`，兩者不一致、原始碼找不到實作或契約缺漏時標為 `unverified` 或 `declared: false`，不悄悄修正。Kit 之間以原始碼 import 形成、契約未宣告的相依記為 `consumes` 的 `declared: false`。基線版副本 `kits/` 不修改 | 基線版 `kit.contract.json` 與原始碼不一致：`station-data-link-kit` 無原始碼、`db.*` 實作在 `platform-core-kit`；`generic-forms-kit` 契約只涵蓋 2 條端點；`query-traceability-kit` 契約路徑 `/api/v2/query/records` 在原始碼找不到，且直接 import `generic-forms-kit` 的 `Station`、`StationLink`（即 D26 的實際原因）。能表達差異即是 D05 完整性檢查的資料基礎 | `config/registry/`、`schemas/kit-registry.schema.json` |
| D68 | 2026-10-02 | 第一版只登錄 4 個 Kit：`generic-forms-kit`、`station-data-link-kit`、`query-traceability-kit`，以及 `station-data-link-kit` 的 `db.*` 實作所在的 `platform-core-kit`（僅登錄 `db.*` 部分）。其餘 Kit 視為「契約未完整」：不參與推導，推導結果須列出被略過的 Kit，不得靜默忽略。`flows.json` 暫時保留，以測試證明推導與其在 `query-trace` 上結論一致後再退役 | user 指定先做三個範例 Kit；`station-data-link-kit` 沒有 `platform-core-kit` 就無法通過完整性檢查；全部補齊的工作量留待範例驗證資料結構後再議 | 本檔、`config/registry/` |
| D69 | 2026-10-02 | Action 可宣告必帶的 Kit（`requiresKits`，附原因）。所有與表格相關的 Action（建立表單、匯入紀錄、串聯表單、查詢追溯）一律帶出 `generic-forms-kit` 與 `station-data-link-kit`，使用者不可取消。推導 Kit 的來源有三種並逐項記錄：Action 所需 capability 的實作者、Action 的必帶 Kit、已選 Kit 的 consumes 所需的實作者（含契約未宣告的原始碼相依）。一個 capability 有多個不同實作者時不自動選，列為待使用者決定 | user 指定：查詢追溯依靠上傳的表格，也算表格相關；兩個 Kit 都必選。`station-data-link-kit` 沒有原始碼，無法由實作推導，只能用必帶規則；規則放資料檔，新增動作不改程式 | `config/actions.json`、`libs/ui-runtime/actions.ts` |
| D70 | 2026-10-02 | Workflow 改為畫布式圖形文件 `composer-aov-list` version 4：`rootGraphId`、`graphs[]`（`nodes[]`、`edges[]`）、`layout`、頂層 `forms`、`relations`，名稱沿用基線版 AoV（D02）。一個節點最多一個 Action（`actionId` 可為空，表示純業務節點，不產生 Kit），取代 D66 的「步驟含 0..N 個 Action」。連線只表示先後順序：無文字標示、無條件、不得成環，同一節點多條出線視為平行（D18）。推導 Kit 的輸入為所有 graph 內 `actionId` 的聯集 | user 要求先建立完整 workflow 再推導 Kit，且每個節點可再往下建立子 AoV；基線版 AoV 為圖形文件；D18 規定 AoV 不執行條件與迴圈；user 指定連線不要文字標示 | `schemas/aov.schema.json`、`apps/composer-gui/src/workflowGraph.ts` |
| D71 | 2026-10-02 | 子 AoV 規範：最多 3 層（流程、子流程、作業細項），第 3 層的節點不可再有子 AoV；graphs 構成一棵樹，除根以外每個 graph 恰好被一個節點的 `childGraphId` 引用，不可共用、不可循環；每個 graph 最多 100 個節點、整份文件最多 30 個 graph、50 張表單（D25 不變）。超出一律拒絕匯入並指出位置，不截斷、不自動攤平 | user 要求明訂層數以避免解析困難；基線版四層規範的最底層不可再有子圖，目的同為讓解析有界；基線規範的「共用定義需明確契約」尚無契約，故不開放共用。層數 3 為 Claude 提議，user 回覆按提案 | 本檔、`workflowGraph.ts` |
| D72 | 2026-10-02 | 節點最多擁有一張標準表單（`formId`），表單仍放頂層 `forms`，每張表單恰屬一個節點（D23 的對應）；表單的上傳推測與去識別化規則不變（D25、D27、M01）。欄位新增選填 `validation`，依型別限定：整數與小數 `minimum`、`maximum`（整數須為整數）；文字 `maxLength`、`allowedValues`；日期 `minimumDate`、`maximumDate`，採 ISO 8601 日期 `YYYY-MM-DD`；是／否無規則。最小值不得大於最大值，日期須為有效曆法日期。「關聯」沿用 `relations`（D19、D22），端點仍為 `{ formId, fieldId }`，可跨節點與跨 graph | user 指定選擇節點後上傳標準欄位，並設定關聯、必填、驗證；user 指定日期驗證採 ISO 格式（解讀為日期規則的邊界值與格式皆為 ISO 8601，待 user 確認） | `schemas/aov.schema.json`、`workflowGraph.ts` |
| D73 | 2026-10-02 | ActionType 新增 `parameters`（`id`、`name`、`type`：number、text、boolean，`required`、`default`、`minimum`、`maximum`）與 `needs`（節點完成前必須具備：`form` 為有一張欄位完整的標準表單、`relation` 為該表單至少有一條已確認的關聯）。節點完成條件：名稱必填；有 Action 時必填參數齊全（無值則取預設）、型別與範圍正確、`needs` 滿足；表單通過 `formError` 與欄位規則。未知的參數鍵與型別錯誤屬結構錯誤（拒絕匯入），缺值與範圍錯誤屬完成度錯誤（畫面顯示並擋下匯出）。首批參數只取原始碼可查證者：匯入紀錄 `allowDuplicate`（對應 `allow_duplicate`）、串聯表單與查詢追溯 `flowCode`（對應 `flow_code`） | user 要求在建立節點時驗證必填、表格上傳、數值設定；Data-First，驗證規則放資料檔；不虛構原始碼看不出的參數 | `config/actions.json`、`schemas/action-catalog.schema.json` |
| D74 | 2026-10-02 | 畫布外觀規範（功能 2 實作）：所有節點一律為圓形，只顯示名稱；負責職務、時機、參數與表單等細項只在右側節點細項顯示；連線不顯示文字。版面為左側工具箱、中間畫布、右側節點細項。畫布使用 `@xyflow/react`，user 已核准安裝，由 Claude 於功能 2 分支安裝 | user 指定；基線版 AoV Studio 亦使用此套件 | `DESIGN.md`、`apps/composer-gui/src/` |
| D75 | 2026-10-02 | 舊格式（version 1 到 3）轉為 version 4 的規則：每個步驟依序展開為根 graph 的節點並以連線串接；步驟的每個 Action 成為一個節點，Action 作用的第一張表單歸該節點，其餘表單各成一個無 Action 的節點；無 Action 的步驟為單一節點；`when`、`owner` 複製到展開的每個節點。一個節點只能有一張表單，故 Action 原本作用於多張表單時屬於有損轉換，須逐項列出提示，不得靜默。功能 1 期間主畫面仍編輯 version 3；`importAov` 遇 version 4 回報尚未支援。列表頁面（`AovPage`、`FormsPage`、`RelationsPage`）於功能 2 退役，兩套模型並存是已知重複 | D70 取消步驟含多個 Action 的結構；避免功能 1 破壞現有畫面（最小改動） | `workflowGraph.ts`、thread `20261002-workflow-graph` |
| D76 | 2026-10-02 | 「建議加入功能」改為畫布上的建議：存在已確認的表單關聯而流程中（任何層）還沒有「查詢追溯」節點時，在畫布右下角顯示靜態提示與「加入『查詢追溯』節點」按鈕；不自動套用，不使用 toast。規則為確定性程式（`suggestActions`），不交給 LLM。取代 `suggestFlows`（D30 之前的「建議流程」），後者於畫布功能中退役 | user 允許用 toast 或畫布右下提示；選右下靜態提示是因為 DESIGN.md 不使用動畫，且自動消失的訊息對讀得慢的使用者與輔助技術不友善，提示在條件成立期間持續存在，也不會被錯過。若 user 偏好 toast 可再調整 | `workflowGraph.ts`、`DESIGN.md` |
| D77 | 2026-10-02 | GUI 的 5 個必填步驟（D30）改為 3 個：01 流程畫布（取代原 01 流程步驟、02 表單、03 表單關聯；表單上傳、欄位確認、驗證規則與關聯都在節點細項內完成）、02 功能選配（顯示由流程推導的功能與原因，必帶功能鎖定；Registry 尚未涵蓋的流程與功能維持手動選配）、03 輸出。每步仍為必填並維持驗證。D30 的其餘規定不變。Workflow 輸出檔改為 version 4，仍由 Recipe 的 `workflowRef` 記錄檔名與 SHA-256（D29） | 由 user 對節點細項的設計推得：選擇節點後上傳標準欄位並設定關聯、必填、驗證，且先建立完整 workflow 才推導功能；此項為 Claude 的推論，待 user 確認 | `DESIGN.md`、`apps/composer-gui/src/StepShell.tsx` |
| D78 | 2026-10-05 | 流程文件新增「工廠層」：`composer-aov-list` version 5 以 `factories[]`（`id`、`name`、`logicGraphIds[]`）取代 `rootGraphId`。工廠只是容器，沒有自己的節點與連線；工廠不放在畫布上，改用清單管理。上限：最多 20 個工廠、每個工廠最多 20 個生產邏輯、整份文件最多 100 張圖（原為 30）；表單、節點上限不變。工廠與場域（Site Profile，D54）是不同概念，場域設定不變，一個交付包仍只有一個場域 | user 要求在 AoV 加一層工廠層，每個工廠包含多個生產邏輯；工廠之間沒有先後順序，不適合用畫布呈現。user 回覆第 1 點只描述建立流程，未說明工廠是否等於場域，Claude 維持分開，user 於 2026-10-05 確認按此解讀 | `schemas/aov.schema.json`、`apps/composer-gui/src/workflowGraph.ts` |
| D79 | 2026-10-05 | 「生產邏輯」就是工廠底下最上層的一張圖（原「主流程」）。D71 的 3 層上限不變，改由生產邏輯算第 1 層（工廠不算層）。建立流程時先為工廠命名，再按「建立生產邏輯」：按鈕會建立工廠（若尚未建立）與一個生產邏輯並開啟畫布；工廠與生產邏輯在清單中新增、改名與刪除，刪除前於頁內列出將一併刪除的內容。畫布上方的層級列為「工廠 > 生產邏輯 > 子流程」 | user 指定建立 AoV 時先命名工廠並提供「建立生產邏輯」按鈕；其餘依 Claude 建議（user 回覆「其餘按照建議」） | `FactoryPage.tsx`、`WorkflowCanvas.tsx` |
| D80 | 2026-10-05 | 每一張圖（生產邏輯與每個子流程）建立時自動產生一個「開始」與一個「結束」節點（節點新增 `kind`：`start`、`end`、`node`）。開始與結束不可刪除、不可改名、不可有動作、參數、表單與子流程；開始不可有入線、結束不可有出線，每張圖各恰有一個。完成度：每個一般節點都必須在從開始到結束的路徑上，否則指出節點；每張圖至少要有一個一般節點。新增節點時自動接線：插入在目前選取節點（未選取則為開始）之後、結束之前，原本直接相連的線改接經過新節點 | user 要求自動產生開始與結束節點；範圍為每一張圖，以及必須成為連續路徑，是 Claude 的解讀，user 於 2026-10-05 確認按此解讀；自動接線與刪除時接起前後節點的部分已由 D84 取代 | `workflowGraph.ts`、`canvasEditing.ts` |
| D81 | 2026-10-05 | 表單關聯只允許在同一個工廠內：跨工廠的關聯視為結構錯誤並拒絕匯入，畫面只提供同工廠的表單作為候選。功能（Kit）推導取整份文件所有圖的聯集（一個交付包只有一份設定），原因文字帶上工廠與生產邏輯名稱 | 跨工廠的識別編號語意不同，且 D22 的無循環檢查會變複雜；一個交付包只有一份 Recipe。依 Claude 建議，user 回覆「其餘按照建議」 | `workflowGraph.ts`、`FlowPage.tsx` |
| D82 | 2026-10-05 | 舊文件升級為 version 5：version 4 文件放入一個「預設工廠」，原主流程成為它的第一個生產邏輯，並為每張圖補上開始與結束（開始接到沒有入線的節點，沒有出線的節點接到結束），逐項提示；version 1 到 3 先依 D75 轉成圖形再升級。`importWorkflow` 一律回傳 version 5 | 不遺失既有資料，且既有流程升級後仍可通過完成度檢查 | `workflowGraph.ts` |
| D83 | 2026-10-05 | 流程畫布頁的畫面規範（依 user 審閱意見）：側欄不顯示專案與場域；側欄以右緣垂直置中的圓形圖示按鈕收合或展開；工具箱卡片只列動作名稱；節點直徑縮為 64px（名稱最多兩行）；「匯入流程規格」為層級列旁的按鈕，展開後才顯示檔案選擇與進階貼上；畫布寬度不受 100rem 上限限制，節點細項只在選取節點時出現 | user 逐項指定 | `DESIGN.md`、`apps/composer-gui/src/` |
| D84 | 2026-10-05 | 節點預設不連接線：新增節點不自動接線，刪除節點也不自動接起前後節點，連線只在使用者畫出時存在（取代 D80 的自動接線與橋接；完成度規則不變，沒有接上開始與結束的節點仍會被指出）。連線一律有方向箭頭（實心箭頭，指向後續節點），且確實接到連接點：連接點縮為 12px 的圓點，另以透明環保留 44px 的觸控範圍（原本 44px 的方塊使線端離圓點約 22px）。工具箱的「加入到畫布」改為圖示按鈕，放在工具名稱右側，無障礙名稱與提示文字仍為「加入到畫布：名稱」。新增節點的預設位置為開始與結束下方的一列，每列六個；「階梯式展開」的新增方式待 user 說明後再定 | user 要求節點預設不連線、線與節點之間不可有空隙並補上箭頭、加入按鈕改圖示。user 同時確認 D78、D80 的兩個解讀（工廠不等於場域；開始與結束適用每一張圖） | `canvasEditing.ts`、`WorkflowCanvas.tsx`、`style.css`、`DESIGN.md` |

## 必做項目

| ID | 項目 | 適用範圍 | 完成條件 |
|---|---|---|---|
| M01 | 資料去識別化 | 論文實驗資料集、analytical_four 回歸基準資料（spec §10.5）、提供給 LLM 的樣本資料、論文圖表與附錄 | 使用前完成去識別化並記錄方法；未去識別化的原始資料不得進入 repo、論文或外部服務 |

## 論文相關參考

- 檢核表：`C:\Users\gslab\Desktop\兆賢學長的論文\碩論\最基礎的科技八股論文自我檢核表v1.docx`
- IEEE 範本：同資料夾 `Transactions-template-and-instructions-on-how-to-create-your-article-formatted (4).docx`
- 排版參考：同資料夾 `碩論初版_v5_IEEE格式.docx`
- 檢核表本身只規定版面（會議論文 4–6 頁、期刊 12 頁為 2-column／10pt；碩論為 single column／1.5 行距／12pt），IEEE 細節以範本為準。
- 檢核表要求與三年內至少 3 篇文獻做定性與定量比較，僅與基線版比較不足以回答「比 SOTA 強多少」。
- D08 的影響：檢核表要求每個問題對應貢獻、架構與實驗，並逐一分析每張結果圖表；保留全部需求時，每項都需要有對應的實驗證據。

## 待決

### 名詞對照（已給建議，尚未核定）

| 項目 | 建議 | 原因摘要 |
|---|---|---|
| System configuration 與 Recipe | 沿用 Recipe；`config/system.json` 改為 Recipe 檔 | 同一概念；基線版 GUI 匯出、resolver、Resolved Plan 均以 Recipe 為基礎 |
| Site Profile 與 StationSchema | Site Profile 上位包含，以 reference 引用多份 StationSchema（1:N） | 範圍不同；平行會造成 mapping 雙重定義；tenant key 規則只需改一處 |
| System Package | 延伸基線版部署包，保留新名稱 | 保留已驗證的部署能力；新增 manifest／checksum／手冊／AoV／驗證報告屬新機制 |
| AoV | 依 user 說明定義為「描述工作流的架構，由節點與有向連線構成」；縮寫全名未知，不自行編造，論文以此定義說明 | user 於 2026-10-02 口述；沿用基線名稱（D02），Workflow 與 Dataflow 的區分見 D18 |

### HTTPS 憑證來源（D46，2026-10-01 起保留紀錄）

前提：使用者只經內網連入（D46）。資料庫與後端之間的通訊已由 D45 決定，本項只涉及瀏覽器到伺服器（反向代理）。

| 方案 | 做法 | 優點 | 缺點 | 適用 |
|---|---|---|---|---|
| A 維持 HTTP | 只在內網提供 HTTP | 無憑證維護 | 內網中任一台被入侵或可監聽的設備即可讀取帳密與資料；瀏覽器標示不安全 | 僅限封閉、受控網段的暫行做法 |
| B 每台自簽 | 安裝時產生自簽憑證，顯示指紋供人工核對 | 不需外部服務、可離線 | 瀏覽器警告；使用者習慣按「繼續」會削弱防偽效果；需自行處理到期更新 | 小型、單一站點 |
| C 內部 CA | 以企業或專案自建 CA 簽發，CA 憑證由 MIS 透過群組原則等方式派送到用戶端 | 無警告、可集中撤銷與更新 | 需 CA 管理流程與用戶端信任設定 | 已有 MIS 與網域管理的工廠 |
| D 公開 CA | Let's Encrypt 等公開憑證，內網可用 DNS-01 驗證 | 無警告、自動更新 | 需公開網域與 DNS API；離線現場無法更新 | 有網域且可連外者 |

待確認：現場是否已有內部 CA 或網域管理；是否有離線站點；憑證到期時的處理責任。

### 規格與目錄

- §3 角色 L1–L3 與 AoV 四層 L1–L4 標籤撞名。
- §7 migration 格式：Alembic revision 或 `up.sql`／`down.sql` 遷移包。
- §10 改寫：Analytical-Four 實際為 MSPC／RAG／LLM；已決議沿用 `analytics-kit` id；`llm-synthesis`、`rag-retrieval` 目前 `required:false`。
- §5 需並列「值覆寫順序」與基線版「差異處理手段順序」。
- 其他待確認：spec 缺「非目標」一節；§13 驗收情境缺 R 編號欄；§15 中已有部分答案的項目需更新。
- README：`services/analytics-engine/` 應歸屬 Kit；根目錄 `migrations/` 與「Kit 只宣告 migrations」衝突；`packages/`、`manuals/generated/` 應列入 `.gitignore`。

### CLAUDE.md 與環境

- 空白欄位：程式語言、套件管理、框架、架構總覽、常用指令、安全基準線。
- 引用不存在的 `mailbox thread`。
- Clean Code「用 Exception、不回傳 null」與 spec 結果契約（`status` 欄位、契約允許的 null）衝突。
- 專案目錄尚未 `git init`。
- 筆記庫 `18 Composer Platform 重構專案.md` 的路徑仍指向舊 Codex 輸出位置。

### 論文

- 文獻搜尋：大領域開創文獻、三年內至少 3 篇相關文獻與其缺點、SOTA 基準。
- 第 II 章數學模型：候選為完整性檢查（有型別 DAG 路徑）、設定合併函數的決定性與可追溯性、依賴解析（拓撲排序與循環偵測）。
- 第 III 章實驗：對照組為基線版；候選實驗為缺陷注入的組裝期偵測率、新增場域修改成本；資料集須去識別化（M01）。

### 討論中：LLM 在本專案的角色

**問題：**LLM 在此專案做什麼、如何協助系統建立。目前 spec 未提及 LLM 在 Composer 中的角色。

**基線版已有的設計**（筆記庫 `09 Assembly UI LLM 設計`）：輕量 LLM 為 advisor、不是最終執行者。流程為「使用者回答／樣本檔 → LLM Advisor → Recipe Draft → Rule-based Validator → Assembly Engine」。不交給 LLM 的工作：最終 schema migration、權限規則、entitlement、連線字串、安全設定、production 依賴版本。另外，analytics-kit 的 `llm-synthesis`、`rag-retrieval` subfeature 是產出系統內的 LLM 功能，模型與端點未定（測試用 `qwen3:14b`）。

**需先釐清的範圍**（三種角色，性質不同）：

| 角色 | 時機 | 例子 |
|---|---|---|
| R-A 組裝期助手 | 在 Composer 中協助 User／MIS／Developer 建立系統 | 需求轉 Recipe draft、Site Profile draft、UI definition draft |
| R-B 產出系統內功能 | 產出的 System 執行時 | analytics-kit 的 `llm-synthesis`、`rag-retrieval` |
| R-C 開發工具 | 開發本專案時 | Claude／Codex 協助撰寫程式與文件 |

**R-A 候選工作**（LLM 只產出 draft，由規則驗證器與授權人員決定）：

| 候選工作 | 對應 spec | 驗證方式 |
|---|---|---|
| 自然語言需求 → Recipe draft（選 Kit、subfeature） | §12 | capability 相依與完整性檢查（§4.1） |
| 樣本檔 → Site Profile draft（欄位語意、單位、mapping 候選） | §9 | 型別與單位驗證；別名與換算須 MIS 確認 |
| 自然語言 → UI definition draft | §6 | JSON Schema 驗證；拒絕未知欄位與 renderer |
| 分析目標描述 → task 候選 | §10.1 | 歧義時回報待選目標；演算法選擇仍以規則執行 |
| 既有程式／舊 AoV → Function、primitive、四層分類 draft | §4、基線版 AoV 遷移 | Developer 人工確認；完整性檢查 |
| 跨 Kit 手冊的銜接說明 draft | §11 | 只能引用 manifest 與已啟用功能；人工審查 |
| migration 風險的白話說明 | §7 | 不產生會被執行的 SQL |

**初步原則：**LLM 負責判斷類工作（分類、起草、摘要、萃取），確定性工作（驗證、解析、遷移執行、權限判斷）由程式負責；LLM 產出一律經 schema 與規則驗證器，失敗時回報原因，不自動重試到通過。

**與既有決議的關聯：**
- M01：送給 LLM 的樣本資料須先去識別化；偏好本機或私有部署模型。
- A12 可重現性：LLM 輸出非決定性，須記錄模型名稱／版本、prompt 版本與輸出，並以核定後的 draft 作為組裝輸入，而非每次重新生成。
- 論文：R-A 可成為一項貢獻，候選評估為 draft 相對人工標準答案的正確率、驗證器攔截率，以及 MIS 完成設定所需時間（與基線版比較）。

**待決：**論文與 spec 納入哪些角色；R-A 首批候選工作；模型選型（本機或外部 API）。
