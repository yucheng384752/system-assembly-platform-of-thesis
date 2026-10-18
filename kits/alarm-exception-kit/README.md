# alarm-exception-kit 報警與異常簽核

來源：場域系統 S2（真名對照不在 repo，D-A4）的報警與異常簽核模組，經去識別化與解耦後放入本專案。拆分總表見 `docs/s2-kit-split.md`。

## 提供

- 三種報警規則：**規格範圍**（預設，邊界合格）、**門檻規則**（嚴格比較，小於／不大於／大於／不小於）、**一致性規則**（一組項目需彼此相等且等於另一項加偏移，未填齊不判斷）。
- 報警生命週期：`active` → `acknowledged`（主管確認）→ `resolved`（數值回復合格後自動解除）。違規但已有報警只更新訊息；跨欄位規則同一批次最多一個有效報警。
- 完成阻擋：尚有未解除報警不能結案（`blockCompletion` 可關）。
- 異常簽核：指定的關鍵量測超規時，由管理者核准重工、特採放行（須確認加驗通過）或駁回；未通過前擋住後續站點與完成。

## 與批次生產 Kit 的接點（全部耦合）

| 接點 | 做法 |
|---|---|
| 訂閱 `MeasurementRecorded` | 量測寫入後與量測同一交易判斷並對帳；規格上下限由事件帶入，不查產品定義 |
| 註冊 `ExceptionGate`（`order=20`） | `write_blocker`、`validate_value`、`station_blocked`、`completion_blockers`；數字小代表比籠統閘門先講原因 |
| 唯讀 `batch_read` | 可見性（產線範圍、唯讀角色）與跨欄位數值都走批次 Kit 提供的函式，不匯入它的資料表 |
| 發出 `BatchChanged` | 確認報警、申請、簽核後通知訂閱者（例如儀表板） |

批次 Kit 不認得本 Kit：沒呼叫 `enable_alarm_kit` 就沒有報警，批次照常運作。

## 設定

啟動時 `enable_alarm_kit(raw)`，`raw` 的鍵見 `core/alarm_settings.py`：`specRangeEnabled`、`severity`、`thresholdRules`、`consistencyRules`、`gating`、`blockCompletion`。預設只啟用規格範圍，沒有任何寫死的項目名稱或數值。

## 與來源系統的差異（解耦）

| 來源寫法 | 本 Kit |
|---|---|
| 量測儲存流程在多處直接新增報警列 | 訂閱事件，單一路徑對帳 |
| 規則依特定項目代碼與固定數值寫死 | 規則清單由設定提供 |
| 完成條件直接查報警與簽核資料表 | `completion_blockers` 閘門 |
| 關鍵量測固定是某站某項 | `gating` 設定指定站點與項目 |
| 對批次、量測建外鍵 | 以批次編號、量測編號關聯，無外鍵 |

## 刻意不放進來的

- 報警通知（推播、郵件）。
- 獨立的 `AlarmChanged` 事件：儀表板 Kit 需要時再加。
- 前端畫面：報警清單與簽核畫面待做。

## 驗證狀態

核心判斷（規則、對帳、簽核狀態表、設定）有純函式測試 23 項，用標準函式庫即可執行：

    PYTHONPATH=kits/alarm-exception-kit/src/backend python -m unittest discover -s kits/alarm-exception-kit/tests

資料庫與 HTTP 部分只做語法檢查，尚未連 FastAPI／資料庫實跑（沙箱沒有這些套件，且同步／非同步連線待決）。
