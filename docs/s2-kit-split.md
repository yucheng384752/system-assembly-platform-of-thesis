---
title: 場域系統 S2 的 Kit 拆分計畫
date: 2026-10-18
status: 進行中（WP1 完成）
---

# 場域系統 S2 的 Kit 拆分計畫

S2 是一套已上線的製程紙本電子化系統（React + FastAPI + PostgreSQL，同步 SQLAlchemy）。本文件記錄把它拆成本專案 Kit 的決策、邊界與解耦方式。依 M01，本文件與所有衍生檔案不出現 S2 的公司、產品、設備名稱、表單編號與製程數值；真名對照表只保存在 Claude 的本機工作環境，不進 repo。

## 1. 決策（編號待合併到 main 時接續 decision-log）

| 暫編 | 決議 | 原因 |
|---|---|---|
| D-A1 | S2 拆出的 Kit 放在本專案 `kits/`；基線版維持唯讀 | 三代合併計畫以本專案為主產品；CLAUDE.md 規定基線版不得修改 |
| D-A2 | Composer 新增「參數設定」步驟（流程畫布 → 功能選配 → 參數設定 → 輸出），並新增選配 Kit `runtime-settings-kit` 負責「上線後調整」層 | user 要求最大限度由 GUI 調整表格、預填與報警參數；spec §5 的 Runtime override 層尚未設計。此項改變 D77 的必填步驟數，須同步更新 spec 與 DESIGN.md |
| D-A3 | 產品線改為設定資料，可選擇啟用；未提供定義的產品線顯示「尚未提供定義」，不產生假資料 | user 要求預留尚未建置的產品線 |
| D-A4 | 去識別化對照表（真名 ↔ 代號）不進 repo，由 Claude 在本機維護；搜尋驗收比照 example-scenario | M01 |

## 2. Kit 邊界

| Kit | 顯示名稱 | 範圍 | 狀態 |
|---|---|---|---|
| `platform-core-kit` | 系統基本功能 | 沿用；需補同步 DB session 契約（見 §5 待決 1）與事件匯流排 | 待決 |
| `entry-permission-kit` | 帳號與入口權限 | 登入、帳號管理、入口註冊與覆寫、資源範圍 | WP1 後端完成 |
| `product-process-kit` | 產品與製程定義 | 產品線（可預留）、型號、配方明細、站點、製程步驟、量測項目、型號規格、異動紀錄 | WP4 後端完成 |
| `batch-production-kit` | 批次生產紀錄 | 開單派工、用料秤重、量測記錄、批號流水號、簽核、完成（第一階段）；入庫單、回鍋確認單、子表格備註、照片佐證（第二階段） | WP5 第一階段完成 |
| `equipment-maintenance-kit` | 設備點檢與維修 | 日常點檢、複核、故障維修、月度匯出、生產閘門 | 後端核心完成（WP7），前端待做 |
| `alarm-exception-kit` | 報警與異常簽核 | 量測超規判定、報警總覽與確認、檢驗異常簽核 | 後端核心完成（WP6），前端待做 |
| `production-dashboard-kit` | 儀表板與製程查詢 | 報警與設備異常總覽、製程查詢、操作紀錄 | 後端核心完成（WP9），前端待做 |
| `runtime-settings-kit` | 參數設定中心 | 上線後參數調整、版本、異動紀錄、依場域限制驗證 | 待做（D-A2） |

相依：platform-core → entry-permission → product-process → {equipment-maintenance, batch-production}；batch-production → {alarm-exception, production-dashboard}；runtime-settings 只依賴 platform-core 與 entry-permission。

## 3. 解耦方式

| S2 的耦合 | 拆分後 |
|---|---|
| 所有入口集中在一個檔案 | 各 Kit 註冊自己的入口（`permission.entry-point.register`） |
| 帳號清單檢查批次管理入口 | 入口 tag `user-directory` |
| 帳號 ↔ 產品外鍵 | 通用資源範圍 `user_scopes`，product-process-kit 註冊範圍類型 `product-line` |
| 生產紀錄直接新增報警資料列（4 處） | 生產紀錄只發出「量測已記錄」事件；alarm-exception-kit 訂閱並判定 |
| 生產紀錄直接呼叫點檢閘門 | 生產紀錄提供閘門註冊介面；equipment-maintenance-kit 註冊點檢閘門。未選設備 Kit 時流程照常 |
| 活動日誌與表單定義寫在批次路由檔 | 分別歸入 production-dashboard-kit 與 product-process-kit |
| 單一前端 API 檔與翻譯檔 | 每個 Kit 各自一份，殼層以註冊表組合分頁 |
| 40 個交錯的 Alembic 遷移 | 每個 Kit 一個 baseline 遷移，依相依順序套用 |
| 前端入口清單與後端不同步 | 前端改讀 `GET /users/entry-points` |

## 4. 參數設定（D-A2）

- 組裝時：Composer「參數設定」步驟，屬平台功能，不是 Kit。
- 上線後：`runtime-settings-kit`。各 Kit 在 definition 宣告可調參數（型別、單位、範圍、可修改角色、風險、修改層級），本 Kit 只提供儲存、版本、異動紀錄、驗證與編輯頁。
- 有效值優先序：功能預設 < 系統設定 < 場域設定（限制為最終驗證） < 上線後調整。
- 不可由介面直接完成：改欄位型別（修改層級 B，產生遷移步驟）、新判定規則（修改層級 C，需開發擴充）。
- S2 已是資料驅動、可直接接上：量測規格上下限、型號配方對照。
- S2 寫死、需抽出：散裝重量上限、必填照片欄位、批號格式（廠區碼與類別碼）、照片大小上限、包裝數量一致性欄位、登入鎖定次數與時間（WP1 已抽出）。

## 5. 待決

1. **DB session 契約**：S2 為同步 SQLAlchemy；基線版 platform-core 的連線為非同步，且其 `app.core.database` 原始碼不在本專案。可選：platform-core 同時提供同步 session、S2 系 Kit 改寫為非同步、或另立 S2 用的 platform-core 變體。未決前 S2 系 Kit 不可組裝。
2. **GUI 登錄**：新 Kit 須寫入 `kits/form-analysis.kit-manifest.json`、`config/registry/`、`config/kits/overlay.json`；這些檔案被 GUI 測試讀取，須在可跑 `npm.cmd test` 的環境登錄並驗證。
3. **spec §8 標題**含 S2 的專案名稱，是否改為代號。

## 6. 工作包

| WP | 內容 | 狀態 |
|---|---|---|
| WP1 | entry-permission-kit 後端、契約、definition、單元測試 | 完成（14 項通過） |
| WP2 | entry-permission-kit 前端（登入、改密碼、帳號管理、入口覆寫） | 待做 |
| WP3 | 決議待決 1、2，登錄 GUI | 待決 |
| WP4 | product-process-kit 後端、契約、定義、產線定義範例、單元測試（16 項通過） | 完成 |
| WP5 | batch-production-kit 第一階段：事件、閘門、批號樣板、進度、完成條件、核心 API（30 項單元測試通過） | 完成 |
| WP5b | batch-production-kit 第二階段：入庫單、回鍋確認單、子表格備註、照片佐證 | 待做 |
| WP6 | alarm-exception-kit：規格範圍／門檻／一致性規則、報警對帳、異常簽核閘門（batch 補 `validate_value` 閘門與 `batch_read`） | 後端完成 |
| WP7 | equipment-maintenance-kit：設備、點檢表、點檢與複核、維修、月度匯出、生產閘門（`order=10`，批次 Kit 為可選相依） | 後端完成 |
| WP8 | batch-production-kit 第二階段：入庫單、回鍋確認單、子表格備註、照片佐證（預設關閉，`enable_batch_extras`） | 後端完成 |
| WP9 | production-dashboard-kit：總覽（可登錄區塊）、操作紀錄、製程查詢；批次 Kit 補 `BatchChanged.actor_id` 與搜尋／計數／追溯讀取介面；報警與設備 Kit 各登錄一個總覽區塊 | 後端完成 |
| WP10 | runtime-settings-kit：參數定義、四層有效值、權限與風險、樂觀鎖、變更紀錄、場域鎖定；報警／設備／儀表板／批次共登錄 9 項參數驗證機制 | 後端完成 |
