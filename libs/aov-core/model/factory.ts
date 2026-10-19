/** 建立空白專案與預設節點（畫布「新增節點」使用） */
import { FORMAT_VERSION, type NodeCategory, type NodeDef, type ProjectFile, CATEGORY_LABEL } from './types';

export function emptyProject(name = '未命名專案'): ProjectFile {
  return {
    formatVersion: FORMAT_VERSION,
    meta: { id: `proj-${Date.now().toString(36)}`, name, version: 1, status: 'draft' },
    artifactTypes: [
      {
        id: 'lot.item',
        name: '物料批',
        extends: 'material',
        identity: 'lot',
        quantity: { dimension: 'count', baseUnit: 'pcs', conservation: 'strict' },
        attributes: {},
      },
    ],
    params: [],
    nodes: [],
    flows: [],
    layout: {},
    settings: { exceptionLocation: 'wh.exception', lineageMaxDepth: 10 },
  };
}

/** 依類別產生預設 port，讓新節點拖進來就接近可用 */
export function defaultNode(category: NodeCategory, id: string, materialType = 'material', infoType = 'info'): NodeDef {
  const name = CATEGORY_LABEL[category];
  const m = (pid: string, extra: object = {}) => ({ id: pid, type: materialType, ...extra });
  switch (category) {
    case 'source':
      return { id, name, category, inputs: [], outputs: [m('out')], boundary: { kind: 'warehouse', location: 'wh.raw' } };
    case 'sink':
      return { id, name, category, inputs: [m('in', { cardinality: '1..*' })], outputs: [], boundary: { kind: 'warehouse', location: 'wh.fg' } };
    case 'assemble':
      return { id, name, category, executor: 'manual', inputs: [m('a'), m('b')], outputs: [m('out')] };
    case 'split':
      return { id, name, category, executor: 'manual', inputs: [m('in')], outputs: [m('out', { cardinality: '1..*' })], params: { splitCount: 2 } };
    case 'move':
      return { id, name, category, executor: 'manual', inputs: [m('in')], outputs: [m('out')], params: { toLocation: 'line.1' } };
    case 'hold':
      return { id, name, category, executor: 'auto', inputs: [m('in')], outputs: [m('out')], params: { minDuration: '1h' } };
    case 'measure':
      return { id, name, category, executor: 'manual', inputs: [m('in')], outputs: [m('out'), { id: 'record', type: infoType, role: 'record' }] };
    case 'judge':
      return {
        id,
        name,
        category,
        executor: 'manual',
        inputs: [m('in')],
        outputs: [m('ok'), m('ng'), { id: 'record', type: infoType, role: 'record' }],
        route: [
          { when: 'true', port: 'ok' },
          { when: 'otherwise', port: 'ng' },
        ],
      };
    case 'merge':
      return { id, name, category, inputs: [m('in', { cardinality: '1..*' })], outputs: [m('out', { cardinality: '1..*' })] };
    case 'broadcast':
      return { id, name, category, inputs: [{ id: 'in', type: infoType }], outputs: [{ id: 'out', type: infoType }] };
    case 'subgraph':
      return { id, name, category, inputs: [m('in')], outputs: [m('out')], ref: '' };
    case 'transform':
    default:
      return { id, name, category, executor: 'manual', inputs: [m('in')], outputs: [m('out')] };
  }
}

export function nextId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  let i = 1;
  while (set.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

// ---------------------------------------------------------------- v0.2：業務動作

import type { ActionDef, ActionLibrary } from './types';

export interface ActionAnswers {
  /** 這是流程的起點嗎？ */
  isStart?: boolean;
  /** 這是流程的終點嗎？ */
  isEnd?: boolean;
  /** 結果會讓料走不同的路嗎？ */
  branches?: boolean;
  /** 會讓料變成別的東西嗎？ */
  change?: 'none' | 'merge' | 'split' | 'transform';
  /** 都不是時：只改位置／只經過時間／只記錄資料 */
  other?: 'move' | 'hold' | 'record';
}

/** 依問答推出原語（spec-v0.2 §1.5） */
export function behaviorFromAnswers(a: ActionAnswers): NodeCategory {
  if (a.isStart) return 'source';
  if (a.isEnd) return 'sink';
  if (a.branches) return 'judge';
  if (a.change === 'merge') return 'assemble';
  if (a.change === 'split') return 'split';
  if (a.change === 'transform') return 'transform';
  if (a.other === 'move') return 'move';
  if (a.other === 'hold') return 'hold';
  return 'measure';
}

/** 由動作建立預設 port（新增本地動作時使用） */
export function defaultAction(id: string, name: string, behavior: NodeCategory, materialType = 'material', infoType = 'info'): ActionDef {
  const n = defaultNode(behavior, id, materialType, infoType);
  return {
    id,
    name,
    glyph: name.slice(0, 1),
    behavior,
    executor: n.executor,
    inputs: n.inputs,
    outputs: n.outputs,
    route: n.route,
    boundary: n.boundary,
    params: n.params,
  };
}

/** 由動作在畫布上建立節點（只存引用，port 與邏輯由動作提供） */
export function nodeFromAction(action: ActionDef, id: string, name?: string): NodeDef {
  return { id, name: name ?? action.name, action: action.id, category: action.behavior, inputs: [], outputs: [] };
}

/** 把本地動作匯出成共用動作庫 */
export function exportLibrary(p: ProjectFile, id: string, name: string, version = 1): ActionLibrary {
  return {
    formatVersion: FORMAT_VERSION,
    kind: 'action-library',
    meta: { id, name, version, status: 'published' },
    artifactTypes: p.artifactTypes,
    forms: p.forms ?? [],
    rules: p.rules ?? [],
    actions: p.actions ?? [],
  };
}
