import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const directory = path.dirname(fileURLToPath(import.meta.url));
/** @param {string} action @returns {string[][]} */
export function commands(action) {
  switch (action) {
    case 'up': return [['up', '--build', '--detach', '--wait', '--wait-timeout', '180']];
    case 'down': return [['down', '--remove-orphans']];
    case 'status': return [['ps', '--all']];
    // Stop all background writers before deleting only this Compose project's volumes.
    case 'reset': return [['down', '--volumes', '--remove-orphans'], ['up', '--detach', '--wait', '--wait-timeout', '180']];
    default: throw new Error('用法：node services/preview/preview.mjs up|down|reset|status');
  }
}

/** @param {string} action @param {typeof spawnSync} [run] */
export function execute(action, run = spawnSync, recipeFile = undefined) {
  if (recipeFile && action !== 'up') throw new Error('--recipe 只適用於 up');
  const recipe = recipeFile ? JSON.stringify(JSON.parse(readFileSync(path.resolve(recipeFile), 'utf8').replace(/^\uFEFF/, ''))) : '';
  for (const args of commands(action)) {
    const result = run('docker', ['compose', '--project-name', 'composer-preview',
      '--file', path.join(directory, 'docker-compose.yml'), ...args], {
      cwd: directory, stdio: 'inherit', shell: false, env: { ...process.env, PREVIEW_RECIPE_JSON: recipe } });
    if (result.error) throw new Error(`無法執行 docker compose：${result.error.message}。請確認 Docker 與 Compose v2 已安裝且可執行。`);
    if (result.status !== 0) throw new Error(`docker compose ${args[0]} 失敗（${result.signal ?? result.status}）；請查看上方輸出與 compose logs。`);
  }
  console.log(action === 'reset' ? '預覽 volume 已重建；資料表為空，未建立租戶或業務資料。' : `預覽 ${action} 完成。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!(process.argv.length === 3 || (process.argv.length === 5 && process.argv[3] === '--recipe'))) {
      throw new Error('用法：preview.mjs up|down|reset|status [--recipe <檔>]');
    }
    execute(process.argv[2], spawnSync, process.argv[4]);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
