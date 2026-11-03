import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The evaluator as one self-contained CommonJS file, so a deployment needs only the node binary. Deterministic: same sources, same bytes.
 * @returns {Promise<Buffer>} */
export async function bundleEvaluator() {
  const result = await build({
    absWorkingDir: repository, entryPoints: ['services/evaluator/src/main.ts'], bundle: true, platform: 'node', target: 'node22',
    format: 'cjs', write: false, legalComments: 'none', logLevel: 'silent', outfile: 'evaluator.cjs',
  });
  if (result.outputFiles.length !== 1) throw new Error('evaluator bundle must be a single file');
  return Buffer.from(result.outputFiles[0].contents);
}

// node services/evaluator/build.mjs <outfile>
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { console.error('usage: node services/evaluator/build.mjs <outfile>'); process.exit(2); }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(process.argv[2], await bundleEvaluator());
}
