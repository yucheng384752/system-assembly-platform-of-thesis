# 訂閱串接的對外連線設定送不進產出系統

日期：2026-11-15
分支：`fix/mod-subscription-runtime-env`（基底 `main` 0f5a742），工作樹 `C:\Users\gslab\Desktop\composer-refactor-modenv-wt`
來源：論文復現分支的設定項盤點（`feature/thesis-form-analysis-reproduction` 的 `docs/generated-system-settings-inventory.md`）順帶發現；user 於 2026-11-15 指示另開分支處理。

## 問題（Claude 讀程式確認，未執行）

- `kits/mod-subscription-kit/src/backend/app/api/routes_mod_subscription.py:55-58` 以環境變數讀 `MOD_API_BASE_URL` 與 `MOD_API_KEY`。前者沒設定時，手動同步端點回 503；後者是對外服務的金鑰，屬於秘密值。
- 產出系統只把 `MOD_WEBHOOK_SECRET` 送進後端（`services/package/deployment.mjs:110-112`、`services/package/templates/secret_files.py:10`、`services/installer/engine/install.py:21-23, 82, 105, 347`、安裝精靈 `wizard_static`）。`MOD_API_BASE_URL` 與 `MOD_API_KEY` 沒有任何管道，所以選用訂閱串接的產出系統，手動同步一律 503。
- 同一份盤點提到的 `core/config.py:143` `secret_key` 預設字串：不需修改。組裝時 `services/package/assemble-system.mjs:33-39` 會移除該預設，`services/package/tests/package.test.mjs:245-246` 有測試守住，且 production 環境會拒絕該字串（`config.py:400-410`）。Kit 原檔依慣例不動。

## 設計

選用 `mod-subscription-kit` 時：

| 名稱 | 性質 | 是否必填 | 管道 |
|---|---|---|---|
| `MOD_API_BASE_URL` | 一般設定 | 選填；沒填時行為同現況（同步回 503） | 安裝輸入的公開設定，寫入部署環境檔，Compose 傳給後端 |
| `MOD_API_KEY` | 秘密值 | 選填（路由本來就容許沒有金鑰） | 與 `MOD_WEBHOOK_SECRET` 相同：秘密檔掛入、`MOD_API_KEY_FILE`、`secret_files.py` 載入；不出現在環境檔、指令列、日誌、安裝紀錄 |

- 沒選用訂閱串接時，產出物不得出現這兩個名稱（比照 `MOD_WEBHOOK_SECRET` 現有測試）。
- `MOD_API_BASE_URL` 驗證：必須是 `http://` 或 `https://` 開頭的網址，不得帶帳號密碼（`user:pass@`）；不合格時安裝前就拒絕並說明。
- 選填的秘密檔：沒提供時不建立檔案、Compose 不引用。若現有安裝器的結構做不到「選填的秘密檔」，停下回報，不要改成必填，也不要寫入空檔。
- 安裝精靈新增兩個欄位，金鑰欄位用 `type="password"`、離開步驟時清空（比照既有秘密欄位），文字依 DESIGN.md。
- 不改 `kits/` 下任何檔案（`fix/mod-subscription-webhook-auth` 已在改同一個路由檔，避免衝突）。
- 手冊與說明同步：`services/package/templates/README.md`、`env.example`、`services/installer/README.md`、`docs/installation-operations-manual.md` 中列出設定的段落。只寫名稱與用途，不寫任何值。

## 驗證要求

- `npm.cmd run typecheck`、`npm.cmd test`；`services/package` 的 node 測試與 Python 測試、`services/installer` 的測試。沙箱內已知的 EPERM 失敗（`src/security.test.mjs`、`src/evaluator.test.ts`）照實列出即可。
- 新增測試要能說明意圖：選用時兩個名稱到得了後端、金鑰只走秘密檔；未選用時不出現；金鑰值不出現在環境檔與安裝紀錄。
- 沒跑的項目照實寫「未執行」與原因。

## 決議編號

預留 D210（`main` 到 D205；D206 至 D209 已被其他分支使用或預留）。由 Claude 在提交前寫入 `docs/decision-log.md`，Codex 不要寫。

## Codex Notes

2026-11-15 Codex：實作完成，待 Claude 審閱及 Ubuntu／Docker 驗證；未提交。

### 實作與檔案

- `services/package/deployment.mjs`、`templates/secret_files.py`：選用訂閱 Kit 時，Compose 傳入選填 `MOD_API_BASE_URL`，秘密載入器支援 `MOD_API_KEY_FILE`；兩者均不加入啟動必填清單。未選時移除新名稱。
- `services/installer/engine/install.py`：沿用 webhook 判定 Kit、受保護輸入、秘密檔寫入及遮蔽機制。網址在任何安裝寫入前驗證協定、主機、帳密、連接埠與控制字元；錯誤不回顯輸入。金鑰只寫 `secrets/mod_api_key`（0400、UID/GID 10001），並只在有值時於現有 `compose.override.yml` 加入 backend／init 的 file secret 與 `MOD_API_KEY_FILE`。不改原 Compose，不把值放入 override、環境檔或指令。
- **選填秘密檔可由既有結構達成**：未提供或空字串不建立檔案、不加入 Compose 引用；只有空白的金鑰拒絕。新檔沿用既有還原白名單與資料卷復原保留規則，無空檔或必填降級。
- `services/installer/engine/wizard_static/{index.html,app.js,style.css}`：繁體中文的網址與密碼欄位，沿用原生控制項與 44px 樣式；送出時立即清空秘密欄位（不等請求回應），離開頁面時也清空新金鑰。此精靈各步驟為同頁區段，無獨立換頁步驟狀態。
- `services/package/templates/{README.md,env.example}`、`services/installer/README.md`、`docs/installation-operations-manual.md`：名稱、用途與秘密檔交付方式。`services/package/assemble-system.mjs` 按 Kit 選擇保留／移除手冊的訂閱設定段落，避免未選 Kit 的離線手冊洩漏這兩個名稱。
- `services/package/tests/package.test.mjs`、新增 `services/package/tests/test_secret_files.py`、`services/installer/tests/{test_engine.py,test_wizard.py}`：有／無 Kit 的產物、選填設定、實際組裝、秘密載入、非法輸入、空值與省略、秘密不進環境檔／紀錄／命令、檔案擁有者、密碼欄與清空行為。新增資料全部為合成資料，網址使用 `example.invalid`。

### 實際驗證結果

Python 使用既有 `C:/Users/gslab/AppData/Roaming/uv/python/cpython-3.10.20-windows-x86_64-none/python.exe`（3.10.20），沒有安裝依賴。以下 Python 指令的 `python` 指該執行檔；暫存資料放在工作樹內。

| 指令 | 實際結果 |
|---|---|
| `npm.cmd run typecheck` | exit 0，通過。 |
| `npm.cmd test` | exit 1；Vitest 73 檔通過、2 檔失敗；981 tests 通過、1 失敗、5 skipped。`src/security.test.mjs` 為沙箱 EPERM（秘密測試檔開啟／清理權限）；`src/evaluator.test.ts` 的打包 hook 為 esbuild `Cannot read directory "../..": Access is denied`。後續 `&&` 命令未由本次 npm 執行，已分別補跑如下。 |
| `node --test services/preview/tests/preview.test.mjs` | 14/14 通過。 |
| `npm.cmd --prefix libs/case-store test` | 38/38 通過。 |
| `npm.cmd --prefix services/case-store test` | 8/8 通過。 |
| `node --test tools/thesis-s4/tests/thesis-s4.test.mjs` | 13/13 通過。 |
| `node --test services/package/tests` | 最終 76 tests：69 通過、7 失敗；七項均由 evaluator 的 esbuild 目錄存取限制觸發。新增兩項 MOD 測試通過；含 MOD 的八 Kit 實際組裝與未含 MOD 的七 Kit 全檔掃描通過。 |
| `python -B -m unittest discover -s services/package/tests -p 'test_*.py' -v` | exit 1；13 tests：10 通過、2 import errors、1 skipped。新秘密檔測試 3/3 通過；license gate 缺 `cryptography`、selfcheck 缺 `starlette`；symlink 測試按現有 Windows 條件跳過。 |
| `python -B -m unittest discover -s services/installer/tests -p 'test_*.py' -v` | 最終 exit 1；95 tests：83 通過、2 失敗、10 skipped。新增 MOD 三項與精靈檢查均通過。兩項失敗為既有 `test_apply_and_no_secret_copies` 的 POSIX 0600 模式預期（Windows 回 0666），及 `test_fingerprint_and_detect` 對 Windows CPU 架構的拒絕。跳過項目涉及 Ubuntu/flock/sudo/POSIX、時區及缺少 cryptography。 |
| `node services/package/tests/mutations.mjs` | exit 1，baseline 因上述 esbuild 限制失敗，變異案例未執行。 |
| `python -B services/package/tests/gate_mutations.py` | exit 1，baseline 無法匯入 cryptography，變異案例未執行。 |
| `python -B services/installer/tests/mutations.py` | exit 1，baseline 58 tests、2 失敗、6 skipped（上述 Windows 兩項）；變異案例未執行。 |
| `python -B services/installer/tests/license_mutations.py` | exit 0，baseline 15/15，6/6 變異由 assertion 檢出。 |
| `python -B services/installer/tests/wizard_mutations.py` | exit 0，baseline 12/12，8/8 變異由 assertion 檢出。 |
| `sh -n services/installer/install.sh` | exit 0。 |
| package README 的獨立 JSDoc tsc 指令（assemble-system、deployment、tests/index、mutations） | exit 2；總計 67 診斷，其中 package 41、其餘 26。`assemble-system.mjs`、`deployment.mjs` 無診斷；package.test 的兩項診斷在原有 inventory 呼叫，其餘位於既有測試／相依模組。未把整條指令稱為通過。 |
| installer README 的獨立 JSDoc tsc 指令（tests/make-fixtures.mjs） | exit 2；相依的 `scripts/security/lib.mjs:17` Ajv TS2351，該 fixture 本身無診斷。 |
| `git diff --check` | exit 0。只執行 Git 唯讀檢查。 |

兩條 JSDoc 指令均使用 README 原列的 `node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck` 及其檔案清單。

### 未執行與限制

- 未執行真實 Docker Compose 合併／啟動、離線安裝、MOD HTTP 同步及 Ubuntu 0400/UID 權限實測：目前為 Windows 沙箱，測試使用既有 FakeRunner；需 Claude 在目標環境驗證，不能把檔案與 override 斷言視為容器已實跑。
- 未執行瀏覽器視覺／鍵盤手動驗證；已沿用 DESIGN.md 對應的精靈樣式並測試欄位、秘密清空程式與靜態資源安全限制。
- 未執行缺依賴的 license gate／selfcheck 完整 Python 套件；依「不新增依賴」保留現況。未修復本任務以外的型別診斷或環境失敗。
- 未修改 `kits/`、`docs/decision-log.md`，未新增依賴、TypeScript `any` 或 `innerHTML`，未執行 Git 寫入命令。D210 與提交留給 Claude。
- `.task-verification/` 保留本次測試日誌與暫存快取；清理該目錄的 PowerShell 刪除操作遭自動核准審查拒絕（`blocked by policy`，未提供更具體理由），未改用其他途徑刪除。此目錄不是交付程式碼，請勿提交。

## 2026-11-15 Claude：審閱與沙箱外驗證

- 審閱差異後只改一處：安裝精靈第 4 步說明文字被改成「0400 的秘密檔案」，不在本任務範圍，還原為原文；原文是否過時另行確認。其餘 Codex 的程式未改。
- 沙箱外重跑：`npm.cmd run typecheck` 通過；`npm.cmd test` 全數通過（Vitest 75 檔、986 通過、1 略過，其後各段通過）；`node --test services/package/tests` 76 項全數通過（Codex 在沙箱內的 7 項失敗未重現）。
- Python（3.10.20，Windows）：`services/installer/tests` 95 項中 2 項失敗、10 項略過；`main` 上同一指令是 92 項中同樣 2 項失敗、10 項略過（`test_apply_and_no_secret_copies`、`test_fingerprint_and_detect`，皆為 Windows 環境造成），所以新增的 3 項通過、沒有新失敗。`services/package/tests` 的 Python 測試 13 項中 2 項因本機缺 `cryptography`、`starlette` 無法載入、1 項略過，新增的秘密檔測試通過。`wizard_mutations.py` 通過。
- 未執行：Ubuntu 上的實際安裝、Docker Compose 合併與啟動、秘密檔權限與擁有者實測、對訂閱服務的實際同步、瀏覽器中的精靈畫面與鍵盤操作、缺依賴的 license gate 與 selfcheck 測試、兩支因環境失敗而沒跑到變異案例的腳本。
- `.task-verification/` 是 Codex 留下的測試暫存，未提交。
- 決議 D210 已寫入 `docs/decision-log.md`。
