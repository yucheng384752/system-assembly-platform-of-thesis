import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAUSES, applyEntry, diffGraphs, emptyGraph, graphSha, parseChangelog, renderChangelog, replay, touchedNodes, verifyKit, type Entry, type Graph } from '../../../libs/kit-changelog';

const kitsDir = path.resolve(__dirname, '../../../kits');

const base: Graph = {
  nodes: [
    { id: 'login', name: '登入', capabilityIds: ['auth.login'] },
    { id: 'list-roles', name: '查詢角色', capabilityIds: ['roles.list'] },
    { id: 'set-grants', name: '設定角色授權', capabilityIds: ['roles.grants.set'] },
  ],
  edges: [{ from: 'list-roles', to: 'set-grants' }],
};

/** Builds a valid entry the way the CLI does, so tests change one thing at a time. */
function entry(seq: number, before: Graph, after: Graph, over: Partial<Entry> = {}): Entry {
  const changes = diffGraphs(before, after);
  return {
    seq, kitVersion: '0.1.0', date: '2026-11-08', author: 'tester', source: 'manual',
    cause: seq === 1 ? 'initial' : 'align-runtime', reason: seq === 1 ? '初版' : '流程與實際執行順序不符',
    nodes: changes.nodes, edges: changes.edges, beforeSha: graphSha(before), afterSha: graphSha(after), ...over,
  };
}

const withWorkflow = (graph: Graph) => ({ ...graph, kitVersion: '0.1.0' });
const textOf = (entries: Entry[]) => renderChangelog('demo-kit', entries);

describe('graph identity', () => {
  it('ignores the order of nodes, edges and capabilities, so reordering a file is not a change', () => {
    const shuffled: Graph = { nodes: [...base.nodes].reverse().map(n => ({ ...n, capabilityIds: [...n.capabilityIds].reverse() })), edges: [...base.edges].reverse() };
    expect(graphSha(shuffled)).toBe(graphSha(base));
  });

  it('changes when a node name changes, because the name is what a person sees on the canvas', () => {
    const renamed: Graph = { ...base, nodes: base.nodes.map(n => (n.id === 'login' ? { ...n, name: '使用者登入' } : n)) };
    expect(graphSha(renamed)).not.toBe(graphSha(base));
  });
});

describe('diff and replay', () => {
  it('names the node and the field that changed, with before and after', () => {
    const after: Graph = { ...base, nodes: base.nodes.map(n => (n.id === 'login' ? { ...n, name: '使用者登入', capabilityIds: ['auth.login', 'auth.me.get'] } : n)) };
    const { nodes, edges } = diffGraphs(base, after);
    expect(edges).toEqual([]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ op: 'edit', nodeId: 'login', nodeName: '使用者登入', fields: { name: { before: '登入', after: '使用者登入' }, capabilityIds: { before: ['auth.login'], after: ['auth.login', 'auth.me.get'] } } });
  });

  it('records an edge-only change against the nodes it connects, so no touched node is missing from the log', () => {
    const after: Graph = { ...base, edges: [{ from: 'login', to: 'list-roles' }, ...base.edges] };
    const e = entry(2, base, after);
    expect([...touchedNodes(e)]).toEqual([['login', 'link'], ['list-roles', 'link']]);
  });

  it('replaying every entry from an empty graph reproduces the final workflow', () => {
    const second: Graph = { nodes: [...base.nodes, { id: 'create-role', name: '建立角色', capabilityIds: ['roles.create'] }], edges: [...base.edges, { from: 'login', to: 'create-role' }] };
    const third: Graph = { nodes: second.nodes.filter(n => n.id !== 'list-roles'), edges: second.edges.filter(e => e.from !== 'list-roles') };
    const entries = [entry(1, emptyGraph(), base), entry(2, base, second), entry(3, second, third)];
    const steps = replay(entries);
    expect(graphSha(steps[2].after)).toBe(graphSha(third));
    expect(steps[1].before).toEqual(steps[0].after);
  });

  it('refuses an entry that does not follow the previous one, so a deleted or reordered entry is caught', () => {
    const second: Graph = { ...base, nodes: [...base.nodes, { id: 'x', name: '新節點', capabilityIds: [] }] };
    const third: Graph = { ...second, nodes: [...second.nodes, { id: 'y', name: '另一個', capabilityIds: [] }] };
    expect(() => replay([entry(1, emptyGraph(), base), entry(3, second, third)])).toThrow(/修改前/);
  });

  it('refuses to remove a node that still has an edge, because the canvas would show a line to nothing', () => {
    const broken = entry(2, base, { nodes: base.nodes.filter(n => n.id !== 'set-grants'), edges: base.edges });
    expect(() => applyEntry(base, broken)).toThrow(/不存在的節點/);
  });
});

describe('verifyKit: the log must follow the workflow', () => {
  const first = entry(1, emptyGraph(), base);

  it('accepts a log whose replay equals the workflow and whose text is the generated text', () => {
    expect(verifyKit('demo-kit', withWorkflow(base), textOf([first]))).toEqual([]);
  });

  it('fails when the workflow gained a node nobody logged, and names that node', () => {
    const edited = withWorkflow({ ...base, nodes: [...base.nodes, { id: 'delete-role', name: '刪除角色', capabilityIds: ['roles.delete'] }] });
    const problems = verifyKit('demo-kit', edited, textOf([first]));
    expect(problems.join('\n')).toMatch(/刪除角色（delete-role）/);
    expect(problems.join('\n')).toMatch(/kit-changelog\.mjs add demo-kit/);
  });

  it('fails when the workflow lost an edge nobody logged', () => {
    const problems = verifyKit('demo-kit', withWorkflow({ ...base, edges: [] }), textOf([first]));
    expect(problems.join('\n')).toMatch(/連線 list-roles → set-grants/);
  });

  it('fails when there is no CHANGELOG.md at all', () => {
    expect(verifyKit('demo-kit', withWorkflow(base), null)[0]).toMatch(/缺少 CHANGELOG\.md/);
  });

  it('fails when the readable text was edited by hand, so the text and the data a model reads cannot drift apart', () => {
    const tampered = textOf([first]).replace('- 修改原因：初版', '- 修改原因：改過的說法');
    expect(verifyKit('demo-kit', withWorkflow(base), tampered).join('\n')).toMatch(/不一致/);
  });

  it('fails when the machine-readable data was edited to hide a change', () => {
    const text = textOf([first]);
    const hidden = text.replace(/"nodeName": "登入"/, '"nodeName": "別的名字"');
    expect(verifyKit('demo-kit', withWorkflow(base), hidden).join('\n')).toMatch(/不一致/);
  });

  it('requires a reason, because a change with no reason teaches nothing', () => {
    const noReason = entry(1, emptyGraph(), base, { reason: '  ' });
    expect(verifyKit('demo-kit', withWorkflow(base), textOf([noReason])).join('\n')).toMatch(/修改原因不可空白/);
  });

  it('requires a cause from the fixed list, so the observations stay comparable', () => {
    const odd = entry(1, emptyGraph(), base, { cause: 'because' as never });
    expect(verifyKit('demo-kit', withWorkflow(base), textOf([odd])).join('\n')).toMatch(/不在允許清單/);
  });

  it('allows initial only as the first entry', () => {
    const second: Graph = { ...base, nodes: [...base.nodes, { id: 'x', name: '新節點', capabilityIds: [] }] };
    const again = entry(2, base, second, { cause: 'initial' });
    expect(verifyKit('demo-kit', withWorkflow(second), textOf([first, again])).join('\n')).toMatch(/只有第 1 筆/);
  });

  it('survives CRLF line endings from a Windows checkout', () => {
    expect(verifyKit('demo-kit', withWorkflow(base), textOf([first]).replace(/\n/g, '\r\n'))).toEqual([]);
  });
});

describe('rendering', () => {
  it('shows node_name, node_id and the action for every touched node, and the canvas before and after', () => {
    const after: Graph = { ...base, nodes: base.nodes.map(n => (n.id === 'login' ? { ...n, name: '使用者登入' } : n)) };
    const text = textOf([entry(1, emptyGraph(), base), entry(2, base, after)]);
    expect(text).toContain('| 使用者登入 | login | 修改 | 名稱：「登入」改為「使用者登入」 |');
    expect(text).toContain('### 畫布：修改前');
    expect(text).toContain('n_login["使用者登入"]:::edit');
    expect(text).toContain('n_login["登入"]:::edit');
    expect(parseChangelog(text).map(e => e.seq)).toEqual([1, 2]);
  });

  it('puts the newest entry first, as readers of a change log expect', () => {
    const after: Graph = { ...base, nodes: [...base.nodes, { id: 'x', name: '新節點', capabilityIds: [] }] };
    const text = textOf([entry(1, emptyGraph(), base), entry(2, base, after)]);
    expect(text.indexOf('## #2')).toBeLessThan(text.indexOf('## #1'));
  });

  it('escapes a table separator inside a node name so the table does not break', () => {
    const odd: Graph = { nodes: [{ id: 'a', name: '甲|乙', capabilityIds: [] }], edges: [] };
    expect(textOf([entry(1, emptyGraph(), odd)])).toContain('| 甲\\|乙 | a | 新增 |');
  });
});

describe('every Kit in the repository', () => {
  const kits = readdirSync(kitsDir).filter(name => existsSync(path.join(kitsDir, name, 'workflow.aov.json'))).sort();

  it('has a workflow to check, so the loop below cannot pass by finding nothing', () => {
    expect(kits.length).toBeGreaterThanOrEqual(13);
    expect(kits).toContain('analytical-four-kit');
  });

  it.each(kits)('%s: CHANGELOG.md follows workflow.aov.json (D190)', kit => {
    const workflow = JSON.parse(readFileSync(path.join(kitsDir, kit, 'workflow.aov.json'), 'utf8'));
    const file = path.join(kitsDir, kit, 'CHANGELOG.md');
    expect(verifyKit(kit, workflow, existsSync(file) ? readFileSync(file, 'utf8') : null)).toEqual([]);
  });

  it('documents every cause in the authoring guide, so authors know what to choose', () => {
    const guide = readFileSync(path.resolve(kitsDir, '../docs/kit-authoring.md'), 'utf8');
    for (const cause of Object.keys(CAUSES)) expect(guide).toContain(cause);
  });
});
