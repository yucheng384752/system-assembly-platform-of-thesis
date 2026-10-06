import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { deriveKits } from '../../../libs/ui-runtime/actions';
import { checkRegistry, parseActionCatalog, parseRegistry } from '../../../libs/ui-runtime/registry';
import actionData from '../../../config/actions.json';
import { registry } from './registryData';

const catalog = parseActionCatalog(actionData);
const tables = ['generic-forms-kit', 'platform-core-kit', 'station-data-link-kit'];
const tableGaps = ['generic-forms-kit', 'station-data-link-kit'];
// D94 permits only the known tenant capability gap, with every consuming Kit explicit.
const cases: [string, string[], string[]][] = [
  ['browse-forms', tables, tableGaps],
  ['upload-file', [...tables, 'upload-validation-kit', 'import-pipeline-kit'], [...tableGaps, 'upload-validation-kit']],
  ['convert-pdf', [...tables, 'upload-validation-kit', 'import-pipeline-kit'], [...tableGaps, 'upload-validation-kit']],
  ['import-job-track', [...tables, 'import-pipeline-kit'], tableGaps],
  ['view-upload-history', ['analytics-kit', 'platform-core-kit'], []],
  ['analyze-trend', [...tables, 'analytics-kit'], tableGaps],
  ['view-audit-events', ['audit-edit-kit', 'generic-forms-kit', 'platform-core-kit'], ['generic-forms-kit']],
  ['edit-record', [...tables, 'audit-edit-kit'], tableGaps],
  ['manage-edit-reasons', ['audit-edit-kit', 'generic-forms-kit', 'platform-core-kit'], ['generic-forms-kit']],
  ['manage-subscription', ['mod-subscription-kit'], ['mod-subscription-kit']],
  ['view-logs', ['logs-ops-kit'], []],
  ['view-kit-contracts', ['platform-core-kit'], []],
  ['manage-endpoint-permissions', ['platform-core-kit'], []],
];

describe('新增工具的上架條件', () => {
  test.each(cases)('%s 推導完整實作者且只保留既有租戶缺口', (id, kits, gapKits) => {
    const result = deriveKits([id], catalog, registry);
    expect(result.kits.map(k => k.kitId).sort()).toEqual([...kits].sort());
    expect(result.kits.every(k => k.registered)).toBe(true);
    expect(result.ambiguities).toEqual([]);
    expect(result.gaps.map(g => `${g.kind}|${g.kitId}|${g.subject}`).sort())
      .toEqual(gapKits.map(k => `unresolved-consume|${k}|db.tenants.read`).sort());
  });

  test('所有動作要求的能力都能追到已驗證的服務與實際原始碼', () => {
    for (const action of catalog.actions) for (const id of action.requires) {
      const providers = registry.flatMap(r => r.capabilities).filter(c => c.id === id && c.verified && c.implementedBy);
      expect(providers.length, `${action.id}: ${id}`).toBeGreaterThan(0);
      for (const cap of providers) {
        const owner = registry.find(r => r.kitId === cap.implementedBy!.kitId)!;
        const service = owner.mServices.find(s => s.id === cap.implementedBy!.mService)!;
        expect(service.provides).toContain(id);
        for (const fnId of service.functions) {
          const fn = owner.functions.find(f => f.id === fnId)!;
          const source = readFileSync(fn.source.path, 'utf8');
          expect(source).toMatch(new RegExp(`(?:async\\s+)?def\\s+${fn.source.symbol.split('.').at(-1)}\\s*\\(`));
        }
      }
    }
  });

  test('新工具齊全且無預設參數，名稱與描述不洩漏技術識別碼', () => {
    expect(catalog.actions).toHaveLength(17);
    expect(new Set(catalog.actions.map(a => a.id)).size).toBe(17);
    const added = catalog.actions.filter(a => cases.some(([id]) => id === a.id));
    expect(added).toHaveLength(13);
    for (const action of added) for (const parameter of action.parameters) {
      expect(parameter).not.toHaveProperty('default');
      expect(Object.keys(parameter).every(k => ['id', 'name', 'type', 'required', 'minimum', 'maximum'].includes(k))).toBe(true);
    }
    const technicalIds = registry.flatMap(r => [r.kitId, ...r.capabilities.map(c => c.id)]);
    for (const action of catalog.actions) for (const id of technicalIds) {
      expect(`${action.name} ${action.description}`).not.toContain(id);
    }
    expect(catalog.actions.find(a => a.id === 'import-records')?.name).toBe('匯入資料列');
    expect(catalog.actions.some(a => a.id === 'check-health')).toBe(false);
  });

  test('所有 registry 通過解析與服務鏈檢查，只記環境變數名稱', () => {
    expect(registry).toHaveLength(10);
    for (const entry of registry) expect(parseRegistry(entry)).toEqual(entry);
    for (const entry of registry) for (const fn of entry.functions) {
      expect(readFileSync(fn.source.path, 'utf8'))
        .toMatch(new RegExp(`(?:async\\s+)?def\\s+${fn.source.symbol.split('.').at(-1)}\\s*\\(`));
    }
    expect(checkRegistry(registry).filter(i => i.severity === 'error')).toEqual([]);
    const upload = registry.find(r => r.kitId === 'upload-validation-kit')!;
    for (const name of ['VALID_MATERIALS_CSV', 'VALID_SLITTING_MACHINES_CSV']) expect(upload.scope).toContain(name);
    const text = JSON.stringify(registry);
    expect(text).not.toMatch(/(?:VALID_MATERIALS_CSV|VALID_SLITTING_MACHINES_CSV|PDF_SERVER_URL|MOD_API_BASE_URL|MOD_API_KEY|MOD_WEBHOOK_SECRET)\s*[=:]/);
    expect(text).not.toMatch(/https?:\/\/|[A-Z]:\\\\|BEGIN (?:RSA |EC )?PRIVATE KEY/);
  });

  test('D94 保留契約差異，只將真實訂閱端點上架', () => {
    const subscription = registry.find(r => r.kitId === 'mod-subscription-kit')!;
    expect(subscription.capabilities.find(c => c.id === 'subscriptions.manage')).toMatchObject({ declared: true, verified: false, implementedBy: null });
    for (const id of ['subscriptions.sync', 'subscriptions.webhook', 'subscriptions.get', 'subscriptions.entitlements.get']) {
      expect(subscription.capabilities.find(c => c.id === id)).toMatchObject({ declared: false, verified: true });
    }
    expect(catalog.actions.find(a => a.id === 'manage-subscription')?.requires)
      .toEqual(['subscriptions.sync', 'subscriptions.get', 'subscriptions.entitlements.get']);
    const core = registry.find(r => r.kitId === 'platform-core-kit')!;
    expect(core.capabilities.find(c => c.id === 'platform.health')).toMatchObject({ declared: true, verified: false, implementedBy: null });
    expect(core.capabilities.some(c => c.id === 'kit.capability.call')).toBe(false);
    const upload = registry.find(r => r.kitId === 'upload-validation-kit')!;
    expect(upload.capabilities.some(c => c.id === 'db.upload.jobs.list')).toBe(false);
    expect(upload.consumes.some(c => c.capability === 'db.upload.jobs.list')).toBe(true);
    expect(core.capabilities.find(c => c.id === 'db.upload.jobs.list')?.implementedBy?.kitId).toBe('platform-core-kit');
    expect(registry.find(r => r.kitId === 'logs-ops-kit')?.capabilities.find(c => c.id === 'logs.list'))
      .toMatchObject({ verified: true, note: expect.stringContaining('backend_router_registry.py') });
  });
});
