const SERVER_ENDPOINT_STORAGE_KEY = 'cradle.web.serverEndpointUrl'

export function getDefaultServerUrl(): string {
  if (window.cradle?.env?.serverUrl) {
    return window.cradle.env.serverUrl
  }
  return import.meta.env.VITE_SERVER_URL ?? 'http://127.0.0.1:21423'
}

export function normalizeServerEndpointUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('empty')
  }

  const url = new URL(trimmed)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('protocol')
  }

  url.hash = ''
  url.search = ''
  const normalized = url.toString().replace(/\/+$/, '')
  return normalized || url.origin
}

export function readCustomServerUrl(): string | null {
  try {
    const value = window.localStorage.getItem(SERVER_ENDPOINT_STORAGE_KEY)
    if (!value) {
      return null
    }
    return normalizeServerEndpointUrl(value)
  }
  catch {
    return null
  }
}

export function writeCustomServerUrl(value: string): string {
  const normalized = normalizeServerEndpointUrl(value)
  window.localStorage.setItem(SERVER_ENDPOINT_STORAGE_KEY, normalized)
  return normalized
}

export function clearCustomServerUrl(): void {
  window.localStorage.removeItem(SERVER_ENDPOINT_STORAGE_KEY)
}
