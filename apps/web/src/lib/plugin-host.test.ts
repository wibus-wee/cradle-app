import { describe, expect, it, vi } from 'vitest'

import { activateWebPluginModule, deactivateWebPlugin, isWebLayerLoadable } from './plugin-host'

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
})
