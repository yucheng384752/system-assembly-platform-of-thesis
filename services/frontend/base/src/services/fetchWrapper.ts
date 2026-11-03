import { AUTH_REQUIRED_EVENT, getApiKeyHeaderName, getApiKeyValue, setSessionToken } from './auth'

// Adds the session token to same-origin /api requests and returns to the login page after a 401.
export function installGlobalFetchWrapper(): () => void {
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlString = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(urlString, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return originalFetch(input, init)
    }

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const value = getApiKeyValue()
    if (value && !headers.has(getApiKeyHeaderName())) headers.set(getApiKeyHeaderName(), value)

    const response = await originalFetch(input, { ...init, headers })
    if (response.status === 401 && url.pathname !== '/api/auth/login') {
      setSessionToken('')
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
    }
    return response
  }

  return () => {
    window.fetch = originalFetch
  }
}
