// @vitest-environment node
// Prefer: pnpm exec vitest run --config vitest.transport.config.ts <this-file>

import { afterEach, describe, expect, it, vi } from 'vitest'

import { waitForDesktopServer } from './server-readiness'
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
  delete window.cradle
  resetServerTransportBaseUrlStateForTests()
  window.localStorage.clear()
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
