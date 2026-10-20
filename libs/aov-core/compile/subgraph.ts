/**
 * 子流程：編譯期展開（B-01）。
 * - 引用格式 `<projectId>@<version>`，只允許已發佈（published）版本。
 * - 對外介面 = 子專案「未連線的輸入 port」（匯流節點的輸入一律開放）與「未連線的輸出 port」，port id 為 `<內部節點>.<內部 port>`。
 * - 展開後內部節點 id 加前綴 `<子流程節點 id>/`，上層連線重新接到內部 port；引擎不需要知道子流程。
 */
import { resolveProject } from '../resolve/resolve';
import type { ActionLibrary, Diagnostic, Flow, NodeDef, PortDef, ProjectFile } from '../model/types';

export const MAX_SUBGRAPH_DEPTH = 5;

export function parseSubgraphRef(ref: string | undefined): { id: string; version: number } | undefined {
  const m = /^([^@\s]+)@(\d+)$/.exec(ref ?? '');
  return m ? { id: m[1], version: Number(m[2]) } : undefined;
}

export function subgraphPortId(nodeId: string, portId: string): string {
  return `${nodeId}.${portId}`;
}

/** 子專案（已展開）對外的 port；source 沒有輸入、sink 沒有輸出，自然不會出現 */
export function subgraphInterface(sub: ProjectFile): { inputs: PortDef[]; outputs: PortDef[] } {
  const inputs: PortDef[] = [];
  const outputs: PortDef[] = [];
  for (const n of sub.nodes) {
    for (const p of n.inputs) {
      // 匯流的輸入永遠對外開放：上層可再接進來更多路徑
      if (n.category === 'merge' || !sub.flows.some((f) => f.to.node === n.id && f.to.port === p.id)) {
        inputs.push({ ...p, id: subgraphPortId(n.id, p.id), label: `${n.name}：${p.label ?? p.id}` });
      }
    }
    for (const p of n.outputs) {
      if (!sub.flows.some((f) => f.from.node === n.id && f.from.port === p.id)) {
        outputs.push({ ...p, id: subgraphPortId(n.id, p.id), label: `${n.name}：${p.label ?? p.id}` });
      }
    }
  }
  return { inputs, outputs };
}

export interface FlattenOptions {
  libraries?: ActionLibrary[];
  /** 可被引用的專案（以 id@version 查找） */
  projects?: ProjectFile[];
}

function splitPort(id: string): { node: string; port: string } | undefined {
  const i = id.lastIndexOf('.');
  return i > 0 ? { node: id.slice(0, i), port: id.slice(i + 1) } : undefined;
}

/**
 * 輸入為已展開（resolveProject 之後）的專案；回傳不含 subgraph 節點的專案。
 * `stack` 是目前展開路徑上的專案 key（含自己），用來偵測循環與深度。
 */
export function flattenSubgraphs(
  p: ProjectFile,
  opts: FlattenOptions,
  stack: string[] = [`${p.meta.id}@${p.meta.version}`],
): { project: ProjectFile; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const err = (message: string, nodeId?: string) => diagnostics.push({ severity: 'error', code: 'C-subgraph', message, nodeId });
  if (!p.nodes.some((n) => n.category === 'subgraph')) return { project: p, diagnostics };

  let nodes: NodeDef[] = [...p.nodes];
  let flows: Flow[] = [...p.flows];
  const types = new Map(p.artifactTypes.map((t) => [t.id, t]));
  const rules = new Map((p.rules ?? []).map((r) => [r.id, r]));
  const params = new Map((p.params ?? []).map((x) => [x.id, x]));

  for (const sg of p.nodes.filter((n) => n.category === 'subgraph')) {
    const ref = parseSubgraphRef(sg.ref);
    if (!ref) {
      err(`子流程「${sg.name}」的引用格式必須是 <專案id>@<版本>，目前為「${sg.ref ?? ''}」`, sg.id);
      continue;
    }
    const key = `${ref.id}@${ref.version}`;
    if (stack.includes(key)) {
      err(`子流程「${sg.name}」造成循環引用：${[...stack, key].join(' → ')}`, sg.id);
      continue;
    }
    if (stack.length > MAX_SUBGRAPH_DEPTH) {
      err(`子流程巢狀超過 ${MAX_SUBGRAPH_DEPTH} 層`, sg.id);
      continue;
    }
    const raw = opts.projects?.find((x) => x.meta.id === ref.id && x.meta.version === ref.version);
    if (!raw) {
      err(`子流程「${sg.name}」找不到專案 ${key}`, sg.id);
      continue;
    }
    if (raw.meta.status !== 'published') {
      err(`子流程「${sg.name}」引用的 ${key} 不是已發佈版本（只允許 published，才能鎖定內容）`, sg.id);
      continue;
    }
    const res = resolveProject(raw, opts.libraries);
    const subErrors = res.diagnostics.filter((d) => d.severity === 'error');
    if (subErrors.length) {
      err(`子流程 ${key} 本身展開失敗：${subErrors.map((d) => d.message).join('；')}`, sg.id);
      continue;
    }
    const inner = flattenSubgraphs(res.project, opts, [...stack, key]);
    if (inner.diagnostics.some((d) => d.severity === 'error')) {
      err(`子流程 ${key} 內部的子流程展開失敗：${inner.diagnostics.map((d) => d.message).join('；')}`, sg.id);
      continue;
    }
    const sub = inner.project;
    const iface = subgraphInterface(sub);

    // 宣告的 port 必須存在於子專案介面且型別一致
    let portErrors = 0;
    for (const dir of ['inputs', 'outputs'] as const) {
      for (const port of sg[dir]) {
        const hit = iface[dir].find((x) => x.id === port.id);
        if (!hit) {
          err(`子流程「${sg.name}」的 port「${port.id}」不存在於 ${key} 的對外介面`, sg.id);
          portErrors++;
        } else if (hit.type !== port.type) {
          err(`子流程「${sg.name}」的 port「${port.id}」型別 ${port.type} 與 ${key} 的 ${hit.type} 不符`, sg.id);
          portErrors++;
        }
      }
    }
    if (portErrors) continue;

    const pre = (id: string) => `${sg.id}/${id}`;
    nodes = nodes.filter((n) => n.id !== sg.id);
    for (const n of sub.nodes) nodes.push({ ...structuredClone(n), id: pre(n.id), name: `${sg.name}／${n.name}` });
    const incoming = flows.filter((f) => f.to.node === sg.id);
    const outgoing = flows.filter((f) => f.from.node === sg.id);
    flows = flows.filter((f) => f.to.node !== sg.id && f.from.node !== sg.id);
    for (const f of sub.flows) {
      flows.push({ id: pre(f.id), from: { node: pre(f.from.node), port: f.from.port }, to: { node: pre(f.to.node), port: f.to.port } });
    }
    for (const f of incoming) {
      const t = splitPort(f.to.port);
      flows.push({ ...f, to: t ? { node: pre(t.node), port: t.port } : f.to });
    }
    for (const f of outgoing) {
      const s = splitPort(f.from.port);
      flows.push({ ...f, from: s ? { node: pre(s.node), port: s.port } : f.from });
    }
    // 型別、規則、參數：上層優先，其餘由子專案補入
    for (const t of sub.artifactTypes) if (!types.has(t.id)) types.set(t.id, t);
    for (const r of sub.rules ?? []) if (!rules.has(r.id)) rules.set(r.id, r);
    for (const x of sub.params ?? []) if (!params.has(x.id)) params.set(x.id, x);
  }

  return {
    project: { ...p, nodes, flows, artifactTypes: [...types.values()], rules: [...rules.values()], params: [...params.values()] },
    diagnostics,
  };
}
