// @vitest-environment node
// Prefer: pnpm exec vitest run --config vitest.transport.config.ts <this-file>

import { afterEach, describe, expect, it, vi } from 'vitest'

import { cradleFetch } from './server-credential'
import {
  applyDesktopServerReadyEndpoint,
  CRADLE_SERVER_LOCAL_BASE,
  resetServerTransportBaseUrlStateForTests,
} from './server-transport/base-url'

afterEach(() => {
  resetServerTransportBaseUrlStateForTests()
  window.localStorage.clear()
  delete window.cradle
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('cradleFetch credential injection', () => {
  it('does not attach Authorization on cradle-server:// requests', async () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:21423',
      connection: {
        kind: 'owned-proxy',
        serverUrl: 'http://127.0.0.1:21423',
        rendererBaseUrl: CRADLE_SERVER_LOCAL_BASE,
        generation: 1,
      },
    })
    window.cradle = {
      env: {
        isElectron: true,
        serverAuthToken: 'secret-token',
        serverUrl: 'http://127.0.0.1:21423',
      },
    } as unknown as typeof window.cradle

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await cradleFetch(new URL('/health', CRADLE_SERVER_LOCAL_BASE))

    expect(fetchMock).toHaveBeenCalledOnce()
    const [input, init] = fetchMock.mock.calls[0]!
    const url = input instanceof Request ? input.url : String(input)
    expect(url).toBe('cradle-server://local/health')
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    expect(headers.has('authorization')).toBe(false)
    expect(init?.credentials).toBe('omit')
  })

  it('attaches Bearer for browser/attached HTTP Server requests', async () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:21423',
    })
    window.cradle = {
      env: {
        isElectron: true,
        serverAuthToken: 'secret-token',
        serverUrl: 'http://127.0.0.1:21423',
      },
    } as unknown as typeof window.cradle

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await cradleFetch(new URL('/health', 'http://127.0.0.1:21423'))

    const [, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer secret-token')
    expect(init?.credentials).toBe('include')
  })

  it('rebases HTTP Server URLs onto cradle-server://local in owned-proxy mode', async () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:21423',
      connection: {
        kind: 'owned-proxy',
        serverUrl: 'http://127.0.0.1:21423',
        rendererBaseUrl: CRADLE_SERVER_LOCAL_BASE,
      },
    })

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await cradleFetch(new Request('http://127.0.0.1:21423/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer leak' },
      body: '{"ok":true}',
    }))

    const [input, init] = fetchMock.mock.calls[0]!
    const request = input instanceof Request ? input : new Request(input, init)
    expect(request.url).toBe('cradle-server://local/sessions')
    expect(request.method).toBe('POST')
    expect(request.headers.has('authorization')).toBe(false)
    expect(await request.text()).toBe('{"ok":true}')
  })
})
