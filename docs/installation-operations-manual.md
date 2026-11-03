# 系統安裝與維運手冊

本手冊給現場工程師。內容只寫已在 Ubuntu 22.04 實機跑過的流程，沒有跑過的部分列在「已知限制」。所有範例的密碼、金鑰與路徑都是佔位，不是可用值。

## 1. 交付物與前提

交付給客戶現場的檔案：

| 檔案 | 說明 |
|---|---|
| `system-package.tar.gz` | 系統包（後端、前端、映像、設定、文件），已簽章 |
| `system-package.sig.json` | 系統包簽章信封 |
| `root.pem` | 根公鑰（驗簽用） |
| 安裝引擎（`services/installer/`，含 `install.sh`） | 另行交付，用來驗證並安裝系統包 |
| 子金鑰與憑證（`subkey.enc.pem`、`subkey.cert.json`） | 現場簽發授權用，放在 USB，由發行端交給工程師 |

主機需求：Ubuntu 22.04、Python 3.10 以上、OpenSSL、sudo、可連 Ubuntu 套件庫（缺 Docker 時引擎會以 apt 安裝）。磁碟與記憶體各至少 1 GiB 只是底線，不是容量保證；系統包解壓後約 340 MB 映像另需空間。

## 2. 先人工核對信任根

引擎只接受你確認過的根公鑰。核對步驟：

```sh
sha256sum install.sh
sha256sum root.pem
openssl pkey -pubin -in root.pem -outform DER | sha256sum | cut -c1-8
```

- 前兩行的雜湊要與發行端用**另一個管道**（電話、當面、另一封信）告知的值逐字相同。
- 第三行是公鑰的指紋前 8 碼，之後安裝指令的 `--confirm-key-prefix` 要填這 8 碼。引擎比對的是 SPKI DER 的 SHA-256，不是 `root.pem` 檔案雜湊，兩者不同。
- 任何一項不符就停止，不要執行安裝。

## 3. 安裝（命令列）

以一般使用者執行，不要整條加 `sudo`；需要提權時引擎會自己處理，先用 `sudo -v` 輸入一次密碼。`apply` 與 `issue-license` 的 `--input-file` 必須是你自己的普通檔案、權限正好 0600，讀完就會被刪除。

```sh
sudo -v
ENGINE="sh services/installer/install.sh"
PKG="--system-id <系統名稱> --archive system-package.tar.gz --signature system-package.sig.json --key root.pem --confirm-key-prefix <前8碼>"

$ENGINE detect --system-id <系統名稱>
$ENGINE verify $PKG
```

### 3.1 簽發授權

授權綁定這台機器的硬體，要在客戶現場用 USB 內的子金鑰簽發：

```sh
# issue.json 只放：{"passphrase":"子金鑰密碼","expiresAt":"<到期日，ISO 8601 UTC>"}，權限 0600
$ENGINE issue-license $PKG --subkey /media/usb/subkey.enc.pem --certificate /media/usb/subkey.cert.json --input-file issue.json --out license.lic
```

- 失敗訊息會指出階段（密碼、憑證有效期、輸出檔已存在等），不會回顯輸入。
- 授權檔已存在時不會覆寫。
- 到期日由發行端指定，不要自己延長。

### 3.2 預覽計畫並安裝

```sh
$ENGINE plan $PKG --license license.lic --plan plan.json
# 記下輸出的 planSha256
```

安裝輸入檔 `input.json`（權限 0600，內容為現場秘密，不要放進任何版本庫）：

```text
{
  "env": {
    "POSTGRES_USER": "<資料庫使用者>", "POSTGRES_DB": "<資料庫名稱>", "POSTGRES_PASSWORD": "<現場秘密>",
    "SECRET_KEY": "<至少 32 字元>", "ENTRY_PERMISSION_JWT_SECRET": "<至少 32 字元>",
    "DEFAULT_TENANT_ID": "<合法 UUID>", "PROXY_BIND": "<可省略，預設 127.0.0.1>", "HTTP_PORT": "<可省略，預設 8080>"
  },
  "admin": {"username": "<帳號>", "password": "<初始密碼，超過 8 字元>", "display_name": "<顯示名稱>"}
}
```

```sh
$ENGINE apply --system-id <系統名稱> --plan plan.json --plan-sha256 <planSha256> --license license.lic --input-file input.json
```

- 預設只監聽 `127.0.0.1:8080`；要讓區網其他電腦連線，需在 `env` 設 `PROXY_BIND`，並自行決定防火牆範圍。系統**沒有提供 TLS**。
- 含 MOD 訂閱 Kit 時，`env` 另需 `MOD_WEBHOOK_SECRET`。
- 選填 `LICENSE_BLOCK_WINDOW`（例如 `mon-fri 09:00-15:00`）與 `LICENSE_TIMEZONE`，決定硬體不符且寬限結束後從何時開始停止服務。
- 安裝共 11 步（Docker、信任庫與安裝目錄、載入映像、網路與卷、秘密檔、啟動資料庫、建表與管理員、安裝授權、啟動 guard、啟動後端與代理、健康檢查）。在 7 Kit 的實機約 52 秒。
- 進度可用 `$ENGINE status --system-id <系統名稱>` 查看；`cancel` 會在目前步驟完成後停止。

### 3.3 網頁精靈（替代方式）

`$ENGINE wizard --system-id <系統名稱>` 會在 `127.0.0.1` 開一個一次性權杖網址，依畫面完成偵測、驗證、簽發、安裝。精靈尚未對真實引擎完整跑過一次安裝，現場請以命令列為準，精靈僅在命令列不便時使用並由工程師全程在場。

## 4. 第一次使用

1. 瀏覽器開啟 `http://<主機位址>:<HTTP_PORT>/`。
2. 用安裝輸入的管理員帳號登入。第一次登入會要求先變更密碼（新密碼超過 8 字元、不可與目前密碼相同），完成前其他功能都不可用。
3. 登入失敗多次帳號會暫時鎖定；鎖定與錯誤密碼畫面相同，不會提示原因。
4. 畫面上的分頁依這次選用的 Kit 產生。分頁不依角色隱藏，沒有權限的操作由後端回 403。

## 5. 授權狀態與日常維運

- **授權狀態頁**：`http://<主機位址>:<HTTP_PORT>/license`，即使服務被封鎖也可開啟（`/healthz` 同樣可用，其餘回 503）。
- **硬體不符**：立即警告，寬限 24 小時，服務照常並在回應帶 `X-License-Warning`。寬限結束後，只在設定的封鎖時段內停止服務；非封鎖時段會順延到下一個時段開始。
- **重新綁定（更換主機板、網卡、硬碟等）**：
  1. 從授權狀態頁取得重新綁定申請檔（內容為來源名稱與雜湊，不含序號原文）。
  2. 交給發行端，由發行端簽出新授權。
  3. 上傳新授權。上傳的授權若綁的是別台硬體會被拒絕（400 `hardware-mismatch`）；正確的授權會解除封鎖。
- **緊急臨時授權**：這是發行端的作業規則，程式不強制。臨時授權有效 72 小時（以短到期日簽發），只在上班時間受理，**不接受夜間申請**。被擋的現場請在上班時間聯絡發行端，不要以修改狀態檔或授權檔案的方式繞過。
- **授權失敗種類**：缺檔（license-missing）、格式錯誤（malformed）、簽章不符（signature）、綁到別的 manifest（manifest-mismatch）都會讓服務回 503，授權狀態頁會顯示原因。
- **根金鑰輪替**：需工程師到場重置客機信任庫，沒有線上換鑰機制。

## 6. 還原與失敗處理

- 安裝中任何一步失敗，引擎只還原失敗的步驟；能回到前一個完成點結束碼為 13，無法完全還原或有保留事項為 14。
- 還原會移除容器、網路、本次載入的映像與信任庫；**不會刪除可能有資料的卷、秘密檔、安裝目錄與 apt 套件**，並逐項警告。這些要由人確認資料或備份後手動處理。
- 手動還原：

  ```sh
  $ENGINE rollback --system-id <系統名稱> --plan plan.json --rollback-plan rollback.json
  # 檢查輸出後，帶回還原計畫的雜湊再執行一次
  $ENGINE rollback --system-id <系統名稱> --plan plan.json --rollback-plan rollback.json --plan-sha256 <還原計畫雜湊>
  ```

- 已完整還原且沒有保留項目的失敗安裝，可直接再次 `apply`（舊狀態會搬到 `<狀態目錄>/archive/`）。有保留項目時，要先人工處理保留的卷與檔案。
- 已有執行中安裝時再次 `apply` 會被拒絕（結束碼 10），不影響執行中的系統。
- 結束碼：0 成功、10 輸入或環境、11 驗包或授權、12 計畫或硬體漂移、13 失敗已還原、14 還原失敗或需人工處理、15 取消、16 鎖、17 授權簽發失敗。

## 7. 已知限制

以下是已確認的限制，現場不得對客戶宣稱已具備：

- **沒有 TLS**；密碼與權杖以明文經區網傳送。需要加密時請在前端另加反向代理，不在本系統範圍。
- **沒有機器 API key 認證**；系統只能用登入帳號存取。
- **稽核紀錄只涵蓋編輯**：每一次資料編輯都記在資料庫的編輯稽核（含原因、修改前後的值）。系統層級的稽核事件表（`audit_events`）預設關閉，本系統沒有為一般 API 請求寫入；不要對客戶宣稱有完整的操作稽核。
- **檔案上傳頁的資料去向**：上傳頁把 CSV 匯入「通用表格」已定義欄位的表單（先預覽、確認才寫入）；欄位型別不符的列會被列為錯誤、不會匯入。資料查詢頁查的是同一份通用表格資料；沒有另一套舊版上傳資料。
- **沒有升級遷移**；本版只支援全新安裝。不要刪除卷來「升級」。
- **有 root 或 docker 群組權限的人可以讀到容器環境與秘密檔**。授權綁定只能提高複製門檻，不能保證無法複製。
- 硬體綁定在品牌機上的指紋穩定性、真實 USB 流程、guard 長時間失效、等滿 24 小時寬限，都**未在實機驗證**；封鎖時段關閉時不封鎖的行為只有單元測試。
- 網頁精靈沒有對真實引擎完整跑過安裝。
- 授權狀態頁的重新綁定申請檔與上傳，實機只以 API 呼叫驗證，沒有用瀏覽器操作過頁面按鈕。
- 前端上傳頁沿用基線程式，型別檢查有 10 個既有錯誤（建置不受影響，功能未因此判定有誤）。
- 依賴套件以版本固定、未加雜湊鎖定；基底映像以標籤指定，未固定 digest。

## 8. 版本與驗證紀錄

- 設計與決議：`docs/decision-log.md`（D124、D138、D143 至 D149）。
- 引擎契約：`docs/install-engine-contract.md`。
- 實機驗證：Ubuntu 22.04.5、Docker 29、Compose 2.40.3；包含乾淨安裝、授權失敗路徑、硬體寬限與封鎖、重複安裝、還原，以及前端登入、首次改密碼與已登入畫面（以瀏覽器確認）。
