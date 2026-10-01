import { validateSchema } from '../../../libs/ui-runtime/schema';
import type { Catalog } from '../../../libs/ui-runtime/recipe';
import type { Kit, Overrides } from '../../../libs/ui-runtime/types';
import type { Flow } from './catalog';

export const manualRoles = ['user', 'mis', 'developer'] as const;
export type ManualRole = typeof manualRoles[number];
export const roleNames = { user: '一般使用者', mis: '維護人員', developer: '開發人員' };
const permissions = { user: 'User', mis: 'MIS', developer: 'Developer' } as const;
const sections = ['用途', '前置條件', '可設定項目', '操作步驟', '輸入輸出', '常見錯誤與復原'];
export interface Fragment {
  meta: { kitId: string; kitVersion: string; role: ManualRole; status: 'draft' | 'reviewed'; sources: string[] };
  body: string;
}
// Keep malformed files in the collection: one bad manual must not prevent configuration delivery (D34).
export type Fragments = Record<string, Fragment | { error: string }>;
export interface ManualIssue { kitId: string; role: ManualRole; path: string; reason: string }
export const fragmentPath = (kit: Kit, role: ManualRole) => `manuals/kits/${kit.id}/${kit.version}/${role}.md`;

export function parseFragment(text: string): Fragment {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end < 0) throw new Error('frontmatter 必須以 --- 開始與結束');
  const meta: Record<string, unknown> = {};
  let inSources = false;
  for (const line of lines.slice(1, end)) {
    if (inSources && /^  - kits\/[A-Za-z0-9._/-]+$/.test(line)) {
      const source = line.slice(4);
      if (source.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('sources 必須為 kits/ 下的檔案路徑');
      (meta.sources as string[]).push(source); continue;
    }
    const field = /^(kitId|kitVersion|role|status): ([A-Za-z0-9._-]+)$/.exec(line);
    const key = line === 'sources:' ? 'sources' : field?.[1];
    if (!key || Object.hasOwn(meta, key)) throw new Error(`frontmatter 語法錯誤或重複欄位：${line}`);
    inSources = key === 'sources';
    meta[key] = inSources ? [] : field![2];
  }
  validateSchema('manual', meta);
  const body = lines.slice(end + 1).join('\n').trim();
  const headings = [...body.matchAll(/^## (.+)$/gm)].map(match => match[1]);
  for (const [index, section] of sections.entries()) {
    if (headings[index] !== section) throw new Error(`缺少章節或順序錯誤：## ${section}`);
  }
  if (headings.length !== sections.length) throw new Error('章節錯誤：只能包含六個指定的二級標題');
  return { meta: meta as unknown as Fragment['meta'], body };
}

export function loadFragments(raw: Record<string, string> = import.meta.glob('../../../manuals/kits/*/*/*.md', { query: '?raw', import: 'default', eager: true })): Fragments {
  return Object.fromEntries(Object.entries(raw).map(([path, text]) => {
    const key = path.replace(/^\.\.\/\.\.\/\.\.\//, '');
    try { return [key, parseFragment(text)]; }
    catch (error) { return [key, { error: error instanceof Error ? error.message : String(error) }]; }
  }));
}

interface CheckInput { kits: Kit[]; enabledKits: string[]; fragments: Fragments; mode: 'package' | 'release' }
export function checkManuals({ kits, enabledKits, fragments, mode }: CheckInput): ManualIssue[] {
  return [...new Set(enabledKits)].flatMap(kitId => manualRoles.flatMap(role => {
    const kit = kits.find(item => item.id === kitId);
    const path = kit ? fragmentPath(kit, role) : `manuals/kits/${kitId}/尚未提供/${role}.md`;
    const fragment = fragments[path];
    let reason = '';
    if (!kit) reason = 'Kit 目錄中不存在';
    else if (!fragment) {
      const other = Object.keys(fragments).filter(key => key.startsWith(`manuals/kits/${kitId}/`) && key.endsWith(`/${role}.md`));
      reason = other.length ? `版本不符：需要 ${kit.version}；找到 ${other.join('、')}` : '缺少片段';
    } else if ('error' in fragment) reason = fragment.error;
    else {
      const { meta } = fragment;
      if (meta.kitId !== kitId || meta.role !== role) reason = 'kitId 或 role 與路徑不符';
      else if (meta.kitVersion !== kit.version) reason = `版本不符：需要 ${kit.version}，片段為 ${meta.kitVersion}`;
      else if (mode === 'release' && meta.status !== 'reviewed') reason = '尚未審閱';
    }
    return reason ? [{ kitId, role, path, reason: `${kitId}／${role}（${path}）：${reason}` }] : [];
  }));
}

function orderedKits(kits: Kit[], enabledKits: string[]): Kit[] {
  const selected = kits.filter(kit => enabledKits.includes(kit.id));
  const depths = new Map<string, number>();
  function visit(kit: Kit, path: string[]): number {
    if (path.includes(kit.id)) throw new Error(`相依循環：${[...path, kit.id].join(' → ')}`);
    const cached = depths.get(kit.id);
    if (cached !== undefined) return cached;
    const depth = Math.max(0, ...selected.filter(item => kit.dependencies.includes(item.id)).map(dependency => visit(dependency, [...path, kit.id]) + 1));
    depths.set(kit.id, depth); return depth;
  }
  selected.forEach(kit => visit(kit, []));
  return selected.sort((a, b) => depths.get(a.id)! - depths.get(b.id)!);
}
const cell = (value: string | number | boolean) => String(value).replace(/[&<>|]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '|': '&#124;' })[char]!).replace(/\r?\n/g, '／');

interface AssemblyInput extends Omit<CheckInput, 'mode'> {
  role: ManualRole; selectedSubfeatures: Record<string, string[]>; flows: Flow[]; selectedFlows: string[];
  catalog: Catalog; overrides: Overrides;
}
export function assembleManual(input: AssemblyInput): string {
  const { role, kits, enabledKits, fragments, selectedSubfeatures, flows, selectedFlows, catalog } = input;
  // Overrides are intentionally not read: only option definitions supply defaults, never connection or user values.
  const issues = checkManuals({ kits, enabledKits, fragments, mode: 'package' }).filter(issue => issue.role === role);
  if (issues.length) throw new Error(issues.map(issue => issue.reason).join('\n'));
  const ordered = orderedKits(kits, enabledKits);
  const parts = ordered.map(kit => ({ kit, fragment: fragments[fragmentPath(kit, role)] as Fragment }));
  const lines = [`# ${roleNames[role]}操作手冊`, '', '產生依據：', ...ordered.map(kit => `- ${kit.displayName}（${kit.version}）`), ''];
  if (parts.some(({ fragment }) => fragment.meta.status === 'draft')) lines.push('本手冊含草稿內容，尚未經審閱', '');
  lines.push('## 跨功能操作路徑', '');
  const routes = flows.filter(flow => selectedFlows.includes(flow.id) && flow.kits.some(id => enabledKits.includes(id)));
  for (const flow of routes) lines.push(`### ${flow.name}`, '', `操作順序：${flow.pages.join(' → ') || '尚未提供'}`, '',
    `包含功能：${ordered.filter(kit => flow.kits.includes(kit.id)).map(kit => kit.displayName).join('、')}`, '');
  if (!routes.length) lines.push('尚未選擇跨功能操作路徑。', '');
  for (const { kit, fragment } of parts) {
    lines.push(`## ${kit.displayName}（${kit.version}）`, '', fragment.body.replace(/^(#{2,5}) /gm, '$1# '), '', '### 設定項目一覽', '');
    const options = catalog.kits.find(item => item.id === kit.id)?.subfeatures
      .filter(sub => selectedSubfeatures[kit.id]?.includes(sub.id)).flatMap(sub => sub.options)
      .filter(option => option.allowed_roles.includes(permissions[role])) ?? [];
    if (!options.length) lines.push('此角色沒有可修改的設定項目', '');
    else {
      lines.push('| 名稱 | 可修改角色 | 風險 | 變更層級 | 預設值 |', '| --- | --- | --- | --- | --- |');
      for (const option of options) lines.push(`| ${[option.displayName, option.allowed_roles.join('、'), option.risk, option.change_level, option.defaultValue].map(cell).join(' | ')} |`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
