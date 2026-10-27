// @ts-check
import { constants, createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { isoSeconds, sha256Hex, signPayload, validate } from './lib.mjs';

/** @typedef {{payload: string, signature: string, algorithm: string}} Envelope */
/** @typedef {{source: string, sha256: string}} Source */
/** @typedef {{schemaVersion: string, keyId: string, issuerKeyId: string, subjectPublicKey: string, licensee: {name: string}, notBefore: string, notAfter: string}} Certificate */
/** @typedef {{schemaVersion: string, issuedAt: string, expiresAt: string, licensee: {name: string}, systemId: string, recipe: string, enabledKits: string[], fingerprint: {minMatch: number, sources: Source[]}, packageManifestSha256: string}} License */
/** @typedef {Envelope & {issuerCertificate: Envelope}} LicenseFile */
/** @typedef {{rootPublicKey: string, manifestSha256: string, sources?: Source[], now?: Date, mode?: 'issue'|'verify'}} VerifyOptions */

/** Python str.strip whitespace, which differs from JavaScript trim for NEL, BOM and control separators. @param {string} value */
export function fingerprintHash(value) {
  return sha256Hex(value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, '').toLowerCase());
}

/** @param {string} pem */
export function keyId(pem) {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('需要至少 2048 位 RSA 金鑰');
  return sha256Hex(key.export({ type: 'spki', format: 'der' }));
}

/** @param {string} text */
function timestamp(text) {
  const value = new Date(text);
  if (!Number.isFinite(value.getTime()) || isoSeconds(value) !== text) throw new Error('無效 UTC 時間');
  return value.getTime();
}

/** @param {unknown} envelope @param {string} publicKey @param {'subkeyCertificatePayload'|'licensePayloadV3'|'systemPackageSignaturePayload'} kind */
function verifySigned(envelope, publicKey, kind) {
  validate('envelope', envelope);
  const signed = /** @type {Envelope} */ (envelope);
  keyId(publicKey);
  if (!verify('sha256', Buffer.from(signed.payload, 'utf8'), {
    key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
  }, Buffer.from(signed.signature, 'base64'))) throw new Error(`${kind} 簽章不符`);
  const payload = JSON.parse(signed.payload);
  validate(kind, payload);
  return payload;
}

/** @param {unknown} envelope @param {string} rootPublicKey @returns {Certificate} */
export function verifySubkeyCertificate(envelope, rootPublicKey) {
  const certificate = /** @type {Certificate} */ (verifySigned(envelope, rootPublicKey, 'subkeyCertificatePayload'));
  if (certificate.issuerKeyId !== keyId(rootPublicKey)) throw new Error('issuerKeyId 不符');
  if (certificate.keyId !== keyId(certificate.subjectPublicKey)) throw new Error('keyId 不符');
  if (timestamp(certificate.notAfter) <= timestamp(certificate.notBefore)) throw new Error('憑證有效區間不合法');
  return certificate;
}

/** @param {{rootPrivateKey: string, clientName: string, passphrase: string, hours?: number, now?: Date}} input */
export function issueSubkey({ rootPrivateKey, clientName, passphrase, hours = 24, now = new Date() }) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('--hours 須為 1 至 168 的整數');
  if (!passphrase || /[\r\n]/u.test(passphrase)) throw new Error('密碼須為非空的一行文字');
  const issuerKeyId = keyId(rootPrivateKey);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const subjectPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const payload = { schemaVersion: '1.0', keyId: keyId(subjectPublicKey), issuerKeyId, subjectPublicKey,
    licensee: { name: clientName }, notBefore: isoSeconds(now), notAfter: isoSeconds(new Date(now.getTime() + hours * 3600000)) };
  validate('subkeyCertificatePayload', payload);
  return { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }).toString(),
    certificate: signPayload(payload, rootPrivateKey) };
}

/** @param {unknown} envelope @param {VerifyOptions} options @returns {License} */
export function verifyLicenseV3(envelope, { rootPublicKey, manifestSha256, sources, now = new Date(), mode = 'verify' }) {
  if (mode !== 'issue' && mode !== 'verify') throw new Error('mode 不合法');
  if (!Number.isFinite(now.getTime())) throw new Error('now 不合法');
  validate('licenseFileV3', envelope);
  const { issuerCertificate, ...signed } = /** @type {LicenseFile} */ (envelope);
  const certificate = verifySubkeyCertificate(issuerCertificate, rootPublicKey);
  const payload = /** @type {License} */ (verifySigned(signed, certificate.subjectPublicKey, 'licensePayloadV3'));
  const issued = timestamp(payload.issuedAt), start = timestamp(certificate.notBefore), end = timestamp(certificate.notAfter);
  if (issued < start || issued > end) throw new Error('issuedAt 不在憑證有效區間');
  if (mode === 'issue' && (now.getTime() < start || now.getTime() > end)) throw new Error('簽發時 now 不在憑證有效區間');
  if (payload.licensee.name !== certificate.licensee.name) throw new Error('licensee 不符');
  if (timestamp(payload.expiresAt) <= now.getTime()) throw new Error('expiresAt 已到期');
  if (payload.packageManifestSha256 !== manifestSha256) throw new Error('packageManifestSha256 不符');
  if (new Set(payload.fingerprint.sources.map(s => s.source)).size !== payload.fingerprint.sources.length) throw new Error('指紋來源重複');
  if (sources !== undefined) {
    validate('fingerprintSources', sources);
    const current = new Set(sources.map(s => s.sha256));
    const expected = new Set(payload.fingerprint.sources.map(s => s.sha256));
    if ([...expected].filter(hash => current.has(hash)).length < payload.fingerprint.minMatch) throw new Error('指紋交集不足');
  }
  return payload;
}

/** @param {{payload: License, encryptedPrivateKey: string, passphrase: string, certificate: Envelope} & VerifyOptions} input */
export function issueLicenseV3({ payload, encryptedPrivateKey, passphrase, certificate, ...options }) {
  validate('licensePayloadV3', payload);
  const key = createPrivateKey({ key: encryptedPrivateKey, passphrase });
  const privatePem = key.export({ type: 'pkcs8', format: 'pem' }).toString();
  const envelope = { ...signPayload(payload, privatePem), issuerCertificate: certificate };
  verifyLicenseV3(envelope, { ...options, sources: options.sources ?? payload.fingerprint.sources, mode: 'issue' });
  return envelope;
}

/** @param {{archive: Uint8Array, manifest: Uint8Array, privateKey: string, file?: string, systemId?: string, systemVersion?: string}} input */
export function signSystemPackage({ archive, manifest, privateKey, ...metadata }) {
  keyId(privateKey);
  const payload = { schemaVersion: '1.0', ...metadata, sha256: sha256Hex(archive), systemManifestSha256: sha256Hex(manifest) };
  validate('systemPackageSignaturePayload', payload);
  return signPayload(payload, privateKey);
}

/** @param {{signature: unknown, archive: Uint8Array, manifest: Uint8Array, rootPublicKey: string}} input */
export function verifySystemPackage({ signature, archive, manifest, rootPublicKey }) {
  const payload = verifySigned(signature, rootPublicKey, 'systemPackageSignaturePayload');
  if (payload.sha256 !== sha256Hex(archive)) throw new Error('tar.gz sha256 不符');
  if (payload.systemManifestSha256 !== sha256Hex(manifest)) throw new Error('systemManifestSha256 不符');
  return payload;
}

/** @param {Uint8Array} launcher @param {Uint8Array} rootPublicKey */
export function releaseFingerprints(launcher, rootPublicKey) {
  const id = keyId(Buffer.from(rootPublicKey).toString('utf8'));
  return `${sha256Hex(launcher)}  install.sh\n${sha256Hex(rootPublicKey)}  root-public.pem\n# keyId (SPKI DER sha256): ${id}\n# 精靈確認碼（前 8 碼）: ${id.slice(0, 8)}\n`;
}
