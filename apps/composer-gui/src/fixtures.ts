import type { Definition, Kit, Option, Sources } from '../../../libs/ui-runtime/types';

function tableOptions(): Option[] {
  return ['name', 'status'].flatMap((field, index) => (
    ['label', 'visible', 'order', 'width'] as const
  ).map(property => ({
    id: `${field}-${property}`, displayName: `${field} ${property}`,
    type: property === 'visible' ? 'boolean' : property === 'label' ? 'text' : 'number',
    defaultValue: property === 'visible' ? true : property === 'label' ? field : property === 'order' ? index : 180,
    allowed_roles: ['User'], risk: 'low', change_level: 'A',
    target: { component_id: 'records', field, property },
    range: property === 'width' ? { minimum: 60, maximum: 600 } : property === 'order' ? { minimum: 0, maximum: 99 } : { maxLength: 100 },
  })));
}
const options: Option[] = [...tableOptions(), {
  id: 'filter-options', displayName: '篩選選項（每行一個值）', type: 'text', defaultValue: 'open\nclosed',
  allowed_roles: ['User'], risk: 'low', change_level: 'A', target: { component_id: 'filter', property: 'options' }, range: { maxLength: 1000 },
}, {
  id: 'filter-default', displayName: '篩選預設值', type: 'text', defaultValue: 'open',
  allowed_roles: ['User'], risk: 'low', change_level: 'A', target: { component_id: 'filter', property: 'defaultValue' }, range: { maxLength: 100 },
}];
export const kits: Kit[] = [
  { id: 'records-kit', version: '1.0.0', displayName: '紀錄 Kit', category: 'business', businessCapability: '模擬紀錄篩選', dependencies: [],
    subfeatures: [{ id: 'records', displayName: '紀錄畫面', businessCapability: '表格與篩選', defaultSelected: true, options }] },
  { id: 'entry-permission-kit', version: '1.0.0', displayName: '入口權限 Kit', category: 'permission', businessCapability: '入口權限能力說明（尚未串接身分驗證）', dependencies: [], subfeatures: [] },
  { id: 'platform-core-kit', version: '1.0.0', displayName: '平台基礎 Kit', category: 'infrastructure', businessCapability: '提供平台基礎設施；無獨立操作畫面', dependencies: [], subfeatures: [] },
];
export const definitions: Record<string, Definition> = {
  'records-kit': { schema_version: '1.0.0', kitId: 'records-kit', components: [
    { id: 'filter', subfeature_id: 'records', type: 'select', title: '狀態篩選', options: [{ value: 'open', displayName: 'open' }, { value: 'closed', displayName: 'closed' }], defaultValue: 'open', action: { type: 'filter', target_component_id: 'records', field: 'status' } },
    { id: 'records', subfeature_id: 'records', type: 'table', title: '模擬紀錄', source_ref: 'mock-records', columns: ['name', 'status'].map((field, order) => ({ field, label: field, visible: true, order, width: 180, renderer: 'text' })) },
  ] },
};
export const sources: Sources = { 'mock-records': { fields: ['name', 'status'], rows: [
  { name: 'Mock A', status: 'open' }, { name: 'Mock B', status: 'closed' },
] } };
