# WP3b 安裝引擎與命令列

Ubuntu 22.04、Python 3.10 以上、標準庫。這是首次安裝引擎；尚未經 Python、Docker 或客機驗收。只使用 WP3a 的部署產物，不修改原 Compose；沒有新增依賴。`issue-license`、`license-install`、`guard-up` 回 10「尚未提供」，驗包的授權部分為 `skipped`。沒有精靈與升級遷移。

客機另需既有 OpenSSL、sudo 與 Ubuntu apt 工具；引擎只負責按計畫安裝缺少的 Docker 套件。沙箱沒有安裝或執行這些工具。

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
sh services/installer/install.sh plan --system-id example --archive system.tar.gz --signature system-package.sig.json --key root.pem --confirm-key-prefix 0123abcd --plan plan.json --json
sh services/installer/install.sh apply --system-id example --plan plan.json --plan-sha256 HASH_FROM_PLAN --input-file /private/input.json --json
sh services/installer/install.sh status --system-id example --json
sh services/installer/install.sh cancel --system-id example --json
sh services/installer/install.sh rollback --system-id example --plan plan.json --rollback-plan rollback.json --json
sh services/installer/install.sh rollback --system-id example --plan plan.json --rollback-plan rollback.json --plan-sha256 HASH_FROM_ROLLBACK_PLAN --json
```

`--input-file` 必須是目前使用者的普通檔案，權限正好 0600；讀完立即刪除，包括驗證失敗。省略時從 stdin 讀 JSON。輸入格式（以下是欄位說明，不是可用秘密）：

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

含 MOD Kit 時 env 另需 `MOD_WEBHOOK_SECRET`。`SYSTEM_ID` 由 manifest 提供；`DATABASE_URL` 由引擎使用同一組 PostgreSQL 設定與百分比編碼密碼產生。env 值不可包含換行、NUL、單引號；Compose `.env` 使用單引號保留 `$` 的字面值。只建立一份安裝目錄 `.env`，權限 0600；管理員 JSON 直接傳入 create_admin 的 stdin。密碼不進參數、計畫、事件或狀態；子程序輸出不直接回顯。

路徑可覆寫：`--state-dir`（預設 `/var/lib/<system-id>/install`）、`--install-dir`（`/opt/<system-id>-<systemVersion>`）、`--trust-dir`（`/etc/<system-id>/trust`）。狀態目錄不可放在安裝目錄內；舊狀態不會被自動覆寫。測試可覆寫 `--sys-root`、`--proc-root`、`--etc-root`、`--lock-file`。一般操作不得另選鎖路徑來規避互斥。

detect 檢查 OS、架構、磁碟／記憶體、sudo、Docker／Compose、universe、apt 候選版本、埠及 Ubuntu 套件庫 HTTPS；底線為磁碟與記憶體各 1 GiB，並非容量保證。計畫記錄實際 apt 候選版本，只安裝缺少元件，不改 apt 來源、不加 docker 群組。sudo 尚未快取時先 `sudo -v`；不將密碼提示誤認為沒有 sudoers 權限。指紋來源是 DMI UUID／序號與具實體 device 的網卡，無效來源被排除；少於三項只警告。

## 狀態與還原

固定九步：Docker、信任庫／新安裝目錄、映像、網路與卷、秘密檔、啟動 DB、首次建表與管理員、後端／代理、經代理 healthz。`migration` 只呼叫既有 `app.system_init` 與 `app.entry_permission.create_admin`，不冒充升級遷移。

`compose.override.yml` 是 JSON（合法 YAML），替每個服務、網路與卷加 install-id label，服務用 image ID 與 `pull_policy: never`；命令另加 `--no-build --pull never`。專案名 `<system-id>-<install-id>`。映像不加 label；state 記錄載入前存在與否、載入後 ID、載入標籤。遇到原有標籤指向其他映像就停止，不覆蓋。

apply／rollback 共用 flock；記錄 PID／命令，持有期間第二個命令回 16。狀態逐步寫入、寫入副作用前先記 undo 意圖；事件連續編號，狀態原子替換。取消在完整步驟後生效，回 15。一般失敗只還原失敗步驟；能回到前一完成點回 13，還原失敗或有保留事項回 14。

rollback 首次只產生計畫，第二次帶該計畫雜湊才執行；另綁定當時 state 雜湊，狀態改變就拒絕。`--checkpoint <step-id>` 留下指定已完成點及之前步驟。apply 正在跑時先 cancel，等鎖釋放才還原。

刪除容器、網路與卷前重新檢查本次標籤。只刪除本次新增且沒有容器使用的映像；Docker 套件只有本次安裝且主機無容器、映像、卷才移除，不做 autoremove。DB 曾啟動後不能證明卷為空，所以保留全部卷與復原設定（含 0600 `.env`），回 14 並列入 `retained`；人工確認資料／備份後再處理。父目錄可能由建立狀態或信任庫時新增，不遞迴刪除共用父目錄。

程序意外被殺或 SSH 斷線後可以讀 status／要求 rollback，但不會自動續跑 apply；脫離終端的方式仍是契約待決事項。沒有假稱支援可靠斷線續裝。狀態可讀權限、跨使用者 flock、sudo／Compose 整合均待 Ubuntu 實測。

退出碼：0 成功，10 環境／輸入／尚未提供，11 驗包，12 計畫雜湊或漂移，13 步驟失敗已還原，14 還原失敗或需人工處理，15 取消，16 鎖。17 保留給尚未實作的授權簽發；本階段不自行簽發。

## 驗證與交接

```sh
sh -n services/installer/install.sh
python3 -B -m unittest discover -s services/installer/tests -p 'test_*.py' -v
python3 -B services/installer/tests/mutations.py
npm run typecheck
node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck services/installer/tests/make-fixtures.mjs
```

Python 單元測試與六項變異 **由 Claude 執行，Codex 未執行、未宣稱通過**。FakeRunner 不呼叫真 Docker、sudo、apt 或網路；只能證明控制流程，不能證明 OpenSSL 密碼學正確性或 Compose 可執行性。變異先要求 baseline 通過；只有 assertion failure 算攔截，語法／import 錯誤不算。模板只讀 `services/package/templates`，測試／變異副本不修改 package。

真實簽章 fixture：Claude 用測試 tar.gz 與對應 manifest 呼叫 `node services/installer/tests/make-fixtures.mjs TEST.tar.gz system-manifest.json NEW_OUTPUT_DIR`，產生測試簽章、公鑰與前綴；私鑰只存在記憶體。再以 verify 實際呼叫 OpenSSL 驗證並竄改測試。此腳本 **由 Claude 執行**，不是 WP3d 簽發工具。

待驗證／未提供：Python 語法與所有 unittest／變異、真實 OpenSSL、apt 安裝、Compose config／離線 load／部署、Ubuntu 權限、實機指紋、斷線行為，以及 WP3d／WP3c／WP3e。WP3e 前 root／docker 群組仍能由 `docker inspect` 讀到秘密；此限制亦寫入 plan 的 `notProvided` 與 verify 報告。不能宣稱完整 P2、授權驗收或防複製已完成。
