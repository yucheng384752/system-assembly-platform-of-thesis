// @ts-check
import { readFileSync } from 'node:fs';
import { issueSubkey } from './system-license.mjs';
import { args, outsideRepo, passphraseFile, required, run, writeOutputs } from './system-cli.mjs';
run(() => {
  const values = args(['root-key', 'client-name', 'hours', 'out-dir', 'passphrase-file']);
  const root = outsideRepo(required(values, 'root-key'));
  const out = outsideRepo(required(values, 'out-dir'));
  const result = issueSubkey({ rootPrivateKey: readFileSync(root, 'utf8'), clientName: required(values, 'client-name'),
    hours: values.hours === undefined ? 24 : Number(values.hours), passphrase: passphraseFile(required(values, 'passphrase-file')) });
  writeOutputs(out, { 'subkey.enc.pem': result.privateKey, 'subkey.cert.json': JSON.stringify(result.certificate, null, 2) }, 'subkey.enc.pem');
  console.log('已簽發 subkey.enc.pem 與 subkey.cert.json');
});
