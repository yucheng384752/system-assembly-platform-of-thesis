#!/usr/bin/env node
// Writes and checks kits/<kit>/CHANGELOG.md (D190). Runs libs/kit-changelog/index.ts through Node's type stripping (Node >= 22.18).
//   add <kit> --cause <cause> --reason <text> [--author <name>]   record the current workflow.aov.json as the next entry
//   render <kit>                                                  rewrite the readable text from the machine-readable data
//   check [<kit>...]                                              the check the test runs; exit 1 on any problem
//   backfill <kit>... [--map file.json]                           rebuild the log from git history (see below)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAUSES, applyEntry, diffGraphs, emptyGraph, graphSha, parseChangelog, renderChangelog, replay, verifyKit } from '../libs/kit-changelog/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kitsDir = path.join(root, 'kits');
/** @param {string} message @returns {never} */
const fail = message => { console.error(message); process.exit(1); };

/** @param {string} kit */
const workflowPath = kit => path.join(kitsDir, kit, 'workflow.aov.json');
/** @param {string} kit */
const changelogPath = kit => path.join(kitsDir, kit, 'CHANGELOG.md');
/** @param {string} kit */
const readWorkflow = kit => JSON.parse(readFileSync(workflowPath(kit), 'utf8'));
/** @param {string} kit */
const readLog = kit => (existsSync(changelogPath(kit)) ? parseChangelog(readFileSync(changelogPath(kit), 'utf8')) : []);
/** @param {string} kit @param {import('../libs/kit-changelog/index.ts').Entry[]} entries */
const write = (kit, entries) => writeFileSync(changelogPath(kit), renderChangelog(kit, entries), 'utf8');
const allKits = () => readdirSync(kitsDir).filter(name => existsSync(workflowPath(name))).sort();

/** @param {string[]} args */
function options(args) {
  /** @type {Record<string, string | undefined>} */
  const named = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) named[args[i].slice(2)] = args[++i];
    else positional.push(args[i]);
  }
  return { named, positional };
}

/** @param {...string} args */
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, '-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });

/** @param {{seq: number, workflow: any, before: import('../libs/kit-changelog/index.ts').Graph, cause: import('../libs/kit-changelog/index.ts').Cause, reason: string, author: string, source: string, date: string}} input */
function entryFrom({ seq, workflow, before, cause, reason, author, source, date }) {
  const changes = diffGraphs(before, workflow);
  return { seq, kitVersion: workflow.kitVersion, date, author, source, cause, reason, nodes: changes.nodes, edges: changes.edges, beforeSha: graphSha(before), afterSha: graphSha(workflow) };
}

const [command, ...rest] = process.argv.slice(2);
const { named, positional } = options(rest);

if (command === 'add') {
  const kit = positional[0];
  if (!kit || !existsSync(workflowPath(kit))) fail('用法：add <kit> --cause <分類> --reason <原因> [--author <作者>]');
  const cause = /** @type {import('../libs/kit-changelog/index.ts').Cause} */ (named.cause ?? '');
  if (!(cause in CAUSES)) fail(`--cause 必須是：${Object.keys(CAUSES).join('、')}`);
  if (!named.reason?.trim()) fail('--reason 不可空白（寫為什麼要改，不是改了什麼）');
  const entries = readLog(kit);
  if (!entries.length && cause !== 'initial') fail(`${kit} 還沒有任何紀錄，第一筆必須是 initial；若流程已有 git 歷史，請改用 backfill`);
  const before = entries.length ? replay(entries).at(-1)?.after ?? emptyGraph() : emptyGraph();
  const workflow = readWorkflow(kit);
  const entry = entryFrom({ seq: entries.length + 1, workflow, before, cause, reason: named.reason.trim(), author: named.author?.trim() || git('config', 'user.name').trim() || 'unknown', source: 'manual', date: new Date().toISOString().slice(0, 10) });
  if (!entry.nodes.length && !entry.edges.length) fail(`${kit}：流程描述與最後一筆紀錄相同，沒有可記錄的變更`);
  applyEntry(before, entry);
  write(kit, [...entries, entry]);
  console.log(`${kit}：已新增 #${entry.seq}（${entry.nodes.length} 個節點變更、${entry.edges.length} 個連線變更）`);
} else if (command === 'render') {
  for (const kit of positional.length ? positional : allKits()) write(kit, readLog(kit));
} else if (command === 'check') {
  const problems = [];
  for (const kit of positional.length ? positional : allKits()) problems.push(...verifyKit(kit, readWorkflow(kit), existsSync(changelogPath(kit)) ? readFileSync(changelogPath(kit), 'utf8') : null));
  if (problems.length) fail(problems.join('\n'));
  console.log('所有 Kit 的 CHANGELOG 與流程描述一致');
} else if (command === 'backfill') {
  // One entry per commit that changed the workflow. The cause is a judgement, so every commit after the first needs a line in
  // the --map file: { "<7-char hash>": { "cause": "...", "reason": "..." } }. A commit that changed only the text (no node or
  // edge) is reported, not logged.
  const map = /** @type {Record<string, {cause: import('../libs/kit-changelog/index.ts').Cause, reason: string}>} */ (named.map ? JSON.parse(readFileSync(named.map, 'utf8')) : {});
  for (const kit of positional) {
    if (readLog(kit).length) fail(`${kit} 已有紀錄，backfill 只用於還沒有 CHANGELOG 的 Kit`);
    const file = `kits/${kit}/workflow.aov.json`;
    const commits = git('log', '--reverse', '--format=%H%x09%an%x09%ad%x09%s', '--date=short', '--', file).trim().split('\n').filter(Boolean).map(line => line.split('\t'));
    let before = emptyGraph();
    /** @type {import('../libs/kit-changelog/index.ts').Entry[]} */
    const entries = [];
    /** @type {string[]} */
    const skipped = [];
    for (const [hash, author, date, subject] of commits) {
      const workflow = JSON.parse(git('show', `${hash}:${file}`));
      const changes = diffGraphs(before, workflow);
      if (!changes.nodes.length && !changes.edges.length) { skipped.push(`${hash.slice(0, 7)} ${subject}`); continue; }
      const picked = map[hash.slice(0, 7)];
      const first = entries.length === 0;
      if (!first && !picked) fail(`${kit}：提交 ${hash.slice(0, 7)}（${subject}）需要在 --map 指定 cause 與 reason`);
      const cause = picked?.cause ?? 'initial';
      if (!(cause in CAUSES)) fail(`${kit}：${hash.slice(0, 7)} 的 cause ${cause} 不在允許清單`);
      entries.push(entryFrom({ seq: entries.length + 1, workflow, before, cause, reason: picked?.reason ?? `初版建立（提交：${subject}）`, author, source: `git:${hash.slice(0, 7)}`, date }));
      before = workflow;
    }
    const current = readWorkflow(kit);
    if (graphSha(current) !== graphSha(before)) fail(`${kit}：工作目錄的流程描述與最後一個提交不同（有未提交的修改？），請先提交再 backfill`);
    const last = entries.at(-1);
    if (last && current.kitVersion !== last.kitVersion) last.kitVersion = current.kitVersion;
    write(kit, entries);
    console.log(`${kit}：${entries.length} 筆${skipped.length ? `；只改文字、未記錄的提交：${skipped.join('；')}` : ''}`);
  }
} else {
  fail('指令：add、render、check、backfill（說明見檔案開頭）');
}
