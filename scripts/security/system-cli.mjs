// @ts-check
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { isInside, REPO_ROOT } from './lib.mjs';

/** @param {string[]} names @returns {Record<string, string|undefined>} */
export function args(names) {
  const options = Object.fromEntries(names.map(name => [name, { type: /** @type {const} */ ('string') }]));
  return parseArgs({ options }).values;
}
/** @param {Record<string, string|undefined>} values @param {string} name */
export function required(values, name) {
  const value = values[name];
  if (!value) throw new Error(`缺少 --${name}`);
  return value;
}
/** @param {string} path */
export function outsideRepo(path) {
  const absolute = resolve(path);
  let parent = absolute;
  while (!existsSync(parent)) parent = dirname(parent);
  if (isInside(absolute, REPO_ROOT) || isInside(realpathSync(parent), realpathSync(REPO_ROOT))) throw new Error('私鑰與子金鑰輸出不得位於 repo 內');
  return absolute;
}
/** @param {string} path */
export const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
/** @param {string} path */
export function passphraseFile(path) {
  const value = readFileSync(path, 'utf8').replace(/\r?\n$/u, '');
  if (!value || /[\r\n]/u.test(value)) throw new Error('--passphrase-file 須包含非空的一行文字');
  return value;
}
/** @param {string} directory @param {Record<string,string>} files @param {string} [privateName] */
export function writeOutputs(directory, files, privateName) {
  for (const name of Object.keys(files)) if (existsSync(join(directory, name))) throw new Error(`不覆寫既有檔案：${name}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const [name, contents] of Object.entries(files)) {
    const path = join(directory, name);
    writeFileSync(path, contents, { flag: 'wx', mode: name === privateName ? 0o600 : 0o644 });
    if (name === privateName && process.platform === 'win32') {
      const acl = spawnSync('icacls', [path, '/inheritance:r', '/grant:r', `${userInfo().username}:F`], { encoding: 'utf8' });
      if (acl.status !== 0) throw new Error('無法限制子金鑰檔權限；停止，請檢查輸出檔');
    }
  }
}
/** @param {() => void} action */
export function run(action) {
  try { action(); }
  catch (error) { console.error(error instanceof Error ? error.message : '操作失敗'); process.exitCode = 1; }
}
