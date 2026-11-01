import { isUnit, unitDim, type Dimension } from '../aov-core';
import { FORM_ID_PATTERN, KEY_PATTERN } from './formLibrary';
import { checkRequirement, type FormRequirement } from './formRequirement';

// What the canvas does not say: which material flows through a node and how the node touches the outside world.
// Kept apart from the canvas document, keyed by canvas node id, so the canvas format does not change.
export const MATERIAL_DIMENSIONS = ['count', 'mass', 'volume', 'length', 'area'] as const satisfies readonly Dimension[];
export type MaterialDimension = (typeof MATERIAL_DIMENSIONS)[number];
export interface MaterialType {
  /** English identifier; the type id in the project is `lot.<key>`. */
  key: string;
  name: string;
  dimension: MaterialDimension;
  /** The unit this material is counted in; must belong to the dimension. */
  baseUnit: string;
}

export type SinkDirection = 'stock-in' | 'ship-customer' | 'ship-external';
export const SINK_DIRECTIONS: Record<SinkDirection, string> = { 'stock-in': '入庫', 'ship-customer': '出庫（給客戶）', 'ship-external': '出庫（到外部）' };
export type NodeBehavior =
  /** 領料: material enters the flow from a warehouse, which is the flow's boundary. */
  | { kind: 'pick'; location: string; material: string }
  /** 入庫 / 出庫: material leaves the flow; the direction says to where. */
  | { kind: 'sink'; direction: SinkDirection | ''; location: string; material: string }
  /** 填單: material passes through while a form is filled in (e.g. the stock-in slip before stocking in). Aov-core ends cannot carry a form, so this is its own step. */
  | { kind: 'fill'; material: string; form: string; requires: FormRequirement };
// '' (direction, and the empty location or material of a node being filled in) is a form not yet complete:
// checkProjectDetails reports it, and nothing converts a project while it is reported.

export interface ProjectDetails { format: 'composer-project-details'; version: 1; materials: MaterialType[]; nodes: Record<string, NodeBehavior> }
export interface DetailIssue { code: string; message: string; nodeId?: string; field?: string }

export const emptyProjectDetails: ProjectDetails = { format: 'composer-project-details', version: 1, materials: [], nodes: {} };
export const materialTypeId = (key: string) => `lot.${key}`;

// A location is an address in plans and orders, not prose; ASCII for the same reason field keys are (contract 5, no normalization).
export const LOCATION_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function checkMaterial(raw: unknown, index: number): DetailIssue[] {
  if (!isObject(raw)) return [{ code: 'material-shape', message: `第 ${index + 1} 個物料型別必須是一個物件。` }];
  const label = isText(raw.name) ? `物料型別「${raw.name}」` : `第 ${index + 1} 個物料型別`;
  const issues: DetailIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message: `${label}${message}` });
  if (typeof raw.key !== 'string' || !KEY_PATTERN.test(raw.key)) add('material-key', '的識別碼只能用英文字母、數字與底線，且不可以數字開頭。');
  if (!isText(raw.name)) add('material-name', '沒有名稱。');
  if (!MATERIAL_DIMENSIONS.includes(raw.dimension as MaterialDimension)) { add('material-dimension', '的量綱不明。'); return issues; }
  if (typeof raw.baseUnit !== 'string' || !isUnit(raw.baseUnit)) add('material-unit', `的單位「${String(raw.baseUnit)}」不是已知的單位。`);
  else if (unitDim(raw.baseUnit) !== raw.dimension) add('material-unit', `的單位「${raw.baseUnit}」與所選的量綱不符。`);
  return issues;
}

function checkBehavior(nodeId: string, raw: unknown, materials: Set<string>): DetailIssue[] {
  if (!isObject(raw)) return [{ code: 'behavior-shape', message: `節點「${nodeId}」的物料流設定必須是一個物件。`, nodeId }];
  const issues: DetailIssue[] = [];
  const add = (code: string, message: string, field?: string) => issues.push({ code, message: `節點「${nodeId}」${message}`, nodeId, field });
  if (raw.kind !== 'pick' && raw.kind !== 'sink' && raw.kind !== 'fill') return [{ code: 'behavior-kind', message: `節點「${nodeId}」的物料流類別不明。`, nodeId }];
  if (raw.kind === 'sink' && !(typeof raw.direction === 'string' && Object.hasOwn(SINK_DIRECTIONS, raw.direction))) add('behavior-direction', '尚未選擇入庫或出庫的方向。', 'direction');
  if (raw.kind !== 'fill' && (typeof raw.location !== 'string' || !LOCATION_PATTERN.test(raw.location))) add('behavior-location', '的倉位代碼只能用英文字母開頭，含英文、數字、底線、句點與連字號。', 'location');
  if (typeof raw.material !== 'string' || !materials.has(raw.material)) add('behavior-material', '選擇的物料型別不存在。', 'material');
  if (raw.kind === 'fill') {
    if (typeof raw.form !== 'string' || !FORM_ID_PATTERN.test(raw.form)) add('behavior-form', '尚未選擇要填的表單。', 'form');
    issues.push(...checkRequirement(raw.requires, { nodeId }).map(i => ({ code: i.code, message: i.message, nodeId, field: i.field })));
  }
  return issues;
}

export function checkProjectDetails(raw: unknown): DetailIssue[] {
  if (!isObject(raw)) return [{ code: 'details-shape', message: '專案細項檔必須是一個物件。' }];
  if (raw.format !== 'composer-project-details') return [{ code: 'details-format', message: '這不是專案細項檔。' }];
  if (raw.version !== 1) return [{ code: 'details-version', message: `不支援的專案細項檔版本：${String(raw.version)}。` }];
  if (!Array.isArray(raw.materials) || !isObject(raw.nodes)) return [{ code: 'details-shape', message: '專案細項檔缺少物料型別或節點的清單。' }];
  const issues = raw.materials.flatMap(checkMaterial);
  const keys = new Set<string>();
  for (const material of raw.materials) {
    const key = isObject(material) ? material.key : undefined;
    if (typeof key !== 'string') continue;
    if (keys.has(key)) issues.push({ code: 'material-duplicate', message: `物料型別識別碼「${key}」重複，無法決定使用哪一個。` });
    keys.add(key);
  }
  for (const [nodeId, behavior] of Object.entries(raw.nodes)) issues.push(...checkBehavior(nodeId, behavior, keys));
  return issues;
}
