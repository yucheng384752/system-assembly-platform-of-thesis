-- 基準的資料庫結構調整（user 2026-11-12 決定採用）。
-- 原因：來源的 alembic 遷移在空資料庫上失敗；程式啟動時自動建表會把 extras 建成 json，
-- 而遷移檔定義的是 jsonb。在 json 之下 P2 的 NG 明細與規格查詢回 500。
ALTER TABLE p1_records ALTER COLUMN extras DROP DEFAULT, ALTER COLUMN extras TYPE jsonb USING extras::jsonb, ALTER COLUMN extras SET DEFAULT '{}'::jsonb;
ALTER TABLE p2_records ALTER COLUMN extras DROP DEFAULT, ALTER COLUMN extras TYPE jsonb USING extras::jsonb, ALTER COLUMN extras SET DEFAULT '{}'::jsonb;
ALTER TABLE p3_records ALTER COLUMN extras DROP DEFAULT, ALTER COLUMN extras TYPE jsonb USING extras::jsonb, ALTER COLUMN extras SET DEFAULT '{}'::jsonb;
