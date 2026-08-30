// @vitest-environment node
// Prefer: pnpm exec vitest run --config vitest.transport.config.ts <this-file>

import { afterEach, describe, expect, it, vi } from 'vitest'

import { cradleFetch } from './server-credential'
import {
  applyDesktopServerReadyEndpoint,
  resetServerTransportBaseUrlStateForTests,
} from './server-transport/base-url'
import {
  disposeDesktopIpcFetchDocument,
  resetDesktopIpcFetchForTests,
} from './server-transport/desktop-ipc-fetch'

afterEach(() => {
  resetDesktopIpcFetchForTests()
  resetServerTransportBaseUrlStateForTests()
  window.localStorage.clear()
  delete window.cradle
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('cradleFetch transport selection', () => {
  it('does not attach a bearer token for browser/attached HTTP Server requests', async () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:21423',
    })
    window.cradle = {
      env: {
        isElectron: true,
        serverUrl: 'http://127.0.0.1:21423',
      },
    } as unknown as typeof window.cradle

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await cradleFetch(new URL('/health', 'http://127.0.0.1:21423'))

    const [, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(init?.credentials).toBe('include')
  })

  it('routes owned Desktop requests through the IPC fetch bridge with pull credit', async () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:21423',
      connection: {
        kind: 'owned-ipc',
        serverUrl: 'http://127.0.0.1:21423',
        rendererBaseUrl: 'http://127.0.0.1:21423',
        generation: 1,
      },
    })

    let onChunk: ((event: { requestId: string, bytes: Uint8Array }) => void) | null = null
    let onClosed: ((event: { requestId: string }) => void) | null = null
    const open = vi.fn(async (request: {
      requestId: string
      generation: number
      method: string
      path: string
      headers: Array<[string, string]>
      body: Uint8Array | null
    }) => ({
      requestId: request.requestId,
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']] as Array<[string, string]>,
      url: 'http://127.0.0.1:21423/sessions?limit=2',
    }))
    const credit = vi.fn((requestId: string) => {
      if (credit.mock.calls.length === 1) {
        onChunk?.({ requestId, bytes: new TextEncoder().encode('{"ok":true}') })
      }
      else {
        onClosed?.({ requestId })
      }
    })
    const nativeFetch = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', nativeFetch)
    window.cradle = {
      env: {
        isElectron: true,
        serverAuthToken: 'renderer-must-not-send-this',
        serverUrl: 'http://127.0.0.1:21423',
      },
      serverFetch: {
        open,
        credit,
        cancel: vi.fn(),
        onChunk: (handler: typeof onChunk) => {
          onChunk = handler
          return () => {}
        },
        onClosed: (handler: typeof onClosed) => {
          onClosed = handler
          return () => {}
        },
        onError: () => () => {},
      },
    } as unknown as typeof window.cradle

    const response = await cradleFetch(new Request(
      'http://127.0.0.1:21423/sessions?limit=2',
      {
        method: 'POST',
        headers: {
          'authorization': 'Bearer leaked-renderer-token',
          'content-type': 'application/json',
        },
        body: '{"name":"ipc"}',
      },
    ))

    expect(await response.json()).toEqual({ ok: true })
    expect(nativeFetch).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledOnce()
    const request = open.mock.calls[0]![0]
    expect(request.method).toBe('POST')
    expect(request.generation).toBe(1)
    expect(request.path).toBe('/sessions?limit=2')
    expect(new Headers(request.headers).has('authorization')).toBe(false)
    expect(new TextDecoder().decode(request.body!)).toBe('{"name":"ipc"}')
    expect(credit).toHaveBeenCalledTimes(2)
  })

  it('cancels an IPC request whose headers are pending when the document is discarded', async () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:21423',
      connection: {
        kind: 'owned-ipc',
        serverUrl: 'http://127.0.0.1:21423',
        rendererBaseUrl: 'http://127.0.0.1:21423',
        generation: 1,
      },
    })
    let resolveOpen!: (value: { requestId: string, cancelled: true }) => void
    const open = vi.fn((_request: { requestId: string }) => new Promise<{
      requestId: string
      cancelled: true
    }>((resolve) => {
      resolveOpen = resolve
    }))
    const cancel = vi.fn()
    window.cradle = {
      serverFetch: {
        open,
        credit: vi.fn(),
        cancel,
        onChunk: () => () => {},
        onClosed: () => () => {},
        onError: () => () => {},
      },
    } as unknown as typeof window.cradle

    const fetching = cradleFetch('http://127.0.0.1:21423/slow-headers')
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    const requestId = open.mock.calls[0]![0].requestId

    disposeDesktopIpcFetchDocument()

    expect(cancel).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith(requestId)
    resolveOpen({ requestId, cancelled: true })
    await expect(fetching).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('cancels an unread IPC response body when the document is discarded', async () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:21423',
      connection: {
        kind: 'owned-ipc',
        serverUrl: 'http://127.0.0.1:21423',
        rendererBaseUrl: 'http://127.0.0.1:21423',
        generation: 1,
      },
    })
    const cancel = vi.fn()
    const open = vi.fn(async (request: { requestId: string }) => ({
      requestId: request.requestId,
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']] as Array<[string, string]>,
      url: 'http://127.0.0.1:21423/large',
    }))
    window.cradle = {
      serverFetch: {
        open,
        credit: vi.fn(),
        cancel,
        onChunk: () => () => {},
        onClosed: () => () => {},
        onError: () => () => {},
      },
    } as unknown as typeof window.cradle
    const response = await cradleFetch('http://127.0.0.1:21423/large')
    const requestId = open.mock.calls[0]![0].requestId

    disposeDesktopIpcFetchDocument()

    expect(cancel).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith(requestId)
    await expect(response.text()).rejects.toMatchObject({ name: 'AbortError' })
  })
})
