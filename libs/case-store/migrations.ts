import { DatabaseSync } from 'node:sqlite';

export type Migration = (db: DatabaseSync) => void;

export const migrations: readonly Migration[] = [db => {
  db.exec(`
    CREATE TABLE schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL,
      migrated_at TEXT NOT NULL);
    CREATE TABLE flow_case (case_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 300), created_at TEXT NOT NULL);
    CREATE TABLE flow_version (
      case_id TEXT NOT NULL REFERENCES flow_case(case_id), version INTEGER NOT NULL CHECK (version > 0),
      parent_version INTEGER, content TEXT NOT NULL CHECK (length(CAST(content AS BLOB)) <= 10000000),
      content_hash TEXT NOT NULL, verified_report TEXT NOT NULL
        CHECK (json_valid(verified_report) AND COALESCE(json_type(verified_report, '$.passed') = 'true', 0)),
      change_reason TEXT NOT NULL CHECK (length(change_reason) BETWEEN 1 AND 2000),
      author TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 100), created_at TEXT NOT NULL,
      PRIMARY KEY (case_id, version), FOREIGN KEY (case_id, parent_version) REFERENCES flow_version(case_id, version),
      CHECK ((version = 1 AND parent_version IS NULL) OR (version > 1 AND parent_version = version - 1 AND parent_version IS NOT NULL)));
    CREATE TABLE node_lifecycle (seq INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('active', 'deprecated', 'merged')),
      reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000), replaced_by TEXT, at TEXT NOT NULL,
      CHECK (state != 'merged' OR (replaced_by IS NOT NULL AND replaced_by != node_id)));
    CREATE INDEX node_lifecycle_latest ON node_lifecycle(node_id, seq);
    CREATE TABLE node_alias (old_id TEXT PRIMARY KEY NOT NULL, new_id TEXT NOT NULL CHECK (new_id != old_id),
      merge_reason TEXT NOT NULL CHECK (length(merge_reason) BETWEEN 1 AND 2000), at TEXT NOT NULL);
    CREATE TABLE combo_lifecycle (seq INTEGER PRIMARY KEY AUTOINCREMENT,
      combo TEXT NOT NULL CHECK (json_valid(combo) AND json_type(combo) = 'array' AND json_array_length(combo) >= 2),
      state TEXT NOT NULL CHECK (state IN ('active', 'deprecated')),
      reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000), at TEXT NOT NULL);
    CREATE INDEX combo_lifecycle_latest ON combo_lifecycle(combo, seq);
    CREATE TRIGGER alias_no_cycle BEFORE INSERT ON node_alias BEGIN
      SELECT RAISE(ABORT, 'alias cycle') WHERE NEW.old_id IN (
        WITH RECURSIVE chain(id) AS (SELECT NEW.new_id UNION
          SELECT new_id FROM node_alias JOIN chain ON old_id = chain.id) SELECT id FROM chain);
    END;
    CREATE TRIGGER combo_strings BEFORE INSERT ON combo_lifecycle BEGIN
      SELECT RAISE(ABORT, 'combo elements must be strings')
        WHERE EXISTS (SELECT 1 FROM json_each(NEW.combo) WHERE type != 'text');
    END;
  `);
  for (const table of ['flow_case', 'flow_version', 'node_lifecycle', 'node_alias', 'combo_lifecycle']) {
    for (const operation of ['UPDATE', 'DELETE']) {
      db.exec(`CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
        BEGIN SELECT RAISE(ABORT, 'append only'); END;`);
    }
    // REPLACE can bypass DELETE triggers on other connections with recursive_triggers off.
    const keys = table === 'flow_case' ? ['case_id'] : table === 'flow_version' ? ['case_id', 'version']
      : table === 'node_alias' ? ['old_id'] : ['seq'];
    db.exec(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} BEGIN
      SELECT RAISE(ABORT, 'append only') WHERE EXISTS
        (SELECT 1 FROM ${table} WHERE ${keys.map(key => `${key} = NEW.${key}`).join(' AND ')}); END;`);
  }
}];

// Each step owns its transaction; test-only migrations never enter the production list.
export function migrate(db: DatabaseSync, steps: readonly Migration[] = migrations): void {
  for (;;) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'").get();
      const row = exists ? db.prepare('SELECT version FROM schema_meta WHERE id = 1').get() : undefined;
      if (exists && (!row || typeof row.version !== 'number' || !Number.isInteger(row.version) || row.version < 1)) {
        throw new Error('E-SCHEMA-CORRUPT: schema_meta 無有效版本。');
      }
      const current = row ? Number(row.version) : 0;
      if (current > steps.length) throw new Error(`E-SCHEMA-NEWER: 資料庫版本 ${current} 高於支援版本 ${steps.length}。`);
      if (current === steps.length) { db.exec('COMMIT'); return; }
      steps[current](db);
      db.prepare(`INSERT INTO schema_meta VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET version = excluded.version, migrated_at = excluded.migrated_at`)
        .run(current + 1, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
