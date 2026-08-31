import { CradleApiError } from './errors'
import type { CradleConnection, CradleResponse, DirectServerConnection } from './transport/types'

export type {
  CradleConnection,
  DirectServerConfig,
  DirectServerConnection,
  FabricNodeConnection,
} from './transport/types'

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: object | string
}

function requestHeaders(options: RequestOptions): Headers {
  const headers = new Headers(options.headers)
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json')
  }
  if (options.body !== undefined && typeof options.body !== 'string') {
    headers.set('content-type', 'application/json')
  }
  return headers
}

function requestInit(options: RequestOptions): RequestInit {
  return {
    ...options,
    headers: requestHeaders(options),
    body: options.body !== undefined
      ? typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      : undefined,
  }
}

export async function cradleRequest<T>(
  connection: CradleConnection,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await connection.transport.request(path, requestInit(options))

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new CradleApiError(body?.message ?? `${response.status} ${response.statusText}`, response.status)
  }

  return await response.json() as T
}

export async function cradleRequestBytes(
  connection: CradleConnection,
  path: string,
  options: RequestOptions = {},
): Promise<Uint8Array> {
  const response = await connection.transport.request(path, requestInit({
    ...options,
    headers: {
      accept: 'application/octet-stream',
      ...Object.fromEntries(new Headers(options.headers)),
    },
  }))

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new CradleApiError(body?.message ?? `${response.status} ${response.statusText}`, response.status)
  }

  return new Uint8Array(await response.arrayBuffer())
}

export async function cradleStreamResponse(
  connection: CradleConnection,
  path: string,
  options: RequestOptions = {},
): Promise<CradleResponse> {
  const response = await connection.transport.request(path, requestInit({
    ...options,
    headers: requestHeaders({
      ...options,
      headers: {
        accept: 'text/event-stream',
        ...Object.fromEntries(new Headers(options.headers)),
      },
    }),
  }))
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null
    throw new CradleApiError(error?.message ?? `${response.status} ${response.statusText}`, response.status)
  }
  return response
}

export async function testServerConnection(connection: DirectServerConnection): Promise<void> {
  const health = await connection.transport.request('/health', {})
  if (!health.ok) {
    throw new CradleApiError('This is not a healthy Cradle Server.', health.status)
  }
  await cradleRequest(connection, '/workspaces')
}
