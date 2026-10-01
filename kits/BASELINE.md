# 基線版 Kit 副本

本目錄的 Kit 原樣複製自基線版 Form System Kit Composer，作為重構與論文對照的起點。

- 來源：`C:\Users\gslab\Documents\New project\form-system-kit-composer\kits`
- 基線 commit：`c4b2b7b`（2026-09-21），複製時來源目錄無未提交變更
- 複製日期：2026-09-30；153 個檔案，未修改內容

使用注意：

- `tenant-auth-kit` 依決策 D03 廢除，由 `entry-permission-kit` 取代；副本保留供對照，不應再被新 Recipe 選用。
- 這些原始碼目前不在本專案的 typecheck 與測試範圍（`tsconfig.json` 只含 `apps`、`libs`），GUI 仍使用 `apps/composer-gui/src/fixtures.ts` 的 mock Kit。
- 修改副本前先確認是否要同步回基線版；論文比較時以上述 commit 為基線版本。

## 已修改的副本檔案

- `platform-core-kit/src/backend/app/core/license.py`（2026-10-01，D37–D41）：移除 TPM EK 指紋與 challenge-response；授權 payload 升為 schemaVersion 2.0，必須以 `fingerprintSource`（Windows MachineGuid／Linux `/etc/machine-id`）綁定機器；公鑰改為組裝時填入的佔位值，未填入即拒絕所有授權。基線版行為以 commit `c4b2b7b` 為準。
- 新增 `platform-core-kit/tests/test_license.py` 與 `requirements-test.txt`（pytest 9.1.1、cryptography 50.0.2，D43）。執行方式：`python -m venv .venv`，`.venv\Scripts\python -m pip install -r kits/platform-core-kit/requirements-test.txt`，再 `npm.cmd run test:kits`。
