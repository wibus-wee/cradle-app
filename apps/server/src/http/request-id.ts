import { randomUUID } from 'node:crypto'

import { Elysia } from 'elysia'

export const REQUEST_ID_HEADER = 'x-request-id'

export function createRequestIdPlugin() {
  return new Elysia({ name: 'cradle.http.request-id' })
    .derive({ as: 'global' }, ({ request, set }) => {
      const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim()
      const requestId = incoming || randomUUID()
      set.headers[REQUEST_ID_HEADER] = requestId
      return { requestId }
    })
}
