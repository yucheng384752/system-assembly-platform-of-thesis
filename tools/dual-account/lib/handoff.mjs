// 交接寫進 mailbox 既有 thread（一個功能一個 thread），以新段落追加，不改動既有內容。
import { appendFileSync, existsSync } from 'node:fs';

export const FORBIDDEN = '推送、合併、刪除分支或資料仍需 user 同意；不得改動對方帳號的設定資料夾。';

export function renderHandoff({ from, to, branch, worktree, reason, progress, gitStatus, at }) {
  return [
    '',
    `## Handoff ${at}：帳號 ${from} 交給帳號 ${to}`,
    '',
    `- 原因：${reason}`,
    `- 分支：\`${branch}\``,
    `- 工作樹：\`${worktree}\``,
    `- 不可做的事：${FORBIDDEN}`,
    '',
    '交出方最後一則訊息（機器擷取，未經審閱；未完成項目以此與 thread 上方段落為準）：',
    '',
    progress || '（交出方沒有留下訊息；請接手方先看 git status 與 git log 還原狀態）',
    '',
    '工作樹狀態（git status --short）：',
    '',
    '```',
    gitStatus || '（乾淨）',
    '```',
    '',
  ].join('\n');
}

export function appendHandoff(threadPath, data) {
  if (!existsSync(threadPath)) {
    throw new Error(`找不到 thread：${threadPath}。請先建立該功能的 mailbox thread，再交接`);
  }
  appendFileSync(threadPath, renderHandoff(data));
}
