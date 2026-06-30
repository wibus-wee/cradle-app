import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { app } from 'electron'

export function resolveDesktopPreloadPath(moduleDir: string): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    const candidates = [
      resolve(moduleDir, '../preload/index.js'),
      resolve(moduleDir, '../../preload/index.js'),
    ]
    return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]!
  }
  return join(app.getAppPath(), 'dist/preload/index.js')
}

export function resolveDesktopBrowserPanelPreloadPath(moduleDir: string): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    const candidates = [
      resolve(moduleDir, '../preload/browser-panel.js'),
      resolve(moduleDir, '../../preload/browser-panel.js'),
    ]
    return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]!
  }
  return join(app.getAppPath(), 'dist/preload/browser-panel.js')
}

export function resolveDesktopRendererIndexPath(): string {
  return join(app.getAppPath(), 'dist/renderer/index.html')
}

export function resolveDesktopRendererTearoffPath(): string {
  return join(app.getAppPath(), 'dist/renderer/tearoff.html')
}
