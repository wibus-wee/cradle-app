import { Elysia } from 'elysia'
import { describe, expect, it } from 'vitest'

import { chatRuntimeEventRoutes, chatRuntimeGlobalEventRoutes } from './events.routes'

function createTestApp() {
  return new Elysia()
    .use(chatRuntimeGlobalEventRoutes)
    .use(chatRuntimeEventRoutes)
}

async function closeResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

describe('chat runtime event routes', () => {
  it('registers the session event tail route', async () => {
    const app = createTestApp()
    const response = await app.handle(
      new Request('http://localhost/chat/sessions/session-route-test/events?afterVersion=1000'),
    )
    await closeResponseBody(response)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
  })

  it('registers the global sessions event tail route', async () => {
    const app = createTestApp()
    const response = await app.handle(
      new Request('http://localhost/events?scope=sessions&afterSequenceId=1000'),
    )
    await closeResponseBody(response)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
  })
})
