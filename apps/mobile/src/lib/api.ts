import { CradleApiError } from './errors'

export interface ServerConnection {
  url: string
  token: string | null
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: object | string
}

function requestUrl(connection: ServerConnection, path: string): string {
  return `${connection.url}${path.startsWith('/') ? path : `/${path}`}`
}

function requestHeaders(connection: ServerConnection, options: RequestOptions): Headers {
  const headers = new Headers(options.headers)
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json')
  }
  if (connection.token) {
    headers.set('authorization', `Bearer ${connection.token}`)
  }
  if (options.body && typeof options.body !== 'string') {
    headers.set('content-type', 'application/json')
  }
  return headers
}

export async function cradleRequest<T>(
  connection: ServerConnection,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(requestUrl(connection, path), {
    ...options,
    headers: requestHeaders(connection, options),
    body: options.body
      ? typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      : undefined,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new CradleApiError(body?.message ?? `${response.status} ${response.statusText}`, response.status)
  }

  return await response.json() as T
}

export async function cradleStreamResponse(
  connection: ServerConnection,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const response = await fetch(requestUrl(connection, path), {
    ...options,
    headers: requestHeaders(connection, {
      ...options,
      headers: {
        accept: 'text/event-stream',
        ...Object.fromEntries(new Headers(options.headers)),
      },
    }),
    body: options.body
      ? typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      : undefined,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null
    throw new CradleApiError(error?.message ?? `${response.status} ${response.statusText}`, response.status)
  }
  return response
}

export async function testServerConnection(connection: ServerConnection): Promise<void> {
  const health = await fetch(requestUrl(connection, '/health'))
  if (!health.ok) {
    throw new CradleApiError('This is not a healthy Cradle Server.', health.status)
  }
  await cradleRequest(connection, '/workspaces')
}
