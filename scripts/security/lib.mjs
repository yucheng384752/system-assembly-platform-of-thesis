// @ts-check
// Offline signing and verification for the configuration delivery package (spec 12.2, D37-D40).
// Node built-ins plus the project's Ajv only; runs on the signer's machine, never in the browser.
import { constants, createHash, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ALGORITHM = 'RSA-PSS-SHA256';
// salt 32 equals the SHA-256 digest length; the Python verifier uses the same literal (baseline license.py).
const PSS = { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 };
export const DEFAULT_DAYS = 365;

const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas', 'license.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(schema);
const validators = {
  envelope: /** @type {import('ajv').ValidateFunction} */ (ajv.getSchema(schema.$id)),
  licensePayload: /** @type {import('ajv').ValidateFunction} */ (ajv.getSchema(`${schema.$id}#/$defs/licensePayload`)),
  zipSignaturePayload: /** @type {import('ajv').ValidateFunction} */ (ajv.getSchema(`${schema.$id}#/$defs/zipSignaturePayload`)),
};
/** @param {keyof typeof validators} kind @param {unknown} value */
export function validate(kind, value) {
  const check = validators[kind];
  if (!check(value)) throw new Error(`${kind} 格式不正確：${ajv.errorsText(check.errors, { separator: '; ' })}`);
}

/** @param {Uint8Array | string} data */
export const sha256Hex = data => createHash('sha256').update(data).digest('hex');
/** Seconds-precision UTC, matching the baseline issuedAt/expiresAt format. @param {Date} date */
export const isoSeconds = date => date.toISOString().replace(/\.\d+Z$/, 'Z');

/** True when target is the root itself or below it. @param {string} target @param {string} root */
export function isInside(target, root) {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** Same CRC-32 as apps/composer-gui/src/zip.ts; duplicated because this file must run on plain Node. @param {Uint8Array} data */
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
/**
 * Reads the store-only archives written by createZip (D31). Anything else is refused, not guessed at.
 * @param {Uint8Array} bytes
 * @returns {Map<string, Uint8Array>}
 */
export function readStoreZip(bytes) {
  const fail = (/** @type {string} */ why) => { throw new Error(`交付包不是有效的壓縮檔：${why}`); };
  if (bytes.length < 22) fail('檔案過短');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) fail('找不到目錄結尾（不支援註解或 ZIP64）');
  const count = view.getUint16(end + 10, true); const size = view.getUint32(end + 12, true); let at = view.getUint32(end + 16, true);
  if (at + size !== end) fail('中央目錄位置不符');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) fail('中央目錄項目損毀');
    const method = view.getUint16(at + 10, true); const crc = view.getUint32(at + 16, true);
    const length = view.getUint32(at + 20, true); const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (method !== 0) fail(`${path} 不是未壓縮項目`);
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(s => !s || s === '.' || s === '..')) fail(`路徑不安全：${path}`);
    if (files.has(path)) fail(`路徑重複：${path}`);
    if (local + 30 > end || view.getUint32(local, true) !== 0x04034b50) fail(`${path} 的檔頭損毀`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + length > end) fail(`${path} 超出檔案範圍`);
    const data = bytes.subarray(start, start + length);
    if (crc32(data) !== crc) fail(`${path} 的 CRC 不符`);
    files.set(path, data);
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

/**
 * Checks the package against its own manifest and returns what a license binds to.
 * @param {Uint8Array} zipBytes
 */
export function inspectPackage(zipBytes) {
  const files = readStoreZip(zipBytes);
  const manifestBytes = files.get('package-manifest.json');
  if (!manifestBytes) throw new Error('交付包缺少 package-manifest.json。');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (manifest.format !== 'composer-delivery-package' || manifest.version !== 1 || !Array.isArray(manifest.artifacts)) throw new Error('package-manifest.json 不是設定交付包 manifest。');
  const problems = [];
  for (const artifact of manifest.artifacts) {
    const data = files.get(artifact.path);
    if (!data) problems.push(`缺少 ${artifact.path}`);
    else if (sha256Hex(data) !== artifact.sha256 || data.length !== artifact.bytes) problems.push(`${artifact.path} 與 manifest 記錄不符`);
  }
  const listed = new Set(['package-manifest.json', ...manifest.artifacts.map((/** @type {{ path: string }} */ a) => a.path)]);
  for (const path of files.keys()) if (!listed.has(path)) problems.push(`${path} 不在 manifest 中`);
  if (problems.length) throw new Error(`交付包內容已被修改：${problems.join('；')}。`);
  const recipeArtifact = manifest.artifacts.find((/** @type {{ role: string }} */ a) => a.role === 'recipe');
  const recipe = JSON.parse(new TextDecoder().decode(files.get(recipeArtifact.path)));
  return { manifest, manifestSha256: sha256Hex(manifestBytes), recipe };
}

/** @param {object} payload @param {string} privateKeyPem */
export function signPayload(payload, privateKeyPem) {
  const text = JSON.stringify(payload);
  return { payload: text, signature: sign('sha256', Buffer.from(text, 'utf8'), { key: privateKeyPem, ...PSS }).toString('base64'), algorithm: ALGORITHM };
}
/**
 * Verifies the signature over the exact payload string, then its contract.
 * @param {unknown} envelope @param {string} publicKeyPem @param {'licensePayload' | 'zipSignaturePayload'} kind
 */
export function verifyEnvelope(envelope, publicKeyPem, kind) {
  validate('envelope', envelope);
  const { payload, signature } = /** @type {{ payload: string, signature: string }} */ (envelope);
  const key = createPublicKey(publicKeyPem);
  if (!verify('sha256', Buffer.from(payload, 'utf8'), { key, ...PSS }, Buffer.from(signature, 'base64'))) throw new Error('簽章不符：檔案已被修改，或不是用此金鑰簽發。');
  const value = JSON.parse(payload);
  validate(kind, value);
  return value;
}

/**
 * @param {{ recipe: { name: string, clientName?: string, enabledKits: string[] }, manifestSha256: string,
 *   machineFingerprint: string, fingerprintSource: string, days?: number, now?: Date }} input
 */
export function buildLicensePayload({ recipe, manifestSha256, machineFingerprint, fingerprintSource, days = DEFAULT_DAYS, now = new Date() }) {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('有效天數須為 1 到 3650 的整數。');
  const payload = {
    schemaVersion: '2.0', issuedAt: isoSeconds(now), expiresAt: isoSeconds(new Date(now.getTime() + days * 86400000)),
    licensee: { name: (recipe.clientName ?? '').trim() }, recipe: recipe.name, enabledKits: [...recipe.enabledKits],
    machineFingerprint: machineFingerprint.trim().toLowerCase(), fingerprintSource, packageManifestSha256: manifestSha256,
  };
  validate('licensePayload', payload);
  return payload;
}

/**
 * Signs a delivery package: the baseline <zip>.sig.json plus a machine-bound license.lic (D37-D39).
 * Refuses packages whose content no longer matches their manifest.
 * @param {{ zipBytes: Uint8Array, zipName: string, privateKeyPem: string, machineFingerprint: string, fingerprintSource: string, days?: number, now?: Date }} input
 */
export function signPackage({ zipBytes, zipName, privateKeyPem, machineFingerprint, fingerprintSource, days, now = new Date() }) {
  const { recipe, manifestSha256 } = inspectPackage(zipBytes);
  const zipPayload = { schemaVersion: '1.0', issuedAt: isoSeconds(now), zipFile: zipName, sha256: sha256Hex(zipBytes), recipe: recipe.name };
  validate('zipSignaturePayload', zipPayload);
  const license = buildLicensePayload({ recipe, manifestSha256, machineFingerprint, fingerprintSource, days, now });
  return { signature: signPayload(zipPayload, privateKeyPem), license: signPayload(license, privateKeyPem) };
}

/**
 * Pre-install check (closes the baseline gap where .sig.json was never verified). Machine binding is checked
 * at runtime by license.py on the target machine; here it is only reported.
 * @param {{ zipBytes: Uint8Array, zipName: string, signature: unknown, license: unknown, publicKeyPem: string, now?: Date }} input
 */
export function verifyPackage({ zipBytes, zipName, signature, license, publicKeyPem, now = new Date() }) {
  const zipPayload = verifyEnvelope(signature, publicKeyPem, 'zipSignaturePayload');
  if (zipPayload.sha256 !== sha256Hex(zipBytes)) throw new Error('壓縮檔的 SHA-256 與簽章記錄不符：交付包已被修改或替換。');
  if (zipPayload.zipFile !== zipName) throw new Error(`簽章記錄的檔名是 ${zipPayload.zipFile}，不是 ${zipName}。`);
  const { manifestSha256, recipe } = inspectPackage(zipBytes);
  const payload = verifyEnvelope(license, publicKeyPem, 'licensePayload');
  if (payload.packageManifestSha256 !== manifestSha256) throw new Error('授權綁定的是另一個交付包（packageManifestSha256 不符）。');
  if (payload.recipe !== recipe.name || payload.recipe !== zipPayload.recipe) throw new Error('授權、簽章與交付包的 Recipe 名稱不一致。');
  if (Date.parse(payload.expiresAt) <= now.getTime()) throw new Error(`授權已於 ${payload.expiresAt} 到期。`);
  return { recipe: payload.recipe, licensee: payload.licensee.name, expiresAt: payload.expiresAt, machineFingerprint: payload.machineFingerprint, fingerprintSource: payload.fingerprintSource };
}
