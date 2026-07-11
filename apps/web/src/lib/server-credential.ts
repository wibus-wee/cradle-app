let browserServerToken: string | null = null

export function setBrowserServerToken(token: string | null): void {
  browserServerToken = token?.trim() || null
}

export function readServerToken(): string | null {
  return window.cradle?.env?.serverAuthToken?.trim() || browserServerToken
}

export async function cradleFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  // api-gen calls `fetch(request)` with no init. Start from the Request's
  // headers so Content-Type / auth already on the Request are not wiped by an
  // empty Headers override.
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init.headers).forEach((value, key) => {
    headers.set(key, value)
  })

  const token = readServerToken()
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`)
  }
  return await fetch(input, { ...init, credentials: 'include', headers })
}

export async function bootstrapBrowserAuthSession(serverUrl: string): Promise<void> {
  if (!readServerToken()) {
    return
  }
  const response = await cradleFetch(new URL('/auth/browser-session', serverUrl), { method: 'POST' })
  if (!response.ok) {
    throw new Error(`Failed to bootstrap browser authentication: HTTP ${response.status}`)
  }
}
