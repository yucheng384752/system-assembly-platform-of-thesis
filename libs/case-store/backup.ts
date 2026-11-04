import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../aov-integration';

// Logical backup (D180): plain JSON that stays readable without SQLite, so the history outlives the storage engine.
const TABLES = ['flow_case', 'flow_version', 'node_lifecycle', 'node_alias', 'combo_lifecycle'] as const;
type Table = (typeof TABLES)[number];
type Row = Record<string, string | number | null>;
export interface BackupFile {
  format: 'composer-case-store-backup'; version: 1; schemaVersion: number; tables: Record<Table, Row[]>;
  /** sha256 of the canonical JSON of `tables`; detects damage or edits, not a signature. */
  sha256: string;
}
const ORDER: Record<Table, string> = {
  flow_case: 'created_at, case_id', flow_version: 'case_id, version', node_lifecycle: 'seq', node_alias: 'rowid', combo_lifecycle: 'seq',
};
const digest = (tables: unknown) => createHash('sha256').update(canonicalJson(tables), 'utf8').digest('hex');

export function exportBackup(db: DatabaseSync): BackupFile {
  const schema = db.prepare('SELECT version FROM schema_meta WHERE id = 1').get();
  const tables = Object.fromEntries(TABLES.map(table =>
    [table, db.prepare(`SELECT * FROM ${table} ORDER BY ${ORDER[table]}`).all() as unknown as Row[]])) as Record<Table, Row[]>;
  return { format: 'composer-case-store-backup', version: 1, schemaVersion: Number(schema?.version), tables, sha256: digest(tables) };
}

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.values(value).every(v => v === null || typeof v === 'string' || typeof v === 'number');

/** Returns an error message, or null when the file is structurally sound for this store version. */
export function checkBackup(file: unknown, schemaVersion: number): string | null {
  if (typeof file !== 'object' || file === null) return '備份檔不是物件。';
  const f = file as Partial<BackupFile>;
  if (f.format !== 'composer-case-store-backup' || f.version !== 1) return '未知的備份格式或版本。';
  if (f.schemaVersion !== schemaVersion) return `備份的資料庫版本 ${String(f.schemaVersion)} 與目前 ${schemaVersion} 不同，不嘗試轉換。`;
  const tables: unknown = f.tables;
  if (typeof tables !== 'object' || tables === null) return '缺少 tables。';
  for (const table of TABLES) {
    const rows = (tables as Record<string, unknown>)[table];
    if (!Array.isArray(rows) || !rows.every(isRow)) return `${table} 不是列的陣列。`;
  }
  if (f.sha256 !== digest(tables)) return '備份的雜湊不符，檔案已損壞或被改動。';
  return null;
}

/** Caller owns the transaction. Rows replay in insert order so every append-only trigger and CHECK runs again. */
export function importRows(db: DatabaseSync, file: BackupFile): void {
  for (const table of TABLES) {
    // Column names are spliced into SQL: only the table's real columns may pass, whatever the file says.
    const allowed = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => String(c.name)));
    for (const row of file.tables[table]) {
      const columns = Object.keys(row);
      const unknown = columns.find(c => !allowed.has(c));
      if (unknown !== undefined) throw new Error(`E-BACKUP-COLUMN: ${table} 含未知欄位。`);
      db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .run(...columns.map(c => row[c]));
    }
  }
}
