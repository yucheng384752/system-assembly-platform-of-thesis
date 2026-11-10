import { canvasWithLayout } from './kitExamples';
import { exportAovGraphDraft, type AovGraphDocument } from './workflowGraph';

interface Edge { from: string; to: string }
export interface OriginalFlow {
  factory: string;
  source: Record<string, string>;
  logics: { id: string; name: string; nodes: {
    id: string; name: string; function: string; file: string; defLine: number | null; kitNodes: string[];
  }[]; edges: Edge[] }[];
  observations: { id: string; text: string; evidence: string }[];
}
export interface CaseKit { nodes: { id: string; name: string }[]; edges: Edge[] }

export function compareThesisCase(original: OriginalFlow, kit: CaseKit) {
  const mappings = original.logics.flatMap(logic => logic.nodes.map(node => ({ logicId: logic.id, ...node })));
  for (const node of mappings) for (const id of node.kitNodes) {
    if (!kit.nodes.some(node => node.id === id)) throw new Error(`${node.id}: Kit 節點 ${id} 不存在`);
  }
  for (const graph of [...original.logics, kit]) for (const edge of graph.edges) {
    if (![edge.from, edge.to].every(id => graph.nodes.some(node => node.id === id))) throw new Error(`連線引用不存在的節點：${edge.from} → ${edge.to}`);
  }
  const reachable = (from: string, to: string): boolean => {
    const seen = new Set<string>(), pending = [from];
    while (pending.length) {
      const id = pending.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...kit.edges.filter(edge => edge.from === id).map(edge => edge.to));
    }
    return false;
  };
  const orderDifferences = original.logics.flatMap(logic => logic.edges.flatMap(edge => {
    const a = logic.nodes.find(node => node.id === edge.from)!;
    const b = logic.nodes.find(node => node.id === edge.to)!;
    return [...new Set(a.kitNodes)].flatMap(ka => [...new Set(b.kitNodes)]
      .filter(kb => ka !== kb && reachable(kb, ka))
      .map(kb => ({ logicId: logic.id, ...edge, kitFrom: ka, kitTo: kb })));
  }));
  const granularity = kit.nodes.map(node => {
    const mapped = mappings.filter(before => before.kitNodes.includes(node.id));
    return { ...node, nodeCount: mapped.length, functionCount: new Set(mapped.map(node => node.function)).size };
  });
  return {
    before: original.logics.map(logic => ({ id: logic.id, name: logic.name, nodes: logic.nodes.length, edges: logic.edges.length,
      functions: new Set(logic.nodes.map(node => node.function)).size })),
    totalNodes: mappings.length, uniqueFunctions: new Set(mappings.map(node => node.function)).size,
    after: { nodes: kit.nodes.length, edges: kit.edges.length }, mappings, granularity,
    unmappedKit: granularity.filter(node => !node.nodeCount).map(node => node.id),
    unmappedOriginal: mappings.filter(node => !node.kitNodes.length).map(node => node.id), orderDifferences,
  };
}

export function originalToCanvas(original: OriginalFlow): AovGraphDocument {
  const parts = original.logics.map(logic => canvasWithLayout(logic.id, logic.name,
    logic.nodes.map(node => ({ id: node.id, name: node.name, kind: 'node', when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null })), logic.edges));
  if (!parts.length) throw new Error('來源沒有生產邏輯。');
  const value = parts[0];
  value.factories[0] = { ...value.factories[0], name: original.factory, logicGraphIds: original.logics.map(logic => logic.id) };
  value.graphs = parts.flatMap(part => part.graphs.map(graph => ({ ...graph,
    edges: graph.edges.map(edge => ({ ...edge, id: `${graph.id}-${edge.id}` })) })));
  value.layout = Object.assign({}, ...parts.map(part => part.layout));
  exportAovGraphDraft(value);
  return value;
}

export function renderThesisComparison(original: OriginalFlow, kit: CaseKit): string {
  const result = compareThesisCase(original, kit);
  const cell = (value: string | number) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const table = (headers: string[], rows: (string | number)[][]) => [headers, headers.map(() => '---'), ...rows]
    .map(row => `| ${row.map(cell).join(' | ')} |`).join('\n');
  return [
    '# Analytical-Four 使用前後結構比較',
    '節點粒度不同：使用前是函式呼叫，使用後 Kit 的分析階段把多個函式合成一個節點。對應關係是人工判斷，節點數差異不代表效能或操作時間差異。',
    '## 結構統計',
    '使用前的統計只計函式節點及其連線；畫布另有開始、結束節點及邊界連線。',
    table(['使用前邏輯', '節點數', '連線數', '不重複函式數'], result.before.map(row => [row.name, row.nodes, row.edges, row.functions])),
    `使用前節點合計：${result.totalNodes}；跨邏輯不重複函式：${result.uniqueFunctions}。`,
    table(['使用後', '節點數', '連線數'], [['Kit', result.after.nodes, result.after.edges]]),
    '## 節點對應',
    table(['邏輯', '使用前節點', '名稱', '函式', '來源檔案', '定義行', 'Kit 節點'], result.mappings.map(node => [node.logicId, node.id, node.name, node.function, node.file, node.defLine ?? '未提供', node.kitNodes.join('、') || '無'])),
    '## 粒度比',
    table(['Kit 節點', '名稱', '對應的使用前節點數', '不重複函式數'], result.granularity.map(node => [node.id, node.name, node.nodeCount, node.functionCount])),
    '## 沒有對應的節點',
    table(['分類', '節點'], [['Kit 新增的環節', result.unmappedKit.join('、') || '無'], ['使用前沒有對應', result.unmappedOriginal.join('、') || '無']]),
    '## 順序差異',
    '只檢查使用前相鄰邊；當對應的兩個 Kit 節點不同，且 Kit 可從後者到達前者時列出。',
    table(['邏輯', '使用前相鄰邊', 'Kit 反向可達'], result.orderDifferences.map(edge => [edge.logicId, `${edge.from} → ${edge.to}`, `${edge.kitTo} → ${edge.kitFrom}`])),
    '## 原專案觀察',
    table(['編號', '觀察', '依據'], original.observations.map(item => [item.id, item.text, item.evidence])),
    '## 來源',
    table(['項目', '內容'], Object.entries(original.source)),
    '本文件與 analytical-four-before.aov.json 由 thesisAovCase.test.ts 產生。更新：在專案根目錄以 THESIS_CASE_UPDATE=1 執行 npx vitest run --configLoader native thesisAovCase.test.ts；一般 npm test 會檢查兩個產生檔是否過期。',
  ].join('\n\n') + '\n';
}
