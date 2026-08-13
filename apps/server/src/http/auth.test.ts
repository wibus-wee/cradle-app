import { Elysia } from 'elysia'
import { describe, expect, it } from 'vitest'

import { loadServerAuthConfig } from '../config/server-config'
import { createAuthPlugin, verifyWebSocketRequestToken } from './auth'
import { issueSingleUseTicket, resetSingleUseTicketsForTests } from './single-use-ticket'

function createTestApp(config: { authRequired: boolean }) {
  return new Elysia()
    .use(createAuthPlugin(config))
    .get('/health', () => 'OK')
    .get('/api/plugins/-/deps/react.mjs', () => 'export {}')
    .get('/protected', () => ({ ok: true }))
}

describe('hTTP auth plugin', () => {
  it('allows requests when auth is not required', async () => {
    const app = createTestApp({ authRequired: false })

    const response = await app.handle(new Request('http://localhost/protected'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('bootstraps an HttpOnly browser session for headerless browser transports', async () => {
    const app = createTestApp({ authRequired: false })
    const bootstrap = await app.handle(new Request('http://localhost/auth/browser-session', {
      method: 'POST',
    }))
    const cookie = bootstrap.headers.get('set-cookie')

    expect(bootstrap.status).toBe(200)
    expect(cookie).toContain('HttpOnly')
    const response = await app.handle(new Request('http://localhost/protected', {
      headers: { cookie: cookie!.split(';')[0]! },
    }))
    expect(response.status).toBe(200)
  })

  it('always allows the health endpoint', async () => {
    const app = createTestApp({ authRequired: true })

    const response = await app.handle(new Request('http://localhost/health'))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('OK')
  })

  it('always allows OpenAPI document routes', async () => {
    const app = createTestApp({ authRequired: true })

    const specResponse = await app.handle(new Request('http://localhost/openapi.json'))
    const docsResponse = await app.handle(new Request('http://localhost/docs'))

    expect(specResponse.status).not.toBe(401)
    expect(docsResponse.status).not.toBe(401)
  })

  it('allows stable shared plugin dependency modules without credentials', async () => {
    const app = createTestApp({ authRequired: true })

    const response = await app.handle(new Request('http://localhost/api/plugins/-/deps/react.mjs'))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('export {}')
  })

  it('accepts a single-use audience-bound ticket for browser WebSocket clients', () => {
    resetSingleUseTicketsForTests()
    const { ticket } = issueSingleUseTicket('/sync')
    const request = new Request(`http://localhost/sync?ticket=${ticket}`)

    expect(verifyWebSocketRequestToken(request, {
      config: { authRequired: true },
      audience: '/sync',
    })).toBe(true)
    expect(verifyWebSocketRequestToken(new Request(request.url), {
      config: { authRequired: true },
      audience: '/sync',
    })).toBe(false)
  })

  it('keeps ticket consumption idempotent within one WebSocket upgrade request', () => {
    resetSingleUseTicketsForTests()
    const { ticket } = issueSingleUseTicket('/sync')
    const request = new Request(`http://localhost/sync?ticket=${ticket}`)
    const options = {
      config: { authRequired: true },
      audience: '/sync',
    }

    expect(verifyWebSocketRequestToken(request, options)).toBe(true)
    expect(verifyWebSocketRequestToken(request, options)).toBe(true)
    expect(verifyWebSocketRequestToken(new Request(request.url), options)).toBe(false)
  })

  it('lets the global auth hook pre-validate, but not consume, WebSocket tickets', async () => {
    resetSingleUseTicketsForTests()
    const { ticket } = issueSingleUseTicket('/protected')
    const app = createTestApp({ authRequired: true })

    const response = await app.handle(new Request(`http://localhost/protected?ticket=${ticket}`, {
      headers: { upgrade: 'websocket' },
    }))

    expect(response.status).toBe(200)
    expect(verifyWebSocketRequestToken(new Request(`http://localhost/protected?ticket=${ticket}`), {
      config: { authRequired: true },
    })).toBe(true)
  })

  it('does not bypass HTTP auth for a ticket without a WebSocket upgrade', async () => {
    resetSingleUseTicketsForTests()
    const { ticket } = issueSingleUseTicket('/protected')
    const app = createTestApp({ authRequired: true })

    const response = await app.handle(new Request(`http://localhost/protected?ticket=${ticket}`))

    expect(response.status).toBe(401)
  })

  it('allows one audience-bound GET with a browser resource ticket', async () => {
    resetSingleUseTicketsForTests()
    const app = createTestApp({ authRequired: true })
    const { ticket } = issueSingleUseTicket('resource:/protected')
    const resourceUrl = `http://localhost/protected?resourceTicket=${ticket}`

    expect((await app.handle(new Request(resourceUrl))).status).toBe(200)
    expect((await app.handle(new Request(resourceUrl))).status).toBe(401)
  })

  it('rejects a WebSocket ticket issued for a different audience', () => {
    resetSingleUseTicketsForTests()
    const { ticket } = issueSingleUseTicket('/sync')
    const request = new Request(`http://localhost/terminal-sessions/one/socket?ticket=${ticket}`)

    expect(verifyWebSocketRequestToken(request, {
      config: { authRequired: true },
      audience: '/terminal-sessions/one/socket',
    })).toBe(false)
  })

  it('derives authRequired from the explicit environment switch', () => {
    expect(loadServerAuthConfig({ CRADLE_AUTH_REQUIRED: 'true' })).toEqual({
      authRequired: true,
    })
    expect(loadServerAuthConfig({})).toEqual({
      authRequired: false,
    })
  })
})
