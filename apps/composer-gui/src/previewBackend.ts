import { useCallback, useEffect, useRef, useState } from 'react';
import type { Recipe } from '../../../libs/ui-runtime/types';

// D116 to D119: the screen talks to the preview backend only through the same-origin proxy path, never a hard-coded port.
export const PREVIEW_BASE = '/preview-api';
// D106 fixed fake value, an identity stand-in for tests only; it is not authentication.
export const ADMIN_HEADERS = { 'X-Admin-API-Key': 'preview-fake-admin-key' } as const;
export const PROBE_TIMEOUT_MS = 3000;
export const PUSH_DEBOUNCE_MS = 400;

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface Capabilities {
  mode: 'all' | 'recipe';
  enabledKits: string[];
  allowed: string[];
  denied: { detail?: string; capability?: string | null; kit?: string }[];
  unavailable: { kit: string; reason: string }[];
  warnings: string[];
}

// First batch (D118): capabilities each live screen needs. A screen is live only when all of them are open.
export const LIVE_KITS: Record<string, string[]> = {
  'generic-forms-kit': ['forms.list', 'forms.create', 'forms.records.list'],
  'upload-validation-kit': ['upload.file.create', 'upload.status.get'],
  'query-traceability-kit': ['query.lot.search', 'query.trace.lot'],
};

const defaultFetch: Fetcher = (input, init) => globalThis.fetch(input, init);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// Reachable only counts when the body is the preview backend itself; any other answer means mock data.
export async function probeBackend(fetcher: Fetcher = defaultFetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${PREVIEW_BASE}/healthz`, { signal: controller.signal });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return isRecord(body) && body.preview === true && body.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function parseCapabilities(body: unknown): Capabilities | undefined {
  if (!isRecord(body) || (body.mode !== 'all' && body.mode !== 'recipe')) return undefined;
  return {
    mode: body.mode,
    enabledKits: strings(body.enabledKits),
    allowed: strings(body.allowed),
    denied: Array.isArray(body.denied) ? body.denied.filter(isRecord).map(d => ({ detail: typeof d.detail === 'string' ? d.detail : undefined, capability: typeof d.capability === 'string' ? d.capability : null, kit: typeof d.kit === 'string' ? d.kit : undefined })) : [],
    unavailable: Array.isArray(body.unavailable) ? body.unavailable.filter(isRecord).flatMap(u => typeof u.kit === 'string' ? [{ kit: u.kit, reason: typeof u.reason === 'string' ? u.reason : '' }] : []) : [],
    warnings: strings(body.warnings),
  };
}

function detailText(body: unknown): string {
  if (!isRecord(body)) return '';
  const detail = body.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(d => isRecord(d) && typeof d.msg === 'string' ? d.msg : '').filter(Boolean).join('；');
  if (isRecord(detail)) return [detail.message, ...strings(detail.errors)].filter((v): v is string => typeof v === 'string').join('；');
  return '';
}

export type ApplyResult = { ok: true; capabilities: Capabilities } | { ok: false; message: string };

// Sends the screen's own Recipe, then reads back which capabilities the backend actually opened.
export async function applyRecipe(recipe: Recipe, fetcher: Fetcher = defaultFetch): Promise<ApplyResult> {
  try {
    const put = await fetcher(`${PREVIEW_BASE}/_preview/recipe`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS }, body: JSON.stringify(recipe) });
    if (!put.ok) {
      const body: unknown = await put.json().catch(() => undefined);
      return { ok: false, message: detailText(body) || `預覽後端拒絕此選配（HTTP ${put.status}）` };
    }
    const get = await fetcher(`${PREVIEW_BASE}/_preview/capabilities`);
    const capabilities = get.ok ? parseCapabilities(await get.json().catch(() => undefined)) : undefined;
    return capabilities ? { ok: true, capabilities } : { ok: false, message: '預覽後端的功能清單無法讀取' };
  } catch {
    return { ok: false, message: '無法連線到預覽後端' };
  }
}

export type PreviewStatus = 'checking' | 'offline' | 'online';
export interface PreviewState { status: PreviewStatus; applied: boolean; capabilities?: Capabilities; recipeError?: string }

export interface KitMode { live: boolean; note: string }

// The single source for the badge: every condition must hold, otherwise the screen says mock data and why.
export function kitMode(state: PreviewState, kitId: string): KitMode {
  if (state.status === 'checking') return { live: false, note: '正在偵測預覽後端。' };
  if (state.status === 'offline') return { live: false, note: '未連上預覽後端，顯示內建模擬資料。' };
  if (!state.applied || !state.capabilities) return { live: false, note: state.recipeError ? `預覽後端未套用目前選配：${state.recipeError}` : '正在把目前選配套用到預覽後端。' };
  const capabilities = state.capabilities;
  const unavailable = capabilities.unavailable.find(u => u.kit === kitId);
  if (unavailable) return { live: false, note: `預覽後端沒有此功能${unavailable.reason ? `（${unavailable.reason}）` : ''}，顯示模擬資料。` };
  if (!capabilities.enabledKits.includes(kitId)) return { live: false, note: '預覽後端未開放此功能，顯示模擬資料。' };
  const needed = LIVE_KITS[kitId];
  if (!needed) return { live: false, note: '此功能尚未接上真實資料，顯示模擬資料。' };
  const closed = needed.filter(capability => !capabilities.allowed.includes(capability));
  if (closed.length) return { live: false, note: '所選子功能未開放此畫面所需的操作，顯示模擬資料。' };
  return { live: true, note: '資料來自本機預覽後端。' };
}

// Probes on mount and on demand; pushes the Recipe (debounced) only while the backend is reachable.
export function usePreviewBackend(recipe: Recipe, enabled = true, fetcher: Fetcher = defaultFetch): PreviewState & { recheck: () => void } {
  const [state, setState] = useState<PreviewState>({ status: enabled ? 'checking' : 'offline', applied: false });
  const [probe, setProbe] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const key = JSON.stringify(recipe);

  useEffect(() => {
    if (!enabled) return;
    setState(s => ({ ...s, status: 'checking', applied: false }));
    void probeBackend(fetcher).then(online => { if (alive.current) setState(s => ({ ...s, status: online ? 'online' : 'offline', applied: false, capabilities: online ? s.capabilities : undefined })); });
  }, [enabled, probe, fetcher]);

  useEffect(() => {
    if (state.status !== 'online') return;
    setState(s => ({ ...s, applied: false }));
    let current = true;
    const timer = setTimeout(() => {
      void applyRecipe(JSON.parse(key) as Recipe, fetcher).then(result => {
        if (!current || !alive.current) return;
        setState(s => result.ok ? { ...s, applied: true, capabilities: result.capabilities, recipeError: undefined } : { ...s, applied: false, capabilities: undefined, recipeError: result.message });
      });
    }, PUSH_DEBOUNCE_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [state.status, key, fetcher]);

  const recheck = useCallback(() => setProbe(n => n + 1), []);
  return { ...state, recheck };
}
