import type { AovBundle } from '../aov-integration';

type Graph = AovBundle['platform']['graphs'][number];

// Follow one edge per element; a node with no action cannot bridge a combination.
export function hasCombo(graph: Graph, combo: readonly string[], resolve: (id: string) => string): boolean {
  const nodes = new Map(graph.nodes.filter(n => n.kind === 'node' && n.actionId !== null)
    .map(n => [n.id, resolve(n.actionId!)]));
  let candidates = new Set([...nodes].filter(([, action]) => action === combo[0]).map(([id]) => id));
  for (let i = 1; i < combo.length && candidates.size; i++) {
    candidates = new Set(graph.edges.filter(edge => candidates.has(edge.from) && nodes.get(edge.to) === combo[i])
      .map(edge => edge.to));
  }
  return candidates.size > 0;
}
