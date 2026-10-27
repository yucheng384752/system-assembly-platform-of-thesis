// @ts-check
// Run separately: node scripts/security/tests/mutations.mjs
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const source = readFileSync(new URL('../system-license.mjs', import.meta.url), 'utf8');
const target = fileURLToPath(new URL(`../.wp3d-mutant-${process.pid}.mjs`, import.meta.url));
const testFile = fileURLToPath(new URL('./system-license.test.mjs', import.meta.url));
const mutations = [
  ['certificate signature', "if (!verify('sha256',", "if (kind !== 'subkeyCertificatePayload' && !verify('sha256',", 'certificate signature tampering'],
  ['issuerKeyId', 'if (certificate.issuerKeyId !== keyId(rootPublicKey))', 'if (false)', 'issuerKeyId mismatch'],
  ['issuedAt', 'if (issued < start || issued > end)', 'if (false)', 'issuedAt outside'],
  ['licensee', 'if (payload.licensee.name !== certificate.licensee.name)', 'if (false)', 'licensee mismatch'],
  ['fingerprint intersection', 'if ([...expected].filter(hash => current.has(hash)).length < payload.fingerprint.minMatch)', 'if (false)', 'fingerprint intersection'],
  ['manifest hash', 'if (payload.packageManifestSha256 !== manifestSha256)', 'if (false)', 'manifest mismatch'],
];
try {
  for (const [name, before, after, pattern] of mutations) {
    assert.equal(source.split(before).length, 2, `${name}: unique mutation target`);
    writeFileSync(target, source.replace(before, after), { flag: 'wx' });
    const result = spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, testFile], {
      encoding: 'utf8', env: { ...process.env, WP3D_TEST_MODULE: pathToFileURL(target).href },
    });
    unlinkSync(target);
    assert.equal(result.status, 1, `${name}: mutant must fail\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout + result.stderr, /Missing expected exception/, `${name}: must fail assertion, not module loading`);
    console.log(`KILLED: ${name}`);
  }
} finally {
  try { unlinkSync(target); } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
}
