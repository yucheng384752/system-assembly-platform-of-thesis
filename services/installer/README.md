# WP3b 安裝引擎與命令列

Ubuntu 22.04、Python 3.10 以上、標準庫與 OpenSSL。這是首次安裝引擎，只使用 WP3a 的部署產物，不修改原 Compose，沒有新增依賴。第一階段已由 Claude 驗收；本次第二階段新增授權 3.0 簽發、鏈驗證與安裝，Python／Ubuntu 驗證待 Claude 執行。沒有精靈與升級遷移；guard 尚未提供。

客機另需既有 OpenSSL、sudo 與 Ubuntu apt 工具；引擎只負責按計畫安裝缺少的 Docker 套件。

## 信任與包裝前置

工程師先依操作手冊以 `sha256sum` 人工核對 `install.sh`、引擎整包與根公鑰，再執行。引擎顯示／核對的是公鑰 **SPKI DER SHA-256** 的前 8 碼；不是 PEM 檔案雜湊。既有 `<trust-dir>/root.pem` 存在時改用信任庫，不接受任意替換金鑰。

WP3a 尚未輸出可直接驗證的離線安裝包。封裝者需依 `schemas/package-extension.schema.json` 草案加入：

- `systemVersion`：部署版本，不能拿 manifest 的 `schemaVersion` 冒充。
- `images`：`id` 為 config digest（`sha256:` image ID）、`tag` 為載入時標籤、`archive` 為相對路徑、`services` 為對應服務。backend 與 init 共用同一映像。
- 每個 `docker save` tar 只含一個映像與一個標籤，全部 tar 也列入既有 `files` 的 sha256／bytes。映像 config 雜湊必須等於 `id`。不使用 RepoDigests，不改映像標籤設定，不連網拉映像或 build。
- tar.gz 根目錄直接包含 `system-manifest.json`、`deployment/` 等，不加外層目錄，不含 `.env`、Compose override、符號連結、硬連結或特殊檔案。
- `system-package.sig.json` 為既有 `{payload,signature,algorithm}` 信封。payload 為原始 JSON 字串，必含壓縮檔 `sha256` 與 `systemManifestSha256`；對 payload 原始 UTF-8 位元組做 RSA-PSS-SHA256、salt 32。實際簽發工具屬 WP3d。

引擎先確認公鑰指紋、驗簽，再驗 tar.gz sha256，才解壓到私有暫存目錄；接著驗 manifest、全部檔案與映像。apply 重新驗證並重建預期計畫，拒絕套件、環境或計畫漂移。原 `services/package/` 未變動；原始 WP3a 包缺上述欄位時會明確拒絕。

## 操作

以下是客機指令範例，**未在 Codex 沙箱執行**。所有命令可加 `--json`，stdout 每行一個 JSON。不加時同一內容以縮排 JSON 顯示。連線、密碼與管理員帳號只走 stdin 或 0600 檔案；CLI sudo 使用終端提示，不接收命令列密碼。

```sh
sudo -v
sh services/installer/install.sh detect --system-id example --json
sh services/installer/install.sh verify --system-id example --archive system.tar.gz --signature system-package.sig.json --key root.pem --confirm-key-prefix 0123abcd --json
sh services/installer/install.sh issue-license --system-id example --archive system.tar.gz --signature system-package.sig.json --key root.pem --confirm-key-prefix 0123abcd --subkey /media/usb/subkey.enc.pem --certificate /media/usb/subkey.cert.json --input-file /private/issue.json --out license.lic --json
sh services/installer/install.sh verify --system-id example --archive system.tar.gz --signature system-package.sig.json --key root.pem --confirm-key-prefix 0123abcd --license license.lic --json
sh services/installer/install.sh plan --system-id example --archive system.tar.gz --signature system-package.sig.json --key root.pem --confirm-key-prefix 0123abcd --license license.lic --plan plan.json --json
sh services/installer/install.sh apply --system-id example --plan plan.json --plan-sha256 HASH_FROM_PLAN --license license.lic --input-file /private/input.json --json
sh services/installer/install.sh status --system-id example --json
sh services/installer/install.sh cancel --system-id example --json
sh services/installer/install.sh rollback --system-id example --plan plan.json --rollback-plan rollback.json --json
sh services/installer/install.sh rollback --system-id example --plan plan.json --rollback-plan rollback.json --plan-sha256 HASH_FROM_ROLLBACK_PLAN --json
```

`--input-file` 必須是目前使用者的普通檔案，權限正好 0600；讀完立即刪除，包括驗證失敗。省略時從 stdin 讀 JSON。輸入格式（以下是欄位說明，不是可用秘密）：

`issue-license` 的輸入只含 `{"passphrase":"現場密碼","expiresAt":"2099-01-01T00:00:00Z"}`；實際到期日由人員決定。密碼、到期日都沒有命令列參數；子金鑰與憑證路徑可用 `--subkey`、`--certificate`。以下 env／admin 格式用於 `apply`：

```text
{
  "env": {
    "POSTGRES_USER": "資料庫使用者識別字",
    "POSTGRES_DB": "資料庫名稱識別字",
    "POSTGRES_PASSWORD": "現場秘密",
    "SECRET_KEY": "至少 32 字元的現場秘密",
    "ENTRY_PERMISSION_JWT_SECRET": "至少 32 字元的現場秘密",
    "DEFAULT_TENANT_ID": "合法 UUID",
    "PROXY_BIND": "可省略，預設 127.0.0.1",
    "HTTP_PORT": "可省略，預設 8080"
  },
  "admin": {"username": "現場帳號", "password": "超過 8 字元、最多 72 UTF-8 bytes", "display_name": "現場顯示名稱"}
}
```

含 MOD Kit 時 env 另需 `MOD_WEBHOOK_SECRET`。`SYSTEM_ID` 由 manifest 提供；`DATABASE_URL` 由引擎使用同一組 PostgreSQL 設定與百分比編碼密碼產生。env 值不可包含換行、NUL、單引號；Compose `.env` 使用單引號保留 `$` 的字面值。選填的安裝輸入 `LICENSE_BLOCK_WINDOW`（例如 `mon-fri 09:00-15:00`，格式與星期於安裝前驗證，後端遇到無法解析的值會拒絕啟動）與 `LICENSE_TIMEZONE`（IANA 名稱，預設 Asia/Taipei）決定硬體不符且寬限期結束後，從哪個時段開始停止服務（D137、D143）。安裝目錄的 `.env`（0600）只放非秘密設定與三個宿主路徑（`LICENSE_DIR`、`ROOT_KEY_FILE`、`MANIFEST_FILE`）；秘密值寫成 `secrets/` 下的獨立檔案（目錄 0700、檔案 0400，後端使用的檔案擁有者為 UID 10001，`postgres_password` 為 root），由 Compose 以 file secrets 掛入容器的 `/run/secrets`，容器內以 `<NAME>_FILE` 指向，`docker inspect` 只看得到路徑而看不到值（D138、D142）。管理員 JSON 直接傳入 create_admin 的 stdin。密碼不進參數、計畫、事件或狀態；子程序輸出不直接回顯。

路徑可覆寫：`--state-dir`（預設 `/var/lib/<system-id>/install`）、`--install-dir`（`/opt/<system-id>-<systemVersion>`）、`--trust-dir`（`/etc/<system-id>/trust`）。狀態目錄不可放在安裝目錄內；舊狀態不會被自動覆寫。測試可覆寫 `--sys-root`、`--proc-root`、`--etc-root`、`--lock-file`。一般操作不得另選鎖路徑來規避互斥。

detect 檢查 OS、架構、磁碟／記憶體、sudo、Docker／Compose、universe、apt 候選版本、埠及 Ubuntu 套件庫 HTTPS；底線為磁碟與記憶體各 1 GiB，並非容量保證。計畫記錄實際 apt 候選版本，只安裝缺少元件，不改 apt 來源、不加 docker 群組。sudo 尚未快取時先 `sudo -v`；不將密碼提示誤認為沒有 sudoers 權限。指紋經 root 內部命令 `fingerprint` 採集，只回傳來源、有效性與雜湊。來源包含 DMI、實體網卡與磁碟序號（serial 或 vpd_pg80）；排除 USB、removable、loop／ram／dm／md／zram／sr／nbd 裝置。detect 無 sudo 時保留非特權採集並警告；簽發與驗證不得退回非特權採集。

簽發先驗安裝包，以 manifest 推得 systemId／recipe／enabledKits，要求至少三項有效來源。憑證須為根金鑰簽署、金鑰 ID 正確且簽發當下有效；授權到期日須在未來。OpenSSL 直接讀加密 PKCS#8 子金鑰，密碼只走 stdin，解密私鑰不落地。自驗通過才以排他建立方式發布授權，不覆寫已有檔案。授權驗證使用不同雜湊值的集合交集（至少二項），來源改名不影響；已簽發授權不因子金鑰憑證後來過期而失效。

`verify` 未給 `--license` 時回 `license: skipped`，有給則完整驗鏈、到期日、manifest 與當前硬體。plan／apply 必須給授權；計畫只記授權檔 sha256、licensee.name、expiresAt，不含指紋雜湊。apply 開始與 license-install 步驟前都重驗，拒絕授權或硬體漂移。

## 網頁精靈（WP3c）

```sh
sudo -v
sh services/installer/install.sh wizard --system-id example [--state-dir ...] [--install-dir ...] [--trust-dir ...] [--wizard-port N]
```

只監聽 `127.0.0.1`；啟動時印出含一次性權杖的網址（`http://127.0.0.1:<埠>/<權杖>/`）與暫存目錄（存放授權與計畫，還原時需要）。每個畫面對應一個引擎子命令，精靈以子程序呼叫 `cli.py`，不含安裝邏輯：偵測、驗證安裝包、簽發授權、安裝設定、檢視計畫、進度與報告、還原。

- **防護：**路徑權杖加 `Host` 標頭檢查（防 DNS rebinding）、POST 檢查 `Origin` 與 `Content-Type: application/json`、請求大小上限 128 KB、CSP `default-src 'none'`、不回應靜態檔案白名單以外的路徑、請求日誌不記錄（網址含權杖）。畫面文字一律以 `textContent` 呈現。
- **秘密值：**子金鑰密碼與安裝設定只經子程序標準輸入傳給引擎，不進命令列；送出後畫面欄位立即清空。回應不回顯秘密值。
- **確認綁定：**`apply` 與 `rollback` 的確認雜湊必須等於精靈剛顯示的計畫雜湊，否則 409；同一時間只允許一個 `apply`。
- **sudo：**精靈不接收 sudo 密碼。開始安裝前以 `sudo -n true` 檢查，未取得時提示在終端機執行 `sudo -v`（契約第 7 節原寫「經標準輸入傳給 sudo -S」，改為此做法，見 D141）。
- **背景執行：**`apply` 以獨立 session 啟動，關閉瀏覽器不會中斷；重新開啟精靈或用 `status` 可看進度。
- **子金鑰與憑證：**以 USB 上的檔案路徑輸入（D140），不經瀏覽器上傳。
- 驗證：`python3 -B -m unittest tests.test_wizard`、`python3 -B tests/wizard_mutations.py`（八項變異）。

## 狀態與還原

固定十一步：Docker、信任庫／新安裝目錄、映像、網路與卷、秘密檔、啟動 DB、首次建表與管理員、license-install、guard-up、後端／代理、經代理 healthz 與授權／硬體狀態檢查。guard-up 先啟動 guard 容器（沿用後端映像，manifest 的映像必須同時指派給 guard），讓後端啟動時已有第一份硬體回報；health-check 要求 `/api/license/status` 回 `valid: true` 且硬體為 `match`（最多等 60 秒），確認從宿主簽發授權到容器內比對的整條路徑。`migration` 只呼叫既有 `app.system_init` 與經 `app.secret_files` 載入秘密後的 `app.entry_permission.create_admin`，不冒充升級遷移。license-install 在服務啟動前寫入 `license/license.lic`（目錄 0755、檔案 0644，擁有者為後端使用者 10001，因為後端在上傳新授權時要能替換檔案），state 記錄本次建立者；後端啟動後 health-check 會要求 `/api/license/status` 回 `valid: true`，確認執行中的後端自己接受這份授權；還原只刪本次授權檔與本次建立的空目錄，目錄內有其他檔案則保留並回報失敗。

`compose.override.yml` 是 JSON（合法 YAML），替每個服務、網路與卷加 install-id label，服務用 image ID 與 `pull_policy: never`；命令另加 `--no-build --pull never`。專案名 `<system-id>-<install-id>`。映像不加 label；state 記錄載入前存在與否、載入後 ID、載入標籤。遇到原有標籤指向其他映像就停止，不覆蓋。

apply／rollback 共用 flock；記錄 PID／命令，持有期間第二個命令回 16。狀態逐步寫入、寫入副作用前先記 undo 意圖；事件連續編號，狀態原子替換。取消在完整步驟後生效，回 15。一般失敗只還原失敗步驟；能回到前一完成點回 13，還原失敗或有保留事項回 14。

rollback 首次只產生計畫，第二次帶該計畫雜湊才執行；另綁定當時 state 雜湊，狀態改變就拒絕。`--checkpoint <step-id>` 留下指定已完成點及之前步驟。apply 正在跑時先 cancel，等鎖釋放才還原。

刪除容器、網路與卷前重新檢查本次標籤。只刪除本次新增且沒有容器使用的映像；Docker 套件只有本次安裝且主機無容器、映像、卷才移除，不做 autoremove。DB 曾啟動後不能證明卷為空，所以保留全部卷與復原設定（含 0600 `.env`），回 14 並列入 `retained`；人工確認資料／備份後再處理。父目錄可能由建立狀態或信任庫時新增，不遞迴刪除共用父目錄。

程序意外被殺或 SSH 斷線後可以讀 status／要求 rollback，但不會自動續跑 apply；脫離終端的方式仍是契約待決事項。沒有假稱支援可靠斷線續裝。狀態可讀權限、跨使用者 flock、sudo／Compose 整合均待 Ubuntu 實測。

退出碼：0 成功，10 環境／輸入／尚未提供，11 驗包或授權驗證／缺授權，12 計畫雜湊或授權／硬體漂移，13 步驟失敗已還原，14 還原失敗或需人工處理，15 取消，16 鎖，17 授權簽發失敗。license-install 是 apply 內部步驟，不提供獨立執行入口。授權漂移回 12 時，先前已完成步驟仍保留，可用 status／rollback 處理。

## 驗證與交接

```sh
sh -n services/installer/install.sh
python3 -B -m unittest discover -s services/installer/tests -p 'test_*.py' -v
python3 -B services/installer/tests/mutations.py
python3 -B services/installer/tests/license_mutations.py
npm run typecheck
node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck services/installer/tests/make-fixtures.mjs
```

本次 Python 單元測試與授權六項變異 **由 Claude 執行，Codex 未執行、未宣稱通過**。test_engine 的 FakeRunner 不呼叫真 Docker、sudo、apt 或網路；test_license 以 Node 產生臨時測試金鑰／憑證／授權，實際使用 OpenSSL 驗證與簽發。變異先要求 baseline 通過；只有 assertion failure 算攔截，語法／import 錯誤不算。模板只讀 `services/package/templates`，測試／變異副本不修改 package。

真實簽章 fixture：`node services/installer/tests/make-fixtures.mjs TEST.tar.gz system-manifest.json NEW_OUTPUT_DIR` 產生測試簽章、公鑰、前綴、授權案例與加密測試子金鑰；根私鑰只存在記憶體。manifest 需含 systemId 與 kits。測試憑證固定為 2026-10-28T10:00:00Z 起 24 小時，單元測試注入相同時間；實機 CLI 簽發須在該區間或另產生當下有效的測試憑證。測試使用臨時目錄並清理；切勿使用真實金鑰或提交 fixture 私鑰。Python 簽出授權對 Node 驗證器的反向檢查仍由 Claude 執行。

本次待驗證：Python 語法與 unittest／變異、Python/OpenSSL 跨語言整合、apt 安裝、Compose config／離線 load／部署、Ubuntu 權限、實機指紋與斷線行為。授權鏈驗證與安裝已提供，但後端啟動不檢查授權、guard 尚未提供，不能宣稱已防複製（WP3e）。root／docker 群組仍能由 `docker inspect` 讀到秘密；此限制亦寫入 plan 的 `notProvided` 與 verify 報告。沒有完成 WP3c 或 WP3e。
