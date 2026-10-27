// @ts-check
// Reference signer only; the on-site Python issuer belongs to WP3b phase two.
import { readFileSync } from 'node:fs';
import { isoSeconds, sha256Hex } from './lib.mjs';
import { issueLicenseV3 } from './system-license.mjs';
import { args, outsideRepo, passphraseFile, readJson, required, run, writeOutputs } from './system-cli.mjs';
run(() => {
  const values = args(['key', 'certificate', 'passphrase-file', 'root-public-key', 'fingerprints', 'manifest', 'client-name', 'recipe', 'enabled-kits', 'expires-at', 'out-dir']);
  const manifestBytes = readFileSync(required(values, 'manifest'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const sources = readJson(required(values, 'fingerprints'));
  const now = new Date();
  const manifestSha256 = sha256Hex(manifestBytes);
  const payload = { schemaVersion: '3.0', issuedAt: isoSeconds(now), expiresAt: required(values, 'expires-at'),
    licensee: { name: required(values, 'client-name') }, systemId: manifest.systemId, recipe: required(values, 'recipe'),
    enabledKits: required(values, 'enabled-kits').split(','), fingerprint: { minMatch: 2, sources }, packageManifestSha256: manifestSha256 };
  const license = issueLicenseV3({ payload, certificate: readJson(required(values, 'certificate')),
    encryptedPrivateKey: readFileSync(outsideRepo(required(values, 'key')), 'utf8'),
    passphrase: passphraseFile(required(values, 'passphrase-file')), rootPublicKey: readFileSync(required(values, 'root-public-key'), 'utf8'),
    manifestSha256, sources, now });
  writeOutputs(required(values, 'out-dir'), { 'license.lic': JSON.stringify(license, null, 2) });
  console.log('已簽發 license.lic 3.0');
});
