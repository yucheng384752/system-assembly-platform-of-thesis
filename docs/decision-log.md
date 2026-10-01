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
