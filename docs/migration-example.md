---
title: 系統更新時的資料庫遷移範例
date: 2026-10-20
status: 範例草稿（未成為決議，未實作）
---

# 系統更新時的資料庫遷移範例

回應 `TODO.md` 第 2 項：新版系統上線時，舊資料庫是原樣繼承，還是跑遷移腳本。本文用一個去識別化的虛構情境，說明兩者如何分工，以及腳本如何產生。

資料全部為虛構（M01）。標示「假設」的地方尚未對照原始碼驗證，實作前必須核對。

## 1. 先看基線版如何儲存資料

讀 `kits/` 的基線副本得到的事實：

| 表 | 內容 | 與遷移的關係 |
|---|---|---|
| `stations` | 站點（一張表單對應一個站點） | 新增表單 = 新增一列 |
| `station_schemas` | 每個站點的欄位定義，有 `version`、`is_active`，欄位清單存在 JSONB 欄位 `record_fields` | 欄位變更 = 新增一個版本，不改舊版本 |
| `generic_records` | 每筆紀錄一列，欄位值存在 JSONB 欄位 `data`，並有 `schema_version_id` 指向它依據的欄位定義版本 | 改欄位不需要改資料表結構（DDL） |

結論：表單欄位的增減不會產生 `ALTER TABLE`。遷移分兩層：

- 第一層，平台資料表結構（DDL）：只有 Kit 新增或改版、需要新資料表或新欄位時才會發生。用 Alembic。
- 第二層，表單欄位定義與既有紀錄（資料層）：新增 `station_schemas` 版本；必要時對 `generic_records.data` 做回填或改寫。

「繼承舊資料庫」在這個架構下是預設行為：舊紀錄的 `schema_version_id` 保持指向舊版本，不必動它。需要腳本的只有兩種情況：新舊版本的欄位語意不相容，或舊紀錄要用新規則查詢。

## 2. 範例情境

虛構產線「配料混合」，表單 `mix-batch`，目前系統為 v1，要升級為 v2。

v1 欄位：

| 欄位 id | 名稱 | 型別 | 必填 | 識別欄位 |
|---|---|---|---|---|
| lot_no | 批號 | text | 是 | 是 |
| temperature | 溫度 | integer | 是 | 否 |
| operator | 作業員 | text | 否 | 否 |
| remark | 備註 | text | 否 | 否 |

v2 欄位（Composer 中的流程文件已改版）：

| 欄位 id | 名稱 | 型別 | 必填 | 識別欄位 | 與 v1 的差異 |
|---|---|---|---|---|---|
| lot_no | 批號 | text | 是 | 是 | 無 |
| temperature | 溫度 | decimal | 是 | 否 | 型別 integer 改 decimal |
| operator_name | 作業員 | text | 否 | 否 | 欄位 id 改名 |
| humidity | 濕度 | decimal | 否 | 否 | 新增，選填 |
| shift | 班別 | text | 是 | 否 | 新增，必填 |

`remark` 在 v2 移除。另外 v2 新增一個 Kit「表格互鎖」，需要新資料表 `form_interlocks`。

## 3. 差異分類與風險

| 變更 | 類別 | 風險 | 處理 |
|---|---|---|---|
| 新增 `humidity`（選填） | 新增選填 | 自動 | 只新增 schema 版本，舊紀錄沒有此鍵，視為空 |
| 新增 `shift`（必填） | 新增必填 | 需確認 | 舊紀錄沒有值。使用者必須在遷移計畫中選：回填固定值、保持空值且新規則只套用於新紀錄、或阻擋遷移。不自動補預設 |
| `temperature` integer 改 decimal | 型別擴大 | 自動 | 整數必為合法小數，值不變 |
| `operator` 改為 `operator_name` | 改名 | 需確認 | 以 JSONB 鍵改寫。舊版本保留，舊紀錄是否改寫由使用者選 |
| 移除 `remark` | 刪除 | 需確認 | 預設不刪資料，只在新 schema 版本中不再列出，舊紀錄的值保留可查 |
| 新增 Kit 的資料表 `form_interlocks` | 平台 DDL | 自動 | Alembic 新增表，downgrade 為 drop，因為新表此時沒有舊資料 |
| 型別縮小或不相容（如 text 改 integer） | 破壞性 | 阻擋 | 本範例未出現。預檢發現有無法轉換的值時列出筆數與樣本，不產生腳本 |

風險分三級：自動（可直接產生並執行）、需確認（計畫書逐項列出，使用者核定後才產生）、阻擋（列出原因，不產生腳本）。

## 4. 產出物

遷移計畫書 `migration-plan.json`（隨設定交付包，納入 manifest 的 sha256 與簽章）：

```json
{
  "format": "composer-migration-plan",
  "version": 1,
  "from": { "workflowSha256": "（v1 流程文件）", "systemVersion": "1.0.0" },
  "to":   { "workflowSha256": "（v2 流程文件）", "systemVersion": "2.0.0" },
  "platform": {
    "alembic": { "downRevision": "a1b2c3", "revision": "d4e5f6" }
  },
  "forms": [
    {
      "formId": "mix-batch",
      "schemaVersion": { "from": 1, "to": 2 },
      "changes": [
        { "field": "humidity", "kind": "add-optional", "risk": "auto" },
        { "field": "shift", "kind": "add-required", "risk": "confirm",
          "decision": { "choice": "leave-empty-for-old-records" } },
        { "field": "temperature", "kind": "widen-type", "from": "integer", "to": "decimal", "risk": "auto" },
        { "field": "operator", "kind": "rename", "to": "operator_name", "risk": "confirm",
          "decision": { "choice": "rewrite-old-records" } },
        { "field": "remark", "kind": "remove", "risk": "confirm",
          "decision": { "choice": "keep-data-hide-field" } }
      ]
    }
  ],
  "decidedBy": "（核定人員）",
  "decidedAt": "（核定時間）"
}
```

## 5. 腳本如何產生

由確定性程式產生，不交給 LLM。輸入是新舊兩份流程文件與遷移計畫書，輸出是 Alembic 版本檔與資料層腳本。

1. 讀取新舊流程文件，驗證 schema 與 sha256。
2. 以表單 id、欄位 id 配對。改名只在「欄位 id 相同、名稱不同」或使用者在 Composer 明確標示時成立，不用名稱相似度猜測（比照 D19 的確定性原則）。
3. 逐欄位分類（新增選填、新增必填、型別擴大、型別不相容、改名、刪除），並依第 3 節的規則給風險等級。
4. 預檢（唯讀）：對實際資料庫統計受影響筆數；型別轉換先在唯讀查詢中試算，找出無法轉換的值。
5. 產生遷移計畫書。有「需確認」項目時，停下來等使用者在計畫書內填 `decision`；有「阻擋」項目時，不往下產生。
6. 依計畫書產生兩份腳本：
   - 第一層 Alembic 版本檔（`upgrade`、`downgrade`）。
   - 第二層資料層腳本（新增 schema 版本、回填或改寫 JSONB），每個步驟附對應的還原步驟。
7. 先在資料庫副本上乾跑：對照預檢的受影響筆數，不一致即中止。
8. 備份後，在單一交易內套用；套用後執行驗證查詢（筆數不變、`schema_version_id` 都指向存在的版本、新必填規則的例外筆數與計畫書一致）。
9. 寫入遷移紀錄（計畫書 sha256、時間、受影響筆數、結果）。失敗時整筆還原，並保留備份。

## 6. 範例腳本

第一層（Alembic，新增互鎖資料表；表結構為示意，實際欄位待互鎖 Kit 設計）：

```python
"""add form_interlocks"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d4e5f6"
down_revision = "a1b2c3"


def upgrade() -> None:
    op.create_table(
        "form_interlocks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("blocked_station_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("stations.id"), nullable=False),
        sa.Column("required_station_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("stations.id"), nullable=False),
        sa.UniqueConstraint("tenant_id", "blocked_station_id", "required_station_id",
                            name="uq_form_interlocks_pair"),
    )


def downgrade() -> None:
    op.drop_table("form_interlocks")
```

第二層（資料層，SQL 示意，假設 `record_fields` 是欄位物件陣列，鍵名以實際為準）：

```sql
BEGIN;

-- 1. 新增 schema 版本 2（欄位清單由計畫書產生）；舊版本保留，僅取消啟用
UPDATE station_schemas SET is_active = false
 WHERE station_id = :station_id AND version = 1;

INSERT INTO station_schemas (id, station_id, version, is_active, record_fields, unique_key_fields)
VALUES (gen_random_uuid(), :station_id, 2, true, :record_fields_v2::jsonb, '["lot_no"]'::jsonb);

-- 2. 改名：operator -> operator_name（僅在使用者選擇改寫舊紀錄時產生）
UPDATE generic_records
   SET data = (data - 'operator') || jsonb_build_object('operator_name', data -> 'operator')
 WHERE station_id = :station_id AND data ? 'operator';

-- 3. integer -> decimal：JSON 數字不需改寫，無對應步驟
-- 4. 新增 humidity、移除 remark：不改資料（remark 的值保留）

-- 5. 驗證：受影響筆數須等於預檢結果，否則 ROLLBACK
-- SELECT count(*) FROM generic_records WHERE station_id = :station_id AND data ? 'operator';  -- 預期 0

COMMIT;
```

還原步驟：

```sql
BEGIN;
UPDATE generic_records
   SET data = (data - 'operator_name') || jsonb_build_object('operator', data -> 'operator_name')
 WHERE station_id = :station_id AND data ? 'operator_name';
DELETE FROM station_schemas WHERE station_id = :station_id AND version = 2;
UPDATE station_schemas SET is_active = true WHERE station_id = :station_id AND version = 1;
COMMIT;
```

注意：還原只在 v2 之後沒有新紀錄時安全。若已有依 v2 寫入的紀錄，還原會遺失 `humidity`、`shift`，所以還原腳本必須先檢查 v2 紀錄筆數，非零就拒絕並提示改用備份還原。

## 7. 尚未驗證，實作前要核對

- `record_fields` 的實際結構，以及 `data` 的鍵是欄位 id 還是欄位名稱（決定改名要改寫哪個）。
- 新增必填欄位時，基線版後端是否會對舊紀錄的編輯強制檢查。
- `station_schemas` 同時啟用多個版本時，基線版的行為（本範例假設一次只有一個啟用）。
- migration 格式（Alembic 或 up/down.sql）尚未決議，本文用 Alembic 示意。
- 本文沒有涵蓋 NoSQL；若日後支援，第二層的 JSONB 改寫要換成對應的文件更新語法，分類與計畫書不變。
