/* Verifies Electron desktop asset path resolution across dev and packaged runtimes. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  app: {
    getAppPath: vi.fn(() => '/Applications/Cradle.app/Contents/Resources/app.asar'),
  },
}))

vi.mock('electron', () => electronMocks)

const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
const tempRoots: string[] = []

function createDesktopDistFixture(): { browserPanelPreloadPath: string, chunkDir: string, preloadPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'cradle-desktop-assets-'))
  tempRoots.push(root)
  const chunkDir = join(root, 'apps', 'desktop', 'dist', 'main', 'chunks')
  const preloadPath = join(root, 'apps', 'desktop', 'dist', 'preload', 'index.js')
  const browserPanelPreloadPath = join(root, 'apps', 'desktop', 'dist', 'preload', 'browser-panel.js')
  mkdirSync(chunkDir, { recursive: true })
  mkdirSync(join(root, 'apps', 'desktop', 'dist', 'preload'), { recursive: true })
  writeFileSync(preloadPath, '')
  writeFileSync(browserPanelPreloadPath, '')
  return { browserPanelPreloadPath, chunkDir, preloadPath }
}

afterEach(() => {
  if (previousRendererUrl === undefined) {
    delete process.env.ELECTRON_RENDERER_URL
  }
 else {
    process.env.ELECTRON_RENDERER_URL = previousRendererUrl
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveDesktopPreloadPath', () => {
  it('finds the dev preload output from an electron-vite main chunk directory', async () => {
    const { chunkDir, preloadPath } = createDesktopDistFixture()
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5174'
    const { resolveDesktopPreloadPath } = await import('./desktop-assets')

    expect(resolveDesktopPreloadPath(chunkDir)).toBe(preloadPath)
  })

  it('uses the packaged preload output under app path outside development', async () => {
    delete process.env.ELECTRON_RENDERER_URL
    const { resolveDesktopPreloadPath } = await import('./desktop-assets')

    expect(resolveDesktopPreloadPath('/unused')).toBe('/Applications/Cradle.app/Contents/Resources/app.asar/dist/preload/index.js')
  })

  it('finds the dev browser panel preload output from an electron-vite main chunk directory', async () => {
    const { browserPanelPreloadPath, chunkDir } = createDesktopDistFixture()
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5174'
    const { resolveDesktopBrowserPanelPreloadPath } = await import('./desktop-assets')

    expect(resolveDesktopBrowserPanelPreloadPath(chunkDir)).toBe(browserPanelPreloadPath)
  })

  it('uses the packaged browser panel preload output under app path outside development', async () => {
    delete process.env.ELECTRON_RENDERER_URL
    const { resolveDesktopBrowserPanelPreloadPath } = await import('./desktop-assets')

    expect(resolveDesktopBrowserPanelPreloadPath('/unused')).toBe('/Applications/Cradle.app/Contents/Resources/app.asar/dist/preload/browser-panel.js')
  })

  it('resolves the packaged tear-off renderer entry', async () => {
    const { resolveDesktopRendererTearoffPath } = await import('./desktop-assets')

    expect(resolveDesktopRendererTearoffPath()).toBe('/Applications/Cradle.app/Contents/Resources/app.asar/dist/renderer/tearoff.html')
  })
})
