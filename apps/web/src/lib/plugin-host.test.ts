import { describe, expect, it } from 'vitest'

import { isWebLayerLoadable } from './plugin-host'

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
})
