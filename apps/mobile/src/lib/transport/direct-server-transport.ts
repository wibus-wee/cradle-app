import type {
  CradleTransport,
  DirectServerConfig,
  DirectServerConnection,
} from './types'

function directRequestUrl(serverUrl: string, path: string): string {
  return `${serverUrl}${path.startsWith('/') ? path : `/${path}`}`
}

class DirectServerTransport implements CradleTransport {
  constructor(private readonly config: DirectServerConfig) {}

  request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.config.token) {
      headers.set('authorization', `Bearer ${this.config.token}`)
    }
    return fetch(directRequestUrl(this.config.url, path), { ...init, headers })
  }
}

export function createDirectServerConnection(
  config: DirectServerConfig,
): DirectServerConnection {
  return {
    ...config,
    kind: 'direct',
    resourceId: `direct:${config.url}`,
    displayName: config.url,
    transport: new DirectServerTransport(config),
  }
}
