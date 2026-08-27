export type ServerHealthResult
  = | { kind: 'healthy' }
    | { kind: 'http-error', status: number }
    | { kind: 'unreachable' }

export async function probeServerHealth(
  serverUrl: string,
  options: {
    fetcher?: typeof fetch
    signal?: AbortSignal
  } = {},
): Promise<ServerHealthResult> {
  const fetcher = options.fetcher ?? fetch

  try {
    const response = await fetcher(new URL('/health', serverUrl), {
      cache: 'no-store',
      signal: options.signal,
    })
    return response.ok
      ? { kind: 'healthy' }
      : { kind: 'http-error', status: response.status }
  }
  catch {
    return { kind: 'unreachable' }
  }
}
