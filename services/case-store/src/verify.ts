import { compile, type ActionLibrary, type ProjectFile } from '../../../libs/aov-core';
import version from '../../../libs/aov-core/VERSION.json';
import { validateAovBundle } from '../../../libs/aov-integration';

// The server runs this itself (D180): the browser never supplies the verified report, so a client cannot claim "passed".
// Scope is the bundle contract plus the A core compile (which runs the full rule validation). The interactive
// simulation in the GUI is a browser session and is not re-run here; the report says so instead of implying it was.
export const VERIFY_SCOPE = 'bundle-contract+core-compile';
const MAX_DIAGNOSTICS = 50;

export interface VerifyReport {
  passed: boolean; scope: string; checkedAt: string; aovCoreCommit: string;
  steps: { name: string; ok: boolean }[];
  diagnostics: { severity: string; code: string; message: string }[];
  notRun: string[];
}

export async function verifyContent(content: string): Promise<VerifyReport> {
  const base = { scope: VERIFY_SCOPE, checkedAt: new Date().toISOString(), aovCoreCommit: version.commit,
    notRun: ['瀏覽器內的互動模擬', '正式執行環境'] };
  const bundle = await validateAovBundle(content);
  if (!bundle.ok) {
    return { ...base, passed: false, steps: [{ name: 'bundle', ok: false }],
      diagnostics: bundle.errors.slice(0, MAX_DIAGNOSTICS).map(e => ({ severity: 'error', code: e.code, message: `${e.path}: ${e.message}` })) };
  }
  const compiled = compile(bundle.value.aov as unknown as ProjectFile,
    bundle.value.libraries.map(l => l.content as unknown as ActionLibrary));
  return { ...base, passed: compiled.ok, steps: [{ name: 'bundle', ok: true }, { name: 'compile', ok: compiled.ok }],
    diagnostics: compiled.diagnostics.slice(0, MAX_DIAGNOSTICS).map(d => ({ severity: d.severity, code: d.code, message: d.message })) };
}
