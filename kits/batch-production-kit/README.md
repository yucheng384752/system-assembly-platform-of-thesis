# batch-production-kit 批次生產紀錄

來源：場域系統 S2（真名對照不在 repo，D-A4）的批次、量測、用料、簽核與完成工單模組，經去識別化與解耦後放入本專案。拆分總表見 `docs/s2-kit-split.md`。

批次核心（第一階段）加上四項可選的第二階段子功能：入庫單、回鍋確認單、子表格備註、照片佐證。第二階段預設全部關閉，啟動時以 `enable_batch_extras(raw, object_store)` 選用。

## 提供

- 開單（產生批號、指派負責人、依型號配方預填理論用量）、派工、查詢、表頭修改、軟刪除。
- 依產品定義逐站逐項填寫量測（重填覆寫、記錄操作人）；項目的填寫角色與步驟層規則照舊。
- 用料秤重：現場操作員只能填實際用量，其餘欄位須管理者或品管。
- 操作員與檢驗員一次性簽核，完成工單（簽核、必填站點、外部條件齊全才可結案）。
- 進度判斷（第一個尚未填完的站點），簽核與完成共用同一份「還缺什麼」。

## 第二階段子功能

| 子功能 | 做了什麼 | 接進完成條件的方式 |
|---|---|---|
| 入庫單 | 每批次一張：數量、單位、位置、明細（合計須等於數量，用 Decimal 比對）；送出後鎖定 | 設定 `requireWarehouseEntry` 時，未送出不能結案 |
| 回鍋確認單 | 站點、數量、原因；由另一位 manager／admin 確認（`rework_confirm` 入口，預設不可自己確認） | `completion_checks`：有待確認的回鍋單不能結案 |
| 子表格備註 | 針對站點與步驟加備註，只增不改 | 無 |
| 照片佐證 | 依設定的附件欄位上傳；以檔頭判斷真實格式（JPEG、PNG、WebP），不信用戶端宣稱的類型；檔名只留安全字元；大小有上限；重傳取代並刪除舊物件；資料庫失敗時回收剛上傳的物件 | 設定 `requiredAttachments` 的欄位未上傳不能結案 |

照片放哪裡由平台提供：實作 `put(batch_id, filename, content_type, data) -> ref`、`delete(ref)`、`url(ref)` 的物件儲存，交給 `enable_batch_extras(..., object_store=...)`；沒提供時上傳端點回 501。

## 三個對外接點（這個 Kit 與其他 Kit 的全部耦合）

| 接點 | 用途 | 沒有人使用時 |
|---|---|---|
| 事件 `MeasurementRecorded`、`BatchChanged`（`app.core.events`） | 通知量測已寫入、批次已異動；訂閱者與量測同交易 | 什麼都不做 |
| 閘門 `gates.register`（`app.core.gates`） | 寫入前條件、站點完成判斷、完成前阻擋原因；依 `order` 由小到大 | 全部放行 |
| 產品定義查詢（`app.core.model_lookup`） | 只經由 product-process-kit 的函式，不匯入它的資料表 | 無法開單（必要相依） |

## 與來源系統的差異（解耦）

| 來源寫法 | 本 Kit |
|---|---|
| 量測儲存流程直接新增報警資料列（多個地方） | 發出 `MeasurementRecorded`，報警由報警 Kit 訂閱後判斷；規格上下限由本 Kit 先解析好隨事件帶出 |
| 完成條件直接查報警與異常簽核資料表 | `completion_blockers` 閘門，報警 Kit 註冊後才生效 |
| 初始量測異常會擋住後續站點、寫死特定站點與項目代碼 | 站點判斷與寫入阻擋改為閘門，本 Kit 不認得任何站點代碼 |
| 寫入前直接呼叫設備點檢檢查，且精確檢查要排在全域檢查之前 | 閘門的 `order`：數字小的先講，具體原因優先於籠統原因 |
| 儀表板更新訊號直接在各端點呼叫 | `BatchChanged` 事件 |
| 批號前綴、製程變體碼、廠區碼、位數、流水號分組寫死 | `lot_number` 樣板與對照表；流水號依 (產線, 製程變體, 期間) 累加，預設不歸零 |
| 必附照片欄位清單寫死 | 設定 `requiredAttachments`，預設空 |
| 用料種類為固定列舉 | 字串：`total` 或配方明細的 key |
| 表頭含行業專屬欄位 | 通用欄位加 `extra`；由型號屬性預填的對照放設定 `headerPrefill` |
| 對產品、型號、站點、項目、帳號建外鍵 | 一律用業務鍵（產線代碼、型號代碼、站點代碼、項目 key、步驟序號）或不建外鍵的帳號編號 |
| 量測唯一限制在步驟為 NULL 時失效，靠程式約定補洞 | 不屬於步驟的 `step_seq` 存 0，唯一限制由資料庫保證 |
| 量測回應附帶報警資料 | 回應只含量測；報警由報警 Kit 提供讀取 |

## 刻意不放進來的

- 回鍋單的來源批次與併入總重計算：來源系統的做法牽涉配方與重量換算，等有明確需求再做。
- 「重設全部批次資料」端點：這是測試資料清理工具，不屬於產品功能，也不該隨 Kit 交付。
- 初始量測異常的簽核流程、散裝與數量一致性的報警規則：屬於報警與異常簽核 Kit（下一個）。
- 設備點檢閘門：屬於設備點檢與維修 Kit。
- 活動紀錄與製程查詢：屬於儀表板與製程查詢 Kit，透過 `BatchChanged` 取得異動。

## 設定

啟動時呼叫 `configure(load_batch_settings(raw))`；`raw` 的鍵：`lotFormat`（`pattern`、`regionCode`、`variantCodes`、`serialReset`）、`requiredAttachments`、`materialStationCodes`、`signExcludeStations`、`headerPrefill`、`requireAssignment`、`timezone`。未知鍵與不合法的批號樣板會直接報錯。上線後由參數設定中心調整。

## 資料遷移（對應來源系統）

- `batches.product_id`、`product_model_id` → `product_line_code`、`product_model_code`，另存 `process_variant` 快照。
- 表頭行業專屬欄位 → `extra`；`mixer` → `equipment_ref`；`can_no` → `container_no`；`target_weight_kg` → `target_weight`。
- `measurements.metric_id`、`step_id`、`station_id` → `station_code`、`metric_key`、`step_seq`（無步驟為 0）。
- `batch_materials.kind` 列舉 → 字串；`*_kg` → `*_qty`。
- `lot_serial_counters(product_id, lead_type)` → `(product_line_code, variant, period='')`。
- 帳號欄位保留編號，外鍵移除。遷移腳本放在來源系統那一側的遷移包，本 Kit 不含任何場域資料。

## 已知限制

- 與 entry-permission-kit 相同，使用同步 SQLAlchemy Session，與基線版 platform-core 的非同步連線不相容，未解決前不可組裝。
- 資料表與路由只通過語法編譯，沒有 API／資料庫整合測試（環境沒有 FastAPI、SQLAlchemy）；純邏輯有 30 項單元測試。
- 材料寫入的閘門詢問以第一個用料站點代碼代表（來源系統在此處呼叫全域點檢閘門），之後可改為專用的閘門方法。
- 前端尚未抽出。
