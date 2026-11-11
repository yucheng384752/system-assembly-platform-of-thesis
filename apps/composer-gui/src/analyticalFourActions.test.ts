import { describe, expect, test } from 'vitest';
import { kits } from './catalog';
import { parseKitWorkflow, workflowFiles } from './kitWorkflows';
import { actionCatalog } from './workflow';
import { registry } from './registryData';

// D199: the training data for the AoV small model needs analytical-four steps that map to actions,
// and a capability no action covers would silently stay a business node.
const kitId = 'analytical-four-kit';
const kit = kits.find(item => item.id === kitId)!;
const workflow = parseKitWorkflow(workflowFiles[`kits/${kitId}/workflow.aov.json`], kit);
const actions = actionCatalog.actions.filter(action => action.requires.some(id => id.startsWith('analytical-four.')));

describe('analytical-four actions (D199)', () => {
  test('every registered capability is required by exactly one action', () => {
    for (const capability of registry.find(entry => entry.kitId === kitId)!.capabilities) {
      expect(actions.filter(action => action.requires.includes(capability.id)).map(action => action.id), capability.id).toHaveLength(1);
    }
  });

  test('each step with its own capabilities maps to a distinct action, the in-run stages map to none', () => {
    const actionsOf = (node: { capabilityIds: string[] }) => actions.filter(action => action.requires.some(id => node.capabilityIds.includes(id))).map(action => action.id);
    const own = workflow.nodes.filter(node => node.capabilityIds.length);
    own.forEach(node => expect(actionsOf(node), node.id).toHaveLength(1));
    expect(new Set(own.flatMap(actionsOf)).size).toBe(own.length);
    expect(workflow.nodes.filter(node => !node.capabilityIds.length)).toHaveLength(10);
  });
});
