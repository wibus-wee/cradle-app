import { Elysia } from 'elysia'
import { describe, expect, it } from 'vitest'

import { loadServerAuthConfig } from '../config/server-config'
import { createAuthPlugin, verifyRequestToken, verifyWebSocketRequestToken } from './auth'
import { issueWebSocketTicket, resetWebSocketTicketsForTests } from './websocket-ticket'

function createTestApp(config: { authRequired: boolean, authToken: string | null }) {
  return new Elysia()
    .use(createAuthPlugin(config))
    .get('/health', () => 'OK')
    .get('/protected', () => ({ ok: true }))
}

describe('hTTP auth plugin', () => {
  it('allows requests when auth is not required', async () => {
    const app = createTestApp({ authRequired: false, authToken: null })

    const response = await app.handle(new Request('http://localhost/protected'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('rejects a missing token when auth is required', async () => {
    const app = createTestApp({ authRequired: true, authToken: 'secret-token' })

    const response = await app.handle(new Request('http://localhost/protected'))

    expect(response.status).toBe(401)
  })

  it('rejects the wrong bearer token', async () => {
    const app = createTestApp({ authRequired: true, authToken: 'secret-token' })

    const response = await app.handle(new Request('http://localhost/protected', {
      headers: { authorization: 'Bearer wrong-token' },
    }))

    expect(response.status).toBe(401)
  })

  it('allows the correct bearer token', async () => {
    const app = createTestApp({ authRequired: true, authToken: 'secret-token' })

    const response = await app.handle(new Request('http://localhost/protected', {
      headers: { authorization: 'Bearer secret-token' },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('bootstraps an HttpOnly browser session for headerless browser transports', async () => {
    const app = createTestApp({ authRequired: true, authToken: 'secret-token' })
    const bootstrap = await app.handle(new Request('http://localhost/auth/browser-session', {
      method: 'POST',
      headers: { authorization: 'Bearer secret-token' },
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
    const app = createTestApp({ authRequired: true, authToken: 'secret-token' })

    const response = await app.handle(new Request('http://localhost/health'))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('OK')
  })

  it('always allows OpenAPI document routes', async () => {
    const app = createTestApp({ authRequired: true, authToken: 'secret-token' })

    const specResponse = await app.handle(new Request('http://localhost/openapi.json'))
    const docsResponse = await app.handle(new Request('http://localhost/docs'))

    expect(specResponse.status).not.toBe(401)
    expect(docsResponse.status).not.toBe(401)
  })

  it('accepts the WebSocket-adjacent token header', () => {
    const headers = new Headers({ 'x-cradle-token': 'secret-token' })

    expect(verifyRequestToken(headers, {
      config: { authRequired: true, authToken: 'secret-token' },
    })).toBe(true)
  })

  it('accepts a single-use audience-bound ticket for browser WebSocket clients', () => {
    resetWebSocketTicketsForTests()
    const { ticket } = issueWebSocketTicket('/sync')
    const request = new Request(`http://localhost/sync?ticket=${ticket}`)

    expect(verifyWebSocketRequestToken(request, {
      config: { authRequired: true, authToken: 'secret-token' },
      audience: '/sync',
    })).toBe(true)
    expect(verifyWebSocketRequestToken(request, {
      config: { authRequired: true, authToken: 'secret-token' },
      audience: '/sync',
    })).toBe(false)
  })

  it('rejects a WebSocket ticket issued for a different audience', () => {
    resetWebSocketTicketsForTests()
    const { ticket } = issueWebSocketTicket('/sync')
    const request = new Request(`http://localhost/terminal-sessions/one/socket?ticket=${ticket}`)

    expect(verifyWebSocketRequestToken(request, {
      config: { authRequired: true, authToken: 'secret-token' },
      audience: '/terminal-sessions/one/socket',
    })).toBe(false)
  })

  it('derives authRequired from token or explicit required env', () => {
    expect(loadServerAuthConfig({ CRADLE_AUTH_TOKEN: ' secret-token ' })).toEqual({
      authRequired: true,
      authToken: 'secret-token',
    })
    expect(loadServerAuthConfig({ CRADLE_AUTH_REQUIRED: 'true' })).toEqual({
      authRequired: true,
      authToken: null,
    })
    expect(loadServerAuthConfig({})).toEqual({
      authRequired: false,
      authToken: null,
    })
  })
})
