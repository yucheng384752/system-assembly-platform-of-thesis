// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { applyRecipe, kitMode, probeBackend, type Capabilities, type Fetcher, type PreviewState } from './previewBackend';
import { createPreviewApi, describeError, PreviewError } from './live/previewApi';
import { LiveGenericForms } from './live/LiveGenericForms';
import { LiveUpload } from './live/LiveUpload';
import { LiveTrace } from './live/LiveTrace';
import { KitPreview } from './KitPreview';
import { catalog } from './previewCatalog';
import type { Recipe } from '../../../libs/ui-runtime/types';

afterEach(() => { cleanup(); });

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const caps = (over: Partial<Capabilities> = {}): Capabilities => ({ mode: 'recipe', enabledKits: ['generic-forms-kit', 'upload-validation-kit', 'query-traceability-kit', 'analytics-kit'],
  allowed: ['forms.list', 'forms.create', 'forms.records.list', 'upload.file.create', 'upload.status.get', 'query.lot.search', 'query.trace.lot'], denied: [], unavailable: [], warnings: [], ...over });
const live = (over: Partial<PreviewState> = {}): PreviewState => ({ status: 'online', applied: true, capabilities: caps(), ...over });

// D116: the backend only counts when it identifies itself as the preview backend.
describe('probeBackend', () => {
  it('is connected only for a 200 body with preview true and status ok', async () => {
    expect(await probeBackend(() => json({ status: 'ok', preview: true }))).toBe(true);
  });
  it('treats a wrong body, an error status, a network failure and a timeout as offline', async () => {
    expect(await probeBackend(() => json({ status: 'ok' }))).toBe(false);
    expect(await probeBackend(() => json({ status: 'ok', preview: true }, 503))).toBe(false);
    expect(await probeBackend(() => Promise.reject(new TypeError('fail')))).toBe(false);
    const hang: Fetcher = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await probeBackend(hang, 20)).toBe(false);
  });
});

// D116/D118: the badge says real preview only when every condition holds; removing any one falls back to mock data.
describe('kitMode', () => {
  it('is live for a first-batch kit when all four conditions hold', () => {
    for (const kit of ['generic-forms-kit', 'upload-validation-kit', 'query-traceability-kit']) expect(kitMode(live(), kit).live).toBe(true);
  });
  it.each([
    ['backend offline', live({ status: 'offline' })],
    ['still probing', live({ status: 'checking' })],
    ['recipe not applied', live({ applied: false })],
    ['recipe rejected', live({ applied: false, capabilities: undefined, recipeError: '缺少必要功能' })],
    ['kit not enabled', live({ capabilities: caps({ enabledKits: ['analytics-kit'] }) })],
    ['kit unavailable in preview', live({ capabilities: caps({ unavailable: [{ kit: 'generic-forms-kit', reason: '預覽無來源' }] }) })],
    ['required capability closed', live({ capabilities: caps({ allowed: ['forms.list'] }) })],
  ])('falls back to mock data when %s', (_name, state) => { expect(kitMode(state, 'generic-forms-kit').live).toBe(false); });
  it('keeps a kit outside the first batch on mock data even when the backend opens it', () => {
    const mode = kitMode(live(), 'analytics-kit');
    expect(mode.live).toBe(false);
    expect(mode.note).toContain('尚未接上真實資料');
  });
  it('shows the backend reason when the recipe is rejected', () => {
    expect(kitMode(live({ applied: false, capabilities: undefined, recipeError: '缺少必要功能' }), 'generic-forms-kit').note).toContain('缺少必要功能');
  });
});

describe('applyRecipe', () => {
  const recipe = { enabledKits: ['generic-forms-kit'] } as unknown as Recipe;
  it('puts the recipe with the fixed fake admin header and then reads capabilities', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetcher: Fetcher = (url, init) => { calls.push([url, init]); return url.endsWith('/recipe') ? json({ ok: true }) : json({ mode: 'recipe', enabledKits: ['generic-forms-kit'], allowed: ['forms.list'], denied: [], unavailable: [], warnings: [] }); };
    const result = await applyRecipe(recipe, fetcher);
    expect(result.ok && result.capabilities.enabledKits).toEqual(['generic-forms-kit']);
    expect(calls[0][0]).toBe('/preview-api/_preview/recipe');
    expect(calls[0][1]?.method).toBe('PUT');
    expect(new Headers(calls[0][1]?.headers).get('X-Admin-API-Key')).toBe('preview-fake-admin-key');
    expect(calls[1][0]).toBe('/preview-api/_preview/capabilities');
  });
  it('reports the backend reason on 422 and does not read capabilities', async () => {
    const fetcher = vi.fn<Fetcher>(() => json({ detail: '缺少必要功能：platform-core-kit' }, 422));
    const result = await applyRecipe(recipe, fetcher);
    expect(result).toEqual({ ok: false, message: '缺少必要功能：platform-core-kit' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('live screens', () => {
  it('lists forms, creates one only on the button, and shows its records as plain text', async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/preview-api/api/forms' && init?.method === 'POST') return json({ id: '2', code: 'new', name: '新表單', fields: null }, 201);
      if (url === '/preview-api/api/forms') return json([{ id: '1', code: 'old', name: '舊表單', fields: [{ name: 'a' }] }]);
      return json({ total: 1, records: [{ id: 'r', lot_no_raw: 'L1', data: { note: '<b>x</b>' }, created_at: '' }] });
    };
    render(<LiveGenericForms api={createPreviewApi(fetcher)} />);
    await screen.findByText('舊表單');
    expect(calls).toEqual(['GET /preview-api/api/forms']);
    fireEvent.click(screen.getByRole('button', { name: '檢視資料列：舊表單' }));
    expect(await screen.findByText('<b>x</b>')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('表單代碼'), { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('表單名稱'), { target: { value: '新表單' } });
    expect(calls.some(c => c.startsWith('POST'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /建立表單（寫入預覽資料庫/ }));
    await waitFor(() => expect(calls).toContain('POST /preview-api/api/forms'));
    expect(await screen.findByText('已建立表單「新表單」。')).toBeTruthy();
  });
  it('explains an uninitialised preview when the form list answers 404', async () => {
    render(<LiveGenericForms api={createPreviewApi(() => json({ detail: 'No tenant' }, 404))} />);
    expect((await screen.findByRole('alert')).textContent).toContain('預覽資料尚未初始化');
  });
  it('uploads only after the button, then shows counts and validation errors', async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return url.endsWith('/status') ? json({ process_id: 'p', status: 'VALIDATED', filename: 'u.csv', total_rows: 2, valid_rows: 0, invalid_rows: 2 })
        : json({ process_id: 'p', total_rows: 2, valid_rows: 0, invalid_rows: 2, sample_errors: [{ row_index: 0, field: 'lot_no', error_code: 'X', message: '批號格式錯誤' }] });
    };
    render(<LiveUpload api={createPreviewApi(fetcher)} />);
    fireEvent.change(screen.getByLabelText('選擇要檢查的檔案'), { target: { files: [new File(['lot_no\nA'], 'u.csv', { type: 'text/csv' })] } });
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /上傳並檢查/ }));
    expect((await screen.findByRole('status')).textContent).toContain('有問題 2 列');
    expect(screen.getByText('批號格式錯誤')).toBeTruthy();
    expect(calls).toEqual(['POST /preview-api/api/upload', 'GET /preview-api/api/upload/p/status']);
  });
  it('looks up a lot and its trace without any write', async () => {
    const methods: string[] = [];
    const fetcher: Fetcher = (url, init) => {
      methods.push(init?.method ?? 'GET');
      return url.includes('/trace/') ? json({ nodes: [{ key: 'k', station_name: '站一', record: { lot_no_raw: 'L1', data: {} }, depth: 0 }], edges: [] })
        : json([{ station_code: 's', station_name: '站一', records: [{ id: 'r', lot_no_raw: 'L1', data: { v: '1' }, created_at: '' }] }]);
    };
    render(<LiveTrace api={createPreviewApi(fetcher)} />);
    fireEvent.change(screen.getByLabelText('批號'), { target: { value: 'L1' } });
    fireEvent.click(screen.getByRole('button', { name: '查詢批號' }));
    expect(await screen.findByText('第 1 層：站一（L1）')).toBeTruthy();
    expect(methods.every(m => m === 'GET')).toBe(true);
  });
  it('describes errors in business language with the status', () => {
    expect(describeError(new PreviewError(500, 'boom'))).toContain('HTTP 500');
    expect(describeError(new PreviewError(0, '無法連線到預覽後端'))).toBe('無法連線到預覽後端');
  });
});

// D116/D117: the badge in the configurator follows the real connection and recipe state.
describe('KitPreview wiring', () => {
  const recipe: Recipe = { recipeVersion: '1', name: 't', sourceManifest: 'm', database: { engine: 'postgresql' }, enabledKits: ['query-traceability-kit'], selectedSubfeatures: {}, selectedSubfeatureOptions: {}, uiOverrides: {} };
  const capsBody = { mode: 'recipe', enabledKits: ['query-traceability-kit'], allowed: ['query.lot.search', 'query.trace.lot'], denied: [], unavailable: [], warnings: [] };
  const mount = (fetcher: Fetcher) => render(<KitPreview split recipe={recipe} onChange={() => undefined} catalog={catalog} fetcher={fetcher} />);

  it('stays on mock data when the backend is unreachable', async () => {
    mount(() => Promise.reject(new TypeError('offline')));
    await waitFor(() => expect(screen.getByText('預覽後端：未連線')).toBeTruthy());
    expect(screen.getAllByText('模擬資料').length).toBeGreaterThan(0);
    expect(screen.queryByText('真實預覽')).toBeNull();
  });
  it('switches to real preview only after the recipe is applied and the kit is open', async () => {
    const fetcher: Fetcher = url => url.endsWith('/healthz') ? json({ status: 'ok', preview: true }) : url.endsWith('/recipe') ? json({ ok: true }) : json(capsBody);
    mount(fetcher);
    expect((await screen.findAllByText('真實預覽', {}, { timeout: 3000 })).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('批號')).toBeTruthy();
  });
  it('returns to mock data and shows the reason when the backend rejects the recipe', async () => {
    const fetcher: Fetcher = url => url.endsWith('/healthz') ? json({ status: 'ok', preview: true }) : json({ detail: '缺少必要功能' }, 422);
    mount(fetcher);
    expect((await screen.findByText(/缺少必要功能/, {}, { timeout: 3000 })).textContent).toContain('未套用');
    expect(screen.queryByText('真實預覽')).toBeNull();
  });
});
