# 接手文件：產品上線與論文證據的範圍、判準與待辦

日期：2026-11-11
讀者：接手這項工作的 subagent。你沒有先前對話的脈絡，本文件是唯一的交接來源。
狀態：第 2、3 節是 user 的決定；第 4 節的判準是 Claude 起草的草案，**user 尚未核定**；第 5 節的做法是 Claude 的建議，尚未決定。
決議編號：本文件沒有取號。需要寫入 `docs/decision-log.md` 時，先看 `main` 與各分支用到幾號（2026-11-10 已用到 D202，另一個 session 預留 D203 起），並通知其他 session 後再取。

動手前必讀：專案根目錄的 `CLAUDE.md`（回覆用繁體中文、不用 emoji、每個功能開專屬分支、新增依賴須先經 user 核准、提交用約定式提交且**不加任何 Claude 署名**）。

## 1. 一頁摘要

- 專案的「完成」同時指兩件事：**可以上線的產品**，以及**論文的證據**。
- 論文主張（user 原話）：「用AoV畫布將工廠或是已經成熟的workflow轉換成電子化的操作」。
- 論文的成熟案例是一套實際運作過的系統 `C:\Users\gslab\Desktop\Form-analysis-server-specify-kit`，要用 Composer 把它復現出來。
- 產出的系統跑在 Linux（Ubuntu）上，由 user 公司的工程師維護。
- 下一步的順序：先核定「轉換成功」的判準（第 4 節），再做復現；產品線的安全待辦（第 5 節）等部署情境補齊後逐項決定。

## 2. user 的決定（2026-11-10 至 11-11）

| 編號 | 決定 | 影響 |
|---|---|---|
| U1 | 完成 = 可上線的產品 + 論文的證據，兩者都要 | 每項工作要歸到其中一條線，見第 3 節 |
| U2 | 論文主張是「用 AoV 畫布把工廠或成熟的 workflow 轉換成電子化的操作」 | 論文貢獻以畫布與轉換為中心 |
| U3 | 核准兩個新的傳遞依賴：`annotated-doc 0.0.5`、`typing-inspection 0.4.5` | `chore/security-dependency-upgrade` 不再卡在依賴核准 |
| U4 | 成熟案例用 Form-analysis-server-specify-kit，以 Composer 復現 | 見第 4 節與 4.4 的限制 |
| U5 | 產出系統跑在 Ubuntu，由公司工程師維護 | 見第 5.1 節 |
| U6 | 先定義轉換成功的標準 | 第 4 節是草案，待核定 |

**user 還沒有同意的事**（不要自行執行）：合併或推送任何分支；刪除工作目錄或分支；第 4 節的判準；第 5 節任何一項的做法。

## 3. 兩條線的界線

這一節是 Claude 的解讀，user 沒有反對，但也沒有逐條確認。

| | 論文線 | 產品線 |
|---|---|---|
| 內容 | AoV 畫布、AoV 的表示方式、從 AoV 到可操作系統的轉換、轉換結果是否忠實於原流程 | 安全修復、依賴升級、TLS、鎖定與限流、身分與授權、安裝與維運 |
| 完成的證據 | 第 4 節的判準逐項有量測結果 | 在 Ubuntu 上安裝、啟動、通過自我檢查，安全待辦有決定且已實作或明列為限制 |
| 寫進論文的方式 | 貢獻與實驗 | 只寫成「產出系統的安全加固」或限制，不放進與基線版的對照 |

由此得到兩個結論：

- `kits/` 內的安全修正（第 6 節的八條分支多數改在這裡）**不計入論文貢獻**。
- 先前的案例 analytical-four（決議 D200、D201，契約 `docs/thesis-aov-case.md`）是軟體分析流程，不是工廠流程。它可以留作輔助案例，但撐不起「工廠或成熟流程」這句主張，主案例改為 U4。

## 4. 「轉換成功」的判準（草案，待 user 核定）

### 4.1 來源系統是什麼

以下由來源專案的 `README.md`、`dev-guides/USER_FLOW_DIAGRAMS.md`、`USER_UPLOAD_FLOW.md`、`USER_QUERY_FLOW.md`、`VALIDATION_MECHANISMS.md` 讀得，沒有執行來源系統。

- 用途：表單資料分析。三道製程 P1（擠出）、P2（分條）、P3（沖孔）以批號（lot）串成追溯鏈。
- 使用者流程四條：登入；上傳（上傳 CSV 或 Excel、驗證、修正、匯入）；查詢（批號、進階、追溯）；分析（每日 NG 的 Pareto）。另有租戶與使用者管理。
- 技術：FastAPI、PostgreSQL、React，以 Docker 部署。

### 4.2 六項判準

每一項都要在開始轉換**之前**寫定比對對象與門檻，之後不得為了通過而修改。失敗的項目照實列出，不得調整成通過。

| 代號 | 判準 | 怎麼量 | 通過條件（建議） |
|---|---|---|---|
| S1 流程涵蓋 | 來源流程的每個步驟，在 AoV 畫布上都有對應的節點 | 轉換前先從來源的流程文件列出「來源步驟清單」並凍結；轉換後逐項標出對應的節點 | 清單內每一步都有對應；刻意不納入的步驟要事先列出並寫理由 |
| S2 可操作 | 每個帶操作的節點，在產出系統中都有一個使用者能完成的操作 | 逐節點在產出系統上實際操作一次，記錄成功或失敗 | 全部成功 |
| S3 不靠手改 | 產出系統由畫布與 Composer 產生，不事後手改產出物 | 統計產生後被人工修改的檔案數與行數 | 0。為了這個案例而新增或修改的 Kit 程式碼另外統計並全部列出，不算在 0 之內，但論文必須揭露 |
| S4 行為等價 | 同一批輸入、同一串操作，在來源系統與產出系統上得到相同的可觀察結果 | 一組固定的去識別化輸入檔，包含會被拒絕的資料；用腳本比對：每一列被接受或拒絕及拒絕原因的類別、匯入後的紀錄內容、各種查詢的結果、分析的彙總數字 | 全部相同。預期會不同的地方（例如時間戳記、內部識別碼、文字措辭）要在比對前列入排除清單並寫理由 |
| S5 順序與限制 | 畫布上表達的先後與限制，產出系統確實執行 | 反向測試：跳過前置步驟、用不合規的資料，確認被擋下 | 來源系統會擋的，產出系統也擋 |
| S6 可追溯 | 產出系統的每個入口與操作，都能指回畫布上的節點 | 由產出系統列出全部入口，逐一查對節點識別碼 | 沒有找不到來源節點的入口 |

不屬於「轉換成功」的項目：生成、導入、調整的速度，以及可用性與易用性。user 先前說這些的細節還要思考，另外定，不要混進這六項。

### 4.3 核定時需要 user 回答的問題

1. S4 的範圍：四條使用者流程全部比對，還是先比上傳與查詢？PDF 轉 CSV、舊版（legacy）上傳路徑、跨租戶彙總要不要納入？
2. S4 的輸入檔從哪裡來：來源專案 `test-data/` 的檔案能不能用？見 4.4 第 2 點。
3. S3 的「為案例新增的 Kit 程式碼」可以接受到什麼程度？若復現需要大量新 Kit 程式，主張要怎麼寫。
4. 來源的登入是租戶加 API key；產出系統用 `entry-permission-kit`（帳號密碼與權杖）。登入流程是比對「行為等價」，還是列為刻意的差異？

### 4.4 兩個必須寫進論文的限制

1. **Kit 的程式碼出自同一個來源系統。** `kits/form-analysis.kit-manifest.json` 的 `sourceSystem.path` 就是這個來源專案，`kits/BASELINE.md` 也記載 Kit 複製自基線版，而基線版由這套系統拆出。所以「復現」有一部分是把原系統的程式重新組裝。論文必須分開說明：哪些行為由畫布決定，哪些是沿用的 Kit 程式碼。否則「AoV 完成了轉換」的說法站不住。建議在 S3 的統計之外，另列一張「每個節點的行為來自畫布設定還是 Kit 既有程式」的表。
2. **來源專案的資料當作真實資料處理，直到 user 說明。** 來源專案有 `.env` 類檔案、`uploads/` 資料夾與多個 CSV（檔名帶批號樣式）。Claude 沒有打開這些檔案，不知道內容是否去識別化。規則：
   - 來源專案唯讀，只讀文件與程式碼。
   - 不讀 `.env`、`.env.*`（範例檔除外）。
   - 不把來源的資料檔複製進本專案、測試 fixture、論文或任何外部服務（含 LLM）。
   - S4 的輸入檔一律自己依欄位格式製作合成資料，或用 user 確認已去識別化的檔案。

### 4.5 建議的工作順序

1. user 核定 4.2 並回答 4.3。
2. 從來源流程文件寫出「來源步驟清單」並凍結（S1 的依據）。
3. 製作合成輸入檔與比對腳本（S4），先在來源系統上跑出基準結果。
4. 在畫布上畫出流程，用 Composer 產出系統。
5. 逐項量測 S1 至 S6，結果連同失敗項寫成一份報告。

第 3 步需要啟動來源系統。它是否能在本機啟動、要不要 user 提供環境設定，Claude 沒有驗證。

## 5. 產品線：部署情境與安全待辦

### 5.1 已知與未知

已知：

- 作業系統 Ubuntu；維護者是 user 公司的工程師（U5）。
- 使用者只經內網連入（決議 D46）。
- 資料庫與後端之間的通訊已由 D45 決定。
- 產出系統的組成：nginx 在前、FastAPI 後端、PostgreSQL，有授權閘門與啟動時的自我檢查。

未知，需要問 user 才能定下列各項做法：

1. 系統裝在公司自己的機房，還是客戶的工廠內？機器由誰保管？
2. 現場有沒有內部憑證機構（CA）或網域管理？有沒有離線的站點？（`docs/decision-log.md`「HTTPS 憑證來源」一節的待確認事項，自 2026-10-01 懸而未決。）
3. 操作系統的人是誰（客戶的產線人員、MIS、公司工程師）？人數大約多少？
4. analytical-four 的 LLM 服務在內網還是外部？
5. Ubuntu 的版本。
6. 誰可以改畫布、誰可以發布系統？Composer 目前沒有身分機制（規格第 3 節明列授權為「未涵蓋」），要上線就得決定。

### 5.2 待辦清單

來源是 2026-11-10 的安全性稽核。稽核的完整報告只在當時的對話紀錄裡，repo 內沒有。下表只有標題層級的描述；**動手前必須重新讀程式碼確認位置與現況**，不要只憑這張表修改。

| 項目 | 問題 | Claude 的建議（未決定） |
|---|---|---|
| M4 | 產出系統沒有 TLS 與安全標頭 | 安全標頭可以先加在 nginx 樣板；TLS 等 5.1 第 2 題。有內部 CA 用 D46 的方案 C，否則方案 B |
| H1 殘留 | analytical-four 的 `llm.endpoint` 可填任意主機，後端會向它發請求（SSRF）。金鑰變數名稱與轉址已在分支修掉 | 加主機允許清單，由部署時的環境變數提供；需要改部署樣板 |
| L2 | 登入沒有鎖定、限流與密碼政策 | 在 `entry-permission-kit` 加失敗次數與延遲，並在 nginx 加請求頻率限制 |
| L3 | 入口權限檔讀取失敗時放行 | 改成讀不到就拒絕 |
| L4 | 稽核紀錄的來源位址在反向代理後不正確 | 只信任來自 nginx 的轉送標頭 |
| L6 | 預覽容器沒有加固 | 預覽是開發機上的工具，優先度最低 |
| L7 | pip 沒有雜湊鎖定，且用了額外的套件來源 | 產生含雜湊的鎖定檔；可能需要新工具，須先經 user 核准 |
| L8 | Kit 的通用代理（broker）可繞過入口權限檢查 | 上線前應修，優先度僅次於 M4 |
| 其他 | `services/factory/requirements.txt` 仍是 fastapi 0.115.6（註明須與 composer-refactor-2 的鎖定檔一致，所以沒動）；Kit 內有 12 處使用已棄用的 `HTTP_422_UNPROCESSABLE_ENTITY`；預覽的選配冒煙測試有一項在升級前就失敗（切換到上傳驗證後 `/api/forms` 仍回 200） | 各自另開分支處理 |

## 6. 現有的修復分支

八條分支都從 `main` 的 9437d63 分出，**沒有合併、沒有推送**。2026-11-10 試合併八條無衝突，合併後測試全過。之後 `main` 已前進到 db340e5，所以合併前要重新試一次。

| 項目 | 分支 | 提交 | 分支上的測試結果 |
|---|---|---|---|
| M1 案例庫畸形路徑使服務中斷 | `fix/case-store-malformed-path` | 2ab7c9f | 服務 9/9 |
| H1 LLM 金鑰變數範圍與轉址 | `fix/analytical-four-llm-scope` | a4a8c50 | Kit 150/150 |
| M2 改密碼後舊權杖失效 | `fix/entry-permission-token-revocation` | e1e433a | Kit 40/40 |
| M3 使用者管理的權限邊界 | `fix/entry-permission-user-manage-scope` | 3ad4196 | Kit 42/42 |
| H2、L5 依賴升級 | `chore/security-dependency-upgrade` | af07731、ffef6ae、1ba6750、c437d6a | 根目錄 `npm test` 844 通過 1 略過；預覽冒煙 24/24；完整系統啟動與自我檢查通過 |
| M5 MOD webhook 驗證與 sync 識別碼 | `fix/mod-subscription-webhook-auth` | 42ea489 | Kit 27/27 |
| M6 備份匯入檢查內容 | `fix/case-store-backup-content-check` | 78a9073 | 服務 9/9、函式庫 38/38 |
| L1 資料表名稱檢查 | `fix/sql-identifier-check` | 5396211 | platform-core 19/19 |

合併後會改變的行為：

- H1：`llm.apiKeyEnv` 必須以 `ANALYTICAL_FOUR_LLM_` 開頭，既有設定若填別的名稱會被拒絕。另一個 session 的 `kits/analytical-four-kit/tools/measure_kit.py` 內的假 LLM 要多接受 `allow_redirects` 參數（已通知）。
- M2：改密碼的回應多了 `access_token`；舊密碼簽發的權杖一律失效。
- M5：未設定 `MOD_WEBHOOK_SECRET` 時 webhook 回 503，原本是放行。
- M6：`importBackup` 變成非同步。驗證報告與作者仍照備份檔原樣寫入，匯入的歷史不能當成「本伺服器驗證過」的證據。
- 依賴：fastapi 釘在 0.136.3，**不可升到 0.137 以上**。0.137 起 `app.routes` 不再列出以 `include_router` 掛入的路由，而 `services/package/templates/selfcheck.py` 靠它列舉路由，升上去會讓產出系統的自我檢查把所有路由報成缺少而拒絕服務。預覽冒煙測試測不出這個問題。

沒有驗證的項目：

- 有效授權下的系統 API 行為。
- Docker 端對端腳本 `services/package/e2e/system_e2e.py` 與 `kits/entry-permission-kit/tests/e2e/run_e2e.py`，已依 M2 改寫但沒有執行過。
- analytical-four 在系統映像內的行為，以及新版 sentence-transformers 5.6.0 搭配真實 E5 模型。
- 在 Ubuntu 實機上的安裝。先前的完整系統測試是在 Windows 的 Docker 內跑 Linux 容器。

## 7. 環境與協作規則

- git 指令要加 `-c safe.directory=<路徑>`，否則出現 dubious ownership。npm 一律用 `npm.cmd`。
- 主資料夾 `C:\Users\gslab\Desktop\composer-refactor` 被其他 session 的分支佔用。**不要在主資料夾切換分支或提交**，使用自己的工作目錄（git worktree）。
- 現有工作目錄：`C:\Users\gslab\Desktop\composer-refactor-secfix-wt`（本文件所在分支 `docs/handoff-product-and-thesis`）、`composer-refactor-secfix2-wt`（`fix/entry-permission-token-revocation`）、`composer-refactor-secfix3-wt`（`chore/security-dependency-upgrade`，`node_modules` 為獨立安裝）。前兩個的 `node_modules` 是連回主資料夾的 junction。
- 開分支、取決議編號之前，先通知其他 Claude session。推送、合併、刪分支都要 user 明確同意。
- 不與 Codex 同時寫同一批檔案。
- 跑各 Kit 的 Python 測試要自建環境：專案的 `.venv` 只有 pytest。照 `services/preview/requirements.txt` 加各 Kit 的 `requirements.txt` 安裝；需要組裝後端的測試用 `PREVIEW_PYTHON=<該環境的 python> node services/package/assemble-system.mjs <新目錄> --recipe <recipe.json>`，把 `<新目錄>/backend` 當 `PYTHONPATH`。不要用 `services/preview/assemble.mjs` 的預覽樹，它帶預覽閘門且不含 entry-permission。
- `services/frontend/base` 若留下 `node_modules`，組裝系統包時會被掃進去並因「預設秘密」檢查失敗，測完要刪。
- 安全基準線（`CLAUDE.md`）：只用 mock 或去識別化資料；秘密值不寫進設定、文件或指令列；基線版 `C:\Users\gslab\Documents\New project\form-system-kit-composer` 唯讀。

## 8. 接手後的第一步

1. 讀 `CLAUDE.md`、`docs/project-spec.md` 第 3、4、12 節、`docs/decision-log.md` 的「待決」。
2. 把第 4.3 節與第 5.1 節的問題整理給 user，一次問完，用開放式問題。
3. user 核定判準後，依第 4.5 節開工；每一步開專屬分支。
4. 不要在得到 user 同意前合併第 6 節的分支。
