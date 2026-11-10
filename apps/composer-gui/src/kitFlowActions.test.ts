import { describe, expect, test } from 'vitest';
import { deriveKits } from '../../../libs/ui-runtime/actions';
import { kits } from './catalog';
import { parseKitWorkflow, workflowFiles } from './kitWorkflows';
import { actionCatalog } from './workflow';
import { registry } from './registryData';

// D203: an action exists for every verified API capability a Kit flow uses. Internal data functions (kind db, model)
// are not tools a user can place on the canvas, so a step that only uses them must stay without an action
// (the refusal class of the AoV small model), and must not be mapped by accident.
describe('Kit flows and the action catalog (D203)', () => {
  test.each(Object.keys(workflowFiles))('%s', path => {
    const kitId = path.split('/')[1];
    const capabilities = registry.find(entry => entry.kitId === kitId)!.capabilities;
    const workflow = parseKitWorkflow(workflowFiles[path], kits.find(item => item.id === kitId)!);
    for (const node of workflow.nodes) {
      const userFacing = node.capabilityIds.filter(id => { const c = capabilities.find(item => item.id === id)!; return c.kind === 'api' && c.verified; });
      for (const id of userFacing) {
        expect(actionCatalog.actions.some(action => action.requires.includes(id)), `${kitId}/${node.id}: ${id}`).toBe(true);
      }
      if (!userFacing.length) {
        const mapped = actionCatalog.actions.filter(action => action.requires.some(id => node.capabilityIds.includes(id)));
        expect(mapped.map(action => action.id), `${kitId}/${node.id} has no user-facing capability`).toEqual([]);
      }
    }
  });
});

// D203: the system layer under the actions. Each new action must pull in the Kit that implements it, with no
// ambiguity, and may only carry the known tenant gap (D94), listed per Kit so a new gap fails here.
const own = (kitId: string, ids: string[]): [string, string[], string[]][] => ids.map(id => [id, [kitId], []]);
const tables = ['generic-forms-kit', 'platform-core-kit', 'station-data-link-kit'];
const tableGaps = ['generic-forms-kit', 'station-data-link-kit'];
const derived: [string, string[], string[]][] = [
  ...own('analytical-four-kit', ['load-analysis-demo', 'get-analysis-templates', 'upload-analysis-files', 'decide-analysis-upload', 'configure-analysis',
    'check-analysis-ready', 'check-analysis-data', 'start-analysis-run', 'view-analysis-runs', 'get-analysis-results', 'submit-analysis-feedback',
    'decide-analysis-feedback', 'publish-case-library']),
  ...own('entry-permission-kit', ['sign-in', 'manage-own-account', 'view-entry-points', 'manage-roles', 'set-role-grants', 'manage-users', 'reset-user-password', 'set-user-overrides']),
  ...own('factory-core-kit', ['receive-production-plan', 'browse-production-plans', 'manage-plan-forms', 'propose-param-change', 'view-param-versions', 'decide-param-change',
    'create-work-order', 'start-work-order', 'view-work-order', 'raise-alarm', 'browse-alarms', 'acknowledge-alarm', 'collect-alarm-reminders']),
  ['browse-form-links', tables, tableGaps],
  ['create-import-from-upload', [...tables, 'import-pipeline-kit'], tableGaps],
  ['cancel-import-job', [...tables, 'import-pipeline-kit'], tableGaps],
  ['receive-subscription-notice', ['mod-subscription-kit'], ['mod-subscription-kit']],
];

describe('Derived Kits of the added actions (D203)', () => {
  test.each(derived)('%s', (id, kitIds, gapKits) => {
    const result = deriveKits([id], actionCatalog, registry);
    expect(result.kits.map(k => k.kitId).sort()).toEqual([...kitIds].sort());
    expect(result.kits.every(k => k.registered)).toBe(true);
    expect(result.ambiguities).toEqual([]);
    expect(result.gaps.map(g => `${g.kind}|${g.kitId}|${g.subject}`).sort()).toEqual(gapKits.map(k => `unresolved-consume|${k}|db.tenants.read`).sort());
  });
});
