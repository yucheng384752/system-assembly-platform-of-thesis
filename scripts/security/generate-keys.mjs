// @ts-check
// Usage: node scripts/security/generate-keys.mjs --out-dir <folder outside the repo>
// Writes signing-private-key.pem and signing-public-key.pem (baseline file names). Never overwrites.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { isInside, REPO_ROOT, sha256Hex } from './lib.mjs';

try {
  const { values } = parseArgs({ options: { 'out-dir': { type: 'string' } } });
  if (!values['out-dir']) throw new Error('請以 --out-dir 指定 repo 以外的資料夾。');
  const outDir = resolve(values['out-dir']);
  // D40: a private key inside the repo is one commit away from being published.
  if (isInside(outDir, REPO_ROOT)) throw new Error(`拒絕把私鑰寫進專案資料夾：${outDir}`);
  const privatePath = join(outDir, 'signing-private-key.pem'); const publicPath = join(outDir, 'signing-public-key.pem');
  for (const path of [privatePath, publicPath]) if (existsSync(path)) throw new Error(`檔案已存在，不覆寫：${path}`);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(privatePath, privateKey, { mode: 0o600, flag: 'wx' });
  writeFileSync(publicPath, publicKey, { flag: 'wx' });
  if (process.platform === 'win32') {
    // mode is ignored on Windows; restrict the private key to the current user like the baseline Protect-EnvFile.
    const acl = spawnSync('icacls', [privatePath, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { encoding: 'utf8' });
    if (acl.status !== 0) throw new Error(`私鑰已寫入但無法限制存取權限，請手動處理：${privatePath}\n${acl.stderr || acl.stdout}`);
  }
  console.log(`私鑰：${privatePath}`);
  console.log(`公鑰：${publicPath}`);
  console.log(`公鑰 SHA-256：${sha256Hex(publicKey)}`);
} catch (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exit(1);
}
