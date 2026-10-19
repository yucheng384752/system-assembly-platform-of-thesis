# S2 系 Kit 整合測試

把七個 S2 系 Kit（entry-permission、product-process、batch-production、alarm-exception、equipment-maintenance、production-dashboard、runtime-settings）組成一個 FastAPI 應用程式，用真的 HTTP 請求與非同步 SQLAlchemy 跑過主要流程。

## 執行

```
pip install -r tests/s2-kits-integration/requirements.txt
cd tests/s2-kits-integration
python -m unittest discover -s .
```

缺套件時整組測試會略過並列出缺少的套件，不會誤報通過。

## 組成

- `platform_stub/`：平台替身，只提供 Kit 契約要求的 `app.core.config.settings` 與 `app.core.database`（`Base`、`get_db`）。資料庫為記憶體內 SQLite（aiosqlite），session 以 `expire_on_commit=False` 建立，與 D-A5 的契約一致。不隨任何 Kit 交付。
- `harness.py`：依 README 的啟動順序組裝（entry-permission → product-process → batch 與第二階段 → alarm／equipment → dashboard → runtime-settings），整個測試程序只組裝一次；每個測試案例重建資料表、載入 `product-lines.sample.json` 與測試帳號。
- `base.py`：測試基底與以帳號身分呼叫 API 的方法。

## 涵蓋

| 檔案 | 內容 |
|---|---|
| `test_main_flow.py` | 開單 → 派工 → 量測 → 規格報警 → 異常簽核（核准重工）→ 重填解除報警 → 簽核 → 完成；活動紀錄、總覽、追溯；訂閱者失敗時量測一併回復 |
| `test_visibility.py` | 產線範圍（批次、清單、報警、儀表板一致隱藏）、唯讀角色、首次登入改密碼、登入鎖定、入口覆寫與 tag |
| `test_settings_gates_extras.py` | 設定中心樂觀鎖、同值不留紀錄、提交後套用到批次 Kit、還原；設備閘門與 order 較小的閘門優先；入庫單、回鍋單、備註、照片 |
| `test_product_process.py` | 型號與配方、異動紀錄、理論用量與開單預填、表單解析、預留產線、種子可重複執行 |

## 限制

- SQLite 不支援 `SELECT … FOR UPDATE`，批號流水號與同批次寫入排隊的鎖只在 PostgreSQL 上有效，這裡沒有驗證併發。
- 尚未在 PostgreSQL 與基線 platform-core 的實際連線上執行。
