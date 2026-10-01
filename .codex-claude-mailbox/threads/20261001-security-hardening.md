---
id: "20261001-security-hardening"
title: "安全強化：防篡改、單機授權與通訊（D37–D45）"
status: "completed"
owner: "user"
reviewer: "user"
priority: "high"
created_by: "claude"
created_at: "2026-10-01"
updated_at: "2026-10-01"
role_priority:
  implementation: "claude"
  review: "user"
  tests: "claude"
  requirements: "user"
artifacts:
  - path: "schemas/license.schema.json"
    type: "file"
  - path: "scripts/security/"
    type: "dir"
  - path: "kits/platform-core-kit/src/backend/app/core/license.py"
    type: "file"
  - path: "kits/platform-core-kit/tests/test_license.py"
    type: "file"
  - path: "apps/composer-gui/src/security.test.mjs"
    type: "file"
  - path: "docs/project-spec.md"
    type: "file"
---

# Goal

目標：防篡改、單一機器使用、資料庫與前後端安全通訊。分支 `feature/security-hardening`，由 main（6e66ef9）開出。

# User 已確認（2026-10-01）

1. 沿用基線版做法，但移除 TPM 驗證（D37）。
2. 其餘依 Claude 建議（D38–D45）。
3. 接受 MachineGuid／machine-id 會隨 VM 或磁碟映像複製（D38）。
4. 核准安裝 Python 測試依賴：專案內 `.venv`，pytest 9.1.1、cryptography 50.0.2（D43）。
5. 同機部署不啟用資料庫 TLS：user 詢問理由，Claude 已說明，寫入 D45。
6. 建立／更新 Obsidian 筆記。

# Claude Notes

## 基線版研究（唯讀）

- 防篡改：RSA-2048、RSA-PSS-SHA256（salt 32）簽 `license.lic` 與選用的 `<zip>.sig.json`。`.sig.json` 沒有任何程式驗證；公鑰寫死在原始碼，曾與實際金鑰不符而 crash-loop（K1）；安裝精靈不驗簽（H2）。
- 單機：TPM EK 指紋或 TPM challenge-response；指紋來源未記錄、兩平台算法不同（H1）；Windows 沒有指紋工具。
- 通訊：nginx 只聽 80 port、資料庫無 SSL、秘密值放 `.env`（有 ACL 加固）、後端 8000 port 對外開放；HTTPS 與資料庫 TLS 皆無決策紀錄。
- 私鑰未提交進基線 repo，但有三份 `license.lic` 被追蹤。

## 實作

- 契約 `schemas/license.schema.json`：沿用 envelope `{ payload, signature, algorithm }`；授權 payload 升為 2.0（必須含 `machineFingerprint`、`fingerprintSource`、`packageManifestSha256`；`licensee` 只記客戶代稱）；zip 簽章 payload 沿用基線 1.0。
- `scripts/security/`（Node 內建 crypto 加既有 Ajv，不新增依賴）：
  - `generate-keys.mjs`：目標位於 repo 內即拒絕、不覆寫，Windows 以 icacls 限制私鑰權限。
  - `sign-package.mjs`：簽章前先核對交付包與 manifest，私鑰在 repo 內即拒絕，未加 `--force` 不覆寫。
  - `verify-package.mjs`：檢查 zip 簽章、授權簽章、`packageManifestSha256`、各產物 SHA-256 與到期日，任一失敗即以 exit 1 結束。
  - `get-machine-fingerprint.ps1`（UTF-8 BOM）與 `.sh`。
  - `lib.mjs`：讀 zip 的程式只接受自寫的未壓縮格式並驗證 CRC，其他一律拒絕；CRC32 與 `zip.ts` 重複，因為須能在純 Node 執行。
- `license.py`：移除 TPM；依 `fingerprintSource` 取本機識別，並以 `hmac.compare_digest` 比對；公鑰為佔位值、舊格式、含 `machinePublicKey`、或未綁定機器時，一律明確拒絕並說明原因。`kits/BASELINE.md` 已記錄這些修改。
- `.gitignore` 排除 `.venv/`、`*.pem`、`license.lic`、`*.sig.json`。
- `package.json` 新增 `test:kits`。

## 驗證

- `npm.cmd run typecheck`、`npm.cmd run build` 通過。
- `npm.cmd test`：55 passed、1 skipped（身分授權「未涵蓋」，沿用）。新增 `security.test.mjs` 6 項，含以實際 CLI 走完整流程。
- `npm.cmd run test:kits`：14 passed、1 skipped（Linux 指紋測試在 Windows 略過）。
  - 跨語言測試：Node 簽發、Python 驗證。
  - 一致性測試：本機 `get-machine-fingerprint.ps1` 與 `license.py` 算出的指紋相同。
- 突變檢查 9 項全數被測試攔到：zip SHA 比對、manifest 綁定、多餘檔案、repo 路徑防護、PSS salt、Python 機器比對、TPM 欄位拒絕、到期、佔位公鑰。
- 突變檢查期間，拿掉 repo 防護的那次執行在 repo 內寫出一組測試金鑰（未追蹤、未使用），已刪除。測試的 `afterAll` 已加上清除步驟，`.gitignore` 也排除 `*.pem`。

## 未涵蓋與已知限制

- 資料庫與前後端通訊只定規格（D45）；部署檔於 P2 產生。HTTPS 憑證來源待決（spec §15 第 9 項）。
- 專案沒有 `@types/node`，`scripts/security/*.mjs` 與 `security.test.mjs` 不在 typecheck 範圍，只由 vitest 執行。若要納入，須經 user 核准新增 `@types/node`。
- 公鑰填入 `license.py` 屬 P2 組裝工作；目前佔位值會拒絕所有授權。
- 威脅模型界線見 D44；Docker 部署須唯讀掛載 `/etc/machine-id`。
- 遠端測試主機沒有 pip 與 venv，Linux 端以 `linux_smoke.py` 驗證，不跑 pytest 全套。

## Linux 實測（2026-10-01，192.168.200.63）

環境：Ubuntu 22.04.5、Python 3.10.12、系統 cryptography 3.4.8（即 `license.py` 註解所指的 Ubuntu 22.04 預設環境）。主機無 Node、Docker、pip，系統套件不更動。
方法：把 `license.py`、`get-machine-fingerprint.sh` 與 `tests/linux_smoke.py`（只用標準函式庫與系統 cryptography）複製到 `/tmp` 暫存目錄，在本機用 Node 簽發綁定遠端指紋的授權，帶到遠端驗證，測完刪除暫存目錄與本機的簽章檔。
結果 8 項全數通過：
- shell 指紋工具與 `license.py` 對 `/etc/machine-id` 算出相同指紋。
- Windows 識別來源在 Linux 上讀不到，授權被明確拒絕。
- 綁定本機的授權通過；綁定其他機器、已到期的授權被拒絕。
- Node 簽發的授權在舊版 cryptography 3.4.8 上通過。
- 另測：修改 payload 後簽章失敗；公鑰為佔位值時拒絕；大寫 machine-id 與工具算出相同指紋。

### Linux 上的 Node 工具（2026-10-01）

以官方 Node v22.23.3 linux-x64（SHA-256 與 SHASUMS256.txt 相符）解壓到使用者目錄，不使用 sudo、不改系統套件；以本機實際建出的設定交付包（`buildDeliveryPackage`）在遠端執行：
- `generate-keys`：目標在 repo 內被拒絕；repo 外成功，私鑰權限 600；重複執行不覆寫。
- `sign-package`：以遠端 `get-machine-fingerprint.sh` 的指紋簽發；未加 `--force` 不覆寫。
- `verify-package`：通過；改動 zip 一個位元組後以 exit 1 失敗，指出 SHA-256 與簽章記錄不符。
- 同一份 Node 簽發的 `license.lic` 交給 `license.py` 驗證通過。
測完已刪除遠端的 Node、測試檔與測試金鑰。

### Docker 唯讀掛載 machine-id（2026-10-01）

user 在遠端以 sudo 安裝 docker.io 29.1.3；使用 `python:3.10-slim`（測完已刪除映像與測試檔）。
- 不掛載：容器內沒有 `/etc/machine-id`，指紋工具明確報錯 `cannot read /etc/machine-id`，不會產生錯誤的指紋。
- `-v /etc/machine-id:/etc/machine-id:ro`：shell 工具與 `license.py` 的指紋都與主機相同；容器內寫入掛載檔被拒絕（Read-only file system）。
- 容器內安裝 cryptography 50.0.2 後，`linux_smoke.py` 7 項通過。
結論：D38 的「Docker 須唯讀掛載主機 `/etc/machine-id`」成立；不掛載時授權不會誤通過，而是明確失敗。

# Closure

2026-10-01：user 同意合併；以 `--no-ff` 合併至 main（8ae2972），合併後 typecheck、build 通過，vitest 55 passed、1 skipped，test:kits 14 passed、1 skipped。user 核准新增 `@types/node` 並設定 CI，另開分支處理。

# Open Questions

- HTTPS 憑證來源：已記錄四個方案的比較（decision-log「HTTPS 憑證來源」），待現場條件確認後決定；暫以內網為前提（D46）。
- 已核准新增 `@types/node`（見 thread 20261001-node-typecheck-ci）。
