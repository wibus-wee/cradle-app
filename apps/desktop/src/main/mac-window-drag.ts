import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import type { BrowserWindow } from 'electron'
import { app } from 'electron'

interface MacWindowDragAddon {
  install: (handle: Buffer) => boolean
  begin: (handle: Buffer) => boolean
}

const require = createRequire(import.meta.url)
let cachedAddon: MacWindowDragAddon | null | undefined

function loadAddon(): MacWindowDragAddon | null {
  if (cachedAddon !== undefined) {
    return cachedAddon
  }
  const packedPath = __dirname.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  const candidates = [
    join(packedPath, 'native', 'window-drag.node'),
    ...(!app.isPackaged
      ? [resolve(__dirname, '..', '..', 'native', 'macos', 'window-drag', 'build', 'Release', 'window_drag.node')]
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
  cachedAddon = null
  return null
}

export function installMacWindowDragCapture(win: BrowserWindow): boolean {
  if (process.platform !== 'darwin' || win.isDestroyed()) {
    return false
  }
  return loadAddon()?.install(win.getNativeWindowHandle()) ?? false
}

export function beginMacWindowDrag(win: BrowserWindow): boolean {
  if (process.platform !== 'darwin' || win.isDestroyed()) {
    return false
  }
  return loadAddon()?.begin(win.getNativeWindowHandle()) ?? false
}
