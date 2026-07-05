import { join } from 'node:path'

import { app, BrowserWindow, screen } from 'electron'

import { resolveDesktopPreloadPath, resolveDesktopRendererIndexPath, resolveDesktopRendererTearoffPath } from './desktop-assets'
import { installExternalLinkPolicy } from './external-link-policy'
import { subscribeAcpDevtool, subscribeIpcDevtool } from './ipc-devtool'
import { readStoredWindowSize, resolveWindowBoundsNearPoint, resolveWindowSize, writeStoredWindowSize } from './window-state'

const TEAROFF_WINDOW_DEFAULT_WIDTH = 720
const TEAROFF_WINDOW_DEFAULT_HEIGHT = 640
const TEAROFF_WINDOW_MIN_WIDTH = 520
const TEAROFF_WINDOW_MIN_HEIGHT = 420
const TEAROFF_WINDOW_SIZE_FILE = 'tearoff-window-size.json'

/**
 * Serialised surface route passed from the renderer when tearing a surface off
 * into its own window. Kept loose (string params) so the desktop process does
 * not depend on the web-only `SurfaceRoute` union; the renderer owns the shape.
 */
export interface TearoffSurfaceRoute {
  to: string
  params?: Record<string, string>
  search?: Record<string, string | undefined>
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private surfaceWindows = new Map<string, BrowserWindow>()
  private devtoolWindow: BrowserWindow | null = null
  private lastFocusedAppshotWindow: BrowserWindow | null = null
  private serverUrl: string

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
    this.trackAppshotCaptureWindow(win)
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  getLastFocusedAppshotWindow(): BrowserWindow | null {
    if (this.lastFocusedAppshotWindow && !this.lastFocusedAppshotWindow.isDestroyed()) {
      return this.lastFocusedAppshotWindow
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow
    }
    return null
  }

  /**
   * Open a surface in a new tearoff window.
   * If a window for this surface already exists, focus it instead.
   */
  async openSurfaceWindow(surfaceId: string, route: TearoffSurfaceRoute, x: number, y: number): Promise<BrowserWindow> {
    const existing = this.surfaceWindows.get(surfaceId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return existing
    }

    const releasePoint = resolveTearoffReleasePoint(x, y)
    const targetDisplay = screen.getDisplayNearestPoint(releasePoint)
    const targetSize = resolveWindowSize(
      readStoredWindowSize(join(app.getPath('userData'), TEAROFF_WINDOW_SIZE_FILE)),
      {
        defaultWidth: TEAROFF_WINDOW_DEFAULT_WIDTH,
        defaultHeight: TEAROFF_WINDOW_DEFAULT_HEIGHT,
        minWidth: TEAROFF_WINDOW_MIN_WIDTH,
        minHeight: TEAROFF_WINDOW_MIN_HEIGHT,
      },
      targetDisplay.workArea,
    )
    const targetBounds = resolveWindowBoundsNearPoint(targetSize, releasePoint, targetDisplay.workArea)

    const isMacOS = process.platform === 'darwin'

    const win = new BrowserWindow({
      ...targetBounds,
      minWidth: TEAROFF_WINDOW_MIN_WIDTH,
      minHeight: TEAROFF_WINDOW_MIN_HEIGHT,
      titleBarStyle: isMacOS ? 'hiddenInset' : 'hidden',
      titleBarOverlay: isMacOS
        ? true
        : {
            color: '#00000000',
            symbolColor: '#ffffff',
            height: 36,
          },
      ...(isMacOS && { trafficLightPosition: { x: 16, y: 18 } }),
      webPreferences: {
        preload: resolveDesktopPreloadPath(__dirname),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        additionalArguments: [
          `--server-url=${this.serverUrl}`,
          `--surface=${surfaceId}`,
          `--surface-route=${JSON.stringify(route)}`,
          '--tearoff=true',
        ],
      },
      show: false,
    })

    this.surfaceWindows.set(surfaceId, win)
    installExternalLinkPolicy(win.webContents)
    this.trackAppshotCaptureWindow(win)

    let lastTearoffWindowSize = { width: targetBounds.width, height: targetBounds.height }
    const writeTearoffWindowSize = (): void => {
      if (win.isDestroyed()) {
        writeStoredWindowSize(join(app.getPath('userData'), TEAROFF_WINDOW_SIZE_FILE), lastTearoffWindowSize)
        return
      }
      const { width, height } = win.getBounds()
      lastTearoffWindowSize = { width, height }
      writeStoredWindowSize(join(app.getPath('userData'), TEAROFF_WINDOW_SIZE_FILE), lastTearoffWindowSize)
    }

    win.on('resize', writeTearoffWindowSize)
    win.on('close', writeTearoffWindowSize)

    win.once('ready-to-show', () => {
      win.show()
    })

    win.on('closed', () => {
      writeTearoffWindowSize()
      if (this.surfaceWindows.get(surfaceId) !== win) {
        return
      }
      this.surfaceWindows.delete(surfaceId)
      const mainWindow = this.mainWindow
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window:tearoff-surface-closed', surfaceId)
      }
    })

    try {
      if (process.env.ELECTRON_RENDERER_URL) {
        const url = new URL('/tearoff.html', process.env.ELECTRON_RENDERER_URL)
        url.searchParams.set('surface', surfaceId)
        url.searchParams.set('tearoff', 'true')
        await win.loadURL(url.toString())
      }
      else {
        await win.loadFile(resolveDesktopRendererTearoffPath(), {
          query: { surface: surfaceId, tearoff: 'true' },
        })
      }
    }
    catch (error) {
      if (this.surfaceWindows.get(surfaceId) === win) {
        this.surfaceWindows.delete(surfaceId)
      }
      if (!win.isDestroyed()) {
        win.destroy()
      }
      throw error
    }

    return win
  }

  private trackAppshotCaptureWindow(win: BrowserWindow): void {
    if (win.isDestroyed()) {
      return
    }
    if (win.isFocused()) {
      this.lastFocusedAppshotWindow = win
    }
    win.on('focus', () => {
      if (!win.isDestroyed()) {
        this.lastFocusedAppshotWindow = win
      }
    })
    win.on('closed', () => {
      if (this.lastFocusedAppshotWindow === win) {
        this.lastFocusedAppshotWindow = null
      }
    })
  }

  /**
   * Focus a surface window if it exists.
   */
  focusSurfaceWindow(surfaceId: string): boolean {
    const win = this.surfaceWindows.get(surfaceId)
    if (win && !win.isDestroyed()) {
      win.focus()
      return true
    }
    return false
  }

  /**
   * Close a specific surface window.
   */
  closeSurfaceWindow(surfaceId: string): void {
    const win = this.surfaceWindows.get(surfaceId)
    if (win && !win.isDestroyed()) {
      win.close()
    }
  }

  /**
   * Get all open surface window IDs.
   */
  getOpenSurfaceIds(): string[] {
    return [...this.surfaceWindows.keys()].filter((id) => {
      const win = this.surfaceWindows.get(id)
      return win && !win.isDestroyed()
    })
  }

  /**
   * Open the devtool window (or focus if already open).
   */
  async openDevtoolWindow(): Promise<BrowserWindow> {
    if (this.devtoolWindow && !this.devtoolWindow.isDestroyed()) {
      this.devtoolWindow.focus()
      return this.devtoolWindow
    }

    const win = new BrowserWindow({
      width: 900,
      height: 600,
      title: 'Cradle DevTools',
      webPreferences: {
        preload: resolveDesktopPreloadPath(__dirname),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        additionalArguments: [
          `--server-url=${this.serverUrl}`,
          '--devtool=true',
        ],
      },
      show: false,
    })

    installExternalLinkPolicy(win.webContents)
    win.once('ready-to-show', () => {
      win.show()
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#devtool`)
    }
    else {
      await win.loadFile(resolveDesktopRendererIndexPath(), {
        hash: 'devtool',
      })
    }

    this.devtoolWindow = win
    win.on('closed', () => {
      this.devtoolWindow = null
    })

    win.webContents.once('did-finish-load', () => {
      subscribeIpcDevtool(win.webContents)
      subscribeAcpDevtool(win.webContents)
    })

    return win
  }
}

function resolveTearoffReleasePoint(x: number, y: number): { x: number, y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) {
    return screen.getCursorScreenPoint()
  }

  return { x: Math.round(x), y: Math.round(y) }
}
