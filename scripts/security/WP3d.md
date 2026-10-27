# WP3d 離線簽發工具

既有 zip／授權 2.0 工具維持原狀。以下指令在 repo 根目錄執行，僅需既有 Node 與 Ajv；不連網、不使用 Docker。所有輸出拒絕覆寫。私鑰與子金鑰輸出目錄必須在 repo 外；測試用金鑰由測試臨時產生。

```text
node scripts/security/issue-subkey.mjs --root-key <root-private.pem> --client-name <客戶代稱> --passphrase-file <密碼檔> --out-dir <repo外目錄> [--hours 24]
node scripts/security/sign-system-package.mjs --key <root-private.pem> --archive <system.tar.gz> --manifest <system-manifest.json> --system-id <id> --system-version <1.0.0> --out-dir <目錄>
node scripts/security/release-fingerprints.mjs --launcher <install.sh> --root-public-key <root-public.pem> [--out-dir <目錄>]
node scripts/security/issue-license.mjs --key <subkey.enc.pem> --certificate <subkey.cert.json> --passphrase-file <密碼檔> --root-public-key <root-public.pem> --fingerprints <sources.json> --manifest <system-manifest.json> --client-name <客戶代稱> --recipe <recipe名稱> --enabled-kits <kit1,kit2> --expires-at <YYYY-MM-DDTHH:mm:ssZ> --out-dir <目錄>
node scripts/security/verify-license.mjs --license <license.lic> --root-public-key <root-public.pem> --fingerprints <sources.json> --manifest <system-manifest.json>
node scripts/security/verify-system-package.mjs --signature <system-package.sig.json> --archive <system.tar.gz> --manifest <system-manifest.json> --root-public-key <root-public.pem>
```

密碼僅接受 `--passphrase-file` 指定的非空單行 UTF-8 文字，可有最後一個換行。密碼本身不進命令列、不回顯；請保護並自行清除該檔案。子金鑰為 AES-256-CBC 加密 PKCS#8 PEM，期限預設 24 小時、上限 168 小時。Windows 輸出的私鑰 ACL 限制為執行程序的實際使用者；Unix 權限為 0600。

`sources.json` 是有效來源的陣列（從 detect 結果取 `valid: true` 的項目，只保留 `source` 與 `sha256`）：

```json
[
  { "source": "product_uuid", "sha256": "<64位小寫十六進位>" },
  { "source": "board_serial", "sha256": "<64位小寫十六進位>" },
  { "source": "mac:eth0", "sha256": "<64位小寫十六進位>" }
]
```

來源原值以 Python `.strip().lower()` 規則正規化後雜湊，保留內部空白與分隔符號；`system-license.mjs` 匯出 `fingerprintHash` 供交叉驗證。授權至少記錄三個不同來源名稱，比對以不同雜湊值的集合交集計數，至少兩個符合。Node 工具接收已過濾的來源，不自行偵測硬體。

`issue-license` 是測試與格式參考實作；現場 Python 簽發屬 WP3b 第二階段。簽發檢查當下時間及 `issuedAt` 都落在憑證區間；日後驗證只檢查 `issuedAt`，不因子金鑰過期而否定尚未到期的授權。`verify-license` CLI 必須提供目前指紋；程式 API 的 `sources` 可省略，以供只驗證鏈的呼叫端使用。驗證命令退出碼 0 才代表通過，失敗為 1。

簽章採 RSA-PSS-SHA256、saltLength 32，簽的是 UTF-8 `payload` 字串的原始位元組，不重新序列化。公鑰識別為 SPKI DER SHA-256。`release-fingerprints.txt` 前兩行是檔案位元組 SHA-256，供客機 `sha256sum` 核對；註解中的精靈確認碼是 SPKI 指紋前 8 碼，兩者不同。此檔應經 USB 以外管道放入操作手冊。

安裝包工具簽／核對呼叫端提供的 tar.gz 與 manifest 位元組，不解壓、不檢查 tar 內的 manifest；WP3b 引擎負責解壓安全、包內 manifest 與各檔案一致性。OpenSSL 3.0 解密、RSA-PSS 與 Ubuntu Python 引擎交叉驗證由 Claude 執行。

驗證：

```text
node --test scripts/security/tests
node scripts/security/tests/mutations.mjs
```
