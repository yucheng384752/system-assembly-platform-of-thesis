# product-process-kit 產品與製程定義

來源：場域系統 S2（真名對照不在 repo，D-A4）的產品、型號、站點、量測項目與規格模組，經去識別化與解耦後放入本專案。拆分總表見 `docs/s2-kit-split.md`。

## 提供

- 產線、型號、配方明細、站點、製程步驟、量測項目、型號規格，以及一次回傳整份表單定義的 `GET /forms/{product_line_code}`。
- 配方理論用量計算：依總重與配方明細算各原料用量與預設料號，沒有比例資料時回傳空陣列，使用者照舊手動填寫。
- 異動紀錄：修改型號或配方必須填原因；內容沒有真的變動就不寫紀錄；新增也算一次異動。
- 產線定義檔（`seed/*.json`）的檢查與載入，載入只新增不覆蓋，重新部署不會蓋掉介面上改過的值。

## 產線是可選項目（預留）

產線的 `status` 為 `defined` 或 `reserved`。預留的產線會出現在清單並標示「尚未提供定義」，但沒有站點，讀取表單回 409，新增型號被拒絕，檢查工具也不允許預留產線夾帶站點。要啟用某條產線，在定義檔補上站點並改為 `defined`，不需要改程式。

## 與來源系統的差異（解耦與通用化）

| 來源寫法 | 本 Kit |
|---|---|
| 型號表內建行業專屬欄位（合金、配方短碼、主料與輔料佔比、兩個料號） | `attributes` 放描述性欄位；配方改為通用的 `recipe_lines`（key、比例、比例基準、餘量行、料號） |
| 開單流程內寫死的用量拆算 | `app.core.recipe.compute_theoretical`，純函式、可單獨測試、循環參照與負餘量直接報錯 |
| 製程步驟以行業專屬的兩組區分 | 通用的 `process_variant`；步驟逐個 seq 優先取同變體，沒有就退回共用 |
| 稽核角色要隱藏的欄位寫死在後端 key 清單，前端另存一份 | 每個項目的 `hidden_from_roles`，只在後端過濾 |
| 步驟的時間、轉速、真空度為固定欄位 | `expected` 鍵值，鍵名由場域定義 |
| 異動紀錄以外鍵指向帳號表 | 保存帳號編號與當時顯示名稱，不跨 Kit 建外鍵 |
| 帳號與產品以外鍵綁定 | 註冊範圍類型 `product-line` 給 entry-permission-kit，鍵為產線代碼 |
| 入口常數在集中的權限檔 | 本 Kit 自己註冊 `product_model_manage` |

保留不變的規則：型號專屬量測項目整組取代站點共用項目；規格來源為 `model` 時只在讀取時查表，不改動項目本身的常數規格。

## 資料遷移（對應來源系統）

- `products` → `product_lines`（`ok`→`defined`、`wip`→`reserved` 需人工確認，因為兩者語意不完全相同）。
- `product_models` 的行業專屬欄位 → `attributes` 與 `recipe_lines`；兩組製程區分 → `process_variant`。
- `station_steps.lead_type` → `variant`；時間、轉速、真空度 → `expected`。
- `product_model_change_logs.changed_by` → `changed_by_id` 加上以帳號表補入的 `changed_by_name`。
- 對照表與遷移腳本放在來源系統那一側的遷移包，本 Kit 不含任何場域資料。

## 相依與已知限制

- 相依 entry-permission-kit 的入口目錄、範圍機制與使用者模型（讀取 `id`、`role`、`display_name`）。
- 與 entry-permission-kit 相同，使用同步 SQLAlchemy Session，與基線版 platform-core 的非同步連線不相容，處理方式待決，未解決前不可組裝。
- 模型、路由未做 API 整合測試（環境沒有 FastAPI、SQLAlchemy），只通過語法編譯；純邏輯有單元測試。
- 前端（型號與配方管理、異動紀錄）尚未抽出。
- 型號規格（`model_specs`）目前只能由定義檔或資料庫寫入，尚無編輯 API；之後可由參數設定中心或本 Kit 補上。
