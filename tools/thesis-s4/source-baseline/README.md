# 來源系統基準的部署配方

用途與結果見 `docs/thesis-s4-baseline.md` 第 9 節。這裡只有配方，不含來源程式碼、資料與任何秘密值。

目錄配置（在執行基準的機器上自行組出，不進 repo）：

```
backend/            來源 commit 362cc7c 的 app、alembic、alembic.ini、requirements.txt，加上本目錄的 constraints.txt
external/Analytical-Four/            Analytical-Four 的已追蹤檔案（commit f49cfd3）
external/september_v2/config/ut_config_v3.json
tool/               本 repo 的 tools/thesis-s4（給假的 PDF 轉檔服務用）
Dockerfile、compose.yml、.env
```

`.env` 在執行當下產生三個隨機值：`S4_DB_PASSWORD`、`S4_SECRET_KEY`、`S4_ADMIN_KEY`。

步驟：`docker compose up -d` → 等 `/healthz` 回 200 → 對資料庫執行 `schema-adjust.sql` → 依 `docs/thesis-s4-baseline.md` 第 7 節執行 `run.mjs`。每次基準都要用全新的資料庫（`docker compose down -v` 後重來）。
