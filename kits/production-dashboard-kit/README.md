# production-dashboard-kit 生產儀表板與製程查詢

來源：場域系統 S2（真名對照不在 repo，D-A4）的儀表板、操作紀錄與製程查詢模組，經去識別化與解耦後放入本專案。拆分總表見 `docs/s2-kit-split.md`。

## 提供

- **總覽**：批次各狀態的數量，加上其他 Kit 登錄的區塊（目前有報警總覽、設備總覽）。沒安裝的功能不會出現；單一區塊失敗只顯示「此區塊暫時無法取得」，不影響其他區塊。
- **操作紀錄**：訂閱批次異動事件，記下誰在何時對哪個批次做了什麼；只增不改；可設定保留天數，由管理者觸發或排程呼叫清除。
- **製程查詢**：依批號前綴（萬用字元會被當成一般字元）、狀態、產線、建立時間搜尋批次；逐站逐項追溯填寫資料。

## 與其他 Kit 的接點

| 接點 | 做法 |
|---|---|
| 訂閱 `BatchChanged` | 寫活動紀錄。事件現在帶 `actor_id`（本次一併補在批次生產 Kit） |
| 唯讀 `batch_read` | 搜尋、計數、追溯、可見性都走批次 Kit 的函式，可見性與批次自己的端點同一套規則；範圍外的批次不會出現在清單、計數或活動紀錄 |
| 總覽區塊登錄 `dashboard_providers.register` | 報警與設備 Kit 啟動時偵測到本 Kit 才登錄；本 Kit 不認得它們 |

## 與來源系統的差異（解耦）

| 來源寫法 | 本 Kit |
|---|---|
| 各端點呼叫儀表板更新 | 批次 Kit 發出 `BatchChanged`，本 Kit 訂閱 |
| 儀表板直接查報警、設備資料表 | 各 Kit 自己登錄區塊，本 Kit 只負責排列與隔離失敗 |
| 活動紀錄對帳號、批次建外鍵 | 以編號關聯，無外鍵；異動說法可由設定覆寫 |

## 設定

啟動時 `enable_dashboard_kit(raw)`，鍵見 `core/dashboard_settings.py`：`activityEnabled`、`activityRetentionDays`、`reasonLabels`、`listLimit`。

## 刻意不放進來的

- 圖表與趨勢分析：已有 analytics-kit。
- 即時推播（WebSocket）：目前是查詢式；日後可在 `BatchChanged` 之上加。
- 前端畫面。

## 驗證狀態

純函式核心（文字化、保留期限、設定、提供者登錄）有 16 項測試，用標準函式庫即可執行：

    PYTHONPATH=kits/production-dashboard-kit/src/backend python -m unittest discover -s kits/production-dashboard-kit/tests

資料表與路由只做語法檢查，尚未連 FastAPI／資料庫實跑（沙箱沒有這些套件，且同步／非同步連線待決）。
