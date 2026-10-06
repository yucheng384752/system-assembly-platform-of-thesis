import { parseRegistry } from '../../../libs/ui-runtime/registry';

const entries = import.meta.glob('../../../config/registry/*.json', { eager: true, import: 'default' });
export const registry = Object.values(entries).map(parseRegistry);
