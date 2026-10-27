// @ts-check
import { readFileSync } from 'node:fs';
import { releaseFingerprints } from './system-license.mjs';
import { args, required, run, writeOutputs } from './system-cli.mjs';
run(() => {
  const values = args(['launcher', 'root-public-key', 'out-dir']);
  const text = releaseFingerprints(readFileSync(required(values, 'launcher')), readFileSync(required(values, 'root-public-key')));
  writeOutputs(values['out-dir'] ?? '.', { 'release-fingerprints.txt': text });
  console.log(text);
});
