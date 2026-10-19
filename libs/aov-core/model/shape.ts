/**
 * 外部輸入的結構檢查：專案檔與動作庫在進入解析、驗證之前先確認形狀。
 * 只回報錯誤，不丟例外、不修改輸入；通過後型別才可視為 ProjectFile／ActionLibrary。
 */
import { CATEGORY_GROUP, FORMAT_VERSION, type Diagnostic } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const STATUS = ['draft', 'published'];
const PORT_ROLE = ['main', 'loss', 'record'];

function err(out: Diagnostic[], where: string, message: string): void {
  out.push({ severity: 'error', code: 'S0-shape', message: `${where}：${message}` });
}

function checkPorts(out: Diagnostic[], where: string, v: unknown): void {
  if (!Array.isArray(v)) return err(out, where, '必須是陣列');
  v.forEach((p, i) => {
    const w = `${where}[${i}]`;
    if (!isObj(p)) return err(out, w, '必須是物件');
    if (!isStr(p.id)) err(out, w, 'id 必須是非空字串');
    if (!isStr(p.type)) err(out, w, 'type 必須是非空字串');
    if (p.role !== undefined && !PORT_ROLE.includes(p.role as string)) err(out, w, `role 不是可用值（${PORT_ROLE.join('、')}）`);
  });
}

function checkMeta(out: Diagnostic[], v: unknown): void {
  if (!isObj(v)) return err(out, 'meta', '必須是物件');
  if (!isStr(v.id)) err(out, 'meta.id', '必須是非空字串');
  if (!isStr(v.name)) err(out, 'meta.name', '必須是非空字串');
  if (typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1) err(out, 'meta.version', '必須是正整數');
  if (!STATUS.includes(v.status as string)) err(out, 'meta.status', `必須是 ${STATUS.join(' 或 ')}`);
}

function checkIdList(out: Diagnostic[], where: string, v: unknown, required: boolean): void {
  if (v === undefined && !required) return;
  if (!Array.isArray(v)) return err(out, where, '必須是陣列');
  v.forEach((x, i) => { if (!isObj(x) || !isStr(x.id)) err(out, `${where}[${i}]`, '必須是含非空字串 id 的物件'); });
}

function checkActions(out: Diagnostic[], where: string, v: unknown): void {
  if (!Array.isArray(v)) return err(out, where, '必須是陣列');
  v.forEach((a, i) => {
    const w = `${where}[${i}]`;
    if (!isObj(a)) return err(out, w, '必須是物件');
    if (!isStr(a.id)) err(out, `${w}.id`, '必須是非空字串');
    if (!isStr(a.name)) err(out, `${w}.name`, '必須是非空字串');
    if (!(typeof a.behavior === 'string' && a.behavior in CATEGORY_GROUP)) err(out, `${w}.behavior`, '不是已知的節點類別');
    for (const dir of ['inputs', 'outputs']) if (a[dir] !== undefined) checkPorts(out, `${w}.${dir}`, a[dir]);
  });
}

export function checkProjectShape(raw: unknown): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!isObj(raw)) { err(out, '專案檔', '必須是物件'); return out; }
  if (raw.formatVersion !== FORMAT_VERSION) out.push({ severity: 'error', code: 'S0-format', message: `不支援的 formatVersion：${String(raw.formatVersion)}` });
  checkMeta(out, raw.meta);
  checkIdList(out, 'artifactTypes', raw.artifactTypes, true);
  for (const k of ['params', 'forms', 'rules']) checkIdList(out, k, raw[k], false);
  if (raw.actions !== undefined) checkActions(out, 'actions', raw.actions);
  if (raw.libraries !== undefined) {
    if (!Array.isArray(raw.libraries)) err(out, 'libraries', '必須是陣列');
    else raw.libraries.forEach((l, i) => {
      if (!isObj(l) || !isStr(l.id) || typeof l.version !== 'number') err(out, `libraries[${i}]`, '必須含 id 與數字 version');
    });
  }
  if (!Array.isArray(raw.nodes)) err(out, 'nodes', '必須是陣列');
  else raw.nodes.forEach((n, i) => {
    const w = `nodes[${i}]`;
    if (!isObj(n)) return err(out, w, '必須是物件');
    if (!isStr(n.id)) err(out, `${w}.id`, '必須是非空字串');
    if (!isStr(n.name)) err(out, `${w}.name`, '必須是非空字串');
    if (!(typeof n.category === 'string' && n.category in CATEGORY_GROUP)) err(out, `${w}.category`, '不是已知的節點類別');
    checkPorts(out, `${w}.inputs`, n.inputs);
    checkPorts(out, `${w}.outputs`, n.outputs);
  });
  if (!Array.isArray(raw.flows)) err(out, 'flows', '必須是陣列');
  else raw.flows.forEach((f, i) => {
    const w = `flows[${i}]`;
    if (!isObj(f)) return err(out, w, '必須是物件');
    if (!isStr(f.id)) err(out, `${w}.id`, '必須是非空字串');
    for (const end of ['from', 'to']) {
      const e = f[end];
      if (!isObj(e) || !isStr(e.node) || !isStr(e.port)) err(out, `${w}.${end}`, '必須含非空字串 node 與 port');
    }
  });
  return out;
}

export function checkLibraryShape(raw: unknown): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!isObj(raw)) { err(out, '動作庫', '必須是物件'); return out; }
  if (raw.formatVersion !== FORMAT_VERSION) out.push({ severity: 'error', code: 'S0-format', message: `不支援的 formatVersion：${String(raw.formatVersion)}` });
  if (raw.kind !== 'action-library') err(out, 'kind', '必須是 action-library');
  checkMeta(out, raw.meta);
  for (const k of ['artifactTypes', 'forms', 'rules']) checkIdList(out, k, raw[k], false);
  checkActions(out, 'actions', raw.actions);
  return out;
}
