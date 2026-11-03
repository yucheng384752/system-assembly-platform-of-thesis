// The system package binds one tenant server-side (DEFAULT_TENANT_ID); the browser never selects one.
export const TENANT_STORAGE_KEY = 'form_analysis_tenant_id'

export function setTenantId(_id: string): void {}

export function clearTenantId(): void {}

export function getTenantId(): string {
  return ''
}

export async function ensureTenantId(): Promise<string> {
  return ''
}

export async function ensureTenantIdWithOptions(_options?: unknown): Promise<string> {
  return ''
}
