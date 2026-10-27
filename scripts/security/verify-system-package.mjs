// @ts-check
import { readFileSync } from 'node:fs';
import { verifySystemPackage } from './system-license.mjs';
import { args, readJson, required, run } from './system-cli.mjs';
run(() => {
  const values = args(['signature', 'archive', 'manifest', 'root-public-key']);
  verifySystemPackage({ signature: readJson(required(values, 'signature')), archive: readFileSync(required(values, 'archive')),
    manifest: readFileSync(required(values, 'manifest')), rootPublicKey: readFileSync(required(values, 'root-public-key'), 'utf8') });
  console.log('安裝包簽章與兩個檔案雜湊驗證通過');
});
