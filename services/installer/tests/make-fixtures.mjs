// Ephemeral TEST fixtures only; encrypted subkey is for Python/OpenSSL cross-verification.
import { generateKeyPairSync, createPublicKey, createPrivateKey } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { signPayload, sha256Hex } from '../../../scripts/security/lib.mjs';
import { issueSubkey, issueLicenseV3, fingerprintHash } from '../../../scripts/security/system-license.mjs';

const [archive, manifest, output] = process.argv.slice(2);
if (!archive || !manifest || !output) throw new Error('Usage: node make-fixtures.mjs TEST.tar.gz system-manifest.json NEW_OUTPUT_DIR');
mkdirSync(output);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const envelope = signPayload({ sha256: sha256Hex(readFileSync(archive)), systemManifestSha256: sha256Hex(readFileSync(manifest)) },
  privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
writeFileSync(resolve(output, 'system-package.sig.json'), JSON.stringify(envelope) + '\n');
writeFileSync(resolve(output, 'root.pem'), publicPem);
writeFileSync(resolve(output, 'fixture-info.json'), JSON.stringify({ testOnly: true,
  keyPrefix: sha256Hex(createPublicKey(publicPem).export({ type: 'spki', format: 'der' })).slice(0, 8) }) + '\n');
const rootPrivate = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const now = new Date('2026-10-28T10:00:00Z');
const subkey = issueSubkey({ rootPrivateKey: rootPrivate, clientName: 'fixture-client', passphrase: 'fixture-passphrase', now });
const subPrivate = createPrivateKey({ key: subkey.privateKey, passphrase: 'fixture-passphrase' }).export({ type: 'pkcs8', format: 'pem' }).toString();
const cert = JSON.parse(subkey.certificate.payload);
const system = JSON.parse(readFileSync(manifest, 'utf8'));
const sources = ['product_uuid', 'board_serial', 'disk:sda'].map((source, i) => ({ source, sha256: fingerprintHash(`fixture-hardware-${i}`) }));
const payload = { schemaVersion: '3.0', issuedAt: '2026-10-28T10:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
  licensee: cert.licensee, systemId: system.systemId, recipe: system.systemId,
  enabledKits: system.kits.map(/** @param {{kit: string}} k */ k => k.kit), fingerprint: { minMatch: 2, sources }, packageManifestSha256: sha256Hex(readFileSync(manifest)) };
const valid = issueLicenseV3({ payload, encryptedPrivateKey: subkey.privateKey, passphrase: 'fixture-passphrase',
  certificate: subkey.certificate, rootPublicKey: publicPem, manifestSha256: payload.packageManifestSha256, sources, now });
const sign = (change = {}, certificate = subkey.certificate) => ({ ...signPayload({ ...payload, ...change }, subPrivate), issuerCertificate: certificate });
const cases = {
  valid,
  certificateTampered: sign({}, { ...subkey.certificate, payload: JSON.stringify({ ...cert, notAfter: '2099-01-01T00:00:00Z' }) }),
  issuerMismatch: sign({}, signPayload({ ...cert, issuerKeyId: '0'.repeat(64) }, rootPrivate)),
  keyMismatch: sign({}, signPayload({ ...cert, keyId: '0'.repeat(64) }, rootPrivate)),
  licenseTampered: { ...valid, payload: JSON.stringify({ ...payload, expiresAt: '2098-01-01T00:00:00Z' }) },
  issuedOutside: sign({ issuedAt: '2026-10-27T10:00:00Z' }),
  licenseeMismatch: sign({ licensee: { name: 'other' } }),
  manifestMismatch: sign({ packageManifestSha256: '0'.repeat(64) }),
  expired: sign({ expiresAt: '2026-10-28T09:00:00Z' }),
  duplicateHashes: sign({ fingerprint: { minMatch: 2, sources: sources.map(s => ({ ...s, sha256: sources[0].sha256 })) } }),
  duplicateNames: sign({ fingerprint: { minMatch: 2, sources: sources.map(s => ({ ...s, source: 'product_uuid' })) } }),
  extraField: sign({ unexpected: true }),
};
writeFileSync(resolve(output, 'licenses.json'), JSON.stringify({ cases, sources, manifestSha256: payload.packageManifestSha256 }) + '\n');
writeFileSync(resolve(output, 'license.lic'), JSON.stringify(valid) + '\n');
writeFileSync(resolve(output, 'subkey.cert.json'), JSON.stringify(subkey.certificate) + '\n');
writeFileSync(resolve(output, 'subkey.enc.pem'), subkey.privateKey, { mode: 0o600 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
writeFileSync(resolve(output, 'other-root.pem'), other.publicKey.export({ type: 'spki', format: 'pem' }));
