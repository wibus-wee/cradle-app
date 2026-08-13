import { describe, expect, it, vi } from 'vitest'

import {
  activateWebPluginModule,
  deactivateWebPlugin,
  isWebLayerLoadable,
  loadWebPlugins,
  startPluginDevSessionWatcher,
} from './plugin-host'

const mocks = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  openServerEventSource: vi.fn(),
  readPluginDevSessions: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  getPlugins: mocks.getPlugins,
}))

vi.mock('./authenticated-server-url', () => ({
  getAuthenticatedServerResourceUrl: vi.fn(),
}))

vi.mock('~/features/plugins/api/plugin-dev', () => ({
  readPluginDevSessions: mocks.readPluginDevSessions,
}))

vi.mock('./server-transport', () => ({
  openServerEventSource: mocks.openServerEventSource,
}))

function createLayers(webStatus: 'discovered' | 'failed') {
  return {
    server: {
      layer: 'server' as const,
      status: 'skipped' as const,
    },
    web: webStatus === 'failed'
      ? {
          layer: 'web' as const,
          status: 'failed' as const,
          error: 'Web entry is missing: dist/web.mjs',
        }
      : {
          layer: 'web' as const,
          status: 'discovered' as const,
        },
    desktop: {
      layer: 'desktop' as const,
      status: 'skipped' as const,
    },
  }
}

describe('plugin host web layer filtering', () => {
  it('reads descriptors through the generated SDK', async () => {
    mocks.getPlugins.mockResolvedValueOnce({ data: [] })

    await loadWebPlugins()

    expect(mocks.getPlugins).toHaveBeenCalledWith({ throwOnError: true })
  })

  it('does not load failed web layers', () => {
    expect(isWebLayerLoadable({
      name: '@cradle/system-info',
      version: '1.0.0',
      displayName: 'System Info',
      hasWeb: true,
      layers: createLayers('failed'),
    })).toBe(false)
  })

  it('loads discovered web layers', () => {
    expect(isWebLayerLoadable({
      name: '@cradle/system-info',
      version: '1.0.0',
      displayName: 'System Info',
      hasWeb: true,
      layers: createLayers('discovered'),
    })).toBe(true)
  })

  it('disposes Vite-injected development styles when the web layer deactivates', async () => {
    const deactivate = vi.fn()
    const disposeDevelopmentStyles = vi.fn()
    await activateWebPluginModule('@cradle/dev-style', {
      activate: () => undefined,
      deactivate,
      __cradleDevDispose: disposeDevelopmentStyles,
    })

    await deactivateWebPlugin('@cradle/dev-style')

    expect(deactivate).toHaveBeenCalledOnce()
    expect(disposeDevelopmentStyles).toHaveBeenCalledOnce()
  })

  it('keeps startup alive when the optional development session snapshot resets', async () => {
    const close = vi.fn()
    mocks.readPluginDevSessions.mockRejectedValueOnce(new TypeError('fetch failed'))
    mocks.openServerEventSource.mockReturnValueOnce({
      close,
      onerror: null,
      onmessage: null,
    })

    const dispose = await startPluginDevSessionWatcher()

    expect(mocks.openServerEventSource).toHaveBeenCalledOnce()
    dispose()
    expect(close).toHaveBeenCalledOnce()
  })
})
