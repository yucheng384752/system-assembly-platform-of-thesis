import { expect, test } from 'vitest';
import type { Kit, Option } from '../../../libs/ui-runtime/types';
import { assembleManual, checkManuals, fragmentPath, loadFragments, manualRoles, parseFragment, type Fragments } from './manual';
import type { Flow } from './catalog';

const headings = ['用途', '前置條件', '可設定項目', '操作步驟', '輸入輸出', '常見錯誤與復原'];
const kit = (id: string, dependencies: string[] = []): Kit => ({ id, version: '1.0', displayName: `${id}功能`, category: 'test', businessCapability: '', dependencies, subfeatures: [] });
function text(id = 'a', role = 'user') {
  return `---\nkitId: ${id}\nkitVersion: 1.0\nrole: ${role}\nstatus: draft\nsources:\n  - kits/${id}/manifest.json\n---\n${headings.map(h => `## ${h}\n${id}的內容`).join('\n\n')}`;
}
function inputs() {
  const kits = [kit('c', ['b']), kit('a'), kit('b'), kit('disabled')];
  const raw = Object.fromEntries(kits.flatMap(k => manualRoles.map(role => [fragmentPath(k, role), text(k.id, role)])));
  const option: Option = { id: 'user-option', displayName: '一般顯示', type: 'text', defaultValue: '預設', allowed_roles: ['User'], risk: 'low', change_level: 'A', target: { component_id: 'table', property: 'label' } };
  kits[0].subfeatures = [{ id: 'selected', displayName: '', businessCapability: '', defaultSelected: true,
    options: [option, { ...option, id: 'mis-option', displayName: '維護限定', allowed_roles: ['MIS'] }] },
  { id: 'unselected', displayName: '', businessCapability: '', defaultSelected: false, options: [{ ...option, displayName: '未選設定' }] }];
  const flows: Flow[] = [{ id: 'flow', name: '跨功能流程', description: '', kits: ['b', 'c', 'disabled'], pages: ['上傳', '檢查', '完成'], subflows: [] }];
  return { role: 'user' as const, kits, enabledKits: ['c', 'a', 'b'], fragments: loadFragments(raw), selectedSubfeatures: { c: ['selected'] }, flows, selectedFlows: ['flow'], catalog: { kits, definitions: {}, sources: {} }, overrides: {} };
}

// D48: reject unsupported YAML rather than quietly interpreting it differently on another machine.
test('parser accepts BOM/CRLF and rejects malformed metadata and missing or reordered sections', () => {
  expect(parseFragment('\uFEFF' + text().replace(/\n/g, '\r\n')).meta.role).toBe('user');
  for (const invalid of [text().replace('---', ''), text().replace('status: draft', 'status: "draft"'),
    text().replace('status: draft', 'status: draft\nstatus: draft'), text().replace('status: draft', 'extra: value'),
    text().replace('kits/a/manifest.json', 'kits/../secret'), text().replace('## 操作步驟', '### 操作步驟'),
    text().replace('## 用途', '## 前置條件')]) expect(() => parseFragment(invalid)).toThrow();
  expect(() => parseFragment(text().replace('## 操作步驟', '### 操作步驟'))).toThrow('操作步驟');
});

// A13/D51: sorting must move dependencies before dependents and retain catalog order within each layer.
test('sorts dependencies before dependents with stable peer order and excludes disabled kits', () => {
  const output = assembleManual(inputs());
  expect([...output.matchAll(/^## (\w+)功能（/gm)].map(m => m[1])).toEqual(['a', 'b', 'c']);
  expect(output).not.toContain('disabled');
  expect(output).toContain('操作順序：上傳 → 檢查 → 完成');
  expect(output).toContain('包含功能：b功能、c功能');
  expect(output).toContain('本手冊含草稿內容，尚未經審閱');
});

// A cycle must explain the route so the operator can correct the Kit catalog instead of hanging.
test('reports a dependency cycle with its full path', () => {
  const input = inputs(); input.kits[2].dependencies = ['c'];
  expect(() => assembleManual(input)).toThrow('c → b → c');
});

// Role and subfeature filtering prevents disclosing instructions for unavailable configuration options.
test('includes only selected options editable by the requested role', () => {
  const input = inputs(); const user = assembleManual(input);
  expect(user).toContain('一般顯示'); expect(user).not.toContain('維護限定'); expect(user).not.toContain('未選設定');
  const mis = assembleManual({ ...input, role: 'mis' });
  expect(mis).toContain('維護限定'); expect(mis).not.toContain('一般顯示');
  expect(assembleManual({ ...input, role: 'developer' })).toContain('此角色沒有可修改的設定項目');
});

// D51: arbitrary input/override/row values are not manual sources, including credential-like sentinels.
test('never reads connection settings, overrides or source rows', () => {
  const input = inputs();
  const poisoned = { ...input, password: 'PASSWORD_SENTINEL', overrides: { 'c::selected': { 'user-option': 'OVERRIDE_SENTINEL' } },
    catalog: { ...input.catalog, sources: { private: { fields: ['password'], rows: [{ password: 'ROW_SENTINEL' }] } } } };
  expect(assembleManual(poisoned)).not.toMatch(/PASSWORD_SENTINEL|OVERRIDE_SENTINEL|ROW_SENTINEL/);
});

// D34/D50: packaging permits drafts, while release reports a concrete Kit/role/path for each problem.
test('checks missing files, metadata/path/version mismatch, malformed sections and unreviewed release', () => {
  const input = inputs();
  expect(checkManuals({ ...input, mode: 'package' })).toEqual([]);
  expect(checkManuals({ ...input, mode: 'release' })).toHaveLength(9);
  const path = fragmentPath(input.kits[0], 'user');
  const cases = [undefined, parseFragment(text('wrong')), parseFragment(text('c', 'mis')),
    parseFragment(text('c').replace('kitVersion: 1.0', 'kitVersion: 2.0')),
    loadFragments({ [path]: text('c').replace('## 用途', '## 錯誤') })[path]];
  for (const fragment of cases) {
    const fragments = { ...input.fragments }; delete fragments[path]; if (fragment) fragments[path] = fragment;
    const issues = checkManuals({ ...input, fragments, mode: 'package' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kitId: 'c', role: 'user', path });
    expect(issues[0].reason).toContain(path);
    expect(() => assembleManual({ ...input, fragments })).toThrow(path);
  }
  const fragments: Fragments = { ...input.fragments, 'manuals/kits/c/0.9/user.md': input.fragments[path] }; delete fragments[path];
  expect(checkManuals({ ...input, fragments, mode: 'package' })[0].reason).toContain('版本不符');
});
