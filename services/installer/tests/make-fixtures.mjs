// Claude-only fixture utility. Generates an ephemeral TEST key; never writes a private key.
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { signPayload, sha256Hex } from '../../../scripts/security/lib.mjs';

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
