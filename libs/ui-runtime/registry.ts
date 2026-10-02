import { validateSchema } from './schema';

// Kit registry (D67): capability -> mService -> Function. Pure data checks, no I/O.
export interface Port { name: string; type: string }
export interface Capability {
  id: string; kind: 'api' | 'db' | 'model'; method?: string; path?: string;
  declared: boolean; implementedBy: { kitId: string; mService?: string } | null; verified: boolean; note?: string;
}
export interface Consume { capability: string; kind: 'api' | 'db' | 'model'; declared: boolean; evidence?: string }
export interface MService { id: string; name: string; responsibility: string; provides: string[]; inputs: Port[]; outputs: Port[]; functions: string[]; failure: string }
export interface RegistryFunction { id: string; primitive: string; input: Port[]; output: Port[]; failures: string[]; sideEffects: string[]; source: { path: string; symbol: string } }
export interface KitRegistry {
  format: 'composer-kit-registry'; version: 1; kitId: string; scope?: string;
  capabilities: Capability[]; consumes: Consume[]; mServices: MService[]; functions: RegistryFunction[];
}
export type ParamValue = string | number | boolean;
export interface ActionParameter { id: string; name: string; type: 'number' | 'text' | 'boolean'; required: boolean; default?: ParamValue; minimum?: number; maximum?: number }
// needs: what a node must have before it counts as complete (D73).
export interface ActionType {
  id: string; name: string; description: string; requires: string[];
  parameters: ActionParameter[]; needs: ('form' | 'relation')[]; requiresKits?: { kitId: string; reason: string }[];
}
export interface ActionCatalog { format: 'composer-action-catalog'; version: 1; actions: ActionType[] }

// error: the data contradicts itself. gap: the registry cannot prove something the contract or an action relies on.
// note: baseline contract and source differ; kept visible instead of corrected (D67).
export type IssueSeverity = 'error' | 'gap' | 'note';
export type IssueKind = 'duplicate-kit' | 'broken-reference' | 'chain-broken' | 'unresolved-provider' | 'unresolved-consume' | 'unverified' | 'undeclared' | 'multiple-declarers' | 'unknown-capability' | 'missing-provider' | 'kit-not-registered';
export interface RegistryIssue { severity: IssueSeverity; kind: IssueKind; kitId: string; subject: string; message: string }

export function parseRegistry(value: unknown): KitRegistry {
  validateSchema('kitRegistry', value);
  return value as KitRegistry;
}
export function parseActionCatalog(value: unknown): ActionCatalog {
  validateSchema('actionCatalog', value);
  const catalog = value as ActionCatalog;
  const seen = new Set<string>();
  for (const action of catalog.actions) {
    if (seen.has(action.id)) throw new Error(`actionCatalog: 動作識別碼重複：${action.id}`);
    seen.add(action.id);
    const ids = new Set<string>();
    for (const p of action.parameters) {
      const at = `動作「${action.id}」的參數「${p.id}」`;
      if (ids.has(p.id)) throw new Error(`actionCatalog: ${at}重複。`);
      ids.add(p.id);
      if (p.type !== 'number' && (p.minimum !== undefined || p.maximum !== undefined)) throw new Error(`actionCatalog: ${at}不是數值，不可設定最小值或最大值。`);
      if (p.minimum !== undefined && p.maximum !== undefined && p.minimum > p.maximum) throw new Error(`actionCatalog: ${at}的最小值大於最大值。`);
      if (p.default !== undefined && (typeof p.default !== (p.type === 'text' ? 'string' : p.type))) throw new Error(`actionCatalog: ${at}的預設值型別與參數不符。`);
      if (typeof p.default === 'number' && ((p.minimum !== undefined && p.default < p.minimum) || (p.maximum !== undefined && p.default > p.maximum))) throw new Error(`actionCatalog: ${at}的預設值超出範圍。`);
    }
  }
  return catalog;
}

const issue = (severity: IssueSeverity, kind: IssueKind, kitId: string, subject: string, message: string): RegistryIssue => ({ severity, kind, kitId, subject, message });

// D05: an mService is complete when its Functions can be chained in the listed order from its own inputs to its outputs.
function chainIssues(entry: KitRegistry, service: MService): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const available = new Map(service.inputs.map(p => [p.name, p.type]));
  for (const id of service.functions) {
    const fn = entry.functions.find(f => f.id === id);
    if (!fn) { issues.push(issue('error', 'broken-reference', entry.kitId, service.id, `mService「${service.id}」引用不存在的 Function「${id}」。`)); continue; }
    for (const port of fn.input) {
      const have = available.get(port.name);
      if (have === undefined) issues.push(issue('error', 'chain-broken', entry.kitId, service.id, `Function「${id}」需要輸入「${port.name}」，但 mService「${service.id}」的輸入與前面的 Function 都沒有提供。`));
      else if (have !== port.type) issues.push(issue('error', 'chain-broken', entry.kitId, service.id, `Function「${id}」的輸入「${port.name}」型別為 ${port.type}，但可用的型別是 ${have}。`));
    }
    for (const port of fn.output) available.set(port.name, port.type);
  }
  for (const port of service.outputs) {
    if (available.get(port.name) !== port.type) issues.push(issue('error', 'chain-broken', entry.kitId, service.id, `mService「${service.id}」宣告輸出「${port.name}」（${port.type}），但沒有任何 Function 產生。`));
  }
  return issues;
}

export function checkRegistry(entries: KitRegistry[]): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const byKit = new Map<string, KitRegistry>();
  for (const entry of entries) {
    if (byKit.has(entry.kitId)) issues.push(issue('error', 'duplicate-kit', entry.kitId, entry.kitId, `Kit「${entry.kitId}」登錄了不只一次。`));
    byKit.set(entry.kitId, entry);
  }
  const declarers = new Map<string, string[]>();
  for (const entry of entries) {
    for (const service of entry.mServices) {
      issues.push(...chainIssues(entry, service));
      for (const id of service.provides) {
        const cap = entry.capabilities.find(c => c.id === id);
        if (!cap || cap.implementedBy?.kitId !== entry.kitId || cap.implementedBy.mService !== service.id) {
          issues.push(issue('error', 'broken-reference', entry.kitId, service.id, `mService「${service.id}」宣稱提供「${id}」，但該 capability 未指向此 mService。`));
        }
      }
    }
    for (const cap of entry.capabilities) {
      if (cap.declared) declarers.set(cap.id, [...(declarers.get(cap.id) ?? []), entry.kitId]);
      else issues.push(issue('note', 'undeclared', entry.kitId, cap.id, `「${cap.id}」存在於實作但契約未宣告：${cap.note}`));
      if (!cap.verified) issues.push(issue('gap', 'unverified', entry.kitId, cap.id, `「${cap.id}」無法證實：${cap.note}`));
      if (!cap.implementedBy) continue;
      const target = byKit.get(cap.implementedBy.kitId);
      const service = target?.mServices.find(s => s.id === cap.implementedBy!.mService);
      if (!target) issues.push(issue('gap', 'unresolved-provider', entry.kitId, cap.id, `「${cap.id}」的實作在 Kit「${cap.implementedBy.kitId}」，該 Kit 尚未登錄。`));
      else if (cap.kind === 'model') continue; // data models are owned by a Kit, not realised by an mService
      else if (!service) issues.push(issue('error', 'broken-reference', entry.kitId, cap.id, `「${cap.id}」指向 Kit「${target.kitId}」不存在的 mService「${cap.implementedBy.mService}」。`));
      else if (!service.provides.includes(cap.id)) issues.push(issue('error', 'broken-reference', entry.kitId, cap.id, `「${cap.id}」指向的 mService「${service.id}」未列為提供者。`));
    }
  }
  for (const [id, kits] of declarers) {
    if (kits.length > 1) issues.push(issue('note', 'multiple-declarers', kits[0], id, `「${id}」同時由 ${kits.join('、')} 的契約宣告，實作只有一處。`));
  }
  // A consumed capability needs a verified implementation somewhere in the registry.
  for (const entry of entries) {
    for (const use of entry.consumes) {
      const provided = entries.some(e => e.capabilities.some(c => c.id === use.capability && c.implementedBy && c.verified));
      if (!provided) issues.push(issue('gap', 'unresolved-consume', entry.kitId, use.capability, `Kit「${entry.kitId}」使用「${use.capability}」，登錄資料中沒有任何已驗證的實作。`));
    }
  }
  return issues;
}

// Every capability an action asks for must be known to the registry; otherwise the action could never resolve.
export function checkActionCatalog(catalog: ActionCatalog, entries: KitRegistry[]): RegistryIssue[] {
  const known = new Set(entries.flatMap(e => e.capabilities.map(c => c.id)));
  return catalog.actions.flatMap(action => action.requires.filter(id => !known.has(id))
    .map(id => issue('error', 'unknown-capability', '-', action.id, `動作「${action.name}」需要的 capability「${id}」不在任何已登錄的 Kit 中。`)));
}
