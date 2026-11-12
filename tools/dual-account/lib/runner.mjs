// 自動輪流：A 做到用量上限就寫交接並換 B，B 到上限再換 A。
// 判斷與交棒全由程式決定（規則 5），模型只負責做事。
// 「立刻又碰到上限」（本輪執行不到 minWorkMs）算沒有實際工作；連續兩次就停止，不空轉。
import { appendHandoff } from './handoff.mjs';
import { acquire, release, transfer } from './lock.mjs';
import { otherAccount } from './accounts.mjs';

export function buildPrompt({ task, thread, resumed }) {
  if (!resumed) return task;
  return [
    task,
    '',
    `你是接手的帳號。先讀 ${thread} 最後一個 Handoff 段落，再用 git status 與 git log 確認工作樹現況，然後接續未完成項目。`,
    '遵守該段落列出的不可做的事。完成後在同一個 thread 補上開發內容與測試結果。',
  ].join('\n');
}

// runClaude(account, prompt) -> { kind: 'done'|'limit'|'error', text, detail? }
export async function runLoop({
  branch, worktree, lockDir, thread, start, task,
  maxSwitches = 4, minWorkMs = 60_000,
  runClaude, gitStatus, now = () => new Date(), log = () => {},
}) {
  let account = start;
  let switches = 0;
  let idleLimits = 0;
  acquire(lockDir, branch, account, now());
  for (;;) {
    log(`帳號 ${account} 開始工作（已交棒 ${switches} 次）`);
    const t0 = now().getTime();
    const out = await runClaude(account, buildPrompt({ task, thread, resumed: switches > 0 }));
    const worked = now().getTime() - t0 >= minWorkMs;

    if (out.kind === 'done') {
      release(lockDir, branch, account);
      return { status: 'done', account, switches, text: out.text };
    }
    // 未知錯誤保留鎖，讓人先看過；不自動換帳號重試
    if (out.kind === 'error') return { status: 'error', account, switches, detail: out.detail, text: out.text };

    idleLimits = worked ? 0 : idleLimits + 1;
    if (idleLimits >= 2) return { status: 'both-limited', account, switches, text: out.text };
    if (switches >= maxSwitches) return { status: 'max-switches', account, switches, text: out.text };

    const to = otherAccount(account);
    appendHandoff(thread, {
      from: account, to, branch, worktree,
      reason: `帳號 ${account} 觸及用量上限`,
      progress: out.text,
      gitStatus: gitStatus(),
      at: now().toISOString(),
    });
    transfer(lockDir, branch, account, to, now());
    account = to;
    switches += 1;
  }
}
