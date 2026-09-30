# Composer Platform 重構專案

本專案整理 Composer 重構需求與設計草案，並分階段實作。**目前 React 18 + TypeScript Composer GUI 已支援三個 mock Kit 的分頁、表格／下拉編輯、Schema 驗證及 Recipe JSON 匯入／匯出；Migration generator、Analytics runtime 與正式系統整合尚未實作。**

本專案是 Form System Kit Composer（基線版）的改良版，成果將撰寫成論文。基線版位置：

- Composer 工作區：`C:\Users\gslab\Documents\New project\form-system-kit-composer`
- Target System：`C:\Users\gslab\Desktop\Form-analysis-server-specify-kit`
- 筆記庫：`C:\Users\gslab\Desktop\Form System Kit Composer Obsidian`

- [整合專案規格](docs/project-spec.md)：需求、角色、資料契約、組裝流程、Analytics、里程碑與驗收。
- [決策紀錄](docs/decision-log.md)：已決議事項、原因與待決清單。
- 來源：ChatGPT 對話「歸納 Composer 改版需求」，2026-09-23 整理；conversation ID：`6ab37f74-8ec0-83e8-881b-b59310b07a1e`。
- 規格狀態：`0.1.1 / draft`。原始需求與設計建議分開標記，尚未經既有儲存庫驗證。

## 初始結構

```text
composer-refactor/
├─ README.md
├─ apps/
│  └─ composer-gui/        # React 18 + TypeScript + Vite GUI
├─ libs/ui-runtime/        # 共用驗證、Recipe 轉換、解析與 React renderer
├─ docs/
│  ├─ project-spec.md       # 唯一整合規格
│  └─ decision-log.md       # 決策紀錄
├─ config/
│  ├─ kits/                # Kit 設定
│  ├─ ui/                  # UI 定義實例
│  ├─ permissions/         # 角色、資源與操作規則
│  ├─ database/            # 期望資料模型
│  ├─ runtime/             # 業務 Function 參數
│  └─ site/                # 場域設定
├─ schemas/                # Kit、Recipe、UI definition 的 JSON Schema
├─ kits/
│  ├─ analytics-kit/       # 通用分析 Kit
│  └─ entry-permission-kit/# 入口權限 Kit（取代基線版 tenant-auth-kit）
├─ services/
│  └─ analytics-engine/   # 分析 mService 集合；不是部署切分承諾
├─ migrations/             # 按 DB 方言／版本放置遷移產物
├─ manuals/
│  ├─ kits/                # Kit 與角色的手冊來源
│  └─ generated/           # 未來組裝的手冊
└─ packages/               # 未來產出的 System Package
```

尚未實作的空目錄以 `.gitkeep` 保留；目前 GUI 僅使用 mock fixture，不連接正式資料。

## 一鍵啟動

雙擊專案根目錄的 `start.cmd`，或在命令列執行：

```powershell
.\start.cmd              # 啟動並開啟瀏覽器
.\start.cmd -Check       # 啟動前先跑 typecheck 與測試
.\start.cmd -Port 5180   # 指定連接埠
.\start.cmd -NoBrowser   # 不自動開啟瀏覽器
```

腳本（`scripts/start.ps1`）會依序：檢查 Node 版本（需 ^20.19.0 或 >=22.12.0）→ `node_modules` 不存在或 `package-lock.json` 較新時執行 `npm ci` → 若本專案 dev server 已在執行就直接沿用，連接埠被其他程式占用則往後找可用埠 → 啟動 dev server 並等待就緒（最多 60 秒）→ 開啟瀏覽器。按 Ctrl+C 或關閉視窗會一併停止 dev server。任何一步失敗都會顯示原因並以非 0 結束。`start.cmd` 以 `-ExecutionPolicy Bypass` 呼叫 PowerShell，不需要修改系統執行政策。

## GUI 骨架開發

使用 Node.js 24.15.0 與 npm 11.13.0，在專案根目錄執行：

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
```

建置輸出至 `dist/`；根目錄 `packages/` 仍保留給 System Package 產物。
測試使用 Vitest；在此 Windows 環境採 `--configLoader native` 載入設定，避免預設 esbuild 設定打包時的目錄存取錯誤。
已有 schema、resolver、Recipe 往返與 DOM 互動檢查；真實瀏覽器驗證由 Claude 執行。Composer 尚無身分驗證，角色只作提示；授權拒絕測試標為「未涵蓋」。

選取 Kit 並調整設定後，按「匯出 Recipe」複製 JSON 儲存；貼回文字區並按「匯入 Recipe」可重新載入。匯入成功替換草稿，失敗保留原設定。僅處理 UI Recipe 欄位，其他欄位不保留並顯示提示；匯出排除未選項目、資料列及額外連線憑證欄位。請勿在可編輯文字內輸入實際資料或秘密值。

## 下一步

1. 依規格第 15 節確認 AoV、目標 DB、既有 Kit 與 `analytical_four` 的實際契約。
2. 先制定 Function、mService、Kit、System、Site、Artifact 的資料契約與驗證方式。
3. 以一份場域設定、一個分析流程與一個表格完成端到端最小驗證，再擴充。

既有 Obsidian 筆記庫的「18 Composer Platform 重構專案」作為導航；本專案的 `docs/project-spec.md` 為本次規格的維護來源。
