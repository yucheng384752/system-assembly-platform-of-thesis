// Plain .mjs so it can use Node built-ins without @types/node, which the project does not install.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exportRecipe } from '../../../libs/ui-runtime/recipe';
import { initialRecipe } from './App';
import { catalog } from './previewCatalog';
import { buildDeliveryPackage } from './deliveryPackage';
import { exportAov, sha256Hex } from './workflow';
import { createZip } from './zip';
import { readZip } from './testZip';
import { inspectPackage, readStoreZip, REPO_ROOT, signPackage, verifyPackage } from '../../../scripts/security/lib.mjs';

const FINGERPRINT = 'f'.repeat(64);
const keys = () => generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const issuer = keys();
async function deliveryPackage(stepName = '收料') {
  /** @type {import('./workflow').AovDocument} */
  const workflow = { format: 'composer-aov-list', version: 2,
    steps: [{ id: 'step-1', name: stepName, when: '', owner: '倉管', formIds: ['form-1'] }],
    forms: [{ id: 'form-1', name: '收料單', fields: [{ id: 'field-1', name: '批號', type: 'text', required: true, isKey: true }] }], relations: [] };
  const workflowText = exportAov(workflow);
  const recipeText = exportRecipe({ ...initialRecipe, clientName: '示範客戶', workflowRef: { path: 'workflow.aov.json', sha256: await sha256Hex(workflowText) } }, catalog);
  return buildDeliveryPackage(recipeText, workflowText, catalog);
}
/** @param {Uint8Array} bytes @param {string} fileName @param {string} [privateKeyPem] */
const sign = (bytes, fileName, privateKeyPem = issuer.privateKey) =>
  signPackage({ zipBytes: bytes, zipName: fileName, privateKeyPem, machineFingerprint: FINGERPRINT, fingerprintSource: 'windows-machine-guid' });
// Rebuilds the archive with one file swapped but the original manifest, like a hand edit of an extracted package.
/** @param {Uint8Array} bytes @param {string} path @param {string} text */
const swap = (bytes, path, text) =>
  createZip(readZip(bytes).map(e => ({ path: e.path, data: e.path === path ? new TextEncoder().encode(text) : e.data })));

test('a signed package verifies, and the license binds client, machine and this exact package (D37-D39)', async () => {
  const built = await deliveryPackage();
  const signed = sign(built.bytes, built.fileName);
  const result = verifyPackage({ zipBytes: built.bytes, zipName: built.fileName, signature: signed.signature, license: signed.license, publicKeyPem: issuer.publicKey });
  expect(result).toMatchObject({ recipe: 'my-system', licensee: '示範客戶', machineFingerprint: FINGERPRINT, fingerprintSource: 'windows-machine-guid' });
  const license = JSON.parse(signed.license.payload);
  expect(license.packageManifestSha256).toBe(inspectPackage(built.bytes).manifestSha256);
  expect(Date.parse(license.expiresAt) - Date.parse(license.issuedAt)).toBe(365 * 86400000);
  expect(license).not.toHaveProperty('machinePublicKey');
  expect(JSON.stringify(signed)).not.toMatch(/PRIVATE KEY/);
});
test('editing any packaged file is detected, before signing and before installing', async () => {
  const built = await deliveryPackage();
  const signed = sign(built.bytes, built.fileName);
  const edited = swap(built.bytes, 'config/system.recipe.json', '{"edited":true}');
  expect(() => sign(edited, built.fileName)).toThrow('交付包內容已被修改：config/system.recipe.json 與 manifest 記錄不符');
  expect(() => verifyPackage({ zipBytes: edited, zipName: built.fileName, signature: signed.signature, license: signed.license, publicKeyPem: issuer.publicKey }))
    .toThrow('壓縮檔的 SHA-256 與簽章記錄不符');
  const extra = createZip([...readZip(built.bytes).map(e => ({ path: e.path, data: e.data })), { path: 'deployment/run.ps1', data: new TextEncoder().encode('x') }]);
  expect(() => inspectPackage(extra)).toThrow('deployment/run.ps1 不在 manifest 中');
});
test('a license cannot be reused for another package, another issuer, or after expiry', async () => {
  const a = await deliveryPackage('收料'); const b = await deliveryPackage('進料');
  const signedA = sign(a.bytes, a.fileName); const signedB = sign(b.bytes, b.fileName);
  expect(() => verifyPackage({ zipBytes: b.bytes, zipName: b.fileName, signature: signedB.signature, license: signedA.license, publicKeyPem: issuer.publicKey }))
    .toThrow('授權綁定的是另一個交付包');
  const forged = sign(a.bytes, a.fileName, keys().privateKey);
  expect(() => verifyPackage({ zipBytes: a.bytes, zipName: a.fileName, signature: forged.signature, license: forged.license, publicKeyPem: issuer.publicKey }))
    .toThrow('簽章不符');
  expect(() => verifyPackage({ zipBytes: a.bytes, zipName: a.fileName, signature: signedA.signature, license: signedA.license, publicKeyPem: issuer.publicKey, now: new Date(Date.now() + 400 * 86400000) }))
    .toThrow('授權已於');
});
test('licenses must be machine-bound with a known source (D38)', async () => {
  const built = await deliveryPackage();
  /** @param {string} machineFingerprint @param {string} fingerprintSource */
  const attempt = (machineFingerprint, fingerprintSource) =>
    signPackage({ zipBytes: built.bytes, zipName: built.fileName, privateKeyPem: issuer.privateKey, machineFingerprint, fingerprintSource });
  expect(() => attempt('', 'windows-machine-guid')).toThrow('licensePayload 格式不正確');
  expect(() => attempt(FINGERPRINT, 'tpm-ek')).toThrow('licensePayload 格式不正確');
  expect(() => attempt(FINGERPRINT.toUpperCase(), 'linux-machine-id')).not.toThrow();
});
test('the package reader refuses archives it did not write instead of guessing', () => {
  const zip = createZip([{ path: 'a.json', data: new TextEncoder().encode('{}') }]);
  const central = zip.length - 22 - 46 - 'a.json'.length;
  const deflated = zip.slice(); new DataView(deflated.buffer).setUint16(central + 10, 8, true);
  expect(() => readStoreZip(deflated)).toThrow('不是未壓縮項目');
  const corrupt = zip.slice(); corrupt[30 + 'a.json'.length] ^= 0xff;
  expect(() => readStoreZip(corrupt)).toThrow('CRC 不符');
  expect(() => readStoreZip(new Uint8Array(10))).toThrow('檔案過短');
});

// End to end through the real command-line tools, as the issuer and the installer would run them.
let work = '';
beforeAll(() => { work = mkdtempSync(join(tmpdir(), 'composer-security-')); });
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
  // If the repo guard ever regresses, never leave a generated private key inside the project.
  rmSync(resolve(REPO_ROOT, 'keys-should-not-exist'), { recursive: true, force: true });
});
/** @param {string} name @param {...string} args */
const cli = (name, ...args) => spawnSync(process.execPath, [resolve(REPO_ROOT, 'scripts', 'security', name), ...args], { encoding: 'utf8' });
test('CLI: keys stay outside the repo, signing and verification succeed, and a tampered zip fails with exit code 1', async () => {
  const inRepo = cli('generate-keys.mjs', '--out-dir', resolve(REPO_ROOT, 'keys-should-not-exist'));
  expect(inRepo.status).toBe(1);
  expect(inRepo.stderr).toContain('拒絕把私鑰寫進專案資料夾');
  expect(existsSync(resolve(REPO_ROOT, 'keys-should-not-exist'))).toBe(false);

  const keyDir = join(work, 'keys');
  expect(cli('generate-keys.mjs', '--out-dir', keyDir).status).toBe(0);
  expect(cli('generate-keys.mjs', '--out-dir', keyDir).stderr).toContain('不覆寫');
  const built = await deliveryPackage();
  const zipPath = join(work, built.fileName); writeFileSync(zipPath, built.bytes);
  const signArgs = ['--zip', zipPath, '--machine-fingerprint', FINGERPRINT, '--fingerprint-source', 'windows-machine-guid'];
  const keyInRepo = cli('sign-package.mjs', '--key', resolve(REPO_ROOT, 'package.json'), ...signArgs);
  expect(keyInRepo.stderr).toContain('私鑰不可放在專案資料夾內');
  const signed = cli('sign-package.mjs', '--key', join(keyDir, 'signing-private-key.pem'), ...signArgs);
  expect(signed.status, signed.stderr).toBe(0);
  expect(cli('sign-package.mjs', '--key', join(keyDir, 'signing-private-key.pem'), ...signArgs).stderr).toContain('--force');
  const verify = () => cli('verify-package.mjs', '--public-key', join(keyDir, 'signing-public-key.pem'), '--zip', zipPath);
  const ok = verify();
  expect(ok.status, ok.stderr).toBe(0);
  expect(ok.stdout).toContain('驗證通過');
  const tampered = readFileSync(zipPath); tampered[tampered.length - 30] ^= 1; writeFileSync(zipPath, tampered);
  const bad = verify();
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain('驗證失敗');
}, 30000);
