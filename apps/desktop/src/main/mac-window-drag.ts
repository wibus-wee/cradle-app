import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import type { BrowserWindow } from 'electron'
import { app } from 'electron'

import { resolveStagedNativeAddonPath } from './native-addon-paths'

interface MacWindowDragAddon {
  begin: (handle: Buffer) => boolean
}

const require = createRequire(import.meta.url)
let cachedAddon: MacWindowDragAddon | null | undefined

function loadAddon(): MacWindowDragAddon | null {
  if (cachedAddon !== undefined) {
    return cachedAddon
  }
  const appPath = app.getAppPath()
  const candidates = [
    resolveStagedNativeAddonPath(appPath, 'window-drag.node'),
    ...(!app.isPackaged
      ? [join(appPath, 'native', 'macos', 'window-drag', 'build', 'Release', 'window_drag.node')]
      : []),
  ]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        cachedAddon = require(candidate) as MacWindowDragAddon
        return cachedAddon
      }
    }
    catch (error) {
      console.warn(`[desktop] failed to load macOS window-drag addon at ${candidate}:`, error)
    }
  }
  if (process.platform === 'darwin') {
    console.warn('[desktop] macOS window-drag addon unavailable; held-pointer tear-off cannot continue')
  }
  cachedAddon = null
  return null
}

export function beginMacWindowDrag(win: BrowserWindow): boolean {
  if (process.platform !== 'darwin' || win.isDestroyed()) {
    return false
  }
  return loadAddon()?.begin(win.getNativeWindowHandle()) ?? false
}
