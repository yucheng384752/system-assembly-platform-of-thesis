import { createHash } from 'node:crypto';

// Per-Kit change log of workflow.aov.json (D190). The log is generated from structured entries; the readable text and the
// machine-readable block must agree, and replaying the entries from an empty graph must reproduce the current workflow.
// No enums or parameter properties: scripts/kit-changelog.mjs runs this file with Node's type stripping.

/** Why a workflow changed. A closed set, because a model that learns from the log needs comparable observations. */
export const CAUSES = {
  initial: '初版：Kit 第一次建立流程描述',
  'new-feature': '新增功能：Kit 多了能力，流程跟著補節點',
  'align-runtime': '對齊實際行為：流程描述與實際程式行為不符，已修正',
  wording: '用語調整：節點名稱改成更精確或更貼近業務的說法',
  dependency: '前置關係：調整哪一步必須先完成哪一步',
  granularity: '粒度調整：節點拆分、合併或移除重複',
  'verification-finding': '實測發現：在測試機實際操作後發現需要修改',
  other: '其他：須在修改原因寫清楚',
} as const;
export type Cause = keyof typeof CAUSES;

export type WorkflowNode = { id: string; name: string; subfeatureId?: string; capabilityIds: string[] };
export type WorkflowEdge = { from: string; to: string };
export type Graph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };

type Field<T> = { before: T; after: T };
export type NodeChange =
  | { op: 'add'; nodeId: string; nodeName: string; after: WorkflowNode }
  | { op: 'remove'; nodeId: string; nodeName: string; before: WorkflowNode }
  | { op: 'edit'; nodeId: string; nodeName: string; fields: { name?: Field<string>; subfeatureId?: Field<string | null>; capabilityIds?: Field<string[]> } };
export type EdgeChange = { op: 'add' | 'remove'; from: string; to: string };

export type Entry = {
  seq: number;
  kitVersion: string;
  date: string;
  author: string;
  /** `manual` for an entry written by the CLI, `git:<hash>` for one rebuilt from history. */
  source: string;
  cause: Cause;
  reason: string;
  nodes: NodeChange[];
  edges: EdgeChange[];
  beforeSha: string;
  afterSha: string;
};

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const byKey = <T>(key: (item: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

/** Order of nodes, edges and capabilities carries no meaning, so it must not change the identity of a graph. */
export function normalize(graph: Graph): Graph {
  const nodes = graph.nodes.map(node => ({
    id: node.id, name: node.name,
    ...(node.subfeatureId === undefined ? {} : { subfeatureId: node.subfeatureId }),
    capabilityIds: [...node.capabilityIds].sort(),
  })).sort(byKey(node => node.id));
  const seen = new Set<string>();
  const edges = graph.edges.map(edge => ({ from: edge.from, to: edge.to })).filter(edge => {
    const key = `${edge.from}\0${edge.to}`;
    return seen.has(key) ? false : (seen.add(key), true);
  }).sort(byKey(edge => `${edge.from}\0${edge.to}`));
  return { nodes, edges };
}

export const graphSha = (graph: Graph) => sha256(JSON.stringify(normalize(graph)));
export const emptyGraph = (): Graph => ({ nodes: [], edges: [] });

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/** What changed between two graphs, in a fixed order so the same change always produces the same entry. */
export function diffGraphs(before: Graph, after: Graph): { nodes: NodeChange[]; edges: EdgeChange[] } {
  const a = normalize(before);
  const b = normalize(after);
  const was = new Map(a.nodes.map(node => [node.id, node]));
  const is = new Map(b.nodes.map(node => [node.id, node]));
  const nodes: NodeChange[] = [];
  for (const node of b.nodes) {
    const old = was.get(node.id);
    if (!old) { nodes.push({ op: 'add', nodeId: node.id, nodeName: node.name, after: node }); continue; }
    const fields: Extract<NodeChange, { op: 'edit' }>['fields'] = {};
    if (old.name !== node.name) fields.name = { before: old.name, after: node.name };
    if ((old.subfeatureId ?? null) !== (node.subfeatureId ?? null)) fields.subfeatureId = { before: old.subfeatureId ?? null, after: node.subfeatureId ?? null };
    if (!sameList(old.capabilityIds, node.capabilityIds)) fields.capabilityIds = { before: old.capabilityIds, after: node.capabilityIds };
    if (Object.keys(fields).length) nodes.push({ op: 'edit', nodeId: node.id, nodeName: node.name, fields });
  }
  for (const node of a.nodes) if (!is.has(node.id)) nodes.push({ op: 'remove', nodeId: node.id, nodeName: node.name, before: node });
  const key = (edge: WorkflowEdge) => `${edge.from}\0${edge.to}`;
  const had = new Set(a.edges.map(key));
  const has = new Set(b.edges.map(key));
  const edges: EdgeChange[] = [
    ...b.edges.filter(edge => !had.has(key(edge))).map(edge => ({ op: 'add' as const, from: edge.from, to: edge.to })),
    ...a.edges.filter(edge => !has.has(key(edge))).map(edge => ({ op: 'remove' as const, from: edge.from, to: edge.to })),
  ];
  return { nodes, edges };
}

/** Applies one entry to the graph it was recorded against. Throws a message naming what does not fit. */
export function applyEntry(graph: Graph, entry: Entry): Graph {
  if (graphSha(graph) !== entry.beforeSha) throw new Error(`#${entry.seq} 的「修改前」與前一筆的結果不一致（紀錄被改過，或中間缺了一筆）`);
  const nodes = new Map(normalize(graph).nodes.map(node => [node.id, node]));
  let edges = normalize(graph).edges;
  for (const change of entry.nodes) {
    const current = nodes.get(change.nodeId);
    if (change.op === 'add') {
      if (current) throw new Error(`#${entry.seq} 新增節點 ${change.nodeId}，但它已存在`);
      nodes.set(change.nodeId, change.after);
    } else if (change.op === 'remove') {
      if (!current) throw new Error(`#${entry.seq} 移除節點 ${change.nodeId}，但它不存在`);
      nodes.delete(change.nodeId);
    } else {
      if (!current) throw new Error(`#${entry.seq} 修改節點 ${change.nodeId}，但它不存在`);
      const next = { ...current };
      const { name, subfeatureId, capabilityIds } = change.fields;
      if (name) { if (current.name !== name.before) throw new Error(`#${entry.seq} 節點 ${change.nodeId} 的名稱「修改前」不符`); next.name = name.after; }
      if (subfeatureId) {
        if ((current.subfeatureId ?? null) !== subfeatureId.before) throw new Error(`#${entry.seq} 節點 ${change.nodeId} 的子功能「修改前」不符`);
        if (subfeatureId.after === null) delete next.subfeatureId; else next.subfeatureId = subfeatureId.after;
      }
      if (capabilityIds) { if (!sameList(current.capabilityIds, capabilityIds.before)) throw new Error(`#${entry.seq} 節點 ${change.nodeId} 的能力「修改前」不符`); next.capabilityIds = capabilityIds.after; }
      nodes.set(change.nodeId, next);
    }
  }
  const key = (edge: WorkflowEdge) => `${edge.from}\0${edge.to}`;
  for (const change of entry.edges) {
    const exists = edges.some(edge => key(edge) === key(change));
    if (change.op === 'add') {
      if (exists) throw new Error(`#${entry.seq} 新增連線 ${change.from} → ${change.to}，但它已存在`);
      edges = [...edges, { from: change.from, to: change.to }];
    } else {
      if (!exists) throw new Error(`#${entry.seq} 移除連線 ${change.from} → ${change.to}，但它不存在`);
      edges = edges.filter(edge => key(edge) !== key(change));
    }
  }
  for (const edge of edges) if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error(`#${entry.seq} 之後仍有連線指向不存在的節點：${edge.from} → ${edge.to}`);
  const result = normalize({ nodes: [...nodes.values()], edges });
  if (graphSha(result) !== entry.afterSha) throw new Error(`#${entry.seq} 套用變更後的結果與紀錄的「修改後」不一致`);
  return result;
}

/** Every node an entry touches, including those whose only change is an edge, so a reader (or a model) sees all of them. */
export function touchedNodes(entry: Entry): Map<string, 'add' | 'remove' | 'edit' | 'link'> {
  const touched = new Map<string, 'add' | 'remove' | 'edit' | 'link'>();
  for (const change of entry.nodes) touched.set(change.nodeId, change.op);
  for (const change of entry.edges) for (const id of [change.from, change.to]) if (!touched.has(id)) touched.set(id, 'link');
  return touched;
}

// ---- rendering --------------------------------------------------------------------------------------------------------

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const quote = (text: string) => text.replace(/"/g, '#quot;');
const MARK = '<!-- kit-changelog-entry -->';

function mermaid(graph: Graph, marks: Map<string, string>): string {
  if (!graph.nodes.length) return '（尚無流程）';
  const lines = ['```mermaid', 'flowchart LR'];
  for (const node of graph.nodes) lines.push(`  n_${node.id.replace(/-/g, '_')}["${quote(node.name)}"]${marks.has(node.id) ? `:::${marks.get(node.id)}` : ''}`);
  for (const edge of graph.edges) lines.push(`  n_${edge.from.replace(/-/g, '_')} --> n_${edge.to.replace(/-/g, '_')}`);
  lines.push('  classDef add fill:#d6f5dc,stroke:#2e7d32', '  classDef remove fill:#fbd9d9,stroke:#c62828', '  classDef edit fill:#fff3c4,stroke:#b58900', '  classDef link fill:#dbe9ff,stroke:#1f5fbf', '```');
  return lines.join('\n');
}

function describe(change: NodeChange): [string, string] {
  if (change.op === 'add') return ['新增', `能力：${change.after.capabilityIds.join('、') || '（無）'}`];
  if (change.op === 'remove') return ['移除', `原能力：${change.before.capabilityIds.join('、') || '（無）'}`];
  const parts: string[] = [];
  const { name, subfeatureId, capabilityIds } = change.fields;
  if (name) parts.push(`名稱：「${name.before}」改為「${name.after}」`);
  if (subfeatureId) parts.push(`子功能：${subfeatureId.before ?? '（無）'} 改為 ${subfeatureId.after ?? '（無）'}`);
  if (capabilityIds) {
    const added = capabilityIds.after.filter(id => !capabilityIds.before.includes(id));
    const removed = capabilityIds.before.filter(id => !capabilityIds.after.includes(id));
    if (added.length) parts.push(`增加能力：${added.join('、')}`);
    if (removed.length) parts.push(`移除能力：${removed.join('、')}`);
    if (!added.length && !removed.length) parts.push('能力順序調整');
  }
  return ['修改', parts.join('；')];
}

export function renderEntry(entry: Entry, before: Graph, after: Graph): string {
  const names = new Map([...before.nodes, ...after.nodes].map(node => [node.id, node.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const touched = touchedNodes(entry);
  const rows: string[] = [];
  for (const id of [...touched.keys()].sort()) {
    const change = entry.nodes.find(candidate => candidate.nodeId === id);
    if (change) { const [action, detail] = describe(change); rows.push(`| ${cell(change.nodeName)} | ${id} | ${action} | ${cell(detail)} |`); }
    else {
      const links = entry.edges.filter(edge => edge.from === id || edge.to === id)
        .map(edge => `${edge.op === 'add' ? '新增' : '移除'}連線「${nameOf(edge.from)}」→「${nameOf(edge.to)}」`);
      rows.push(`| ${cell(nameOf(id))} | ${id} | 連線變更 | ${cell(links.join('；'))} |`);
    }
  }
  const edgeLines = entry.edges.map(edge => `- ${edge.op === 'add' ? '新增' : '移除'}連線：「${nameOf(edge.from)}」→「${nameOf(edge.to)}」`);
  const beforeMarks = new Map([...touched].filter(([, op]) => op !== 'add').map(([id, op]) => [id, op]));
  const afterMarks = new Map([...touched].filter(([, op]) => op !== 'remove').map(([id, op]) => [id, op]));
  return [
    `## #${entry.seq}　${entry.date}　${entry.cause}`,
    '',
    `- 修改原因分類：${CAUSES[entry.cause]}`,
    `- 修改原因：${entry.reason}`,
    `- Kit 版本：${entry.kitVersion}　作者：${entry.author}　來源：${entry.source}`,
    '',
    '### 被修改的節點',
    '',
    rows.length ? ['| 節點名稱（node_name） | node_id | 動作 | 變化 |', '| --- | --- | --- | --- |', ...rows].join('\n') : '（沒有節點變更）',
    ...(edgeLines.length ? ['', '### 連線變更', '', ...edgeLines] : []),
    '',
    '### 畫布：修改前',
    '',
    mermaid(before, beforeMarks),
    '',
    '### 畫布：修改後',
    '',
    mermaid(after, afterMarks),
    '',
    '<details><summary>機器可讀資料</summary>',
    '',
    MARK,
    '```json',
    JSON.stringify(entry, null, 2),
    '```',
    '',
    '</details>',
    '',
  ].join('\n');
}

/** Replays the entries from an empty graph; returns the graph before and after each entry (ascending by seq). */
export function replay(entries: Entry[]): { before: Graph; after: Graph }[] {
  let graph = emptyGraph();
  return entries.map(entry => { const before = graph; graph = applyEntry(graph, entry); return { before, after: graph }; });
}

export function renderChangelog(kitId: string, entries: Entry[]): string {
  const steps = replay(entries);
  const legend = Object.entries(CAUSES).map(([key, text]) => `| ${key} | ${text} |`);
  return [
    `# ${kitId} 變更紀錄`,
    '',
    '本檔記錄這個 Kit 的作業流程（`workflow.aov.json`）每次修改了哪些節點、為什麼改、改前改後的畫布長什麼樣。',
    '它由 `node scripts/kit-changelog.mjs` 產生，請不要手改；改了流程描述後執行 `add` 補一筆（見 `docs/kit-authoring.md`）。',
    '測試會檢查：紀錄從空白依序重播後必須等於目前的流程描述，且本檔文字與機器可讀資料一致。',
    '',
    '| 修改原因分類 | 意義 |',
    '| --- | --- |',
    ...legend,
    '',
    ...[...entries].reverse().map((entry, i) => renderEntry(entry, steps[entries.length - 1 - i].before, steps[entries.length - 1 - i].after)),
  ].join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

export function parseChangelog(text: string): Entry[] {
  const entries: Entry[] = [];
  const pattern = new RegExp(`${MARK}\\r?\\n\`\`\`json\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``, 'g');
  for (const match of text.matchAll(pattern)) entries.push(JSON.parse(match[1]) as Entry);
  return entries.sort((a, b) => a.seq - b.seq);
}

// ---- verification -----------------------------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Everything wrong between a Kit's workflow and its CHANGELOG.md; empty when they agree. `text` is null when the file is missing. */
export function verifyKit(kitId: string, workflow: Graph & { kitVersion: string }, text: string | null): string[] {
  if (text === null) return [`${kitId}：缺少 CHANGELOG.md（流程描述的每次修改都要留紀錄，見 docs/kit-authoring.md）`];
  const problems: string[] = [];
  let entries: Entry[];
  try { entries = parseChangelog(text); } catch (error) { return [`${kitId}：CHANGELOG.md 的機器可讀資料無法解析：${(error as Error).message}`]; }
  if (!entries.length) return [`${kitId}：CHANGELOG.md 沒有任何紀錄`];
  entries.forEach((entry, i) => {
    const where = `${kitId} #${entry.seq}`;
    if (entry.seq !== i + 1) problems.push(`${where}：編號必須從 1 連續遞增`);
    if (!(entry.cause in CAUSES)) problems.push(`${where}：修改原因分類 ${entry.cause} 不在允許清單`);
    if ((entry.cause === 'initial') !== (i === 0)) problems.push(`${where}：只有第 1 筆可以也必須是 initial`);
    if (!entry.reason?.trim()) problems.push(`${where}：修改原因不可空白`);
    if (!entry.author?.trim()) problems.push(`${where}：作者不可空白`);
    if (!entry.source?.trim()) problems.push(`${where}：來源不可空白`);
    if (!DATE.test(entry.date ?? '')) problems.push(`${where}：日期格式必須是 YYYY-MM-DD`);
    if (!entry.nodes?.length && !entry.edges?.length) problems.push(`${where}：沒有任何節點或連線變更`);
  });
  if (problems.length) return problems;
  let steps: ReturnType<typeof replay>;
  try { steps = replay(entries); } catch (error) { return [`${kitId}：${(error as Error).message}`]; }
  const final = steps[steps.length - 1].after;
  if (graphSha(final) !== graphSha(workflow)) {
    const gap = diffGraphs(final, workflow);
    const names = [...gap.nodes.map(change => `${change.nodeName}（${change.nodeId}）`), ...gap.edges.map(edge => `連線 ${edge.from} → ${edge.to}`)];
    problems.push(`${kitId}：workflow.aov.json 與 CHANGELOG 最後一筆的結果不同，尚未記錄的變更：${names.join('、')}。請執行 node scripts/kit-changelog.mjs add ${kitId}`);
  }
  if (entries[entries.length - 1].kitVersion !== workflow.kitVersion) problems.push(`${kitId}：最後一筆的 Kit 版本（${entries[entries.length - 1].kitVersion}）與流程描述的 kitVersion（${workflow.kitVersion}）不同`);
  if (text.replace(/\r\n/g, '\n') !== renderChangelog(kitId, entries)) problems.push(`${kitId}：CHANGELOG.md 的文字與機器可讀資料不一致（被手改過？）請執行 node scripts/kit-changelog.mjs render ${kitId}`);
  return problems;
}
