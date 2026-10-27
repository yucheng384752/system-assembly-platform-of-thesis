// @ts-check
import { readFileSync } from 'node:fs';
import { sha256Hex } from './lib.mjs';
import { verifyLicenseV3 } from './system-license.mjs';
import { args, readJson, required, run } from './system-cli.mjs';
run(() => {
  const values = args(['license', 'root-public-key', 'manifest', 'fingerprints']);
  verifyLicenseV3(readJson(required(values, 'license')), { rootPublicKey: readFileSync(required(values, 'root-public-key'), 'utf8'),
    manifestSha256: sha256Hex(readFileSync(required(values, 'manifest'))), sources: readJson(required(values, 'fingerprints')) });
  console.log('授權鏈、期限、manifest 與指紋驗證通過');
});
