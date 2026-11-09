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

  test('every step except the in-run stages maps to a distinct action by capability overlap', () => {
    const shared = workflow.nodes.filter(node => workflow.nodes.some(other => other !== node && other.capabilityIds.some(id => node.capabilityIds.includes(id))));
    const own = workflow.nodes.filter(node => !shared.includes(node) || node.id === 'start-run');
    const mapped = own.map(node => actions.filter(action => action.requires.some(id => node.capabilityIds.includes(id))).map(action => action.id));
    mapped.forEach((ids, index) => expect(ids, own[index].id).toHaveLength(1));
    expect(new Set(mapped.flat()).size).toBe(own.length);
  });
});
