import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveStagedNativeAddonPath } from './native-addon-paths'

describe('resolveStagedNativeAddonPath', () => {
  it('resolves a staged addon from the desktop project in development', () => {
    expect(resolveStagedNativeAddonPath('/repo/apps/desktop', 'window-drag.node')).toBe(
      join('/repo/apps/desktop', 'dist', 'main', 'native', 'window-drag.node'),
    )
  })

  it('resolves electron-builder native modules beside app.asar', () => {
    expect(resolveStagedNativeAddonPath(
      '/Applications/Cradle.app/Contents/Resources/app.asar',
      'window-drag.node',
    )).toBe(join(
      '/Applications/Cradle.app/Contents/Resources/app.asar.unpacked',
      'dist',
      'main',
      'native',
      'window-drag.node',
    ))
  })
})
