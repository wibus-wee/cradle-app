import { Elysia } from 'elysia'
import { describe, expect, it } from 'vitest'

import { loadServerAuthConfig } from '../config/server-config'
import { createAuthPlugin, verifyRequestToken, verifyWebSocketRequestToken } from './auth'

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

  it('accepts a token query parameter for browser WebSocket clients', () => {
    const request = new Request('http://localhost/sync?token=secret-token')

    expect(verifyWebSocketRequestToken(request, {
      config: { authRequired: true, authToken: 'secret-token' },
    })).toBe(true)
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
