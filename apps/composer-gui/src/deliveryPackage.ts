import type { Catalog } from '../../../libs/ui-runtime/recipe';
import { importRecipe } from '../../../libs/ui-runtime/recipe';
import { parseSite } from '../../../libs/ui-runtime/site';
import { resolveKit } from '../../../libs/ui-runtime/resolve';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { validateSchema } from '../../../libs/ui-runtime/schema';
import { sha256Hex, WORKFLOW_FILE } from './workflow';
import { createZip } from './zip';
import { flows, type Flow } from './catalog';
import { summarizeKitWorkflows, workflowTable, KIT_WORKFLOW_SUMMARY, KIT_WORKFLOW_TABLE } from './kitWorkflows';
import { assembleManual, checkManuals, fragmentPath, loadFragments, manualRoles, roleNames, type Fragments } from './manual';

// Configuration delivery package (spec 12, D21, D31-D36): settings only, never an installable system.
export type ArtifactRole = 'readme' | 'recipe' | 'workflow' | 'kit-workflow' | 'validation-report' | 'manual' | 'site-profile';
export interface PackageManifest {
  format: 'composer-delivery-package'; version: 1; installable: false; clientName: string;
  recipe: { name: string; recipeVersion: string };
  kits: { id: string; version: string }[];
  artifacts: { path: string; role: ArtifactRole; sha256: string; bytes: number }[];
  notProvided: { path: string; reason: string }[];
}
export interface ValidationReport {
  format: 'composer-validation-report'; version: 1;
  staticChecks: { id: string; description: string; status: 'passed' | 'not-provided' }[];
  rehearsal: { status: 'not-run'; note: string };
  siteVerification: { status: 'not-run'; note: string };
}

export const MANIFEST_FILE = 'package-manifest.json';
export const notProvided: PackageManifest['notProvided'] = [
  { path: 'kits/', reason: 'Kit 程式需等可執行組裝（P2）完成；本包只以 id 與版本記錄。' },
  { path: 'frontend/', reason: '前端產物需等可執行組裝（P2）完成。' },
  { path: 'database/migrations/', reason: 'DB migration 尚未實作（spec 7）。' },
  { path: 'permissions/', reason: '入口權限設定尚未實作（spec 8）。' },
  { path: 'docs/', reason: '所選功能的操作手冊尚未齊全（spec 11、D34）。' },
  { path: 'deployment/', reason: '不提供部署腳本；設定交付包不能安裝（D21）。' },
];

// Shared by the visible status and packaging so missing fragments never silently change the delivery promise.
export function deliveryManualStatus(recipe: Pick<Recipe, 'enabledKits'>, catalog: Catalog, fragments: Fragments) {
  const issues = checkManuals({ kits: catalog.kits, enabledKits: recipe.enabledKits, fragments, mode: 'package' });
  const hasDraft = catalog.kits.filter(kit => recipe.enabledKits.includes(kit.id)).some(kit => manualRoles.some(role => {
    const fragment = fragments[fragmentPath(kit, role)];
    return fragment && 'meta' in fragment && fragment.meta.status === 'draft';
  }));
  const description = issues.length
    ? `手冊未齊全：${issues.map(issue => `${catalog.kits.find(kit => kit.id === issue.kitId)?.displayName ?? '未知功能'}（${roleNames[issue.role]}）`).join('、')}。本次交付包不含操作手冊，仍可下載設定。`
    : `手冊齊全：包含一般使用者、維護人員及開發人員三份手冊。${hasDraft ? '含草稿內容，尚未經審閱。' : '內容已審閱。'}`;
  return { issues, description };
}
// Key names that would mean connection settings or credentials leaked into an exported file (A15).
const SENSITIVE_KEY = /password|passwd|secret|token|credential|connection|dsn|api[_-]?key|private[_-]?key|licensee|deploymentconfig/i;
export function sensitiveKeys(value: unknown, at = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => sensitiveKeys(item, `${at}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => [...(SENSITIVE_KEY.test(key) ? [`${at}.${key}`] : []), ...sensitiveKeys(item, `${at}.${key}`)]);
}

function readme(manifest: Omit<PackageManifest, 'artifacts'>, hasSite = false): string {
  return [
    `# 設定交付包：${manifest.clientName}`, '',
    '本壓縮檔是 Composer 產出的系統設定，不是可安裝的系統，也不含任何安裝或部署程式。', '',
    '## 包含', '',
    '- `config/system.recipe.json`：系統設定檔（已選功能與畫面設定）。',
    '- `aov/workflow.aov.json`：流程規格（流程節點、子流程、表單欄位與驗證規則、已確認的表單關聯）。',
    '- `aov/kit-workflows.json`、`aov/kit-workflows.md`：所選功能流程總表，包含已啟用步驟與明確連線；缺漏與草稿逐項標示，不代表執行驗證。',
    ...(hasSite ? ['- `config/site/site.profile.json`：場域設定原文（已去除 BOM），含場域限制與資料來源引用，不含秘密值。'] : []),
    '- `validation/report.json`：靜態檢查結果；測試環境演練與現場驗證尚未執行。',
    ...(!manifest.notProvided.some(item => item.path === 'docs/') ? manualRoles.map(role => `- \`docs/manual-${role}.md\`：${roleNames[role]}操作手冊；審閱狀態見各手冊首頁。`) : []),
    '- `package-manifest.json`：各檔案的 SHA-256 與位元組數，以及未提供的項目與原因。', '',
    '## 不包含', '',
    '- 原始資料列、樣本內容、連線資訊與密碼。',
    ...manifest.notProvided.map(item => `- \`${item.path}\`：${item.reason}`), '',
    '## 核對檔案', '',
    '以 SHA-256 比對 `package-manifest.json` 中 `artifacts` 的 `sha256`，例如 PowerShell：`Get-FileHash -Algorithm SHA256 config/system.recipe.json`。',
    '系統設定檔的 `workflowRef.sha256` 應等於 `aov/workflow.aov.json` 的 SHA-256。', '',
    ...(hasSite ? ['系統設定檔的 `siteRef.sha256` 應等於 `config/site/site.profile.json` 的 SHA-256；未確認的欄位語意不生效，請由 MIS 確認。', ''] : []),
  ].join('\n');
}

// recipeText and workflowText must be the exact exported files, so the package matches the separate downloads.
export async function buildDeliveryPackage(recipeText: string, workflowText: string, catalog: Catalog,
  manuals: { selectedFlows?: string[]; flows?: Flow[]; fragments?: Fragments } = {},
  siteText?: string,
): Promise<{ fileName: string; bytes: Uint8Array<ArrayBuffer>; manifest: PackageManifest }> {
  const recipe = JSON.parse(recipeText) as Recipe; const workflow: unknown = JSON.parse(workflowText);
  const failures: string[] = [];
  const check = (condition: boolean, failure: string) => { if (!condition) failures.push(failure); };
  const valid = (kind: 'aov' | 'recipe', value: unknown) => { try { validateSchema(kind, value); return true; } catch { return false; } };
  const workflowSha = await sha256Hex(workflowText);
  const kits = recipe.enabledKits.map(id => ({ id, version: catalog.kits.find(k => k.id === id)?.version ?? '' }));
  check(valid('aov', workflow), '流程規格不符合格式。');
  check(valid('recipe', recipe), '系統設定檔不符合格式。');
  check(recipe.workflowRef?.path === WORKFLOW_FILE && recipe.workflowRef.sha256 === workflowSha, '系統設定檔記錄的流程規格校驗碼與流程規格不符。');
  const leaked = [...sensitiveKeys(recipe).map(p => `系統設定檔 ${p}`), ...sensitiveKeys(workflow).map(p => `流程規格 ${p}`)];
  check(!leaked.length, `檔案含疑似連線或密碼欄位：${leaked.join('、')}。`);
  const unknown = kits.filter(k => !k.version).map(k => k.id);
  check(!unknown.length, `找不到功能的版本：${unknown.join('、')}。`);
  check(!!recipe.clientName?.trim(), '請填寫客戶代稱。');
  siteText = siteText?.replace(/^\uFEFF/, '');
  let siteResult: ReturnType<typeof parseSite> | undefined;
  if (siteText !== undefined) {
    try {
      siteResult = parseSite(siteText, catalog);
      check(recipe.siteRef?.path === 'site.profile.json' && recipe.siteRef.sha256 === await sha256Hex(siteText), '系統設定檔記錄的場域校驗碼與場域設定不符。');
      const validated = importRecipe(recipeText, catalog).recipe;
      for (const kit of catalog.kits.filter(k => validated.enabledKits.includes(k.id))) {
        const definition = catalog.definitions[kit.id];
        if (definition) resolveKit({ kit, definition, sources: catalog.sources, site: siteResult.site,
          overrides: validated.selectedSubfeatureOptions, versions: validated.uiOverrides, selectedSubfeatures: validated.selectedSubfeatures[kit.id] });
      }
    } catch (error) { failures.push(`場域檢查未通過：${error instanceof Error ? error.message : '設定無效'}`); }
  } else check(!recipe.siteRef, '系統設定檔引用的場域設定尚未提供。');
  if (failures.length) throw new Error(`設定交付包未產生：${failures.join(' ')}`);

  const kitWorkflows = summarizeKitWorkflows(recipe, catalog.kits);
  const incompleteWorkflows = kitWorkflows.filter(row => row.status !== 'reviewed');

  const fragments = manuals.fragments ?? loadFragments();
  const manualStatus = deliveryManualStatus(recipe, catalog, fragments);
  const missing = notProvided.filter(item => item.path !== 'docs/');
  if (manualStatus.issues.length) missing.push({ path: 'docs/', reason: manualStatus.issues.map(issue => issue.reason).join('；') });
  const manualFiles = manualStatus.issues.length ? [] : manualRoles.map(role => ({
    path: `docs/manual-${role}.md`, role: 'manual' as const,
    text: assembleManual({ role, kits: catalog.kits, enabledKits: recipe.enabledKits,
      selectedSubfeatures: recipe.selectedSubfeatures, overrides: recipe.selectedSubfeatureOptions,
      flows: manuals.flows ?? flows, selectedFlows: manuals.selectedFlows ?? [], fragments, catalog }),
  }));
  const report: ValidationReport = {
    format: 'composer-validation-report', version: 1,
    staticChecks: [
      { id: 'kit-workflows', description: incompleteWorkflows.length ? `功能流程尚未齊全或審閱：${incompleteWorkflows.map(row => row.name).join('、')}。詳見流程總表。` : '所選功能流程定義已審閱；未執行系統驗證。', status: incompleteWorkflows.length ? 'not-provided' : 'passed' },
      { id: 'workflow-schema', description: '流程規格符合支援的流程文件格式', status: 'passed' },
      { id: 'recipe-schema', description: '系統設定檔符合 Recipe 格式', status: 'passed' },
      { id: 'workflow-ref', description: '系統設定檔的 workflowRef 與流程規格的 SHA-256 相符', status: 'passed' },
      { id: 'sensitive-keys', description: '兩份檔案皆無連線、密碼或金鑰類欄位名稱（只檢查欄位名稱，不檢查使用者輸入的文字）', status: 'passed' },
      { id: 'kit-versions', description: '每項已選功能皆有固定版本', status: 'passed' },
      { id: 'manuals', description: manualStatus.description, status: manualStatus.issues.length ? 'not-provided' : 'passed' },
      ...(siteResult ? [
        { id: 'site-profile', description: '場域設定契約、引用、別名與秘密值檢查通過', status: 'passed' as const },
        { id: 'site-ref', description: '系統設定檔的 siteRef 與場域設定的 SHA-256 相符', status: 'passed' as const },
        { id: 'site-limits', description: '已選功能的預設、使用者與場域值皆符合場域限制', status: 'passed' as const },
        { id: 'site-semantics', description: siteResult.notices.length ? `${siteResult.notices.join('；')}；未確認語意不生效。` : '無待 MIS 確認的欄位語意。', status: siteResult.notices.length ? 'not-provided' as const : 'passed' as const },
      ] : []),
    ],
    rehearsal: { status: 'not-run', note: '尚無可執行組裝，未在測試環境演練。' },
    siteVerification: { status: 'not-run', note: '未在現場驗證；本包不能安裝。' },
  };
  const base = { format: 'composer-delivery-package', version: 1, installable: false, clientName: recipe.clientName!.trim(),
    recipe: { name: recipe.name, recipeVersion: recipe.recipeVersion }, kits, notProvided: missing } as const;
  const files: { path: string; role: ArtifactRole; text: string }[] = [
    { path: 'README.md', role: 'readme', text: readme(base, siteText !== undefined) },
    { path: 'config/system.recipe.json', role: 'recipe', text: recipeText },
    { path: `aov/${WORKFLOW_FILE}`, role: 'workflow', text: workflowText },
    { path: KIT_WORKFLOW_SUMMARY, role: 'kit-workflow', text: JSON.stringify({ format: 'composer-kit-workflow-summary', version: 1, kits: kitWorkflows }, null, 2) },
    { path: KIT_WORKFLOW_TABLE, role: 'kit-workflow', text: workflowTable(kitWorkflows) },
    { path: 'validation/report.json', role: 'validation-report', text: JSON.stringify(report, null, 2) },
    ...manualFiles,
    ...(siteText !== undefined ? [{ path: 'config/site/site.profile.json', role: 'site-profile' as const, text: siteText }] : []),
  ];
  const encoder = new TextEncoder();
  const encoded = files.map(file => ({ ...file, data: encoder.encode(file.text) }));
  const manifest: PackageManifest = { ...base,
    artifacts: await Promise.all(encoded.map(async file => ({ path: file.path, role: file.role, sha256: await sha256Hex(file.text), bytes: file.data.length }))) };
  validateSchema('packageManifest', manifest);
  const manifestText = JSON.stringify(manifest, null, 2);
  const bytes = createZip([{ path: MANIFEST_FILE, data: encoder.encode(manifestText) }, ...encoded.map(({ path, data }) => ({ path, data }))]);
  return { fileName: `${recipe.name}-delivery-${(await sha256Hex(manifestText)).slice(0, 12)}.zip`, bytes, manifest };
}
