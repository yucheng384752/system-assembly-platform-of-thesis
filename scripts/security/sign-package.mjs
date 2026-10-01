// @ts-check
// Usage: node scripts/security/sign-package.mjs --key <private.pem> --zip <package.zip>
//          --machine-fingerprint <sha256> --fingerprint-source <windows-machine-guid|linux-machine-id> [--days 365] [--out-dir <folder>] [--force]
// Writes <package>.sig.json and license.lic next to the zip (or into --out-dir).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isInside, REPO_ROOT, signPackage } from './lib.mjs';

try {
  const { values } = parseArgs({ options: { key: { type: 'string' }, zip: { type: 'string' }, 'machine-fingerprint': { type: 'string' },
    'fingerprint-source': { type: 'string' }, days: { type: 'string' }, 'out-dir': { type: 'string' }, force: { type: 'boolean' } } });
  const required = /** @type {const} */ (['key', 'zip', 'machine-fingerprint', 'fingerprint-source']);
  for (const name of required) if (!values[name]) throw new Error(`缺少 --${name}。`);
  const keyPath = resolve(String(values.key)); const zipPath = resolve(String(values.zip));
  if (isInside(keyPath, REPO_ROOT)) throw new Error(`私鑰不可放在專案資料夾內：${keyPath}`);
  const outDir = resolve(values['out-dir'] ?? dirname(zipPath));
  const zipName = basename(zipPath);
  const signaturePath = join(outDir, zipName.replace(/\.zip$/i, '.sig.json')); const licensePath = join(outDir, 'license.lic');
  if (!values.force) for (const path of [signaturePath, licensePath]) if (existsSync(path)) throw new Error(`檔案已存在，加上 --force 才覆寫：${path}`);
  const result = signPackage({ zipBytes: readFileSync(zipPath), zipName, privateKeyPem: readFileSync(keyPath, 'utf8'),
    machineFingerprint: String(values['machine-fingerprint']), fingerprintSource: String(values['fingerprint-source']),
    days: values.days === undefined ? undefined : Number(values.days) });
  writeFileSync(signaturePath, JSON.stringify(result.signature, null, 2), 'utf8');
  writeFileSync(licensePath, JSON.stringify(result.license, null, 2), 'utf8');
  const payload = JSON.parse(result.license.payload);
  console.log(`已簽章：${signaturePath}`);
  console.log(`授權檔：${licensePath}（${payload.licensee.name}，到期 ${payload.expiresAt}，綁定 ${payload.fingerprintSource}）`);
} catch (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exit(1);
}
