// @ts-check
// Usage: node scripts/security/verify-package.mjs --public-key <public.pem> --zip <package.zip> [--signature <file>] [--license <file>]
// Exit code 0 only when the zip signature, the license signature and every packaged file check out.
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { verifyPackage } from './lib.mjs';

try {
  const { values } = parseArgs({ options: { 'public-key': { type: 'string' }, zip: { type: 'string' }, signature: { type: 'string' }, license: { type: 'string' } } });
  if (!values['public-key'] || !values.zip) throw new Error('缺少 --public-key 或 --zip。');
  const zipPath = resolve(values.zip); const zipName = basename(zipPath);
  const readJson = (/** @type {string} */ path) => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  const result = verifyPackage({ zipBytes: readFileSync(zipPath), zipName, publicKeyPem: readFileSync(resolve(values['public-key']), 'utf8'),
    signature: readJson(resolve(values.signature ?? join(dirname(zipPath), zipName.replace(/\.zip$/i, '.sig.json')))),
    license: readJson(resolve(values.license ?? join(dirname(zipPath), 'license.lic'))) });
  console.log('驗證通過：壓縮檔簽章、授權簽章與交付包內容皆相符。');
  console.log(`客戶：${result.licensee}；Recipe：${result.recipe}；到期：${result.expiresAt}`);
  console.log(`綁定機器（${result.fingerprintSource}）：${result.machineFingerprint}；實際機器於系統啟動時比對。`);
} catch (failure) {
  console.error(`驗證失敗：${failure instanceof Error ? failure.message : String(failure)}`);
  process.exit(1);
}
