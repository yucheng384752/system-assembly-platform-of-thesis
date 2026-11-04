import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, MAX_BUNDLE_BYTES, validateAovBundle, type AovBundle } from '../aov-integration';
import { checkBackup, exportBackup, importRows, type BackupFile } from './backup';
import { hasCombo } from './graph';
import { migrate } from './migrations';

export interface StoreError { code: string; message: string; graph?: string; nodeId?: string; combo?: string[]; replacement?: string }
export type Result<T> = { ok: true; value: T } | { ok: false; errors: StoreError[] };
export interface FlowCase { case_id: string; name: string; created_at: string }
export interface VersionSummary { version: number; parent_version: number | null; change_reason: string; author: string; created_at: string }
export interface FlowVersion extends VersionSummary { case_id: string; content: string; content_hash: string; verified_report: string }
export interface SaveVersionInput {
  caseId: string; expectedParent: number | null; content: string; verifiedReport: unknown; changeReason: string; author: string;
}
type State = 'active' | 'deprecated' | 'merged';
export interface Resolution { nodeId: string; state: State }
export interface Usage { case_id: string; version: number; graph: string }
export interface NodeState { node_id: string; state: State; reason: string; replaced_by: string | null; at: string }
export interface ComboState { combo: string[]; state: 'active' | 'deprecated'; reason: string; at: string }
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: string, message: string): { ok: false; errors: StoreError[] } => ({ ok: false, errors: [{ code, message }] });
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && [...value].length <= max && !value.includes('\0');
const id = (value: unknown): value is string => text(value, Infinity);
const comboValid = (value: unknown): value is string[] => Array.isArray(value) && value.length >= 2 && value.every(id);
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const json = (value: unknown): string | undefined => { try { return canonicalJson(value); } catch { return undefined; } };
const busy = (error: unknown) => error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' && [5, 6].includes(error.errcode & 255);

export function openCaseStore(path: string): CaseStore {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON; PRAGMA busy_timeout = 5000;');
    migrate(db);
    return new CaseStore(db);
  } catch (error) { db.close(); throw error; }
}

export class CaseStore {
  constructor(private readonly db: DatabaseSync) {}

  close(): void { this.db.close(); }

  private transaction<T>(work: () => Result<T>, conflict = 'E-BUSY'): Result<T> {
    let started = false;
    try {
      this.db.exec('BEGIN IMMEDIATE'); started = true;
      const result = work();
      this.db.exec(result.ok ? 'COMMIT' : 'ROLLBACK'); started = false;
      return result;
    } catch (error) {
      if (started) this.db.exec('ROLLBACK');
      if (busy(error)) return fail(conflict, '資料庫正忙碌，請重新讀取後重試。');
      throw error;
    }
  }

  createCase(name: string): Result<FlowCase> {
    if (!text(name, 300)) return fail('E-INVALID-INPUT', '名稱須為 1 至 300 字。');
    const value = { case_id: randomUUID(), name, created_at: new Date().toISOString() };
    return this.transaction(() => {
      this.db.prepare('INSERT INTO flow_case VALUES (?, ?, ?)').run(value.case_id, name, value.created_at);
      return ok(value);
    });
  }

  listCases(): Result<FlowCase[]> {
    return ok(this.db.prepare('SELECT case_id, name, created_at FROM flow_case ORDER BY created_at, case_id').all() as unknown as FlowCase[]);
  }

  private state(nodeId: string): State {
    const row = this.db.prepare('SELECT state FROM node_lifecycle WHERE node_id = ? ORDER BY seq DESC LIMIT 1').get(nodeId);
    return row ? row.state as State : 'active';
  }

  private endpoint(nodeId: string): string {
    const seen = new Set<string>();
    let current = nodeId;
    for (;;) {
      if (seen.has(current)) throw new Error('E-CORRUPT: 別名含循環。');
      seen.add(current);
      const row = this.db.prepare('SELECT new_id FROM node_alias WHERE old_id = ?').get(current);
      if (!row) return current;
      if (typeof row.new_id !== 'string') throw new Error('E-CORRUPT: 別名不是字串。');
      current = row.new_id;
    }
  }

  resolveNode(nodeId: string): Result<Resolution> {
    if (!id(nodeId)) return fail('E-INVALID-INPUT', 'nodeId 須為非空字串。');
    const endpoint = this.endpoint(nodeId);
    return ok({ nodeId: endpoint, state: this.state(endpoint) });
  }

  private deprecated(bundle: AovBundle): StoreError[] {
    const errors: StoreError[] = [];
    for (const graph of bundle.platform.graphs) {
      for (const node of graph.nodes) {
        if (node.kind !== 'node' || node.actionId === null) continue;
        const state = this.state(node.actionId);
        if (state === 'active') continue;
        const replacement = state === 'merged' ? this.endpoint(node.actionId) : undefined;
        errors.push({ code: 'E-DEPRECATED', graph: graph.id, nodeId: node.actionId,
          ...(replacement ? { replacement } : {}),
          message: replacement ? `${node.actionId} 已合併，請改用 ${replacement}。` : `${node.actionId} 已淘汰。` });
      }
    }
    if (errors.length) return errors;
    const combos = this.db.prepare(`SELECT combo FROM combo_lifecycle WHERE seq IN
      (SELECT MAX(seq) FROM combo_lifecycle GROUP BY combo) AND state = 'deprecated'`).all();
    for (const row of combos) {
      const combo: unknown = JSON.parse(String(row.combo));
      if (!comboValid(combo)) throw new Error('E-CORRUPT: 組合格式錯誤。');
      const resolved = combo.map(value => this.endpoint(value));
      for (const graph of bundle.platform.graphs) {
        if (hasCombo(graph, resolved, value => this.endpoint(value))) {
          errors.push({ code: 'E-DEPRECATED', graph: graph.id, combo, message: `組合 ${canonicalJson(combo)} 已淘汰。` });
        }
      }
    }
    return errors;
  }

  async saveVersion(input: SaveVersionInput): Promise<Result<FlowVersion>> {
    const { caseId, expectedParent, content, verifiedReport, changeReason, author } = input;
    if (verifiedReport === null || typeof verifiedReport !== 'object' || Array.isArray(verifiedReport) || !Object.hasOwn(verifiedReport, 'passed') || !('passed' in verifiedReport) || verifiedReport.passed !== true) {
      return fail('E-NOT-VERIFIED', '驗證與模擬報告的 passed 必須為 true。');
    }
    const report = json(verifiedReport);
    if (!report) return fail('E-NOT-VERIFIED', '報告必須是有效 JSON。');
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_BUNDLE_BYTES) {
      return fail('E-BAD-CONTENT', 'content 須為不超過 10,000,000 UTF-8 bytes 的整合包 JSON。');
    }
    const validated = await validateAovBundle(content);
    if (!validated.ok) return { ok: false, errors: validated.errors.map(e => ({ code: 'E-BAD-CONTENT', message: `${e.path}: ${e.message}` })) };
    const stored = canonicalJson(validated.value);
    if (Buffer.byteLength(stored, 'utf8') > MAX_BUNDLE_BYTES) return fail('E-BAD-CONTENT', '正規化後的整合包超過大小上限。');
    // No await inside the transaction: lifecycle, expected parent and insert share one snapshot.
    return this.transaction(() => {
      const errors = this.deprecated(validated.value);
      if (errors.length) return { ok: false, errors };
      if (!id(caseId) || !text(changeReason, 2000) || !text(author, 100)) {
        return fail('E-INVALID-INPUT', '案例識別碼、修改原因（1 至 2000 字）與作者（1 至 100 字）必填。');
      }
      if (!this.db.prepare('SELECT 1 FROM flow_case WHERE case_id = ?').get(caseId)) return fail('E-NOT-FOUND', '案例不存在。');
      const latest = this.db.prepare('SELECT MAX(version) AS version FROM flow_version WHERE case_id = ?').get(caseId)!.version;
      if (expectedParent !== latest) return fail('E-VERSION-CONFLICT', '父版本已過期，請重新讀取最新版本。');
      const value: FlowVersion = { case_id: caseId, version: Number(latest ?? 0) + 1, parent_version: expectedParent,
        content: stored, content_hash: hash(stored), verified_report: report, change_reason: changeReason, author,
        created_at: new Date().toISOString() };
      this.db.prepare('INSERT INTO flow_version VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(caseId, value.version, expectedParent, stored, value.content_hash, report, changeReason, author, value.created_at);
      return ok(value);
    }, 'E-VERSION-CONFLICT');
  }

  getVersion(caseId: string, version: number): Result<FlowVersion> {
    if (!id(caseId) || !Number.isSafeInteger(version) || version < 1) return fail('E-INVALID-INPUT', '案例與版本號不合法。');
    const row = this.db.prepare('SELECT * FROM flow_version WHERE case_id = ? AND version = ?').get(caseId, version) as unknown as FlowVersion | undefined;
    if (!row) return fail('E-NOT-FOUND', '版本不存在。');
    if (hash(row.content) !== row.content_hash) return fail('E-CORRUPT', '版本內容雜湊不符，資料已損壞。');
    return ok(row);
  }

  listVersions(caseId: string): Result<VersionSummary[]> {
    if (!id(caseId)) return fail('E-INVALID-INPUT', '案例識別碼不合法。');
    if (!this.db.prepare('SELECT 1 FROM flow_case WHERE case_id = ?').get(caseId)) return fail('E-NOT-FOUND', '案例不存在。');
    return ok(this.db.prepare(`SELECT version, parent_version, change_reason, author, created_at
      FROM flow_version WHERE case_id = ? ORDER BY version`).all(caseId) as unknown as VersionSummary[]);
  }

  private nodeEvent(nodeId: string, reason: string, state: 'active' | 'deprecated'): Result<null> {
    if (!id(nodeId) || !text(reason, 2000)) return fail('E-INVALID-INPUT', 'nodeId 與原因（1 至 2000 字）必填。');
    return this.transaction(() => {
      if (this.endpoint(nodeId) !== nodeId) return fail('E-DEPRECATED', `已合併，請改用 ${this.endpoint(nodeId)}。`);
      this.db.prepare('INSERT INTO node_lifecycle(node_id, state, reason, replaced_by, at) VALUES (?, ?, ?, NULL, ?)')
        .run(nodeId, state, reason, new Date().toISOString());
      return ok(null);
    });
  }

  deprecateNode(nodeId: string, reason: string): Result<null> { return this.nodeEvent(nodeId, reason, 'deprecated'); }
  reactivateNode(nodeId: string, reason: string): Result<null> { return this.nodeEvent(nodeId, reason, 'active'); }

  mergeNodes({ keep, drop, reason }: { keep: string; drop: string; reason: string }): Result<null> {
    if (!id(keep) || !id(drop) || !text(reason, 2000)) return fail('E-INVALID-INPUT', '保留方、合併方與差異原因（1 至 2000 字）必填。');
    return this.transaction(() => {
      if (keep === drop || this.endpoint(keep) === drop) return fail('E-ALIAS-CYCLE', '合併會造成別名循環。');
      if (this.state(keep) !== 'active' || this.state(drop) === 'merged' || this.endpoint(drop) !== drop || this.endpoint(keep) !== keep) {
        return fail('E-DEPRECATED', '兩方不能已合併，保留方不能已淘汰。');
      }
      const at = new Date().toISOString();
      this.db.prepare('INSERT INTO node_alias VALUES (?, ?, ?, ?)').run(drop, keep, reason, at);
      this.db.prepare("INSERT INTO node_lifecycle(node_id, state, reason, replaced_by, at) VALUES (?, 'merged', ?, ?, ?)")
        .run(drop, reason, keep, at);
      return ok(null);
    });
  }

  private comboEvent(combo: string[], reason: string, state: 'active' | 'deprecated'): Result<null> {
    if (!comboValid(combo) || !text(reason, 2000)) return fail('E-INVALID-INPUT', '組合至少兩個非空 nodeId，原因須為 1 至 2000 字。');
    return this.transaction(() => {
      this.db.prepare('INSERT INTO combo_lifecycle(combo, state, reason, at) VALUES (?, ?, ?, ?)')
        .run(canonicalJson(combo), state, reason, new Date().toISOString());
      return ok(null);
    });
  }
  deprecateCombo(combo: string[], reason: string): Result<null> { return this.comboEvent(combo, reason, 'deprecated'); }
  reactivateCombo(combo: string[], reason: string): Result<null> { return this.comboEvent(combo, reason, 'active'); }

  /** Latest event per node and per combination, so a screen needs one call instead of one per node. */
  listLifecycle(): Result<{ nodes: NodeState[]; combos: ComboState[] }> {
    const nodes = this.db.prepare(`SELECT node_id, state, reason, replaced_by, at FROM node_lifecycle
      WHERE seq IN (SELECT MAX(seq) FROM node_lifecycle GROUP BY node_id) ORDER BY node_id`).all() as unknown as NodeState[];
    const combos = this.db.prepare(`SELECT combo, state, reason, at FROM combo_lifecycle
      WHERE seq IN (SELECT MAX(seq) FROM combo_lifecycle GROUP BY combo) ORDER BY seq`).all().map(row => {
      const parsed: unknown = JSON.parse(String(row.combo));
      if (!comboValid(parsed)) throw new Error('E-CORRUPT: 組合格式錯誤。');
      return { combo: parsed, state: row.state as ComboState['state'], reason: String(row.reason), at: String(row.at) };
    });
    return ok({ nodes, combos });
  }

  exportBackup(): Result<BackupFile> { return ok(exportBackup(this.db)); }

  /** Only into an empty store, so history is never merged or overwritten; every version hash is rechecked. */
  importBackup(file: unknown): Result<null> {
    const bad = checkBackup(file, Number(this.db.prepare('SELECT version FROM schema_meta WHERE id = 1').get()?.version));
    if (bad) return fail('E-BAD-BACKUP', bad);
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM flow_case LIMIT 1').get() || this.db.prepare('SELECT 1 FROM node_lifecycle LIMIT 1').get()
        || this.db.prepare('SELECT 1 FROM combo_lifecycle LIMIT 1').get()) return fail('E-NOT-EMPTY', '只能匯入到空的案例庫。');
      try { importRows(this.db, file as BackupFile); } catch (error) {
        return fail('E-BAD-BACKUP', error instanceof Error ? error.message : '備份內容被資料庫規則拒絕。');
      }
      for (const row of this.db.prepare('SELECT case_id, version, content, content_hash FROM flow_version').all()) {
        if (hash(String(row.content)) !== row.content_hash) return fail('E-CORRUPT', '匯入的版本內容雜湊不符。');
      }
      return ok(null);
    });
  }

  scanUsage(nodeIdOrCombo: string | string[]): Result<Usage[]> {
    if (!(id(nodeIdOrCombo) || comboValid(nodeIdOrCombo))) return fail('E-INVALID-INPUT', '請提供 nodeId 或至少兩個 nodeId 的組合。');
    const usages: Usage[] = [];
    const versions = this.db.prepare('SELECT case_id, version FROM flow_version ORDER BY case_id, version').all();
    for (const row of versions) {
      const result = this.getVersion(String(row.case_id), Number(row.version));
      if (!result.ok) return result;
      // Historical references are literal; resolving them would hide which old id is still stored.
      const bundle = JSON.parse(result.value.content) as AovBundle;
      for (const graph of bundle.platform.graphs) {
        const hit = typeof nodeIdOrCombo === 'string'
          ? graph.nodes.some(n => n.kind === 'node' && n.actionId === nodeIdOrCombo)
          : hasCombo(graph, nodeIdOrCombo, value => value);
        if (hit) usages.push({ case_id: result.value.case_id, version: result.value.version, graph: graph.id });
      }
    }
    return ok(usages);
  }
}
