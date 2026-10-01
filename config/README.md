# config

重構專案的設定資料。基線版檔案唯讀，差異一律放在這裡。

| 檔案 | 來源 | 說明 |
|---|---|---|
| `flows.json` | 基線版 `gui/app.js` 的 `const flows`，commit `c4b2b7b`（見 `kits/BASELINE.md`） | 原樣移植；只允許替換 `tenant-auth-kit` 參照（原 flows 無此參照，故未修改）。唯一差異：`query-trace` 加上 `requiresFlows: ["generic-forms"]`（決策 D26） |
| `kits/overlay.json` | 以檔內 `sourceCommit` 記錄基線 commit | 隱藏 `tenant-auth-kit`、加入 `entry-permission-kit`、覆寫顯示名稱（D03） |
| `ui/previews.json` | 重構專案新增 | Composer 預覽用的 UI definition 與模擬資料 |
| `site/examples/demo-site-{a,b}.site.json` | 重構專案新增（M01 模擬資料） | 在「輸出」匯入場域設定；兩份檔案調整同一資料驗證功能的欄名、欄寬與限制，不含真實製造資料或秘密值 |
