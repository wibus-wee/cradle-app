// @vitest-environment node
// Prefer: pnpm exec vitest run --config vitest.transport.config.ts <this-file>
// Full vite.config.ts + forks/jsdom often hangs under pool contention.

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyDesktopServerReadyEndpoint,
  CRADLE_SERVER_LOCAL_BASE,
  getDesktopServerConnectionKind,
  getRendererServerUrl,
  getServerNetworkUrl,
  isCradleServerLocalUrl,
  isCustomSchemeProxyMode,
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
  it('uses cradle-server renderer base and HTTP network URL for owned-proxy', () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:21423',
      connection: {
        kind: 'owned-proxy',
        serverUrl: 'http://127.0.0.1:21423',
        rendererBaseUrl: CRADLE_SERVER_LOCAL_BASE,
        generation: 1,
      },
    })

    expect(getDesktopServerConnectionKind()).toBe('owned-proxy')
    expect(getRendererServerUrl()).toBe(CRADLE_SERVER_LOCAL_BASE)
    expect(getServerNetworkUrl()).toBe('http://127.0.0.1:21423')
    expect(isCustomSchemeProxyMode()).toBe(true)
  })

  it('keeps attached-http HTTP renderer when Main cannot proxy', () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:3000',
      connection: {
        kind: 'attached-http',
        serverUrl: 'http://127.0.0.1:3000',
        rendererBaseUrl: 'http://127.0.0.1:3000',
      },
    })

    expect(getDesktopServerConnectionKind()).toBe('attached-http')
    expect(getRendererServerUrl()).toBe('http://127.0.0.1:3000')
    expect(getServerNetworkUrl()).toBe('http://127.0.0.1:3000')
    expect(isCustomSchemeProxyMode()).toBe(false)
  })

  it('allows attached-http with cradle-server renderer base when Main proxies', () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:3000',
      connection: {
        kind: 'attached-http',
        serverUrl: 'http://127.0.0.1:3000',
        rendererBaseUrl: CRADLE_SERVER_LOCAL_BASE,
      },
    })

    expect(getRendererServerUrl()).toBe(CRADLE_SERVER_LOCAL_BASE)
    expect(getServerNetworkUrl()).toBe('http://127.0.0.1:3000')
    expect(isCustomSchemeProxyMode()).toBe(true)
  })

  it('falls back to HTTP serverUrl when connection kind is absent', () => {
    applyDesktopServerReadyEndpoint({
      serverUrl: 'http://127.0.0.1:21423',
    })

    expect(getDesktopServerConnectionKind()).toBeNull()
    expect(getRendererServerUrl()).toBe('http://127.0.0.1:21423')
    expect(getServerNetworkUrl()).toBe('http://127.0.0.1:21423')
    expect(isCustomSchemeProxyMode()).toBe(false)
  })

  it('does not use URL.origin for custom-scheme identity', () => {
    expect(isCradleServerLocalUrl(CRADLE_SERVER_LOCAL_BASE)).toBe(true)
    expect(isSameServerEndpoint(CRADLE_SERVER_LOCAL_BASE, 'cradle-server://local/')).toBe(true)
    expect(isSameServerEndpoint(CRADLE_SERVER_LOCAL_BASE, 'http://127.0.0.1:21423')).toBe(false)
    expect(rebaseToServerBase('/health', CRADLE_SERVER_LOCAL_BASE).toString()).toBe(
      'cradle-server://local/health',
    )
    expect(
      rebaseToServerBase('http://127.0.0.1:21423/chat/sessions/1', CRADLE_SERVER_LOCAL_BASE).toString(),
    ).toBe('cradle-server://local/chat/sessions/1')
  })
})
