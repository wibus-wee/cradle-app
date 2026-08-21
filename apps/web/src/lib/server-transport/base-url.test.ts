// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyDesktopServerReadyEndpoint,
  getDesktopServerConnectionKind,
  getDesktopServerGeneration,
  getRendererServerUrl,
  getServerNetworkUrl,
  isDesktopIpcProxyMode,
  isSameServerEndpoint,
  rebaseToServerBase,
  resetServerTransportBaseUrlStateForTests,
} from './base-url'

afterEach(() => {
  resetServerTransportBaseUrlStateForTests()
  window.localStorage.clear()
  delete window.cradle
})

describe('server transport base URL selection', () => {
  it('keeps HTTP URL construction and generation for owned-ipc', () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:21423',
      connection: {
        kind: 'owned-ipc',
        serverUrl: 'http://127.0.0.1:21423',
        rendererBaseUrl: 'http://127.0.0.1:21423',
        generation: 3,
      },
    })

    expect(getDesktopServerConnectionKind()).toBe('owned-ipc')
    expect(getRendererServerUrl()).toBe('http://127.0.0.1:21423')
    expect(getServerNetworkUrl()).toBe('http://127.0.0.1:21423')
    expect(getDesktopServerGeneration()).toBe(3)
    expect(isDesktopIpcProxyMode()).toBe(true)
  })

  it('keeps attached-http on native HTTP', () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:3000',
      connection: {
        kind: 'attached-http',
        serverUrl: 'http://127.0.0.1:3000',
        rendererBaseUrl: 'http://127.0.0.1:3000',
      },
    })

    expect(getDesktopServerConnectionKind()).toBe('attached-http')
    expect(getDesktopServerGeneration()).toBeNull()
    expect(isDesktopIpcProxyMode()).toBe(false)
  })

  it('falls back to the HTTP serverUrl when connection kind is absent', () => {
    applyDesktopServerReadyEndpoint({ serverUrl: 'http://127.0.0.1:21423' })

    expect(getDesktopServerConnectionKind()).toBeNull()
    expect(getRendererServerUrl()).toBe('http://127.0.0.1:21423')
    expect(getServerNetworkUrl()).toBe('http://127.0.0.1:21423')
    expect(isDesktopIpcProxyMode()).toBe(false)
  })

  it('compares exact HTTP endpoints and rebases only path/query/hash', () => {
    expect(isSameServerEndpoint('http://127.0.0.1:21423', 'http://127.0.0.1:21423/')).toBe(true)
    expect(isSameServerEndpoint('http://127.0.0.1:21423', 'http://127.0.0.1:21424')).toBe(false)
    expect(rebaseToServerBase('/health?fresh=1', 'http://127.0.0.1:21423').toString()).toBe(
      'http://127.0.0.1:21423/health?fresh=1',
    )
  })
})
