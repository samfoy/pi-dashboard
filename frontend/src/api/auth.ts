/**
 * Token-based auth for network-exposed dashboard.
 * Token is read from the URL query param (?token=X) on first load,
 * then stripped from the URL bar and stored in memory for all requests.
 */

let _token: string | null = null

export function initToken(): void {
  const params = new URLSearchParams(window.location.search)
  const t = params.get('token')
  if (t) {
    _token = t
    // Strip token from URL bar to avoid leaking in screenshots/shares
    params.delete('token')
    const clean = params.toString()
    const newUrl = window.location.pathname + (clean ? '?' + clean : '') + window.location.hash
    window.history.replaceState({}, '', newUrl)
  }
  // Monkey-patch global fetch to inject auth header on same-origin /api/ requests
  const originalFetch = window.fetch
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (_token) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.startsWith('/api') || url.startsWith(location.origin + '/api')) {
        const headers = new Headers(init?.headers)
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${_token}`)
        }
        return originalFetch.call(window, input, { ...init, headers })
      }
    }
    return originalFetch.call(window, input, init)
  }
}

export function getToken(): string | null {
  return _token
}

/** Append token to a URL as query param (for WebSocket connections). */
export function withToken(url: string): string {
  if (!_token) return url
  const sep = url.includes('?') ? '&' : '?'
  return url + sep + 'token=' + encodeURIComponent(_token)
}

/** Get Authorization header value, or empty object if no token. */
export function authHeader(): Record<string, string> {
  if (!_token) return {}
  return { Authorization: `Bearer ${_token}` }
}
