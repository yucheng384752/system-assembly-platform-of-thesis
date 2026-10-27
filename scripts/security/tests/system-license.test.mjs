// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isoSeconds, REPO_ROOT, sha256Hex, signPayload, validate } from '../lib.mjs';
import { outsideRepo, passphraseFile } from '../system-cli.mjs';
// The mutation runner supplies a temporary sibling module; production code has no mutation switches.
const api = await import(process.env.WP3D_TEST_MODULE ?? '../system-license.mjs');
const { fingerprintHash, issueSubkey, issueLicenseV3, keyId, releaseFingerprints, signSystemPackage,
  verifyLicenseV3, verifySubkeyCertificate, verifySystemPackage } = /** @type {typeof import('../system-license.mjs')} */ (api);

const keys = () => generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const root = keys(), other = keys();
const now = new Date('2026-10-27T10:00:00Z');
const subkey = issueSubkey({ rootPrivateKey: root.privateKey, clientName: '客戶', passphrase: 'test-secret', now });
const subPrivate = createPrivateKey({ key: subkey.privateKey, passphrase: 'test-secret' }).export({ type: 'pkcs8', format: 'pem' }).toString();
const certificate = JSON.parse(subkey.certificate.payload);
const manifest = Buffer.from('{"systemId":"demo"}');
const sources = ['product_uuid', 'board_serial', 'mac:eth0'].map((source, i) => ({ source, sha256: fingerprintHash(`hardware-${i}`) }));
/** @type {import('../system-license.mjs').License} */
const payload = { schemaVersion: '3.0', issuedAt: isoSeconds(now), expiresAt: '2027-10-27T10:00:00Z',
  licensee: { name: '客戶' }, systemId: 'demo', recipe: 'demo', enabledKits: ['platform-core-kit'],
  fingerprint: { minMatch: 2, sources }, packageManifestSha256: sha256Hex(manifest) };
const options = { rootPublicKey: root.publicKey, manifestSha256: sha256Hex(manifest), sources, now };
/** @param {Partial<import('../system-license.mjs').License>} [changes] @param {import('../system-license.mjs').Envelope} [cert] @param {string} [privateKey] */
const license = (changes = {}, cert = subkey.certificate, privateKey = subPrivate) => ({ ...signPayload({ ...payload, ...changes }, privateKey), issuerCertificate: cert });
/** @param {Record<string, unknown>} changes */
const certWith = changes => signPayload({ ...certificate, ...changes }, root.privateKey);

test('normalization preserves internal spaces and separators, matches Python strip', () => {
  assert.equal(fingerprintHash('  AB CD  '), 'b09c5477abec5b3275cc94f1884843b392d708547fe5861a4fbe400e2a64c5eb');
  assert.equal(fingerprintHash(' AA:BB-CD '), sha256Hex('aa:bb-cd'));
  assert.equal(fingerprintHash('\u0085\u001cAB\u0085'), sha256Hex('ab'));
  assert.equal(fingerprintHash('\uFEFFAB\uFEFF'), sha256Hex('\uFEFFab\uFEFF'));
});
test('subkey encryption, default expiry and normal license chain', () => {
  assert.match(subkey.privateKey, /BEGIN ENCRYPTED PRIVATE KEY/);
  assert.throws(() => createPrivateKey({ key: subkey.privateKey, passphrase: 'wrong' }));
  assert.equal(verifySubkeyCertificate(subkey.certificate, root.publicKey).notAfter, '2026-10-28T10:00:00Z');
  const signed = issueLicenseV3({ payload, encryptedPrivateKey: subkey.privateKey, passphrase: 'test-secret', certificate: subkey.certificate, ...options });
  assert.deepEqual(verifyLicenseV3(signed, options), payload);
  assert.throws(() => validate('envelope', signed));
});
test('certificate signature tampering is rejected', () => {
  const tampered = { ...subkey.certificate, payload: JSON.stringify({ ...certificate, notAfter: '2026-10-29T10:00:00Z' }) };
  assert.throws(() => verifyLicenseV3(license({}, tampered), options), /簽章/);
});
test('wrong root certificate signature is rejected', () => {
  assert.throws(() => verifyLicenseV3(license({}, signPayload(certificate, other.privateKey)), options), /簽章/);
});
test('issuerKeyId mismatch is rejected even with valid root signature', () => {
  assert.throws(() => verifyLicenseV3(license({}, certWith({ issuerKeyId: keyId(other.publicKey) })), options), /issuerKeyId/);
});
test('subject keyId mismatch is rejected', () => {
  assert.throws(() => verifyLicenseV3(license({}, certWith({ keyId: keyId(other.publicKey) })), options), /keyId/);
});
test('wrong subkey license signature is rejected', () => {
  assert.throws(() => verifyLicenseV3(license({}, subkey.certificate, other.privateKey), options), /簽章/);
});
test('issuedAt outside certificate interval is rejected', () => {
  for (const issuedAt of ['2026-10-27T09:59:59Z', '2026-10-28T10:00:01Z']) {
    assert.throws(() => verifyLicenseV3(license({ issuedAt }), options), /issuedAt/);
  }
  for (const issuedAt of [certificate.notBefore, certificate.notAfter]) assert.doesNotThrow(() => verifyLicenseV3(license({ issuedAt }), options));
});
test('issue mode checks now but verify mode accepts expired subkey', () => {
  for (const date of ['2026-10-27T09:59:59Z', '2026-10-29T10:00:00Z']) {
    assert.throws(() => verifyLicenseV3(license(), { ...options, mode: 'issue', now: new Date(date) }), /now/);
  }
  assert.doesNotThrow(() => verifyLicenseV3(license(), { ...options, now: new Date('2026-10-29T10:00:00Z') }));
});
test('licensee mismatch is rejected', () => {
  assert.throws(() => verifyLicenseV3(license({ licensee: { name: '別的客戶' } }), options), /licensee/);
});
test('manifest mismatch is rejected', () => {
  assert.throws(() => verifyLicenseV3(license(), { ...options, manifestSha256: '0'.repeat(64) }), /packageManifestSha256/);
});
test('fingerprint intersection uses unique hashes and ignores interface names', () => {
  assert.throws(() => verifyLicenseV3(license(), { ...options, sources: [sources[0], sources[0]] }), /交集/);
  assert.throws(() => verifyLicenseV3(license(), { ...options, sources: [] }), /交集/);
  assert.doesNotThrow(() => verifyLicenseV3(license(), { ...options, sources: [sources[0], { ...sources[2], source: 'mac:renamed' }] }));
  const duplicates = { minMatch: 2, sources: sources.map(s => ({ ...s, sha256: sources[0].sha256 })) };
  assert.throws(() => verifyLicenseV3(license({ fingerprint: duplicates }), options), /交集/);
});
test('expiry and invalid calendar dates are rejected', () => {
  assert.throws(() => verifyLicenseV3(license({ expiresAt: isoSeconds(now) }), options), /expiresAt/);
  assert.throws(() => verifyLicenseV3(license({ expiresAt: '2027-02-30T00:00:00Z' }), options), /UTC/);
});
test('schema rejects missing sources, duplicate source names and additional fields', () => {
  assert.throws(() => verifyLicenseV3(license({ fingerprint: { minMatch: 2, sources: sources.slice(0, 2) } }), options));
  assert.throws(() => verifyLicenseV3(license({ fingerprint: { minMatch: 2, sources: [sources[0], sources[0], sources[1]] } }), options), /來源重複/);
  assert.throws(() => verifyLicenseV3({ ...license(), extra: true }, options));
});
test('hours and private paths reject invalid input', () => {
  for (const hours of [169, 0, -1, NaN, 1.5]) assert.throws(() => issueSubkey({ rootPrivateKey: root.privateKey, clientName: '客戶', passphrase: 'test', hours }), /hours/);
  assert.throws(() => outsideRepo(join(REPO_ROOT, 'private-key.pem')), /repo/);
  assert.throws(() => outsideRepo(REPO_ROOT), /repo/);
});
test('system package signature binds exact archive and manifest bytes', () => {
  const archive = Buffer.from('archive fixture');
  const signature = signSystemPackage({ archive, manifest, privateKey: root.privateKey });
  const input = { archive, manifest, signature, rootPublicKey: root.publicKey };
  assert.doesNotThrow(() => verifySystemPackage(input));
  assert.throws(() => verifySystemPackage({ ...input, archive: Buffer.concat([archive, Buffer.from('x')]) }), /tar.gz/);
  assert.throws(() => verifySystemPackage({ ...input, manifest: Buffer.concat([manifest, Buffer.from(' ')]) }), /systemManifestSha256/);
  assert.throws(() => verifySystemPackage({ ...input, rootPublicKey: other.publicKey }), /簽章/);
});
test('release fingerprints distinguish file hashes from SPKI identity', () => {
  const publicBytes = Buffer.from(root.publicKey);
  const lines = releaseFingerprints(Buffer.from('launcher'), publicBytes).trim().split('\n');
  assert.equal(lines[0], `${sha256Hex('launcher')}  install.sh`);
  assert.equal(lines[1], `${sha256Hex(publicBytes)}  root-public.pem`);
  assert.equal(lines[2], `# keyId (SPKI DER sha256): ${keyId(root.publicKey)}`);
  assert.equal(lines[3], `# 精靈確認碼（前 8 碼）: ${keyId(root.publicKey).slice(0, 8)}`);
  assert.notEqual(sha256Hex(publicBytes), keyId(root.publicKey));
});
test('all six CLIs work offline, never overwrite, and reject bad inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wp3d-'));
  /** @param {string} name @param {string} contents */
  const file = (name, contents) => { const path = join(directory, name); writeFileSync(path, contents); return path; };
  /** @param {string} script @param {string[]} argv */
  const cli = (script, argv) => spawnSync(process.execPath, [resolve(REPO_ROOT, 'scripts/security', script + '.mjs'), ...argv], { encoding: 'utf8' });
  try {
    const rootPath = file('root.pem', root.privateKey), publicPath = file('root-public.pem', root.publicKey);
    const password = file('passphrase', 'test-secret\n');
    const manifestPath = file('system-manifest.json', manifest.toString());
    const archive = file('system.tar.gz', 'archive fixture'), fingerprints = file('sources.json', JSON.stringify(sources));
    const subArgs = ['--root-key', rootPath, '--client-name', '客戶', '--passphrase-file', password, '--out-dir', directory];
    const issued = cli('issue-subkey', subArgs);
    assert.equal(issued.status, 0, issued.stderr);
    assert.doesNotMatch(issued.stdout + issued.stderr, /test-secret/);
    assert.notEqual(cli('issue-subkey', subArgs).status, 0);
    assert.notEqual(cli('issue-subkey', [...subArgs, '--hours', '169']).status, 0);
    assert.notEqual(cli('issue-subkey', [...subArgs.slice(0, -1), REPO_ROOT]).status, 0);
    const malformedPassword = file('bad-passphrase', 'line1\nline2');
    assert.throws(() => passphraseFile(malformedPassword), /一行/);
    const signArgs = ['--key', rootPath, '--archive', archive, '--manifest', manifestPath, '--system-id', 'demo', '--system-version', '1.0.0', '--out-dir', directory];
    assert.equal(cli('sign-system-package', signArgs).status, 0);
    const verifyArgs = ['--signature', join(directory, 'system-package.sig.json'), '--archive', archive, '--manifest', manifestPath, '--root-public-key', publicPath];
    assert.equal(cli('verify-system-package', verifyArgs).status, 0);
    writeFileSync(archive, 'archive fixture!');
    assert.notEqual(cli('verify-system-package', verifyArgs).status, 0);
    const licenseArgs = ['--key', join(directory, 'subkey.enc.pem'), '--certificate', join(directory, 'subkey.cert.json'),
      '--passphrase-file', password, '--root-public-key', publicPath, '--fingerprints', fingerprints, '--manifest', manifestPath,
      '--client-name', '客戶', '--recipe', 'demo', '--enabled-kits', 'platform-core-kit',
      '--expires-at', isoSeconds(new Date(Date.now() + 86400000 * 365)), '--out-dir', directory];
    const licensed = cli('issue-license', licenseArgs);
    assert.equal(licensed.status, 0, licensed.stderr);
    const checkArgs = ['--license', join(directory, 'license.lic'), '--root-public-key', publicPath, '--fingerprints', fingerprints, '--manifest', manifestPath];
    assert.equal(cli('verify-license', checkArgs).status, 0);
    writeFileSync(fingerprints, '[]');
    assert.notEqual(cli('verify-license', checkArgs).status, 0);
    const release = cli('release-fingerprints', ['--launcher', archive, '--root-public-key', publicPath, '--out-dir', directory]);
    assert.equal(release.status, 0, release.stderr);
    assert.ok(existsSync(join(directory, 'release-fingerprints.txt')));
    const preserved = readFileSync(join(directory, 'license.lic'), 'utf8');
    assert.notEqual(cli('issue-license', licenseArgs).status, 0);
    assert.equal(readFileSync(join(directory, 'license.lic'), 'utf8'), preserved);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
