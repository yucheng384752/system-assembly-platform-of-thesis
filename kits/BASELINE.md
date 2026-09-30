# 基線版 Kit 副本

本目錄的 Kit 原樣複製自基線版 Form System Kit Composer，作為重構與論文對照的起點。

- 來源：`C:\Users\gslab\Documents\New project\form-system-kit-composer\kits`
- 基線 commit：`c4b2b7b`（2026-09-21），複製時來源目錄無未提交變更
- 複製日期：2026-09-30；153 個檔案，未修改內容

使用注意：

- `tenant-auth-kit` 依決策 D03 廢除，由 `entry-permission-kit` 取代；副本保留供對照，不應再被新 Recipe 選用。
- 這些原始碼目前不在本專案的 typecheck 與測試範圍（`tsconfig.json` 只含 `apps`、`libs`），GUI 仍使用 `apps/composer-gui/src/fixtures.ts` 的 mock Kit。
- 修改副本前先確認是否要同步回基線版；論文比較時以上述 commit 為基線版本。
