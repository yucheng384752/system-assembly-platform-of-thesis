import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// node services/case-store/start.mjs — bundles the TypeScript service (same approach as services/evaluator) and runs it.
// Env: CASE_STORE_PORT (default 18788), CASE_STORE_DB (default data/case-store.sqlite3). Needs Node >= 22.13 for node:sqlite.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outfile = path.join(repository, 'services/case-store/.run/server.cjs');
await build({
  absWorkingDir: repository, entryPoints: ['services/case-store/src/main.ts'], bundle: true, platform: 'node', target: 'node22',
  format: 'cjs', outfile, legalComments: 'none', logLevel: 'warning',
});
await import(pathToFileURL(outfile).href);
