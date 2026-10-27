// @ts-check
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { signSystemPackage } from './system-license.mjs';
import { args, outsideRepo, required, run, writeOutputs } from './system-cli.mjs';
run(() => {
  const values = args(['key', 'archive', 'manifest', 'system-id', 'system-version', 'out-dir']);
  const archive = required(values, 'archive');
  const signature = signSystemPackage({ privateKey: readFileSync(outsideRepo(required(values, 'key')), 'utf8'),
    archive: readFileSync(archive), manifest: readFileSync(required(values, 'manifest')), file: basename(archive),
    systemId: required(values, 'system-id'), systemVersion: required(values, 'system-version') });
  writeOutputs(required(values, 'out-dir'), { 'system-package.sig.json': JSON.stringify(signature, null, 2) });
  console.log('已簽發 system-package.sig.json');
});
