import type { Catalog } from '../../../libs/ui-runtime/recipe';
import type { Recipe } from '../../../libs/ui-runtime/types';
import { validateSchema } from '../../../libs/ui-runtime/schema';
import { sha256Hex, WORKFLOW_FILE } from './workflow';
import { createZip } from './zip';

// Configuration delivery package (spec 12, D21, D31-D36): settings only, never an installable system.
export type ArtifactRole = 'readme' | 'recipe' | 'workflow' | 'validation-report';
export interface PackageManifest {
  format: 'composer-delivery-package'; version: 1; installable: false; clientName: string;
  recipe: { name: string; recipeVersion: string };
  kits: { id: string; version: string }[];
  artifacts: { path: string; role: ArtifactRole; sha256: string; bytes: number }[];
  notProvided: { path: string; reason: string }[];
}
export interface ValidationReport {
  format: 'composer-validation-report'; version: 1;
  staticChecks: { id: string; description: string; status: 'passed' }[];
  rehearsal: { status: 'not-run'; note: string };
  siteVerification: { status: 'not-run'; note: string };
}

export const MANIFEST_FILE = 'package-manifest.json';
export const notProvided: PackageManifest['notProvided'] = [
  { path: 'kits/', reason: 'Kit 程式需等可執行組裝（P2）完成；本包只以 id 與版本記錄。' },
  { path: 'frontend/', reason: '前端產物需等可執行組裝（P2）完成。' },
  { path: 'database/migrations/', reason: 'DB migration 尚未實作（spec 7）。' },
  { path: 'permissions/', reason: '入口權限設定尚未實作（spec 8）。' },
  { path: 'docs/', reason: 'Kit 操作手冊尚未撰寫（spec 11、D34）。' },
  { path: 'deployment/', reason: '不提供部署腳本；設定交付包不能安裝（D21）。' },
];
// Key names that would mean connection settings or credentials leaked into an exported file (A15).
const SENSITIVE_KEY = /password|passwd|secret|token|credential|connection|dsn|api[_-]?key|private[_-]?key|licensee|deploymentconfig/i;
export function sensitiveKeys(value: unknown, at = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => sensitiveKeys(item, `${at}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => [...(SENSITIVE_KEY.test(key) ? [`${at}.${key}`] : []), ...sensitiveKeys(item, `${at}.${key}`)]);
}

function readme(manifest: Omit<PackageManifest, 'artifacts'>): string {
  return [
    `# 設定交付包：${manifest.clientName}`, '',
    '本壓縮檔是 Composer 產出的系統設定，不是可安裝的系統，也不含任何安裝或部署程式。', '',
    '## 包含', '',
    '- `config/system.recipe.json`：系統設定檔（已選功能與畫面設定）。',
    '- `aov/workflow.aov.json`：流程規格（流程步驟、表單欄位定義與已確認的表單關聯）。',
    '- `validation/report.json`：靜態檢查結果；測試環境演練與現場驗證尚未執行。',
    '- `package-manifest.json`：各檔案的 SHA-256 與位元組數，以及未提供的項目與原因。', '',
    '## 不包含', '',
    '- 原始資料列、樣本內容、連線資訊與密碼。',
    ...manifest.notProvided.map(item => `- \`${item.path}\`：${item.reason}`), '',
    '## 核對檔案', '',
    '以 SHA-256 比對 `package-manifest.json` 中 `artifacts` 的 `sha256`，例如 PowerShell：`Get-FileHash -Algorithm SHA256 config/system.recipe.json`。',
    '系統設定檔的 `workflowRef.sha256` 應等於 `aov/workflow.aov.json` 的 SHA-256。', '',
  ].join('\n');
}

// recipeText and workflowText must be the exact exported files, so the package matches the separate downloads.
export async function buildDeliveryPackage(recipeText: string, workflowText: string, catalog: Catalog): Promise<{ fileName: string; bytes: Uint8Array<ArrayBuffer>; manifest: PackageManifest }> {
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
  if (failures.length) throw new Error(`設定交付包未產生：${failures.join(' ')}`);

  const report: ValidationReport = {
    format: 'composer-validation-report', version: 1,
    staticChecks: [
      { id: 'workflow-schema', description: '流程規格符合 composer-aov-list version 2 格式', status: 'passed' },
      { id: 'recipe-schema', description: '系統設定檔符合 Recipe 格式', status: 'passed' },
      { id: 'workflow-ref', description: '系統設定檔的 workflowRef 與流程規格的 SHA-256 相符', status: 'passed' },
      { id: 'sensitive-keys', description: '兩份檔案皆無連線、密碼或金鑰類欄位名稱（只檢查欄位名稱，不檢查使用者輸入的文字）', status: 'passed' },
      { id: 'kit-versions', description: '每項已選功能皆有固定版本', status: 'passed' },
    ],
    rehearsal: { status: 'not-run', note: '尚無可執行組裝，未在測試環境演練。' },
    siteVerification: { status: 'not-run', note: '未在現場驗證；本包不能安裝。' },
  };
  const base = { format: 'composer-delivery-package', version: 1, installable: false, clientName: recipe.clientName!.trim(),
    recipe: { name: recipe.name, recipeVersion: recipe.recipeVersion }, kits, notProvided } as const;
  const files: { path: string; role: ArtifactRole; text: string }[] = [
    { path: 'README.md', role: 'readme', text: readme(base) },
    { path: 'config/system.recipe.json', role: 'recipe', text: recipeText },
    { path: `aov/${WORKFLOW_FILE}`, role: 'workflow', text: workflowText },
    { path: 'validation/report.json', role: 'validation-report', text: JSON.stringify(report, null, 2) },
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
