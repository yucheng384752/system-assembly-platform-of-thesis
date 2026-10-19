/**
 * AOV 專案檔（Template）型別定義。
 * 對應設計文件 docs/design.md 的「專案檔結構」。
 *
 * 核心規則：
 * - 節點描述動作；業務邏輯放在 port（where）與 guard 上。
 * - flows 只連 port，不連節點：每條邊都攜帶一個 artifact（workflow = dataflow）。
 * - 圖必須是 DAG；迴圈經由倉儲邊界（新工單）斷開。
 */

export const FORMAT_VERSION = 1 as const;

// ---------------------------------------------------------------- artifact 型別系統

export type ArtifactKind = 'material' | 'carrier' | 'information';
export type Identity = 'serial' | 'lot' | 'bulk' | 'record';
export type Conservation = 'strict' | 'tolerance' | 'yield';
export type MergeStrategy = 'min' | 'max' | 'union' | 'weighted_avg' | 'must_equal' | 'drop';
export type AttrSource = 'spec' | 'inherited' | 'generated';
export type AttrValueType = 'number' | 'string' | 'bool' | 'datetime' | 'enum' | 'quantity' | 'string[]' | 'json';

export interface AttrDef {
  type: AttrValueType;
  /** quantity / number 屬性的單位，例如 "%"、"degC"、"kg" */
  unit?: string;
  /** enum 屬性的值，依序由低到高（讓 grade >= 'B' 成立） */
  values?: string[];
  source: AttrSource;
  /** 繼承屬性在組合／匯流時的合併策略；未宣告視為 must_equal（並產生驗證提示） */
  merge?: MergeStrategy;
  /** spec 屬性的固定值 */
  value?: unknown;
  description?: string;
}

export interface QuantityDef {
  dimension: string; // count | mass | volume | length | area | time
  baseUnit: string;
  conservation?: Conservation;
  /** tolerance 模式的相對容許誤差，例如 0.005 */
  tolerance?: number;
}

export interface ArtifactType {
  id: string;
  name?: string;
  extends?: string;
  kind?: ArtifactKind;
  identity?: Identity;
  quantity?: QuantityDef;
  attributes?: Record<string, AttrDef>;
  /** 資訊型專用：它描述哪些型別 */
  subject?: { types: string[] };
  /** 轉換節點的身分規則；預設 new_on_type_change */
  transformIdentity?: 'new_on_type_change' | 'always_new' | 'keep';
  description?: string;
}

/** 解析繼承鏈之後的完整型別 */
export interface ResolvedType {
  id: string;
  name: string;
  chain: string[]; // [self, parent, grandparent, ...]
  kind: ArtifactKind;
  identity: Identity;
  quantity?: QuantityDef;
  attributes: Record<string, AttrDef>;
  subject?: { types: string[] };
  transformIdentity: 'new_on_type_change' | 'always_new' | 'keep';
}

// ---------------------------------------------------------------- 節點

export type NodeCategory =
  // 邊界類
  | 'source'
  | 'sink'
  // 動作類
  | 'transform'
  | 'assemble'
  | 'split'
  | 'move'
  | 'hold'
  | 'measure'
  | 'judge'
  // 結構類
  | 'merge'
  | 'broadcast'
  | 'subgraph';

export type CategoryGroup = 'boundary' | 'activity' | 'structural';

export const CATEGORY_GROUP: Record<NodeCategory, CategoryGroup> = {
  source: 'boundary',
  sink: 'boundary',
  transform: 'activity',
  assemble: 'activity',
  split: 'activity',
  move: 'activity',
  hold: 'activity',
  measure: 'activity',
  judge: 'activity',
  merge: 'structural',
  broadcast: 'structural',
  subgraph: 'structural',
};

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  source: '來源',
  sink: '終點',
  transform: '轉換',
  assemble: '組合',
  split: '拆分',
  move: '移轉',
  hold: '保持',
  measure: '量測',
  judge: '判定',
  merge: '匯流',
  broadcast: '廣播',
  subgraph: '子流程',
};

/** 「做什麼」與「誰來做」正交：執行者是屬性，不是節點型別 */
export type Executor = 'manual' | 'auto' | 'system';

export type PortRole = 'main' | 'loss' | 'record';

export interface PortDef {
  id: string;
  /** artifact 型別 id，可用 glob，例如 "lot.*" */
  type: string;
  /** "1" | "0..1" | "1..*" | "2..*" | "0..*" ；預設 "1" */
  cardinality?: string;
  /** 輸入 port 是否必要；預設 true（cardinality 下限為 0 時預設 false） */
  required?: boolean;
  /** 精煉條件，語境變數 self（單一 artifact），執行時檢查 */
  where?: string;
  /** loss：損耗出口；record：資訊紀錄出口 */
  role?: PortRole;
  /** 輸出 port 的轉換比例（良率），例如 0.98 */
  ratio?: number;
  label?: string;
}

/** 具名條件（v0.2）：guard 可以是字串或具名條件清單 */
export interface GuardItem {
  label: string;
  when: string;
}
export type Guard = string | GuardItem[];

export type CheckLevel = 'critical' | 'major' | 'minor';

/** 檢驗項目（v0.2，判定節點） */
export interface CheckDef {
  id: string;
  label: string;
  /** 實測值運算式 */
  value: string;
  min?: string;
  max?: string;
  equals?: string;
  /** 清單運算式，例如 "['透明', '微濁']" */
  oneOf?: string;
  level?: CheckLevel;
}

/** 判定結果規則（v0.2）：verdict 即輸出 port id */
export interface VerdictRule {
  /** 運算式（可用 failed.*、check.*、in、params、now），或 "otherwise" */
  when: string;
  verdict: string;
}

/** 決策表（v0.2，判定節點） */
export interface DecisionTable {
  hitPolicy?: 'first' | 'unique';
  inputs: { id: string; label?: string; expr: string }[];
  rules: { when: Record<string, string>; port: string; label?: string }[];
}

export interface RouteRule {
  /** guard 表達式，或字面字串 "otherwise" */
  when: string;
  /** 判定節點的輸出 port id */
  port: string;
  label?: string;
}

export interface BoundaryDef {
  kind: 'warehouse' | 'carrier-warehouse' | 'external' | 'supplier' | 'customer' | 'exception' | 'scrap';
  /** 倉儲 / 位置代碼，例如 "wh.raw" */
  location: string;
}

export interface NodeParams {
  /** hold：最短時間（時間字串，如 "1h"） */
  minDuration?: string;
  /** hold：最長時間；完成時寫入 artifact 的 expiresAt */
  maxDuration?: string;
  /** held 狀態的最長等待；逾時進 faulted */
  maxWait?: string;
  /** split：子件數量 */
  splitCount?: number;
  /** move：目的位置 */
  toLocation?: string;
  /** 產出時機：預設 atomic；incremental 為 backlog 功能 */
  emit?: 'atomic' | 'incremental';
  /** 跨維度換算係數：輸出 base 數量 = 輸入 base 數量 × factor */
  conversionFactor?: number;
}

export interface NodeDef {
  id: string;
  name: string;
  category: NodeCategory;
  executor?: Executor;
  /** 預期填寫者（例如 operator / manager）；僅標示，不做權限強制 */
  role?: string;
  inputs: PortDef[];
  outputs: PortDef[];
  /** 節點 guard：語境變數 in、params、now；可為字串或具名條件清單 */
  guard?: Guard;
  /** judge 專用：運算式決策表，第一條成立者勝出，必須有 otherwise */
  route?: RouteRule[];
  /** judge 專用（v0.2）：欄位式決策表 */
  decision?: DecisionTable;
  /** judge 專用（v0.2）：檢驗項目 */
  checks?: CheckDef[];
  /** judge 專用（v0.2）：判定結果規則；未設定時全部合格 → ok，否則 → ng */
  verdicts?: VerdictRule[];
  /** 引用的業務動作 id（v0.2） */
  action?: string;
  /** 選用的表單 id（v0.2，動作 usesForm 時） */
  form?: string;
  boundary?: BoundaryDef;
  params?: NodeParams;
  /** subgraph 專用：引用的專案 id@version（v1 尚未支援執行） */
  ref?: string;
  /** 模擬用：此節點產出的 generated 屬性值，例如 { "value": 11 } */
  sim?: Record<string, unknown>;
  description?: string;
}

export interface PortRef {
  node: string;
  port: string;
}

export interface Flow {
  id: string;
  from: PortRef;
  to: PortRef;
}

export interface ParamDef {
  id: string;
  type: 'number' | 'string' | 'string[]' | 'bool' | 'quantity';
  unit?: string;
  default?: unknown;
  description?: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  /** template 版本；發佈後不可變，工單鎖定 id@version */
  version: number;
  status: 'draft' | 'published';
  description?: string;
  domain?: string;
  updatedAt?: string;
  /** 'subgraph'：此專案設計成被子流程引用，未連線的 port 是對外介面，不算錯誤 */
  kind?: 'subgraph';
}

export interface ProjectSettings {
  /** fault port「轉出」時送往的異常倉位置 */
  exceptionLocation?: string;
  /** lineage 查詢深度上限，預設 10 */
  lineageMaxDepth?: number;
}

// ---------------------------------------------------------------- v0.2：業務動作層

export interface FieldDef {
  label?: string;
  type: AttrValueType;
  unit?: string;
  values?: string[];
  required?: boolean;
  /** 模擬預設值 */
  default?: unknown;
}

/** 表單：展開成資訊型別 form.<id> */
export interface FormDef {
  id: string;
  name: string;
  /** 這張表描述什麼型別 */
  subject: string[];
  /** 繼承的資訊型別，預設 info.document */
  extends?: string;
  fields: Record<string, FieldDef>;
}

/** 具名規則：非遞迴、編譯時展開的條件函式 */
export interface RuleDef {
  id: string;
  label?: string;
  params: string[];
  expr: string;
}

/** 業務動作：業務名稱對應到原語，並帶預設 port 與業務邏輯 */
export interface ActionDef {
  id: string;
  name: string;
  /** 畫布角落的單字圖示 */
  glyph?: string;
  /** 對應的原語 */
  behavior: NodeCategory;
  executor?: Executor;
  description?: string;
  inputs?: PortDef[];
  outputs?: PortDef[];
  guard?: Guard;
  route?: RouteRule[];
  decision?: DecisionTable;
  checks?: CheckDef[];
  verdicts?: VerdictRule[];
  boundary?: BoundaryDef;
  params?: NodeParams;
  /** true：節點必須選一張表單，展開時加上 record 輸出 */
  usesForm?: boolean;
}

export interface LibraryRef {
  id: string;
  version: number;
}

/** 共用動作庫檔案（*.aovlib.json） */
export interface ActionLibrary {
  formatVersion: typeof FORMAT_VERSION;
  kind: 'action-library';
  meta: { id: string; name: string; version: number; status: 'draft' | 'published'; description?: string };
  artifactTypes?: ArtifactType[];
  forms?: FormDef[];
  rules?: RuleDef[];
  actions: ActionDef[];
}

export interface ProjectFile {
  formatVersion: typeof FORMAT_VERSION;
  meta: ProjectMeta;
  /** 引用的共用動作庫（鎖定版本） */
  libraries?: LibraryRef[];
  /** 專案本地動作 */
  actions?: ActionDef[];
  forms?: FormDef[];
  rules?: RuleDef[];
  artifactTypes: ArtifactType[];
  params?: ParamDef[];
  nodes: NodeDef[];
  flows: Flow[];
  layout?: Record<string, { x: number; y: number }>;
  /** 連線的經過點（flow id → 座標）：編輯器中拖曳連線標籤設定；僅影響畫面 */
  flowLayout?: Record<string, { x: number; y: number }>;
  settings?: ProjectSettings;
}

// ---------------------------------------------------------------- 診斷

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  /** 規則代碼，例如 R1-linearity */
  code: string;
  message: string;
  nodeId?: string;
  flowId?: string;
  portId?: string;
}
