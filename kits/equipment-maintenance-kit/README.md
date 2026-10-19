# equipment-maintenance-kit 設備點檢與維修

來源：場域系統 S2（真名對照不在 repo，D-A4）的設備點檢與維修模組，經去識別化與解耦後放入本專案。拆分總表見 `docs/s2-kit-split.md`。

## 提供

- 設備清單（可綁定產線，空白為各產線共用）與每台設備的每日、每週、每月點檢表；項目有「勾選」與「數值（含上下限）」兩種。
- 點檢：同一設備同一期別只有一筆，複核前可覆寫；有異常項目必須寫說明；必填項目沒填不能送出。
- 複核：預設複核者不可是點檢者本人；複核後鎖定。
- 維修：報修與結案，維修中的設備視為不可用。
- 月度匯出：CSV（含 BOM，Excel 可直接開），公式字元開頭的儲存格一律補單引號。
- 生產閘門：批次指定了設備，該設備未通過點檢、待複核、有異常未複核、維修中或已停用時，擋住站點寫入，原因直接指名設備。

## 與其他 Kit 的接點

| 接點 | 做法 |
|---|---|
| 批次生產 Kit（可選） | 啟動時若偵測到有 `app.core.gates`，就註冊 `EquipmentCheckGate`（`order=10`，比籠統閘門先講原因）。沒有批次 Kit 時本 Kit 仍可單獨使用 |
| 產線範圍 | 只用字串 `product-line` 讀取帳號的範圍；設備綁定產線時，範圍外視為不存在 |
| 批次的設備欄位 | 批次存的 `equipment_ref` 就是設備代碼，沒有外鍵 |
| 儀表板（日後） | 讀 `equipment_service.facts_for`／`equipment_in_scope`，不需要事件 |

## 設定

啟動時 `enable_equipment_kit(raw)`，鍵見 `core/equipment_settings.py`：`requiredFrequencies`、`requireReview`、`reviewerMustDiffer`、`blockOnAbnormal`、`gatedStations`、`globalMode`、`timezone`。預設只要求每日點檢、不需複核、批次沒指定設備時不檢查。

## 與來源系統的差異（解耦）

| 來源寫法 | 本 Kit |
|---|---|
| 生產紀錄的儲存流程直接呼叫設備檢查 | 閘門，由本 Kit 註冊 |
| 精確檢查與全域檢查的先後靠呼叫順序 | 閘門 `order`：先講具體原因 |
| 點檢項目與頻率寫死 | 點檢表由資料庫維護，每台設備自己的項目 |
| 對帳號、批次建外鍵 | 以帳號編號、設備代碼關聯，無外鍵 |

## 刻意不放進來的

- 點檢照片、設備保養排程提醒、備品庫存。
- 前端畫面。

## 驗證狀態

純函式核心（週期、項目判斷、閘門判斷、匯出、設定）有 22 項測試，用標準函式庫即可執行：

    PYTHONPATH=kits/equipment-maintenance-kit/src/backend python -m unittest discover -s kits/equipment-maintenance-kit/tests

驗證狀態：純函式有單元測試；資料庫與 HTTP 由 `tests/s2-kits-integration` 實跑（七個 Kit 組成一個 FastAPI 應用程式，SQLAlchemy 非同步 + 記憶體 SQLite）。尚未在 PostgreSQL 與基線 platform-core 上實跑。
