// 用法（npm 腳本見 package.json）：
//   node tools/dual-account/cli.mjs sync [--apply]      互相鏡像還活著的 session 登記檔，預設只列計畫
//   node tools/dual-account/cli.mjs status              列出本分支的鎖與兩帳號的鏡像狀態
//   node tools/dual-account/cli.mjs run --thread <mailbox thread> --task <文字|@檔案> [--start A|B] [--max-switches 4] [--no-sync] [-- claude 額外參數]
// 環境變數：CLAUDE_ACCOUNT_B_DIR（必填）、CLAUDE_ACCOUNT_A_DIR（預設 ~/.claude）、CLAUDE_LIMIT_PATTERN、CLAUDE_BIN
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { resolveAccounts, otherAccount } from './lib/accounts.mjs';
import { DEFAULT_LIMIT_PATTERN, classify, parseStream } from './lib/limit.mjs';
import { readLock, release } from './lib/lock.mjs';
import { runLoop } from './lib/runner.mjs';
import { applyMirror, planMirror } from './lib/sessions.mjs';

const git = (args, cwd) => execFileSync('git', ['-c', `safe.directory=${cwd.replace(/\\/g, '/')}`, ...args], { cwd, encoding: 'utf8' }).trim();

function parseArgs(argv) {
  const sep = argv.indexOf('--');
  const own = sep === -1 ? argv : argv.slice(0, sep);
  const extra = sep === -1 ? [] : argv.slice(sep + 1);
  const opts = { _: [] };
  for (let i = 0; i < own.length; i++) {
    if (own[i].startsWith('--')) {
      const next = own[i + 1];
      if (next === undefined || next.startsWith('--')) opts[own[i].slice(2)] = true;
      else opts[own[i].slice(2)] = own[++i];
    } else opts._.push(own[i]);
  }
  return { opts, extra };
}

function context() {
  const worktree = git(['rev-parse', '--show-toplevel'], process.cwd());
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
  const common = resolve(worktree, git(['rev-parse', '--git-common-dir'], worktree));
  return { worktree, branch, lockDir: join(common, 'dual-account') };
}

function sync(accounts, apply) {
  const plans = [
    planMirror(accounts.A, accounts.B, 'A'),
    planMirror(accounts.B, accounts.A, 'B'),
  ];
  for (const p of plans) {
    console.log(`${p.srcLabel} -> ${otherAccount(p.srcLabel)}：複製 ${p.copy.length}、移除 ${p.remove.length}、同名衝突略過 ${p.skippedConflict.length}`);
    for (const f of p.skippedConflict) console.log(`  衝突（對方已有同名且非本工具鏡像）：${f}`);
    if (apply) applyMirror(p);
  }
  if (!apply) console.log('以上為計畫，加 --apply 才會寫入對方的 sessions 資料夾。');
}

function runClaudeFactory(accounts, worktree, extra, pattern) {
  const bin = process.env.CLAUDE_BIN || 'claude';
  return (account, prompt) => new Promise((done, fail) => {
    const child = spawn(bin, ['-p', '--output-format', 'stream-json', '--verbose', ...extra], {
      cwd: worktree,
      env: { ...process.env, CLAUDE_CONFIG_DIR: accounts[account] },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', fail);
    child.on('close', (code) => done(classify(parseStream(out), code, pattern)));
    child.stdin.end(prompt);
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { opts, extra } = parseArgs(rest);
  const accounts = resolveAccounts();
  if (cmd === 'sync') return sync(accounts, Boolean(opts.apply));
  const ctx = context();
  if (cmd === 'status') {
    console.log(`分支 ${ctx.branch}：`, readLock(ctx.lockDir, ctx.branch) ?? '無鎖（沒有任何帳號持有）');
    return;
  }
  if (cmd === 'unlock') {
    // 出錯後鎖會保留；人確認過後用這個清掉（只清本分支的鎖）
    const cur = readLock(ctx.lockDir, ctx.branch);
    if (!cur) return console.log('本分支沒有鎖');
    release(ctx.lockDir, ctx.branch, cur.holder);
    return console.log(`已清除帳號 ${cur.holder} 持有的鎖`);
  }
  if (cmd === 'run') {
    if (!opts.thread || !opts.task) throw new Error('run 需要 --thread 與 --task');
    const task = String(opts.task).startsWith('@') ? readFileSync(String(opts.task).slice(1), 'utf8') : String(opts.task);
    const pattern = process.env.CLAUDE_LIMIT_PATTERN ? new RegExp(process.env.CLAUDE_LIMIT_PATTERN, 'i') : DEFAULT_LIMIT_PATTERN;
    // 啟動前先鏡像一次，讓兩邊目前的互動 session 彼此看得到；失敗就中止（--no-sync 可略過）
    if (!opts['no-sync']) sync(accounts, true);
    const result = await runLoop({
      ...ctx,
      thread: resolve(String(opts.thread)),
      start: opts.start === 'B' ? 'B' : 'A',
      task,
      maxSwitches: Number(opts['max-switches'] ?? 4),
      runClaude: runClaudeFactory(accounts, ctx.worktree, extra, pattern),
      gitStatus: () => git(['status', '--short'], ctx.worktree),
      log: (m) => console.log(m),
    });
    console.log(`結束：${result.status}（最後帳號 ${result.account}，交棒 ${result.switches} 次）`);
    if (result.detail) console.error(`詳情：${result.detail}`);
    process.exitCode = result.status === 'done' ? 0 : 2;
    return;
  }
  throw new Error('用法：sync [--apply] | status | run --thread <檔> --task <文字|@檔>');
}

main().catch((e) => {
  console.error(`失敗：${e.message}`);
  process.exitCode = 1;
});
