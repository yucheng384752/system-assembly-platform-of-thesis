// 這些測試守住的是「兩個帳號不會互相踩」的前提，不是實作細節：
// - 非持有者不能寫入或搶鎖（否則嚴格輪流形同虛設）；不同分支互不影響（worktree 並行）
// - 鏡像只動自己建立的檔案，不覆蓋、不刪除對方原有的 session
// - 只有確定是用量上限才自動換人；未知錯誤停下並保留鎖
// - 交接是追加到既有 thread，不改動原內容，thread 不存在要報錯
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { appendHandoff } from '../lib/handoff.mjs';
import { classify, parseStream } from '../lib/limit.mjs';
import { acquire, readLock, release, transfer } from '../lib/lock.mjs';
import { runLoop } from '../lib/runner.mjs';
import { applyMirror, planMirror } from '../lib/sessions.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dual-'));

test('鎖：非持有者不能取得、交棒或釋放', () => {
  const d = tmp();
  acquire(d, 'feature/x', 'A');
  assert.throws(() => acquire(d, 'feature/x', 'B'), /由帳號 A 持有/);
  assert.throws(() => transfer(d, 'feature/x', 'B', 'A'), /不是分支/);
  assert.throws(() => release(d, 'feature/x', 'B'), /不是持有者/);
  assert.equal(transfer(d, 'feature/x', 'A', 'B').holder, 'B');
  assert.throws(() => acquire(d, 'feature/x', 'A'), /由帳號 B 持有/);
});

test('鎖：不同分支各自獨立，可由不同帳號並行', () => {
  const d = tmp();
  acquire(d, 'feature/x', 'A');
  acquire(d, 'feature/y', 'B');
  assert.equal(readLock(d, 'feature/x').holder, 'A');
  assert.equal(readLock(d, 'feature/y').holder, 'B');
});

test('鎖：損毀的鎖檔要報錯，不當作沒有鎖', () => {
  const d = tmp();
  acquire(d, 'b', 'A');
  writeFileSync(join(d, 'b.json'), '{壞');
  assert.throws(() => readLock(d, 'b'), /鎖檔損毀/);
});

function makeConfig(files) {
  const dir = tmp();
  mkdirSync(join(dir, 'sessions'));
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, 'sessions', f), c);
  return dir;
}

test('鏡像：只複製活著的 session；已結束的鏡像會被清掉；對方原有檔案不被覆蓋或刪除', () => {
  const key = 'a'.repeat(64);
  const A = makeConfig({ '100.json': '{"pid":100}', [`100.${key}.key`]: 'k', '200.json': '{"pid":200}' });
  const B = makeConfig({ '100.json': '對方自己的同名檔', '999.json': '對方的 session' });
  const alive = (pid) => pid === 100;

  const plan = planMirror(A, B, 'A', alive);
  assert.deepEqual(plan.copy, [`100.${key}.key`]);
  assert.deepEqual(plan.skippedConflict, ['100.json']);
  applyMirror(plan);
  assert.equal(readFileSync(join(B, 'sessions', '100.json'), 'utf8'), '對方自己的同名檔');
  assert.equal(readFileSync(join(B, 'sessions', '999.json'), 'utf8'), '對方的 session');
  assert.ok(existsSync(join(B, 'sessions', `100.${key}.key`)));

  // 來源 session 結束後，只移除我們鏡像過的檔案
  const plan2 = planMirror(A, B, 'A', () => false);
  assert.deepEqual(plan2.remove, [`100.${key}.key`]);
  applyMirror(plan2);
  assert.ok(!existsSync(join(B, 'sessions', `100.${key}.key`)));
  assert.ok(existsSync(join(B, 'sessions', '999.json')));
});

test('鏡像：A 鏡像到 B 的檔案不會被 B 往回鏡像給 A（回音）', () => {
  const A = makeConfig({ '100.json': '{"pid":100}' });
  const B = makeConfig({});
  applyMirror(planMirror(A, B, 'A', () => true));
  const back = planMirror(B, A, 'B', () => true);
  assert.deepEqual(back.copy, []);
  assert.deepEqual(back.skippedConflict, []);
});

const ev = (result, isError) => JSON.stringify({ type: 'result', is_error: isError, result });
const asst = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

test('判斷：只有符合上限樣式的失敗才算 limit，其餘失敗是 error', () => {
  const limit = parseStream([asst('做到一半'), ev('Claude usage limit reached. Resets at 5pm', true)].join('\n'));
  assert.equal(classify(limit, 1).kind, 'limit');
  assert.equal(classify(limit, 1).text, '做到一半');
  const other = parseStream(ev('Invalid API key', true));
  assert.equal(classify(other, 1).kind, 'error');
  assert.equal(classify([], 1).kind, 'error'); // 沒有 result 事件不可當成完成
  assert.equal(classify(parseStream(ev('ok', false)), 0).kind, 'done');
});

function harness(script) {
  const dir = tmp();
  const thread = join(dir, 'thread.md');
  writeFileSync(thread, '# 原內容\n');
  let t = 0;
  const calls = [];
  const opts = {
    branch: 'feature/x', worktree: 'wt', lockDir: join(dir, 'locks'), thread, start: 'A', task: '任務',
    runClaude: async (account, prompt) => {
      calls.push({ account, prompt });
      t += script[calls.length - 1].ms;
      return script[calls.length - 1].out;
    },
    gitStatus: () => ' M a.txt',
    now: () => new Date(1_000_000 + t),
  };
  return { opts, calls, thread };
}

test('輪流：A 到上限後交給 B，B 完成；交接寫進 thread、鎖已釋放', async () => {
  const { opts, calls, thread } = harness([
    { ms: 120_000, out: { kind: 'limit', text: '改到第三步' } },
    { ms: 120_000, out: { kind: 'done', text: '完成' } },
  ]);
  const r = await runLoop(opts);
  assert.equal(r.status, 'done');
  assert.deepEqual(calls.map((c) => c.account), ['A', 'B']);
  assert.match(calls[1].prompt, /Handoff/);
  assert.ok(!calls[0].prompt.includes('Handoff'));
  const md = readFileSync(thread, 'utf8');
  assert.ok(md.startsWith('# 原內容\n'));
  assert.match(md, /帳號 A 交給帳號 B/);
  assert.match(md, /改到第三步/);
  assert.equal(readLock(opts.lockDir, 'feature/x'), null);
});

test('輪流：兩個帳號都立刻碰到上限就停止，不空轉', async () => {
  const { opts, calls } = harness([
    { ms: 1_000, out: { kind: 'limit', text: '' } },
    { ms: 1_000, out: { kind: 'limit', text: '' } },
  ]);
  assert.equal((await runLoop(opts)).status, 'both-limited');
  assert.equal(calls.length, 2);
});

test('輪流：未知錯誤不換人，鎖保留給人檢查', async () => {
  const { opts, calls } = harness([{ ms: 5_000, out: { kind: 'error', text: '', detail: 'Invalid API key' } }]);
  const r = await runLoop(opts);
  assert.equal(r.status, 'error');
  assert.equal(calls.length, 1);
  assert.equal(readLock(opts.lockDir, 'feature/x').holder, 'A');
});

test('輪流：超過交棒上限停止', async () => {
  const long = (k) => ({ ms: 120_000, out: { kind: 'limit', text: k } });
  const { opts, calls } = harness([long('1'), long('2'), long('3')]);
  const r = await runLoop({ ...opts, maxSwitches: 2 });
  assert.equal(r.status, 'max-switches');
  assert.equal(calls.length, 3);
});

test('交接：thread 不存在要報錯，不默默建立', () => {
  assert.throws(() => appendHandoff(join(tmp(), '無.md'), {}), /找不到 thread/);
});
