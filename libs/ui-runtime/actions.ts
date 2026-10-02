import type { ActionCatalog, KitRegistry, RegistryIssue } from './registry';

// Workflow actions -> Kits (D62, D69). Deterministic and side-effect free: the same input always gives the same selection,
// and nothing is silently dropped. What cannot be decided is reported as an ambiguity or a gap.
export type SelectionReason =
  | { kind: 'action-capability'; actionId: string; capability: string }
  | { kind: 'action-kit'; actionId: string; reason: string }
  | { kind: 'dependency'; fromKit: string; capability: string; declared: boolean };
export interface KitSelection { kitId: string; registered: boolean; reasons: SelectionReason[] }
export interface Implementer { kitId: string; mService?: string }
// More than one distinct implementer: never picked automatically, the user decides.
export interface Ambiguity { capability: string; neededBy: { actionId: string } | { kitId: string }; candidates: Implementer[] }
export interface Derivation { kits: KitSelection[]; ambiguities: Ambiguity[]; gaps: RegistryIssue[] }

// Only verified implementations count; a contract declaration alone proves nothing (D67).
function implementers(capability: string, entries: KitRegistry[]): Implementer[] {
  const found = new Map<string, Implementer>();
  for (const entry of entries) for (const cap of entry.capabilities) {
    if (cap.id !== capability || !cap.implementedBy || !cap.verified) continue;
    found.set(`${cap.implementedBy.kitId}/${cap.implementedBy.mService ?? ''}`, cap.implementedBy);
  }
  return [...found.values()];
}

export function deriveKits(actionIds: string[], catalog: ActionCatalog, entries: KitRegistry[]): Derivation {
  const byKit = new Map(entries.map(entry => [entry.kitId, entry]));
  const selected = new Map<string, KitSelection>();
  const queue: string[] = [];
  const ambiguities: Ambiguity[] = [];
  const gaps = new Map<string, RegistryIssue>();
  const gap = (kind: RegistryIssue['kind'], kitId: string, subject: string, message: string) => {
    gaps.set(`${kind}|${kitId}|${subject}`, { severity: 'gap', kind, kitId, subject, message });
  };
  const add = (kitId: string, reason: SelectionReason) => {
    const current = selected.get(kitId);
    if (current) { current.reasons.push(reason); return; }
    selected.set(kitId, { kitId, registered: byKit.has(kitId), reasons: [reason] });
    queue.push(kitId);
    if (!byKit.has(kitId)) gap('kit-not-registered', kitId, kitId, `Kit「${kitId}」尚未登錄，無法檢查它的相依與完整性。`);
  };

  for (const id of new Set(actionIds)) {
    const action = catalog.actions.find(a => a.id === id);
    if (!action) throw new Error(`未知的動作：${id}`);
    for (const capability of action.requires) {
      const found = implementers(capability, entries);
      if (found.length === 1) add(found[0].kitId, { kind: 'action-capability', actionId: id, capability });
      else if (found.length > 1) ambiguities.push({ capability, neededBy: { actionId: id }, candidates: found });
      else {
        const known = entries.flatMap(e => e.capabilities).find(c => c.id === capability);
        gap('missing-provider', '-', `${id}:${capability}`, `動作「${action.name}」需要「${capability}」，${known ? `但它無法證實：${known.note}` : '但登錄資料中沒有這個 capability。'}`);
      }
    }
    for (const required of action.requiresKits ?? []) add(required.kitId, { kind: 'action-kit', actionId: id, reason: required.reason });
  }

  // Follow what each selected Kit consumes, including source-level dependencies its contract never declared.
  for (let i = 0; i < queue.length; i++) {
    const entry = byKit.get(queue[i]);
    if (!entry) continue;
    for (const use of entry.consumes) {
      const found = implementers(use.capability, entries);
      if (found.length === 1) { if (found[0].kitId !== entry.kitId) add(found[0].kitId, { kind: 'dependency', fromKit: entry.kitId, capability: use.capability, declared: use.declared }); }
      else if (found.length > 1) ambiguities.push({ capability: use.capability, neededBy: { kitId: entry.kitId }, candidates: found });
      else gap('unresolved-consume', entry.kitId, use.capability, `Kit「${entry.kitId}」使用「${use.capability}」，登錄資料中沒有任何已驗證的實作。`);
    }
  }
  return { kits: [...selected.values()].sort((a, b) => a.kitId.localeCompare(b.kitId)), ambiguities, gaps: [...gaps.values()] };
}
