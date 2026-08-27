// @vitest-environment node
// Prefer: pnpm exec vitest run --config vitest.transport.config.ts <this-file>

import { afterEach, describe, expect, it, vi } from 'vitest'

import { waitForDesktopServer, waitForHostedServer } from './server-readiness'
import {
  getDesktopServerGeneration,
  getRendererServerUrl,
  getServerNetworkUrl,
  resetServerTransportBaseUrlStateForTests,
} from './server-transport/base-url'

vi.mock('./client.config', () => ({
  client: { setConfig: vi.fn() },
}))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete window.cradle
  resetServerTransportBaseUrlStateForTests()
  window.localStorage.clear()
})

describe('hosted server readiness', () => {
  it('recovers when the server becomes reachable during the startup retry sequence', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('unreachable'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const readiness = waitForHostedServer()
    await vi.advanceTimersByTimeAsync(200)

    await expect(readiness).resolves.toBe('http://127.0.0.1:21423')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops retrying and exposes a recovery path when the server stays unreachable', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('unreachable'))
    vi.stubGlobal('fetch', fetchMock)

    const readiness = expect(waitForHostedServer()).rejects.toThrow(
      'Could not reach Cradle Server at http://127.0.0.1:21423.',
    )
    await vi.runAllTimersAsync()

    await readiness
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})

describe('desktop server readiness bridge', () => {
  it('uses the retained status snapshot when the renderer attaches after ready was emitted', async () => {
    const onStatusChanged = vi.fn(() => () => {})
    window.cradle = {
      env: { isElectron: true },
      serverRuntime: {
        getStatus: vi.fn(async () => ({
          state: 'ready' as const,
          serverUrl: 'http://127.0.0.1:21423',
          bootstrap: {
            currentPhase: null,
            phaseStartedAt: null,
            lastEvent: {
              type: 'cradle-server-bootstrap' as const,
              phase: 'listener-establishment' as const,
              kind: 'ready' as const,
              at: '2026-07-24T00:00:00.000Z',
            },
          },
        })),
        onStatusChanged,
      },
    } as unknown as typeof window.cradle

    await expect(waitForDesktopServer()).resolves.toBe('http://127.0.0.1:21423')
    expect(onStatusChanged).not.toHaveBeenCalled()
  })

  it('applies owned-ipc generation and keeps the HTTP URL for request construction', async () => {
    window.cradle = {
      env: { isElectron: true },
      serverRuntime: {
        getStatus: vi.fn(async () => ({
          state: 'ready' as const,
          serverUrl: 'http://127.0.0.1:21423',
          connection: {
            kind: 'owned-ipc' as const,
            serverUrl: 'http://127.0.0.1:21423',
            rendererBaseUrl: 'http://127.0.0.1:21423',
            generation: 2,
          },
          bootstrap: {
            currentPhase: null,
            phaseStartedAt: null,
          },
        })),
        onStatusChanged: vi.fn(() => () => {}),
      },
    } as unknown as typeof window.cradle

    await expect(waitForDesktopServer()).resolves.toBe('http://127.0.0.1:21423')
    expect(getRendererServerUrl()).toBe('http://127.0.0.1:21423')
    expect(getServerNetworkUrl()).toBe('http://127.0.0.1:21423')
    expect(getDesktopServerGeneration()).toBe(2)
  })
})
