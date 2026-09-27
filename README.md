# Composer Platform 重構專案

本專案整理 Composer 重構需求與設計草案，作為後續盤點既有程式、確認資料契約及分階段實作的起點。**目前是規格與目錄骨架，尚未實作 Composer、Schema validator、Migration generator 或 Analytics runtime。**

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
├─ schemas/                # 未來的 JSON Schema 驗證契約
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

空目錄以 `.gitkeep` 保留。檔案格式、正式 Schema 與執行框架尚待第一階段確認；不提供假 SQL、假 manifest 或不可執行的程式。

## 下一步

1. 依規格第 15 節確認 AoV、目標 DB、既有 Kit 與 `analytical_four` 的實際契約。
2. 先制定 Function、mService、Kit、System、Site、Artifact 的資料契約與驗證方式。
3. 以一份場域設定、一個分析流程與一個表格完成端到端最小驗證，再擴充。

既有 Obsidian 筆記庫的「18 Composer Platform 重構專案」作為導航；本專案的 `docs/project-spec.md` 為本次規格的維護來源。
