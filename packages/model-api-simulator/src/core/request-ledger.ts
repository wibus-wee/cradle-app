import type { JsonValue, ObservedRequest } from '../contract'

export async function observeRequest(
  request: Request,
): Promise<Omit<ObservedRequest, 'index'>> {
  const headers = Object.fromEntries(
    Array.from(request.headers.entries(), ([name, value]) => [name.toLowerCase(), value]),
  )
  let body: JsonValue | undefined
  if (request.body) {
    const text = await request.text()
    if (text) { body = JSON.parse(text) as JsonValue }
  }
  return {
    method: request.method,
    path: new URL(request.url).pathname,
    query: normalizedQuery(new URL(request.url)),
    headers,
    ...(body === undefined ? {} : { body }),
  }
}

function normalizedQuery(url: URL): Readonly<Record<string, string | readonly string[]>> {
  const result: Record<string, string | readonly string[]> = {}
  for (const name of [...new Set(url.searchParams.keys())].sort()) {
    const values = url.searchParams.getAll(name)
    result[name] = values.length === 1 ? values[0]! : values
  }
  return result
}
