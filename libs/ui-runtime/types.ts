export type Value = string | number | boolean;
export interface Option {
  id: string; displayName: string; type: 'text' | 'number' | 'boolean' | 'select';
  defaultValue: Value; allowed_roles: ('User' | 'MIS' | 'Developer')[];
  risk: 'low' | 'medium' | 'high' | 'critical'; change_level: 'A' | 'B' | 'C';
  target: { component_id: string; property: 'label' | 'visible' | 'order' | 'width' | 'options' | 'defaultValue'; field?: string };
  range?: { minimum?: number; maximum?: number; maxLength?: number };
  choices?: { value: string; displayName: string }[];
}
export interface Kit {
  id: string; version: string; displayName: string; category: string;
  businessCapability: string; dependencies: string[];
  subfeatures: { id: string; displayName: string; businessCapability: string; defaultSelected: boolean; options: Option[] }[];
}
export interface Column { field: string; label: string; visible: boolean; order: number; width: number; renderer: 'text' }
interface Component { id: string; subfeature_id: string; title: string }
export interface Table extends Component { type: 'table'; source_ref: string; columns: Column[] }
export interface Select extends Component {
  type: 'select'; options: { value: string; displayName: string }[]; defaultValue: string;
  action: { type: 'filter'; target_component_id: string; field: string };
}
export interface Definition { schema_version: '1.0.0'; kitId: string; components: (Table | Select)[] }
export type Overrides = Record<string, Record<string, Value>>;
export type Versions = Record<string, { kitVersion: string; schema_version: string }>;
export interface Recipe {
  recipeVersion: string; name: string; sourceManifest: string; database: { engine: 'sqlite' | 'postgresql' | 'mysql' };
  enabledKits: string[]; selectedSubfeatures: Record<string, string[]>;
  selectedSubfeatureOptions: Overrides; uiOverrides: Versions;
}
export type Sources = Record<string, { fields: string[]; rows: Record<string, string | number>[] }>;
