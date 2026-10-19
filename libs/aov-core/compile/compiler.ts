/**
 * 編譯：Template（專案檔）→ 執行計畫。
 * 1. 驗證（無環、型別相符、可達）
 * 2. 拓撲排序，得到可並行的階段
 * 3. 每個節點產生一筆工單明細（輸入綁定在執行期決定）
 */
import type { ActionLibrary, Diagnostic, NodeCategory, ProjectFile } from '../model/types';
import { stagesOf, topoSort, validateProject } from '../validate/validator';

export interface PlanNode {
  nodeId: string;
  name: string;
  category: NodeCategory;
  stage: number;
  inputs: { port: string; flows: string[] }[];
  outputs: { port: string; flows: string[] }[];
}

export interface ExecutionPlan {
  templateId: string;
  templateVersion: number;
  order: string[];
  stages: string[][];
  nodes: PlanNode[];
}

export interface CompileResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  plan?: ExecutionPlan;
  /** 展開後的原語專案檔 */
  resolved?: ProjectFile;
}

export class CompileError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) {
    super(
      `專案檔驗證失敗：\n${diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => `- [${d.code}] ${d.message}`)
        .join('\n')}`,
    );
  }
}

export function compile(raw: ProjectFile, libraries: ActionLibrary[] = [], projects: ProjectFile[] = []): CompileResult {
  const v = validateProject(raw, { libraries, projects });
  if (!v.ok) return { ok: false, diagnostics: v.diagnostics, resolved: v.resolved };
  const p = v.resolved;
  const { order } = topoSort(p.nodes, p.flows);
  const stages = stagesOf(p.nodes, p.flows)!;
  const stageOf = new Map<string, number>();
  stages.forEach((s, i) => s.forEach((id) => stageOf.set(id, i)));
  const nodes: PlanNode[] = order!.map((id) => {
    const n = p.nodes.find((x) => x.id === id)!;
    return {
      nodeId: id,
      name: n.name,
      category: n.category,
      stage: stageOf.get(id)!,
      inputs: n.inputs.map((port) => ({
        port: port.id,
        flows: p.flows.filter((f) => f.to.node === id && f.to.port === port.id).map((f) => f.id),
      })),
      outputs: n.outputs.map((port) => ({
        port: port.id,
        flows: p.flows.filter((f) => f.from.node === id && f.from.port === port.id).map((f) => f.id),
      })),
    };
  });
  return {
    ok: true,
    diagnostics: v.diagnostics,
    resolved: p,
    plan: { templateId: p.meta.id, templateVersion: p.meta.version, order: order!, stages, nodes },
  };
}
