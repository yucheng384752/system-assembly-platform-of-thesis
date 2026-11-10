# factory-core-kit 認證審查表

狀態：Claude 驗證完成；待 user 人工覆核。認證只代表「建模與訓練可用」，不代表執行可用（D195）。

## 認證對象

| 項目 | 內容 |
|---|---|
| 檔案 | `kits/factory-core-kit/workflow.aov.json` |
| SHA-256 | `f1c34797a651ab9f512b6ff5ff1bee94cb068fd4d9341ab7f09c654a5acc27c1` |
| 來源 commit | 本分支 `9bdaf0f` 之上的工作樹（動作目錄 55 個，D203） |
| Kit 版本 | 0.1.0 |
| 狀態欄 | draft（是否改成 reviewed 由 user 決定） |

任何對上列檔案或 `config/actions.json` 的修改，都使本認證失效，需要重新審查。

## Claude 驗證結果

| 檢查 | 結果 |
|---|---|
| 流程規格與登錄一致（schema、子功能、能力皆已登錄、無循環） | 通過 |
| 轉成畫布（`kitWorkflowToCanvas`） | 通過，15 步、7 條連線 |
| 畫布完整性（`integrityErrors`） | 0 項 |
| 畫布待補項（`graphErrors`） | 0 項 |
| 下載再匯入的節點與動作標籤 | 相同 |
| 動作對應 | 15 步有對應動作，0 步無對應 |
| 專案檔轉換（`convertCanvas`） | 不適用（需要物料設定，Kit 流程描述軟體功能），未涵蓋 |
| 執行驗證 | 未涵蓋（流程仍是草稿） |

## 步驟標籤

標籤欄的「動作」是訓練時的正確答案；「無對應動作」是拒答類別的答案。

| # | 步驟 | 名稱 | 標籤 | 依據 | 前置 | 後續 | 覆核 |
|---|---|---|---|---|---|---|---|
| 1 | `receive-plan` | 接收生產計畫 | `receive-production-plan`（接收生產計畫） | 已驗證的 API 能力由此動作涵蓋 | 開始 | create-order、propose-params | [ ] |
| 2 | `list-plans` | 查詢生產計畫清單 | `browse-production-plans`（查詢生產計畫） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 3 | `get-plan` | 查看生產計畫 | `browse-production-plans`（查詢生產計畫） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 4 | `upload-form` | 上傳計畫引用的表單 | `manage-plan-forms`（上傳與查看計畫表單） | 已驗證的 API 能力由此動作涵蓋 | 開始 | create-order | [ ] |
| 5 | `get-form` | 查看表單定義 | `manage-plan-forms`（上傳與查看計畫表單） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 6 | `propose-params` | 提出生產參數修改 | `propose-param-change`（提出生產參數修改） | 已驗證的 API 能力由此動作涵蓋 | receive-plan | decide-params | [ ] |
| 7 | `list-params` | 查詢參數版本 | `view-param-versions`（查詢參數版本） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 8 | `decide-params` | 核准或駁回參數修改 | `decide-param-change`（核准或駁回參數修改） | 已驗證的 API 能力由此動作涵蓋 | propose-params | 結束 | [ ] |
| 9 | `create-order` | 建立工單 | `create-work-order`（建立工單） | 已驗證的 API 能力由此動作涵蓋 | receive-plan、upload-form | start-order、raise-alarm | [ ] |
| 10 | `start-order` | 工單開工 | `start-work-order`（工單開工） | 已驗證的 API 能力由此動作涵蓋 | create-order | 結束 | [ ] |
| 11 | `get-order` | 查看工單 | `view-work-order`（查看工單） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 12 | `raise-alarm` | 回報警報並暫停節點 | `raise-alarm`（回報警報） | 已驗證的 API 能力由此動作涵蓋 | create-order | acknowledge-alarm | [ ] |
| 13 | `list-alarms` | 查詢警報 | `browse-alarms`（查詢警報） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |
| 14 | `acknowledge-alarm` | 確認警報並解除暫停 | `acknowledge-alarm`（確認警報） | 已驗證的 API 能力由此動作涵蓋 | raise-alarm | 結束 | [ ] |
| 15 | `collect-reminders` | 收取到期提醒 | `collect-alarm-reminders`（收取到期提醒） | 已驗證的 API 能力由此動作涵蓋 | 開始 | 結束 | [ ] |

## 連線

| # | 從 | 到 | 依據 | 覆核 |
|---|---|---|---|---|
| 1 | `receive-plan` | `create-order` | 路由以 `order_id`／`plan_id`／`alarm_id` 為路徑參數（`routes_factory.py`），並見 scope 文字 | [ ] |
| 2 | `upload-form` | `create-order` | 路由以 `order_id`／`plan_id`／`alarm_id` 為路徑參數（`routes_factory.py`），並見 scope 文字 | [ ] |
| 3 | `receive-plan` | `propose-params` | 路由以 `order_id`／`plan_id`／`alarm_id` 為路徑參數（`routes_factory.py`），並見 scope 文字 | [ ] |
| 4 | `propose-params` | `decide-params` | 路由以 `order_id`／`plan_id`／`alarm_id` 為路徑參數（`routes_factory.py`），並見 scope 文字 | [ ] |
| 5 | `create-order` | `start-order` | 路由以 `order_id`／`plan_id`／`alarm_id` 為路徑參數（`routes_factory.py`），並見 scope 文字 | [ ] |
| 6 | `create-order` | `raise-alarm` | 路由以 `order_id`／`plan_id`／`alarm_id` 為路徑參數（`routes_factory.py`），並見 scope 文字 | [ ] |
| 7 | `raise-alarm` | `acknowledge-alarm` | 路由以 `order_id`／`plan_id`／`alarm_id` 為路徑參數（`routes_factory.py`），並見 scope 文字 | [ ] |

## 流程 scope（原文）

描述生產計畫接收、參數修改與核准、工單建立與開工、警報回報與確認。連線只畫來源與測試明確要求的前置：建立工單需先有已接收的計畫，且計畫引用的表單須已上傳；提出參數需有計畫；核准需有已提出的版本；開工需有工單；回報警報需有工單；確認警報需有已回報的警報。開工不要求參數已核准，未核准時沿用計畫預設並標示。查詢與提醒節點不建立連線。所有路由都需已登入的身分，身分由入口權限中介層提供，本流程不重複畫出。未涵蓋跨 Kit 的節點執行、評估器細節與授權測試。尚未完成執行驗證。

## 限制

1. 新增的動作沒有宣告參數（D92 精神，避免預設值與 mock），所以「畫布待補項」少不代表不需要輸入；實際執行時的必填值尚未建模。
2. 連線依據是作者在 scope 文字寫明的前置，我沒有逐條重讀程式。factory-core-kit 只核對了路由簽章。
3. 沒有條件欄位可表達模式或角色差異。

## 簽核

| 項目 | 內容 |
|---|---|
| Claude 驗證 | 完成，日期 2026-11-10 |
| user 覆核 | 待填：覆核人、日期、是否通過、適用範圍（完整流程／僅局部節點） |
