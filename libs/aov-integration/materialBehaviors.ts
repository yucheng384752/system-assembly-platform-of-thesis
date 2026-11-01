import type { BoundaryDef, NodeCategory, PortDef } from '../aov-core';
import { materialTypeId, SINK_DIRECTIONS, type NodeBehavior, type SinkDirection } from './projectDetails';

// What a business setting becomes in aov-core terms. Pick is the flow's source and a stock-in or ship-out is its sink;
// the three ship/stock directions are one category that differ only in what lies beyond the boundary.
export const SINK_BOUNDARY: Record<SinkDirection, BoundaryDef['kind']> = {
  'stock-in': 'warehouse', 'ship-customer': 'customer', 'ship-external': 'external',
};

export interface NodeShape { category: Extract<NodeCategory, 'source' | 'sink'>; boundary: BoundaryDef; inputs: PortDef[]; outputs: PortDef[] }

export const PICK_OUT_PORT = 'out';
export const SINK_IN_PORT = 'in';

export function shapeOf(behavior: NodeBehavior): NodeShape {
  const type = materialTypeId(behavior.material);
  if (behavior.kind === 'pick') {
    return { category: 'source', boundary: { kind: 'warehouse', location: behavior.location }, inputs: [], outputs: [{ id: PICK_OUT_PORT, type, role: 'main' }] };
  }
  if (behavior.direction === '') throw new Error('shapeOf needs a checked behavior: the stock-in or ship-out direction is not chosen');
  return { category: 'sink', boundary: { kind: SINK_BOUNDARY[behavior.direction], location: behavior.location }, inputs: [{ id: SINK_IN_PORT, type }], outputs: [] };
}

export function behaviorLabel(behavior: NodeBehavior): string {
  if (behavior.kind === 'pick') return '領料';
  return behavior.direction === '' ? '入庫或出庫' : SINK_DIRECTIONS[behavior.direction];
}
