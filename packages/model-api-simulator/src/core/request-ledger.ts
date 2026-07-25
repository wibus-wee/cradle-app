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
    headers,
    ...(body === undefined ? {} : { body }),
  }
}
