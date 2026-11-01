import type { AovGraphDocument } from '../../apps/composer-gui/src/workflowGraph';
import { convertCanvas } from './canvasToProject';
import { buildExecutablePlan, type CapabilityMap, type PlanBuildError } from './executablePlan';
import { makeFormBundle } from './formBundle';
import type { ProjectDetails } from './projectDetails';

// Publishing preparation: one production logic of the canvas becomes a plan file and the form bundle the plan names.
// Nothing is sent anywhere; the engineer takes the files to the factory.
export interface PrepInput {
  doc: AovGraphDocument;
  factoryId: string;
  graphId: string;
  details: ProjectDetails;
  /** English identifier of the project the plan is built from. */
  projectId: string;
  projectName: string;
  version: number;
  mapping?: CapabilityMap;
}
export interface PrepIssue { message: string; nodeId?: string }
export interface PrepFile { name: string; text: string }
export interface PrepSummary { nodes: number; notExecutable: { nodeId: string; name: string; reason: string }[]; forms: number }
export type PrepResult =
  | { ok: true; planId: string; summary: PrepSummary; plan: PrepFile; forms?: PrepFile }
  | { ok: false; issues: PrepIssue[] };

// No Kit function is mapped to pick, stock-in or ship-out yet: an empty map keeps every node visible and marks it not executable.
export const noCapabilities: CapabilityMap = { format: 'composer-action-capability-map', version: 1, entries: [] };

const fromBuild = (e: PlanBuildError): PrepIssue => ({ message: e.message, nodeId: e.nodeId });

export async function preparePlan(input: PrepInput): Promise<PrepResult> {
  const { doc, factoryId, graphId, details, projectId, projectName, version } = input;
  if (!Number.isInteger(version) || version < 1) return { ok: false, issues: [{ message: '版本必須是 1 以上的整數。' }] };
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(projectId)) return { ok: false, issues: [{ message: '專案識別碼只能用英文字母、數字、底線與連字號，且必須以英文字母開頭。' }] };
  if (!projectName.trim()) return { ok: false, issues: [{ message: '請填寫專案名稱。' }] };

  const converted = convertCanvas({ doc, factoryId, graphId, details, meta: { id: projectId, name: projectName.trim(), version, status: 'published' } });
  if (!converted.ok) return { ok: false, issues: converted.issues.map(i => ({ message: i.message, nodeId: i.nodeId })) };

  const built = await buildExecutablePlan({ project: converted.project, mapping: input.mapping ?? noCapabilities, scope: { factoryId, graphId } });
  if (!built.ok) return { ok: false, issues: built.errors.map(fromBuild) };

  const plan = built.plan as { planId: string; nodes: { nodeId: string; name: string; executable: boolean; reason?: string }[] };
  const stem = `${projectId}-v${version}-${plan.planId.slice(0, 12)}`;
  return {
    ok: true,
    planId: plan.planId,
    summary: {
      nodes: plan.nodes.length,
      notExecutable: plan.nodes.filter(n => !n.executable).map(n => ({ nodeId: n.nodeId, name: n.name, reason: n.reason ?? '' })),
      forms: built.forms.length,
    },
    plan: { name: `${stem}.plan.json`, text: JSON.stringify(built.plan, null, 2) + '\n' },
    forms: built.forms.length ? { name: `${stem}.forms.json`, text: JSON.stringify(makeFormBundle(built.forms), null, 2) + '\n' } : undefined,
  };
}
