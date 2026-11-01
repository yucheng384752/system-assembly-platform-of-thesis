import { compile, type ArtifactType, type Flow, type NodeDef, type ProjectFile, type ProjectMeta } from '../aov-core';
import type { AovGraphDocument, Graph, GraphNode } from '../../apps/composer-gui/src/workflowGraph';
import { behaviorLabel, PICK_OUT_PORT, shapeOf, SINK_IN_PORT } from './materialBehaviors';
import { checkProjectDetails, materialTypeId, type ProjectDetails } from './projectDetails';

// Turns one production logic of the canvas (its top layer) into an aov-core project. The canvas says only who follows whom;
// the material flow comes from the project details, so a node without a setting is reported, never guessed.
export interface ConvertIssue { message: string; nodeId?: string; edgeId?: string }
export interface ConvertInput {
  doc: AovGraphDocument;
  factoryId: string;
  graphId: string;
  details: ProjectDetails;
  meta: ProjectMeta;
}
export type ConvertResult = { ok: true; project: ProjectFile } | { ok: false; issues: ConvertIssue[] };

const shown = (node: GraphNode) => `節點「${node.name.trim() || '（未命名節點）'}」`;

export function convertCanvas(input: ConvertInput): ConvertResult {
  const { doc, factoryId, graphId, details, meta } = input;
  const factory = doc.factories.find(f => f.id === factoryId);
  const graph: Graph | undefined = factory?.logicGraphIds.includes(graphId) ? doc.graphs.find(g => g.id === graphId) : undefined;
  if (!graph) return { ok: false, issues: [{ message: '找不到要轉換的生產邏輯。' }] };

  const issues: ConvertIssue[] = checkProjectDetails(details).map(i => ({ message: i.message, nodeId: i.nodeId }));
  if (issues.length) return { ok: false, issues };

  const real = graph.nodes.filter(n => n.kind === 'node'); // start and end are canvas decoration, not material flow
  if (!real.length) return { ok: false, issues: [{ message: '這個生產邏輯還沒有任何節點。' }] };

  const nodes: NodeDef[] = [];
  const kept = new Map<string, GraphNode>();
  for (const node of real) {
    const behavior = details.nodes[node.id];
    if (!behavior) { issues.push({ message: `${shown(node)}還沒有設定物料流類別（領料、入庫或出庫）。`, nodeId: node.id }); continue; }
    const shape = shapeOf(behavior);
    nodes.push({ id: node.id, name: node.name.trim() || node.id, category: shape.category, inputs: shape.inputs, outputs: shape.outputs, boundary: shape.boundary });
    kept.set(node.id, node);
  }

  const flows: Flow[] = [];
  for (const edge of graph.edges) {
    const ends = [edge.from, edge.to].map(id => graph.nodes.find(n => n.id === id));
    if (ends.some(n => n?.kind !== 'node')) continue; // a line to the start or end is not material flow
    const from = kept.get(edge.from), to = kept.get(edge.to);
    if (!from || !to) continue; // an end without a setting was reported above
    if (details.nodes[from.id].kind === 'sink') { issues.push({ message: `${shown(from)}是${behaviorLabel(details.nodes[from.id])}，之後不能再接其他節點。`, nodeId: from.id, edgeId: edge.id }); continue; }
    if (details.nodes[to.id].kind === 'pick') { issues.push({ message: `${shown(to)}是領料，是流程的起點，不能接在其他節點之後。`, nodeId: to.id, edgeId: edge.id }); continue; }
    flows.push({ id: edge.id, from: { node: from.id, port: PICK_OUT_PORT }, to: { node: to.id, port: SINK_IN_PORT } });
  }
  if (issues.length) return { ok: false, issues };

  const used = new Set(Object.values(details.nodes).map(b => b.material));
  const artifactTypes: ArtifactType[] = details.materials.filter(m => used.has(m.key)).map(m => ({
    id: materialTypeId(m.key), name: m.name, extends: 'material', quantity: { dimension: m.dimension, baseUnit: m.baseUnit },
  }));
  const project: ProjectFile = { formatVersion: 1, meta, artifactTypes, nodes, flows };

  const compiled = compile(project);
  const errors = compiled.diagnostics.filter(d => d.severity === 'error');
  if (errors.length) return { ok: false, issues: errors.map(d => ({ message: d.message, nodeId: d.nodeId, edgeId: d.flowId })) };
  return { ok: true, project };
}
