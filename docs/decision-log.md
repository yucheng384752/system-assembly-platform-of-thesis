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
| D85 | 2026-10-05 | 工具箱改為逐層展開：動作分類表（`config/actions.json`）每個動作新增 `category`（表單、查詢與追溯），工具箱先列類別，預設全部收合，點開類別才列出其中的工具；不屬於任何動作的「業務節點」歸在「一般」。類別是資料，新增動作時隨動作宣告，不改程式。畫面間距：卡片、表單、欄位群組與進階區塊內，輸入框、下拉選單與其下的按鈕至少隔 0.5rem（在 Chrome 稽核各畫面，原有三處貼在一起：工廠名稱與建立按鈕、下游欄位與新增關聯、Recipe 輸入框與匯入按鈕）；`[hidden]` 一律優先於 `display`，避免收合的內容被樣式蓋回來 | user 指定階梯式展開為「工具箱逐層展開」，並要求建立合適間距 | `config/actions.json`、`schemas/action-catalog.schema.json`、`WorkflowCanvas.tsx`、`style.css`、`DESIGN.md` |
| D86 | 2026-10-05 | 輸出步驟以「設定交付包」為主：第二欄標題為「設定交付包」，依序是客戶代稱、場域設定、手冊狀態、流程不完整的原因、整頁唯一的主要按鈕「下載設定交付包」；流程規格與系統設定檔的個別下載，以及載入既有設定，收進「進階：個別檔案與載入設定」（預設收合，按鈕為次要樣式，說明「交付請使用設定交付包」）。第三欄先列「設定交付包包含」，並在「皆不包含」註明交付包不是安裝包（不含程式碼、資料庫變更與安裝腳本）。檔案內容與可下載的項目不變，D36 的分別下載與 D21 的「不得稱為可安裝系統」不變。等可執行組裝（P2）完成後，設定交付包與安裝包再合併為單一下載 | user 詢問設定檔、交付包與安裝包的差異與能否整合，並依建議指示修改頁面：現在是整合呈現，而不是宣稱已可安裝；zip 目前不支援匯入，所以個別檔案仍需保留供重新載入 | `OutputPage.tsx`、`RecipeTransfer.tsx`、`StepShell.tsx`、`DESIGN.md` |
| D87 | 2026-10-05 | 欄位設定比照 CSV 的版面：標準表單的欄位改為表格，每一欄是一個欄位、第一列是欄位名稱，第一欄是設定項目（型別、必填、識別欄位、驗證、操作），必填與識別欄位為各欄位下方的核取框；表格在自己的區域內橫向捲動且可用鍵盤聚焦，欄位的無障礙名稱不變（欄位 N 名稱、型別、必填、識別欄位、刪除欄位 N）。驗證規則在儲存格內收合，摘要顯示「未設定」「N 項規則」或「請檢查」。拖曳與點擊的分界：按下到放開移動在 4px 以內是點擊（選取並打開細項），超過是拖曳（只移動節點）；開始拖曳不再選取節點，剛拖曳完隨後補發的點擊與選取一律忽略 | user 要求欄位設定比照 CSV 佈局，並指出拖曳常被當成點擊而打開細項。原因：React Flow 預設在開始拖曳時就選取節點，而畫面把「被選取」等同於「打開細項」；在 Chrome 模擬一次完全沒有點擊事件的拖曳（移動 117px）即重現 | `NodeForm.tsx`、`WorkflowCanvas.tsx`、`style.css`、`DESIGN.md` |
| D88 | 2026-10-05 | 標準表單的欄位設定（CSV 版面的表格）新增「展開全螢幕」按鈕：開啟一個對話框（`role="dialog"`、`aria-modal`），在畫面上水平與垂直置中，背景為淡黑色（黑色 45% 透明）；對話框掛在頁面最外層，不會被側邊面板蓋住，焦點限制在其中，可用 Escape、「關閉全螢幕」或按背景關閉，關閉後焦點回到「展開全螢幕」按鈕，開啟期間背景不捲動。對話框內可新增、刪除欄位並做刪除確認，欄位全部刪完時自動關閉。功能選配步驟移除「相依功能」區塊（目前選了 N 個流程、M 項功能與一串自動加入的原因）；流程所需功能各自保留原因，進階的功能目錄與搜尋不變。不新增「填寫表單」動作：基線版通用表格只能以 CSV 匯入資料，沒有逐筆填寫的功能，使用者要求維持現狀（填寫表格的工作以業務節點加標準表單表示） | user 指定欄位設定可全螢幕調整、移除相依功能區塊、不要新增填寫表單動作 | `Modal.tsx`、`NodeForm.tsx`、`FlowPage.tsx`、`catalog.ts`、`DESIGN.md` |
| D89 | 2026-10-06 | 工具箱擴充：基線版 Kit 中有業務或維運意義的功能轉成節點工具（Action），但只轉「原始碼可驗證」的 Kit。本輪轉 `upload-validation-kit`、`import-pipeline-kit`、`analytics-kit`、`audit-edit-kit`、`mod-subscription-kit`、`logs-ops-kit`、`platform-core-kit`（API 部分）、`generic-forms-kit`（瀏覽）。`station-admin-kit` 排除：契約宣告 `/api/stations`，但基線版任何位置都沒有 `routes_stations.py`，補不齊來源即不上架。`kit.capability.call` 是通用轉發端點，視為內部機制不做工具。`tenant-auth-kit`、`entry-permission-kit` 不轉（D03） | user 指定平台與維運也要轉換、來源補齊後才上架；D68 規定契約未完整的 Kit 不得參與推導 | `config/actions.json`、`config/registry/` |
| D90 | 2026-10-06 | 補齊 `upload-validation-kit`（11 個檔案）與 `import-pipeline-kit`（4 個檔案）的後端原始碼：來源為基線版 `dist/generated-system/backend/app`（基線 commit `c4b2b7b`，各 Kit 的路由對應依基線版 `assembly/backend-registry/backend_router_registry.py`），複製不改內容並記入 `kits/BASELINE.md`。共用依賴（`app.core`、`app.config.constants`、`csv_field_mapper`）不複製，記為外部依賴。`station-data-link-kit` 的 `routes_import.py` 不在組裝後端中，維持無原始碼，D68 的處理不變 | user 選方案 A；基線版 `kits/` 目錄本身只有契約與 CSS，原始碼只存在於組裝輸出；registry 需要可驗證的實作位置 | `kits/BASELINE.md`、`kits/upload-validation-kit/`、`kits/import-pipeline-kit/` |
| D91 | 2026-10-06 | `import-records` 的顯示名稱由「匯入紀錄」改為「匯入資料列」（寫入表單資料列），id 不變；新增 `import-job-track`「匯入工作追蹤」（對應 `import.job.*`，追蹤一次匯入的狀態、錯誤與確認寫入），兩者分屬不同類別 | 避免「紀錄」同時指資料列與過程；user 描述的「上傳到進 DB 的步驟完成紀錄」對應後者；id 不變不影響已存流程文件 | `config/actions.json` |
| D92 | 2026-10-06 | 新動作的 `parameters` 只宣告 id、名稱、型別、必填與範圍，不填 `default`，不新增 mock 範例資料。寫入或高風險動作（修正紀錄、權限設定）只作為設定交付包的需求描述，Composer 內不執行（預覽無副作用） | user 指定必要資料不含範例 mock 與預設參數 | `config/actions.json` |
| D93 | 2026-10-06 | 放寬兩份 schema：`kit-registry.schema.json` 的 capability `method` 加入 `PATCH`、capability id 格式改為 `^[a-z0-9._-]+$`（允許底線）；`action-catalog.schema.json` 的 `requires` 同步。既有資料全部仍通過。`platform.health`（`GET /healthz`）契約有宣告但 `platform-core-kit` 原始碼沒有實作，`check-health` 不上架，registry 記 `implementedBy: null`、`verified: false`。`db.upload.jobs.list` 的實作在 `platform-core-kit` 的 `db_capabilities.py`，如實登錄於 platform-core，不記成 upload-validation 的函式 | 基線契約本身用了 PATCH（`records.edit`、`edit-reasons.update`）與底線（`import.job.from_upload`），原樣登錄比改名誠實；user 同意放寬；測試證明不放寬時 2 項會失敗，放寬後仍拒絕 TRACE 與含空白大寫的 id | `schemas/kit-registry.schema.json`、`schemas/action-catalog.schema.json`、`apps/composer-gui/src/registry.test.ts` |
| D94 | 2026-10-06 | 契約宣告的端點在原始碼找不到、但原始碼有實作其他端點時，沿 D67 處理，不改 Kit、不改契約：契約的 capability 照原樣登錄為 `declared: true`、`verified: false` 並附 note 說明差異；原始碼實際存在的端點另登錄為 `declared: false`、`verified: true` 的 capability（id 以功能命名，note 註明與契約的對應）。動作的 `requires` 只引用 `verified: true` 的實作。首例：`mod-subscription-kit` 契約 `subscriptions.manage`（`GET /api/mod-subscription`）找不到，實際為 `/api/mod` 下的同步、webhook、查詢、權益四個端點。路徑僅差前綴或尾端斜線（如 `logs.list` 的 `/api/logs` 與路由 `/`）者，記 `verified: true` 並在 note 寫明組裝前綴。推導驗收訂為「不新增缺口」：新動作只可帶出既有的 `db.tenants.read` 缺口（其提供者 `tenant-auth-kit` 已廢除，D03），測試逐項斷言，既有 `actions.test.ts` 的缺口斷言保留 | 如實記錄差異又能讓有實作的功能上架；零缺口驗收與既有缺口測試互相矛盾，且缺口為真實狀態，不應被掩蓋 | `config/registry/`、`config/actions.json`、`apps/composer-gui/src/actions.test.ts` |
| D95 | 2026-10-15 | 三代 AOV 合併：user 授權修改第三代 `aov-project`（C）以補完整專案 Schema 與輸入驗證（計畫書 M03）。修改須保留 C 的 core 單一來源與零執行期依賴不變式，由 Claude 執行（超出 Codex 工作目錄） | user 明確授權 | `C:\Users\gslab\Desktop\aov-project`、`docs/aov-three-generation-merge-plan.md` |
| D96 | 2026-10-15 | 整合包另立格式 `composer-aov-bundle`，不併入既有設定交付包（`package-manifest.schema.json`）；兩者各自版本化，交付包可引用整合包 | user 指定另立格式 | `schemas/aov-bundle.schema.json`（擬新增）、`docs/aov-three-generation-merge-plan.md` |
| D97 | 2026-10-15 | 三代 AOV 合併的轉換規則：date 轉 datetime 時保持 ISO 日期值、不補時間，遷移報告固定列「僅日期，無時間」；decimal 預設轉 number，有單位且用於數量時才轉 quantity；integer 與 decimal 的單位須由使用者指定或標為「無單位」，否則阻擋該欄位。未知格式或版本一律拒絕；無法轉換的第一代舊格式只讀保存原檔並列入遷移報告。A＝AOV_generation_system、B＝composer-refactor 的世代對應確認 | user 同意採 Claude 建議；C 的 formCsv 已將「日期」對應 datetime，Date.parse 可讀日期值，補時間屬無依據的值 | `docs/aov-three-generation-merge-plan.md` §10.3、§12 |
| D98 | 2026-10-15 | M03 實作範圍：在 `aov-project` core 新增 `model/shape.ts` 的結構檢查（專案檔與動作庫），`validateProject` 先檢查再解析；編輯器開啟專案、讀取本機草稿、匯入動作庫三處改用同一檢查。id 只要求非空字串，不新增字元限制（C 原本沒有此限制，B 的映射須保存來源 id）；core 仍零執行期依賴 | D95 授權；`validateProject` 對 nodes 非陣列丟出例外，且三處入口各自只看 formatVersion | `C:UsersgslabDesktopaov-project` 的 `packages/core`、`apps/editor`、`docs/aov-merge-inventory.md` §6 |
| D99 | 2026-10-16 | 去識別化系統使用範例（`docs/example-scenario.md`）：以通用的「配料混合產線」為情境，來源案例的公司、產品、設備名稱與全部製程數值皆不保留。呈現方式採兩者並行：輸入框提示文字（使用者可關閉）與「載入範例」按鈕。載入範例只新增一個固定 id 的範例工廠，不覆蓋既有資料，可一鍵清除；提示文字與提示開關不進文件也不進匯出；載入後的範例資料是一般工作區資料，正常參與匯出與匯入。範例資料同時作為整合 fixtures 的 B 側通用來源（取代自行合成的 v5 樣本；v1 至 v4 改以同一情境表達，供舊版升級測試） | user 要求把案例改為可引導填寫的範例；M01 規定未去識別化資料不得進 repo | `docs/example-scenario.md`、`apps/composer-gui/src/`（FactoryPage、NodeDetails、NodeForm、新增 exampleHints）、`fixtures/aov-merge/b/` |
| D100 | 2026-10-18 | Kit 流程描述（thread 20261016-kit-workflows-live-preview 首個增量）：各 kit 以 `kits/<kit-id>/workflow.aov.json` 保存描述性流程（格式 `composer-kit-workflow` v1，新增 `schemas/kit-workflow.schema.json`），只描述步驟與明確有向邊，不代表執行；選配後彙整為流程總表，畫面與設定交付包使用同一彙整函式。設定交付包新增 role `kit-workflow`（`aov/kit-workflows.json`、`aov/kit-workflows.md`），`package-manifest.schema.json` 的 artifacts 上限由 8 改 10。缺漏與草稿逐項標示，驗證報告的 `kit-workflows` 項為 not-provided 時不阻擋交付。嚴格依舊 schema 解析新交付包的外部消費端須同步升級 | user 於 2026-10-16 授權；總表需隨交付包附上，原上限不足 | `schemas/kit-workflow.schema.json`、`schemas/package-manifest.schema.json`、`libs/ui-runtime/schema.ts`、`apps/composer-gui/src/kitWorkflows.ts`、`deliveryPackage.ts`、`OutputPage.tsx` |
| D101 | 2026-10-18 | 核定三代 AOV 合併計畫書第 10 節契約草案並採三項修正：整合包為單一 JSON 檔、上限 10 MB；bindings 的 `sourceVersion` 用表單內容的 sha256（正規化 JSON）；manifest 雜湊只偵測損壞或改動，不當簽章。整合包格式 `composer-aov-bundle` 另立（D96）。派工順序：先做範例功能（D99），再做 M02、M04，一次只派一個 Codex 工作以免同時改同一批檔案 | user 於 2026-10-18 核定 | `docs/aov-three-generation-merge-plan.md` §10，`.codex-claude-mailbox/threads/20261015-aov-merge-contract.md` |
| D102 | 2026-10-18 | 整合層的依賴方向：`libs/aov-integration` 的基礎元件（`sha256Hex`、動作目錄解析）自行取自 libs 與 `config/`，不再從 `apps/composer-gui` 匯入；`workflow.ts` 的 `sha256Hex` 改為由 libs 重新匯出，既有匯入端不變。整合層是 B 的轉接層，允許以 `import type` 引用 B 的文件型別，也允許轉接模組呼叫 B 既有的舊版升級函式（如 `importWorkflow`），因為轉接 B 的舊版本必須沿用該升級路徑（M04）；其餘值層級依賴一律不得指向 apps | 整合包審閱發現 R01：libs 反向依賴 apps 會擴大 | `libs/aov-integration/`、`apps/composer-gui/src/workflow.ts` |
| D103 | 2026-10-19 | M05 引用 C 的 core 採固定版本複製：`aov-project/packages/core/src` 複製為 `libs/aov-core/`（18 個檔案，零第三方依賴，不新增 npm 依賴），以 `scripts/sync-aov-core.mjs` 同步並寫入 `libs/aov-core/VERSION.json`（來源提交與各檔 sha256）；同步腳本拒絕來源有未提交變更或不是 git 專案。為使來源版本可追溯，C 於 2026-10-19 建立 git 並提交基準快照 6a37dbb（含 D98 的結構檢查；雜散目錄 `%SystemDrive%` 加入忽略）。快照不得手動修改，測試以雜湊檢查。排除的方案：本機路徑連結（乾淨環境無法還原、產物帶個人路徑）、私有套件（需新增發佈環境與依賴） | user 同意複製固定版本與 C 的 git init | `libs/aov-core/`、`scripts/sync-aov-core.mjs`、`apps/composer-gui/src/aovCore.test.ts`、`C:\Users\gslab\Desktop\aov-project` |
| D104 | 2026-10-19 | 真實預覽（thread 20261016-kit-workflows-live-preview 的 WP4 至 WP6）範圍定為全部相容 Kit（排除已廢除的 `tenant-auth-kit`）。可從基線版複製的共用後端來源先複製：自 `dist/generated-system/backend/app` 逐檔原樣複製 15 個檔案進 `platform-core-kit/src/backend/app/` 作為共用基底（`core/*`、`api/deps.py`、`config/constants.py`、`models/generic_record.py`、`models/core/*`、`schemas/audit.py`、`services/csv_field_mapper.py`、`utils/normalization.py`），不修改內容。複製不了的缺口（`import-pipeline-kit` 的 P1／P2／P3 紀錄模型、`routes_stations.py`、`routes_import.py` 等）列為必須完成的待辦（`docs/preview-todo.md`），在決定前明確回傳「不支援」，不得靜默略過或以模擬資料冒充 | user 要求全部相容 Kit、能複製的先複製、不能複製的建立待辦 | `kits/platform-core-kit/src/backend/app/`、`kits/BASELINE.md`、`docs/preview-todo.md` |
| D105 | 2026-10-19 | 預覽執行環境固定為 Docker 加 PostgreSQL，Windows 與 Linux 皆使用同一組合；預覽後端只綁定本機、不連外、不使用正式資料或外部訂閱服務。資料表以模型建立並提供重置。Codex 沙箱不能開埠或執行 Docker：Codex 只寫程式與設定，容器啟動、真實 API、資料寫入與重置的實測由 Claude 執行並記錄 | user 指定使用 docker 加 postgresql、也要能在 Linux 使用 | `services/preview/`（擬新增）、`docs/preview-todo.md` |
| D106 | 2026-10-19 | 真實預覽實測後的設計修正（D105 補充）：（1）後端宿主預設埠 18000、可用 `PREVIEW_API_PORT` 覆寫，PostgreSQL 不發布到宿主（Windows 保留埠段會使固定埠無法綁定）；（2）網路拆為內部的 `data`（PostgreSQL 與後端）與僅供後端發布埠的 `edge`，因 `internal: true` 會使發布埠失效；後端不被網路層阻擋對外連線，隔離改靠固定假值與不含外部服務設定，D105 的「不連外」改為此語意；（3）預覽入口提供身分替身（固定假金鑰與 `X-Preview-Role` 標頭）以便測試管理員與角色限定端點，不是驗證機制，授權仍標為未涵蓋；（4）煙霧測試將已知缺口標為 GAP 而不是通過，缺口登錄於 `docs/preview-todo.md` T9、T10 | 實測發現原設計下宿主連不上、管理員端點永遠 403；user 要求能實際使用 | `services/preview/`、`docs/preview-todo.md` §4 |
| D107 | 2026-10-20 | 預覽缺口 T1、T9、T10 的處理（user 於 2026-10-20 決定）：T10 同意補丁，於組裝階段（`services/preview/assemble.mjs` 的 `adapt`）把 `routes_logs.py` 的日期字串參數轉為 datetime，回應仍回傳原本的 ISO 字串，錨點不符即拒絕套用；基線複製檔不修改。T1 為 `import-pipeline-kit` 的 P1／P2／P3 分支建立通用紀錄模型，T9 補 `table_registry` 的預覽種子與對應資料表。T1、T9 的內容只可依基線程式實際使用的欄位與行為推導，不得含來源案例的真實名稱、欄位語意或資料；通用模型與種子放在 `services/preview/`，不寫進 `kits/` | user 指定 T1 建立通用模型、T9 補種子、T10 同意補丁 | `services/preview/assemble.mjs`、`services/preview/app/`、`docs/preview-todo.md` |
| D108 | 2026-10-20 | WP5、WP6 的設計（user 同意 Claude 建議）：（1）選配唯一來源為 Composer 產生的 Recipe，預覽後端只做 schema 驗證與依賴／子功能存在檢查，無效 Recipe 原子拒絕；（2）無 Recipe 為 `all` 模式、有 Recipe 為 `recipe` 模式；（3）以 registry 的 method 加 path 樣板判定能力與 Kit，子功能層級沿用 kit workflow 的綁定，registry 未登錄的路由依 `preview_registry.json` 前綴歸屬並預設拒絕；（4）未開放者回 403，`/api/kit/call/{capability}` 通用轉發端點同樣判定，不得繞道；（5）切換選配只改存取權限、不刪資料，清空用 `reset`；（6）提供 `GET/PUT/DELETE /_preview/...` 端點供畫面與測試共用，寫入需預覽管理員標頭；（7）獨立組裝 `--recipe` 模式只含所選 Kit，匯入缺口明確報告。預覽測試於 WP5 驗收後納入 `npm test`（user 決定）。Linux 實測使用 VM，環境由 user 提供：先前的 192.168.200.63 目前不通，且該主機沒有 Node 與 Docker | user 指示 WP5、WP6 依建議實作、預覽測試之後納入 npm test、要 Linux VM 測試 | `services/preview/`、`docs/preview-todo.md` |
| D109 | 2026-10-20 | 更正 D108 的 Recipe 驗證規則（Codex 於 WP5a 前置檢查發現矛盾）：Composer 的 `selectKits` 會把 `entry-permission-kit`（取代已廢除的 `tenant-auth-kit`）與 `station-data-link-kit` 帶進多數業務 Recipe，但預覽組裝器因無後端來源而排除它們，若要求「enabledKits 全為已納入組裝」與「依賴完整」同時成立，Composer 產生的 Recipe 都會被拒絕。更正：（1）`enabledKits` 必須是 Composer 目錄中存在的 Kit，否則 422；（2）目錄中存在但預覽沒有後端的 Kit（`entry-permission-kit`、`station-data-link-kit`、`station-admin-kit`）視為「預覽不可用」，Recipe 可套用，但這些 Kit 的路由不存在、請求一律回 403 並註明「預覽無來源」，並列在 `GET /_preview/capabilities` 的 `unavailable` 欄位與原因；（3）已納入組裝的 Kit 之間的必要依賴必須完整，缺漏回 422；（4）已納入 Kit 對「預覽不可用 Kit」的依賴只產生警告，列在回應的 `warnings`，不阻擋套用，也不代表該依賴已被滿足。不得因此放寬其他檢查或把無來源的 Kit 當作可執行 | 設計矛盾由 Claude 決定，維持「不隱藏缺口、不放行未驗證功能」的原則 | `services/preview/`、`docs/preview-todo.md`、D108 |
| D110 | 2026-10-20 | AoV 正式畫布規則（user 於 2026-10-20 核定，本列為補記編號）：沿用 React Flow；節點可自由拖曳，位置存於 layout，不代表先後語意；連線與拖曳中的預覽線一律為單段直線，允許右上與右下斜線，不用曲線；連線端點可重新接線並保留連線 id，非法重接（自我連線、違反開始或結束約束、形成循環）整筆拒絕並保留原線與錯誤訊息；建立子 AoV 後直接進入其畫布，以層級列返回，最多三層，每張圖獨立保留位置；`addChildGraph` 對系統節點、已有子圖的節點、深度與數量上限一律拒絕。實作 `reconnectCanvasEdge`、`graphPath`、`graphIssues`（錯誤附帶節點、表單、欄位位置，輸出頁可「前往修改」） | user 要求 AoV 畫布採單段直線、可重新接線、建立子流程後直接進入 | `apps/composer-gui/src/WorkflowCanvas.tsx`、`canvasEditing.ts`、`workflowGraph.ts`、`DESIGN.md` |
| D111 | 2026-10-20 | 參數設定步驟與生產設定（審閱時補記，由另一個 Codex 工作階段實作，無原始規格紀錄；以程式行為為準）：步驟改為四步（01 流程畫布、02 功能選配、03 參數設定、04 輸出）；Recipe 新增可選欄位 `productionSettings`（version 1）：批號格式（代碼、名稱、含 `{流水號}` 的樣式，欄位只可用 `{廠區}`、`{產品}`、`{類別}`、`{日期}`、`{流水號}`）、預設格式、產品規格（產品代碼與名稱、批號格式、檢驗表單與數值欄位、上下限、單位）。匯入 Recipe 與下載設定交付包前驗證，下限大於上限或綁定欄位不存在時整份拒絕；批號樣本只用於顯示，不實際發號；這是初始設定，不覆寫場域鎖定的 Kit 設定，也不代表後端已套用。`schemas/recipe.schema.json` 新增對應定義（檔案同時被重新排版，內容語意只新增此欄位） | 另一個工作階段依 user 任務新增；審閱補測試與決議 | `libs/ui-runtime/production.ts`、`recipe.ts`、`types.ts`、`schemas/recipe.schema.json`、`ProductionPage.tsx`、`OutputPage.tsx` |
| D112 | 2026-10-20 | 逐站模擬（審閱時補記）：功能選配頁的預覽新增「逐站模擬」，讀取正式流程的表單與驗證規則依序演練填寫；前置作業未完成不能完成後站（平行作業可各自填寫），檢驗欄位依所選產品的上下限判定；只演練填寫，不執行 AoV、不寫任何資料、不連後端；狀態只存本次工作階段，流程或設定改變時完成狀態重設 | 同 D111 | `WorkflowSimulation.tsx`、`simulation.ts`、`KitPreview.tsx`、`FlowPage.tsx` |
| D113 | 2026-10-20 | 產業紀錄範本（審閱時補記）：畫布工具箱新增 68 個範本，涵蓋生產與物料、品質與異常、設備與準備、資料與表單，以及金屬加工、熱處理與表面處理、塑橡膠、食品飲料、紡織染整、配方加工、電子組裝；每個範本只是以既有表單功能建立一個節點與一張欄位起點表單（數量與量測類欄位為數值型，其餘為文字型），不代表設備控制、庫存或簽核引擎。範本名稱與欄位為各產業通用製程用語，審閱時以專有詞彙清單比對，僅 3 處（攪拌混合、調色調黏度、錫膏印刷）屬通用製程名詞，已提示 user，不阻擋 | 同 D111 | `industryTemplates.ts`、`industryTemplates.json` |
| D114 | 2026-10-20 | 審閱時的保留與修正：（1）輸出頁的「檔案內容」欄位（說明設定交付包包含與不包含的項目、以及「設定交付包不是安裝包」）原被移除，經審閱恢復，因為它是安全與期望管理的揭露，且既有測試保護此意圖；（2）步驟改為四步後，既有測試的步驟編號由 03 改為 04；（3）新增 19 項測試涵蓋生產設定驗證、Recipe 往返、逐站模擬規則與產業範本，並以變異測試確認測試會失敗 | 審閱結果 | `OutputPage.tsx`、`production.test.tsx`、`output.test.tsx`、`siteUi.test.tsx`、`StepShell.test.tsx` |
| D115 | 2026-10-20 | 預覽的測試與缺口（WP5、WP6 收尾）：預覽的 Node 測試納入 `npm test`（`package.json` 的 test 指令加上 `node --test services/preview/tests/preview.test.mjs`）；Python 靜態測試需要固定版本的 `jsonschema`，維持獨立指令，README 說明建立測試環境的方式；新增缺口 T13（`platform-core-kit` 的資料庫能力延遲匯入其他 Kit 的模型，「核心加通用表單」無法獨立部署，最小可獨立集合為 5 個 Kit，組裝階段 fail-closed 報告）；Linux 主機（Ubuntu 22.04、Docker 29.1.3）實測通過 | user 要求 WP5 完成後把預覽測試加入 npm test、並以 Linux VM 實測 | `package.json`、`services/preview/`、`docs/preview-todo.md` §5、§6 |

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

## 2026-10-20：AoV 畫布新增規則（使用者核定）
正式畫布沿用 React Flow，節點自由拖曳、連線端點可重新接線。連線及連接中的預覽線一律單段直線，可向右上／右下，不用曲線。子 AoV 可建立與編輯，建立後直接進入，以層級列返回；保留三層限制、無循環及開始／結束約束。重新接線原子替換並保留 id，非法重接不改原文件。實作與驗證詳見 Obsidian [[2026-10-20 AoV 正式畫布規則]]；DESIGN.md 同步記錄。

| D116 | 2026-10-20 | 畫面偵測預覽後端並依實際狀態標示：只透過同源代理 `/preview-api/` 探測 `GET /healthz`（回應 200 且 `preview === true`、`status === 'ok'` 才算連線，逾時 3 秒，不輪詢，可手動重新偵測）；標籤逐畫面計算，後端連線、Recipe 已套用、該 Kit 開放、屬第一批四項同時成立才顯示「真實預覽」，否則維持「模擬資料」並說明尚未接上真實資料；靜態打包版沒有代理，探測失敗即模擬資料 | user 同意畫面接線最小範圍；記憶「標籤要符合實際」 | `apps/composer-gui/src/previewBackend.ts`（擬新增）、`KitPreview.tsx` |
| D117 | 2026-10-20 | 選配推送：連線後 Recipe 變更經 400 毫秒防抖 `PUT /_preview/recipe`（標頭 `X-Admin-API-Key: preview-fake-admin-key`，D106 固定假值，不是驗證機制），成功後 `GET /_preview/capabilities` 決定各 Kit 為開放、被拒絕或預覽無後端；分頁仍可選取並以文字標示狀態；422 時顯示後端原因並視為未套用，不顯示真實預覽 | user 指定推送 Recipe 並用 capabilities 決定分頁 | `previewBackend.ts`、`KitPreview.tsx` |
| D118 | 2026-10-20 | 第一批真實畫面為通用表單（列表、建立、檢視資料列）、上傳驗證（上傳、狀態、驗證結果）、追溯查詢（批號查詢與追溯）；欄位與回應形狀須由 `kits/` 後端原始碼與 `smoke.mjs` 推導，不得猜測；後端文字一律純文字；畫面只用業務語言；404 時提示預覽資料尚未初始化；真實預覽的寫入僅在使用者按鈕觸發、僅寫本機預覽後端並標明「寫入預覽資料庫（測試用）」，模擬畫面不發請求；其餘 Kit 維持模擬資料並標明 | user 指定第一批三個畫面 | `apps/composer-gui/src/live/`（擬新增） |
| D119 | 2026-10-20 | 跨網域用 Vite 開發伺服器代理處理：`/preview-api` 代理到 `http://127.0.0.1:${PREVIEW_API_PORT ?? 18000}` 並移除前綴；不放寬後端 CORS、不修改 `services/preview/` | user 指定 | `vite.config.ts` |
| D120 | 2026-10-20 | 修正 D108 對映像的原子拒絕：Recipe 選到有來源但未納入此映像的 Kit 時不再整批回 422，改為警告「未納入此映像，請重新組裝」並列入 `GET /_preview/capabilities` 的 `unavailable`（原因「未納入此映像」），該 Kit 路由仍回 403；其他 Kit 照常升級為真實預覽。已納入 Kit 依賴未納入 Kit 時只產生警告，不代表依賴已滿足（與 D109 對預覽無來源者一致）。schema 錯誤、未知 Kit、已納入 Kit 間依賴缺漏、子功能錯誤仍為 422。畫面不需改，沿用 `unavailable` 逐 Kit 標示 | user 指定只標示未納入的 Kit | `services/preview/app/preview_gate.py`、`test_static.py`、`previewBackend.test.tsx` |
| D121 | 2026-10-21 | 完成 T4：registry 標為 `verified: false` 的契約宣告端點（`subscriptions.manage`、`query.records.search`）在預覽閘門一律回 403「契約已宣告但原始碼沒有對應實作」，不再放行到 404；`platform.health` 例外，因 `/healthz` 由預覽自己提供。組裝時在 policy 的 capability 加 `unverified` 旗標，閘門在 Kit 與 Recipe 判定之前先拒絕。訂閱的外部服務沿用 D106 的本機假服務與固定假金鑰，不連外 | 依 `docs/preview-todo.md` T4 完成條件「預覽只啟用 verified 的端點」；user 指示照順序實作缺口 | `services/preview/assemble.mjs`、`services/preview/app/preview_gate.py`、`docs/preview-todo.md` |
| D122 | 2026-10-21 | 完成 T13：組裝檢查放寬「有保護的可選匯入」，並新增「字串外鍵閉包」。（1）匯入在 `try` 主體、所有 `except` 只捕捉 `Exception`、`ImportError` 或 `ModuleNotFoundError` 且最後一個敘述為 `raise`（基線的 501 模式）時，缺少的 `app.*` 目標不算錯，逐項列入 `assembly-report.json` 的 `optionalImports`；其他形式（無 `try`、`except` 只 `pass`、其他例外型別、裸 `except`、匯入在 `except` 或 `else`）仍拒絕。（2）`ForeignKey("表.欄")` 指向未納入的資料表時，組裝階段拒絕，避免容器啟動才崩潰。（3）最小可獨立集合由 5 個降為 3 個：platform-core、generic-forms、audit-edit。運行時仍有兩層保護：閘門回 403，閘門被繞過時為 501。fail-closed 語意由「任何缺口都拒絕」改為「只放行必須明確失敗的可選匯入並逐項揭露」 | user 指定放寬檢查器；查證基線將這些匯入標為 optional 且回 501 | `services/preview/check_tree.py`、`services/preview/assemble.mjs`、`docs/preview-todo.md` |
| D123 | 2026-10-21 | 完成 T12（user 選 C）：預覽組裝補丁把基線的「已登記於 `table_registry` 即為實體資料表」改為「已登記且實體資料表存在」，涵蓋通用表單列表、核心紀錄搜尋、核心趨勢三處判斷點；匯入進通用表單的資料列因此可由表單列表讀回，趨勢分析不再回 500。有實體表的領域表行為不變，並以回歸測試與變異驗證確認。補丁只改預覽組裝複本，`kits/` 與設定交付包不變，P2 可執行組裝需套用同樣判斷，列為 P2 輸入 | user 指定 T12 選 C；基線的兩種儲存模式（通用資料列、實體領域表）原本無法並存於同一代碼 | `services/preview/assemble.mjs`、`services/preview/smoke.mjs`、`services/preview/smoke-domain.mjs`、`docs/preview-todo.md` |
| D124 | 2026-10-21 | 啟動 P2 可執行組裝：產出可啟動的系統包（後端、前端、安裝腳本），完成後與設定交付包合併，client 只收一份壓縮檔。第一版涵蓋所有有可執行來源的 Kit（9 個），tenant-auth（D03）、station-admin（T2）、station-data-link（T3）、entry-permission（無 backend）不虛構程式碼，列入 manifest `notIncluded` 並寫原因。預覽組裝（含 T12 補丁、T13 外鍵閉包與可選匯入檢查）為重用基礎；預覽專用項目不進系統包。P2 實測通過前，D21、D32 的「設定交付包、不得稱可安裝」文字維持不變，通過後才更新 spec 第 12 節 | user 指定產出可啟動系統包、涵蓋所有已紀錄 Kit、含前端、合併為單一壓縮檔；安裝形式與 Docker 前提為 Claude 假設，待 user 確認 | `.codex-claude-mailbox/threads/20261021-p2-executable-assembly.md` |
| D125 | 2026-10-21 | user 核准自基線逐檔補進 `kits/`：（1）`platform-core-kit` 的 `tenant_user.py`、`tenant_api_key.py`（五個 Kit 的外鍵目標，只有資料表，無身分驗證實作）；（2）`station-data-link-kit` 的 P1/P2/P3 相容轉接器（`routes_import.py`、`p1/p2/p3` 與 `record`、`p2_item`、`p3_item` 模型、`import_data` schema、`production_date_extractor`）。推翻 T3「無來源」與 T1「基線沒有這些模組」兩個前提，預覽移除 D107 自建相容模型與 `tenant_api_keys` 空表，改用真實模型，納入 Kit 由 9 增為 10（排除 3：tenant-auth、station-admin、entry-permission）。副作用：station-data-link 變成可用 Kit 後，Recipe 驗證器要求依賴閉包，最小可獨立集合由 3 個（D122）變為 6 個（platform-core、generic-forms、audit-edit、station-data-link、upload-validation、import-pipeline），且已無任何缺口，`optionalImports` 為空；D122 的放行規則與外鍵閉包仍由單元測試覆蓋。基線行為記錄：`POST /api/import` 會匯入驗證工作的全部列，不剔除驗證器標為無效的列，未修改 | user 於 2026-10-21 指示補齊 tenant_api_keys 與 station-data-link，並以真實模型取代 D107 自建模型；station-admin（`routes_stations.py` 基線全域不存在）與 entry-permission（無基線後端）維持排除 | `kits/BASELINE.md`、`services/preview/assemble.mjs`、`services/preview/tests/`、`services/preview/smoke*.mjs`、`docs/preview-todo.md` |
| D126 | 2026-10-22 | `docs/install-engine-contract.md` 升為正式決議，並改為 Docker Compose 部署：客機為 Ubuntu 22.04 LTS 且可安裝 Docker，後端、PostgreSQL 16、反向代理以容器執行，不用 apt 裝資料庫與 systemd；子命令（`detect`、`verify`、`plan`、`apply`、`status`、`cancel`、`rollback`）、`plan.json` 綁定 `planSha256`、秘密值只走標準輸入或 0600 暫存檔、事件 JSON Lines、退出碼、還原語意維持原契約。第 8 節待決（脫離終端機、狀態檔位置與權限、JSON Schema、精靈依賴）仍須在實作中決定並實機驗證 | user 於 2026-10-22 指示走方案 A（Docker Compose）、客機可裝 Docker，並把安裝引擎升為正式決議 | `docs/install-engine-contract.md` 第 9 節、`.codex-claude-mailbox/threads/20261021-p2-executable-assembly.md` |
| D127 | 2026-10-22 | entry-permission-kit 設計決議（取代 tenant-auth-kit，D03）：（1）角色為資料表可設定，內建 `admin`、`audit`（唯讀）、`manager`、`operator`，不內建產線 `qc`；（2）第一版不做產品範圍；（3）入口目錄由各 Kit 於 `kit.contract.json` 的 `entryPoints` 宣告、組裝時彙整為 `permissions/entry_points.json`（新增 `schemas/entry-points.schema.json`）；（4）以一個共用認證與入口授權中介層取代對終端使用者的 `AUTH_MODE=api_key`，設定 `request.state.is_admin`、`actor_role`、`auth_tenant_id` 讓既有 Kit 不必修改，`X-Admin-API-Key` 保留為機器對機器；（5）新依賴 `PyJWT==2.15.1`、`bcrypt==5.0.0`；（6）租戶固定單一預設租戶，不改 D125 補進的 `tenant_users`、`tenant_api_keys`；（7）SSO、MFA 不做；（8）未選此 Kit 的系統必須明確選擇替代（沿用 API key 或受限制公開），不得預設匿名全權。判定順序：停用拒絕、唯讀角色對寫入入口一律拒絕、使用者覆寫、角色授權、入口預設角色；未列入任何入口的 `/api` 路徑只有 `admin` 可通過。JWT 金鑰缺少或短於 32 字元時啟動失敗（來源只記警告） | user 於 2026-10-22 對 EP 八項決定皆採 Claude 建議，租戶固定單一，並核准依賴選擇；設計細節見 `docs/entry-permission-design.md` | `docs/entry-permission-design.md`、`schemas/entry-points.schema.json`、`.codex-claude-mailbox/threads/20261022-entry-permission-kit.md` |
