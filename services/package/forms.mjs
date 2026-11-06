import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { repository } from '../evaluator/build.mjs';

/** The form bundle checker is Composer's own TypeScript (libs/aov-integration/formBundle.ts); bundling it here keeps one
 * implementation of the canonical hash instead of a third copy in this tool.
 * @returns {Promise<(raw: unknown) => Promise<string[]>>} */
async function bundleChecker() {
  const result = await build({
    absWorkingDir: repository, entryPoints: ['libs/aov-integration/formBundle.ts'], bundle: true, platform: 'node', target: 'node22',
    format: 'esm', write: false, legalComments: 'none', logLevel: 'silent', outfile: 'formBundle.mjs',
  });
  const source = Buffer.from(result.outputFiles[0].contents).toString('utf8');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  return module.checkFormBundle;
}

/** Read a form bundle file and return the package entries: `forms/<hash>.json`, each exactly a POST /api/factory/forms body.
 * Refuses a bundle whose forms do not prove their hash, so a package never carries a form the factory would reject at start.
 * @param {string} file
 * @returns {Promise<Map<string, Buffer>>} */
export async function formEntries(file) {
  /** @type {unknown} */
  let bundle;
  try { bundle = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`表單檔包無法讀取：${error instanceof Error ? error.message : error}`); }
  const errors = await (await bundleChecker())(bundle);
  if (errors.length) throw new Error(`表單檔包不合格：${errors.join('；')}`);
  const entries = new Map();
  for (const form of /** @type {{forms: {contentSha256: string, definition: unknown}[]}} */ (bundle).forms) {
    entries.set(`forms/${form.contentSha256}.json`, Buffer.from(JSON.stringify({ contentSha256: form.contentSha256, definition: form.definition }, null, 2) + '\n'));
  }
  return entries;
}
