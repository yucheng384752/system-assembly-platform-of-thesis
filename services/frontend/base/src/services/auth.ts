// Entry-permission session: the Bearer token lives in sessionStorage only and never in the bundle.
export const SESSION_TOKEN_KEY = 'composer_system_session_token'
export const AUTH_REQUIRED_EVENT = 'composer-system:auth-required'

export interface SessionUser {
  id: string
  username: string
  display_name: string
  role_id: string
  must_change_password: boolean
}

export function getSessionToken(): string {
  try {
    return (window.sessionStorage.getItem(SESSION_TOKEN_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function setSessionToken(token: string): void {
  try {
    if (token) window.sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    else window.sessionStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    // sessionStorage can be blocked; the next request then fails with 401 and the login page returns.
  }
}

// Page code builds headers as { [getApiKeyHeaderName()]: getApiKeyValue() }; keep that contract.
export function getApiKeyHeaderName(): string {
  return 'Authorization'
}

export function getApiKeyValue(): string {
  const token = getSessionToken()
  return token ? `Bearer ${token}` : ''
}

export function clearApiKeyValue(): void {
  setSessionToken('')
}

export function setApiKeyValue(token: string): void {
  setSessionToken(String(token || '').trim())
}
