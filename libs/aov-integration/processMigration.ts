import type { PlanTiming } from './executablePlan';

// Carries B's ProcessDefinition (composer-refactor-2, composer_core/process/model.py) into the inputs of
// buildExecutablePlan and reports what happened to every B field. Nothing is guessed: B nodes are matched
// to plan nodes only through the caller's nodeMap, and whatever cannot be carried is listed, not dropped silently.
export interface ProcessMigrationOptions {
  /** B node id -> plan nodeId (flattened sub-AoV ids allowed). Names are never matched. */
  nodeMap: Record<string, string>;
  /** Unit that B's per_unit multiplies. B stores none, so the caller must state it. */
  quantityUnit?: string;
}
export type FieldDisposition = 'carried' | 'dropped' | 'deferred' | 'needs-input' | 'unknown';
export interface FieldReportItem {
  /** JSON pointer into B's document; `*` stands for every element of an array. */
  sourcePath: string;
  disposition: FieldDisposition;
  /** How many elements the item covers. */
  count: number;
  /** Ids (B node, edge, product or rule ids) the item covers, so a person can find them. */
  ids: string[];
  summary: string;
  suggestedAction: string;
}
export interface ProcessMigrationError { code: 'broken-structure' | 'node-map'; path: string; message: string }
export type ProcessMigrationResult =
  | { ok: false; errors: ProcessMigrationError[] }
  | { ok: true; timings: Record<string, PlanTiming>; resources: Record<string, { capability?: string; operatorSkill?: string }>; report: FieldReportItem[] };

type Rec = Record<string, unknown>;
const record = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(record) : []);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

// Field names of B's pydantic models (extra="forbid"); anything else in a document is reported as unknown.
const KNOWN = {
  process: ['id', 'name', 'version', 'time_unit', 'nodes', 'edges', 'products', 'rework_rules'],
  node: ['id', 'name', 'kind', 'function', 'latency', 'inputs', 'outputs', 'split', 'join', 'resource', 'props', 'subgraph', 'position'],
  edge: ['id', 'source', 'target', 'flow', 'transfer_time'],
  product: ['product_id', 'name', 'enabled_nodes', 'branch_choices', 'latency_overrides', 'inspection_form', 'material_item'],
};

export function migrateProcessDefinition(input: unknown, options: ProcessMigrationOptions): ProcessMigrationResult {
  const errors: ProcessMigrationError[] = [];
  const broken = (path: string, message: string) => errors.push({ code: 'broken-structure', path, message });
  if (!record(input)) return { ok: false, errors: [{ code: 'broken-structure', path: '/', message: '流程定義必須是物件。' }] };
  if (!Array.isArray(input.nodes)) broken('/nodes', 'nodes 必須是陣列。');
  if (!Array.isArray(input.edges)) broken('/edges', 'edges 必須是陣列。');
  const nodes = list(input.nodes);
  nodes.forEach((n, i) => {
    if (!text(n.id)) broken(`/nodes/${i}/id`, '節點缺少 id。');
    const latency = n.latency;
    if (latency !== undefined && (!record(latency) || ['setup', 'per_unit'].some(k => latency[k] !== undefined && typeof latency[k] !== 'number'))) broken(`/nodes/${i}/latency`, 'latency 的 setup、per_unit 必須是數字。');
  });
  if (Array.isArray(input.nodes) && nodes.length !== input.nodes.length) broken('/nodes', 'nodes 含有非物件的項目。');
  const ids = nodes.map(n => text(n.id));
  if (new Set(ids).size !== ids.length) broken('/nodes', '節點 id 重複。');
  if (errors.length) return { ok: false, errors };

  // The map is checked both ways: a typo'd B id or two B nodes sharing one plan node must not pass quietly.
  const known = new Set(ids);
  for (const key of Object.keys(options.nodeMap)) if (!known.has(key)) errors.push({ code: 'node-map', path: `/nodeMap/${key}`, message: `nodeMap 的 B 節點「${key}」不在流程定義內。` });
  const targets = new Map<string, string>();
  for (const [from, to] of Object.entries(options.nodeMap)) {
    if (targets.has(to)) errors.push({ code: 'node-map', path: `/nodeMap/${from}`, message: `B 節點「${targets.get(to)}」與「${from}」對應到同一個計畫節點「${to}」，無法決定工時屬於哪一個。` });
    targets.set(to, from);
  }
  if (errors.length) return { ok: false, errors };

  const report: FieldReportItem[] = [];
  const add = (sourcePath: string, disposition: FieldDisposition, covered: string[], summary: string, suggestedAction: string) => {
    if (covered.length) report.push({ sourcePath, disposition, count: covered.length, ids: covered, summary, suggestedAction });
  };
  const idOf = (n: Rec) => n.id as string;

  const timings: Record<string, PlanTiming> = {};
  const resources: Record<string, { capability?: string; operatorSkill?: string }> = {};
  const unmapped = nodes.filter(n => !(idOf(n) in options.nodeMap));
  const mapped = nodes.filter(n => idOf(n) in options.nodeMap);
  const timeUnitOk = (input.time_unit ?? 'min') === 'min';
  const zero: string[] = [], invalid: string[] = [], noUnit: string[] = [], carriedTiming: string[] = [], carriedResource: string[] = [];
  for (const n of mapped) {
    const planId = options.nodeMap[idOf(n)];
    const latency = record(n.latency) ? n.latency : {};
    const setup = (latency.setup ?? 0) as number, perUnit = (latency.per_unit ?? 0) as number;
    if (!timeUnitOk) timings[planId] = { state: 'missing' };
    else if (!Number.isFinite(setup) || !Number.isFinite(perUnit) || setup < 0 || perUnit < 0) { invalid.push(idOf(n)); timings[planId] = { state: 'missing' }; }
    else if (setup === 0 && perUnit === 0) { zero.push(idOf(n)); timings[planId] = { state: 'missing' }; }
    else if (!options.quantityUnit?.trim()) { noUnit.push(idOf(n)); timings[planId] = { state: 'missing' }; }
    else { carriedTiming.push(idOf(n)); timings[planId] = { state: 'specified', setupMin: setup, perUnitMin: perUnit, quantityUnit: options.quantityUnit }; }

    const resource = record(n.resource) ? n.resource : {};
    const entry = { ...(text(resource.capability) && { capability: text(resource.capability) }), ...(text(resource.operator_skill) && { operatorSkill: text(resource.operator_skill) }) };
    if (Object.keys(entry).length) { resources[planId] = entry; carriedResource.push(idOf(n)); }
  }

  // Latency
  if (!timeUnitOk) add('/time_unit', 'needs-input', mapped.map(idOf), `時間單位是「${String(input.time_unit)}」，計畫以分鐘為單位；不自行換算，所有工時視為缺值。`, '先把來源改成分鐘，或另行提供已換算的工時。');
  add('/nodes/*/latency', 'carried', carriedTiming, '工時（setup、per_unit，分鐘）已帶入計畫。', '無。');
  add('/nodes/*/latency', 'needs-input', zero, 'setup 與 per_unit 皆為 0。B 的預設值就是 0，分不出「真的 0」與「沒填」，一律視為缺值。', '確認後在建置計畫時直接提供這些節點的工時。');
  add('/nodes/*/latency', 'needs-input', invalid, '工時為負數或不是有限數字，視為缺值。', '修正來源的工時後重新遷移。');
  add('/nodes/*/latency', 'needs-input', noUnit, 'B 沒有記錄 per_unit 乘的數量單位，未提供 quantityUnit，視為缺值。', '呼叫時指定 quantityUnit（例如 pcs、kg）。');
  add('/nodes/*/resource', 'carried', carriedResource, '資源需求（capability、operator_skill）已帶入計畫。', '無。');

  // Nodes that have no counterpart keep nothing.
  add('/nodes/*', 'dropped', unmapped.map(idOf), 'B 節點在 nodeMap 中沒有對應的計畫節點，其工時與資源都未帶入。', '在 nodeMap 補上對應，或確認這些節點本來就不屬於此流程。');

  // Everything that does not travel into the plan, one item per B field.
  const withContent = (pick: (n: Rec) => boolean) => nodes.filter(pick).map(idOf);
  add('/nodes/*/function', 'deferred', withContent(n => !!text(n.function)), `B 以 function 字串綁定行為（${[...new Set(nodes.map(n => text(n.function)).filter(Boolean))].join('、')}）；在計畫中改由「動作到能力的對應表」決定，不依字串猜測。`, '把這些 function 對照到 A 的業務動作，再寫入對應表。');
  add('/nodes/*/kind', 'dropped', withContent(n => n.kind !== undefined && n.kind !== 'task'), `B 的節點種類（${[...new Set(nodes.map(n => text(n.kind)).filter(k => k && k !== 'task'))].join('、')}）不是 A 的節點類別；倉儲與結案語意不自動轉換。`, '在 A 的專案內以對應類別的節點表達，並用類別預設對應或動作對應綁定能力。');
  add('/nodes/*/name', 'dropped', withContent(n => !!text(n.name)), '節點名稱以 A 專案為準，不從 B 覆蓋。', '無。');
  add('/nodes/*/inputs', 'dropped', withContent(n => list(n.inputs).length > 0), 'B 的埠位只有名稱與型別，A 的埠位型別來自 artifact 型別，不自動轉換。', '以 A 的 artifact 型別重新定義埠位。');
  add('/nodes/*/outputs', 'dropped', withContent(n => list(n.outputs).length > 0), '同 inputs。', '以 A 的 artifact 型別重新定義埠位。');
  add('/nodes/*/split', 'dropped', withContent(n => n.split !== undefined && n.split !== 'none'), 'B 的分流閘（xor/and）不轉換；A 以 split、judge、broadcast 類別與 route 表達。', '在 A 專案內重建分流邏輯。');
  add('/nodes/*/join', 'dropped', withContent(n => n.join !== undefined && n.join !== 'none'), 'B 的合流閘（xor/and）不轉換；A 以 merge 類別表達。', '在 A 專案內重建合流邏輯。');
  add('/nodes/*/props', 'dropped', withContent(n => record(n.props) && Object.keys(n.props).length > 0), 'B 的自訂屬性沒有對應的 A 欄位。', '需要時改為 A 的節點參數或參數。');
  add('/nodes/*/subgraph', 'dropped', withContent(n => record(n.subgraph) && (list(n.subgraph.steps).length > 0 || list(n.subgraph.inputs).length > 0 || list(n.subgraph.outputs).length > 0)), 'B 的子步驟（form、validate、store、state）屬系統邏輯，依決策 17 直接捨棄，不阻擋發布。', '表單與驗證在 A 專案以節點表單與 guard 表達。');
  add('/nodes/*/position', 'dropped', withContent(n => record(n.position)), '畫面座標只屬於 B 的編輯器。', '無。');

  const edges = list(input.edges);
  const edgeIds = edges.map(e => String(e.id ?? ''));
  add('/edges/*', 'dropped', edgeIds, 'B 的邊只有節點對節點的先後與物料／資料類別，沒有埠位；A 的連線是埠位對埠位，不自動轉換。', '以 A 專案內既有的連線為準。');
  add('/edges/*/transfer_time', 'deferred', edges.filter(e => typeof e.transfer_time === 'number' && e.transfer_time !== 0).map(e => String(e.id ?? '')), '搬運時間尚未帶入計畫（尚無 B 邊到 A 連線的對應規則）。', '待 B 邊與 A 連線的對應規則確定後再帶入。');

  const products = list(input.products);
  add('/products/*', 'dropped', products.map(p => String(p.product_id ?? '')), '產品路線（啟用節點、分支選擇、工時覆寫、檢驗表）不屬於計畫；計畫描述一條流程。', '每個產品如需獨立路線，各自建立一個 A 專案。');
  add('/products/*/latency_overrides', 'dropped', products.filter(p => record(p.latency_overrides) && Object.keys(p.latency_overrides).length > 0).map(p => String(p.product_id ?? '')), '產品專屬的工時覆寫未帶入，計畫只用節點本身的工時。', '需要時以建置計畫的 timings 另行提供。');
  add('/rework_rules/*', 'dropped', list(input.rework_rules).map(r => String(r.id ?? '')), 'B 的重工規則（觸發節點、重做節點、複驗節點）不轉換；A 以 return 邊與判定節點表達。', '在 A 專案內重建重工流程。');
  add('/id', 'dropped', [String(input.id ?? '')], `B 流程「${String(input.name ?? '')}」（版本 ${String(input.version ?? '')}）的識別與版本不帶入；計畫的來源是 A 的專案。`, '無。');

  // Fields outside B's model are reported at the level they appear on.
  const unknown = (path: string, items: Rec[], keys: string[], idKey: string) => {
    const extra = [...new Set(items.flatMap(item => Object.keys(item).filter(k => !keys.includes(k))))];
    add(path, 'unknown', extra.length ? items.filter(item => Object.keys(item).some(k => !keys.includes(k))).map(item => String(item[idKey] ?? '')) : [], `出現 B 模型沒有的欄位：${extra.join('、')}。`, '確認來源版本；這些欄位未帶入。');
  };
  unknown('/', [input], KNOWN.process, 'id');
  unknown('/nodes/*', nodes, KNOWN.node, 'id');
  unknown('/edges/*', edges, KNOWN.edge, 'id');
  unknown('/products/*', products, KNOWN.product, 'product_id');

  return { ok: true, timings, resources, report };
}
