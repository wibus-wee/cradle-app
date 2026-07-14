import { getConfiguredServerUrl } from './server-endpoint-preferences'

let browserServerToken: string | null = null

export function setBrowserServerToken(token: string | null): void {
  browserServerToken = token?.trim() || null
}

export function readServerToken(): string | null {
  return window.cradle?.env?.serverAuthToken?.trim() || browserServerToken
}

export async function cradleFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const serverUrl = new URL(getConfiguredServerUrl())
  const inputUrl = new URL(input instanceof Request ? input.url : input.toString(), serverUrl)
  const resolvedInput
    = inputUrl.origin === serverUrl.origin
      ? input
      : input instanceof Request
        ? new Request(new URL(`${inputUrl.pathname}${inputUrl.search}${inputUrl.hash}`, serverUrl), input)
        : new URL(`${inputUrl.pathname}${inputUrl.search}${inputUrl.hash}`, serverUrl)

  // api-gen calls `fetch(request)` with no init. Start from the Request's
  // headers so Content-Type / auth already on the Request are not wiped by an
  // empty Headers override.
  const headers = new Headers(resolvedInput instanceof Request ? resolvedInput.headers : undefined)
  new Headers(init.headers).forEach((value, key) => {
    headers.set(key, value)
  })

  const token = readServerToken()
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`)
  }
  return await fetch(resolvedInput, { ...init, credentials: 'include', headers })
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
