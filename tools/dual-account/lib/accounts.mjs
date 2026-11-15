// 兩個帳號各有自己的設定資料夾（CLAUDE_CONFIG_DIR）。路徑只從環境變數取得，不寫進 repo。
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function resolveAccounts(env = process.env, home = homedir()) {
  const a = env.CLAUDE_ACCOUNT_A_DIR || join(home, '.claude');
  const b = env.CLAUDE_ACCOUNT_B_DIR;
  if (!b) throw new Error('未設定 CLAUDE_ACCOUNT_B_DIR（account2 的設定資料夾路徑）');
  for (const [name, dir] of [['A', a], ['B', b]]) {
    if (!existsSync(dir)) throw new Error(`帳號 ${name} 的設定資料夾不存在：${dir}`);
  }
  if (a.toLowerCase() === b.toLowerCase()) throw new Error('帳號 A 與 B 指向同一個設定資料夾');
  return { A: a, B: b };
}

export const otherAccount = (name) => (name === 'A' ? 'B' : 'A');
