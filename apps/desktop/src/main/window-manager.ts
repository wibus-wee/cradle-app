import { join } from 'node:path'

import { app, BrowserWindow, nativeTheme, screen } from 'electron'

import {
  resolveTrafficLightPosition,
  resolveWindowControlsOverlay,
  resolveWindowControlsSafeArea,
} from '../shared/window-controls-safe-area'
import {
  resolveDesktopBrowserPanelPreloadUrl,
  resolveDesktopPreloadPath,
  resolveDesktopRendererIndexPath,
  resolveDesktopRendererTearoffPath,
} from './desktop-assets'
import { installExternalLinkPolicy } from './external-link-policy'
import { subscribeAcpDevtool, subscribeIpcDevtool } from './ipc-devtool'
import { beginMacWindowDrag, installMacWindowDragCapture } from './mac-window-drag'
import { readStoredWindowSize, resolveWindowBoundsNearPoint, resolveWindowSize, writeStoredWindowSize } from './window-state'
import { beginWindowsWindowDrag, installWindowsCaptionButtons } from './windows-caption-buttons'

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

interface TearoffOpenOptions {
  bootstrap?: unknown
  continuePointerDrag?: boolean
}

interface TearoffSurfaceBinding {
  surfaceId: string
  route: TearoffSurfaceRoute
  bootstrap?: unknown
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private surfaceWindows = new Map<string, BrowserWindow>()
  private surfaceBindings = new Map<BrowserWindow, TearoffSurfaceBinding>()
  private warmSurfaceWindow: BrowserWindow | null = null
  private warmingSurfaceWindow: BrowserWindow | null = null
  private continuePointerDragWindows = new Set<BrowserWindow>()
  private devtoolWindow: BrowserWindow | null = null
  private lastFocusedAppshotWindow: BrowserWindow | null = null
  private serverUrl: string
  private readonly warmSurfaceWindows: boolean

  constructor(serverUrl: string, options: { warmSurfaceWindows?: boolean } = {}) {
    this.serverUrl = serverUrl
    this.warmSurfaceWindows = options.warmSurfaceWindows ?? true
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
    this.trackAppshotCaptureWindow(win)
    installMacWindowDragCapture(win)
    if (this.warmSurfaceWindows) {
      void this.primeSurfaceWindow()
    }
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
  async openSurfaceWindow(
    surfaceId: string,
    route: TearoffSurfaceRoute,
    x: number,
    y: number,
    options: TearoffOpenOptions = {},
  ): Promise<BrowserWindow> {
    const existing = this.surfaceWindows.get(surfaceId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return existing
    }

    // DOM drag events can report physical-pixel screen coordinates on Retina
    // while Electron's screen/BrowserWindow APIs use DIP. For a live native
    // handoff, the browser process owns the authoritative cursor position and
    // guarantees that the new window is created underneath the held pointer.
    const releasePoint = options.continuePointerDrag
      ? screen.getCursorScreenPoint()
      : resolveTearoffReleasePoint(x, y)
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

    const warmWindow = this.takeWarmSurfaceWindow()
    const win = warmWindow ?? this.createSurfaceBrowserWindow(targetBounds, { surfaceId, route })
    if (warmWindow) {
      win.setBounds(targetBounds)
    }

    this.surfaceWindows.set(surfaceId, win)
    this.surfaceBindings.set(win, { surfaceId, route, bootstrap: options.bootstrap })
    if (options.continuePointerDrag) {
      this.continuePointerDragWindows.add(win)
    }

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

    win.on('closed', () => {
      writeTearoffWindowSize()
      if (this.surfaceWindows.get(surfaceId) !== win) {
        return
      }
      this.surfaceWindows.delete(surfaceId)
      this.surfaceBindings.delete(win)
      this.continuePointerDragWindows.delete(win)
      const mainWindow = this.mainWindow
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window:tearoff-surface-closed', surfaceId)
      }
      if (this.warmSurfaceWindows) {
        void this.primeSurfaceWindow()
      }
    })

    try {
      if (warmWindow) {
        this.bindSurfaceWindow(win)
        this.presentSurfaceWindow(win)
      }
      else {
        // A replacement warm renderer may still be booting during rapid,
        // repeated tear-offs. Reveal the native window immediately so the
        // held-pointer handoff never moves an invisible window; BrowserWindow's
        // themed background and tearoff.html bootstrap shell cover React load.
        this.presentSurfaceWindow(win)
        await this.loadSurfaceRenderer(win, { surfaceId, route })
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

  /** Renderer announces that the static app shell and shared chunks are painted. */
  markTearoffRendererReady(webContentsId: number): void {
    const win = this.warmingSurfaceWindow
    if (!win || win.isDestroyed() || win.webContents.id !== webContentsId) {
      return
    }
    this.warmingSurfaceWindow = null
    this.warmSurfaceWindow = win
  }

  private createSurfaceBrowserWindow(
    bounds: Electron.Rectangle,
    initialBinding?: Pick<TearoffSurfaceBinding, 'surfaceId' | 'route'>,
  ): BrowserWindow {
    const isMacOS = process.platform === 'darwin'
    const windowControlsSafeArea = resolveWindowControlsSafeArea(process.platform)
    const useNativeTitleBarOverlay = isMacOS || process.platform === 'linux'
    const windowControlsOverlay = resolveWindowControlsOverlay(
      nativeTheme.shouldUseDarkColors,
      windowControlsSafeArea,
    )
    const win = new BrowserWindow({
      ...bounds,
      minWidth: TEAROFF_WINDOW_MIN_WIDTH,
      minHeight: TEAROFF_WINDOW_MIN_HEIGHT,
      titleBarStyle: isMacOS ? 'hiddenInset' : 'hidden',
      backgroundColor: windowControlsOverlay.color,
      titleBarOverlay: useNativeTitleBarOverlay ? (isMacOS ? true : windowControlsOverlay) : false,
      ...(isMacOS && { trafficLightPosition: resolveTrafficLightPosition(windowControlsSafeArea) }),
      webPreferences: {
        preload: resolveDesktopPreloadPath(__dirname),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        additionalArguments: [
          `--server-url=${this.serverUrl}`,
          ...(initialBinding
            ? [
                `--surface=${initialBinding.surfaceId}`,
                `--surface-route=${JSON.stringify(initialBinding.route)}`,
              ]
            : []),
          '--tearoff=true',
          `--browser-panel-preload-url=${resolveDesktopBrowserPanelPreloadUrl(__dirname)}`,
        ],
      },
      show: false,
    })
    installExternalLinkPolicy(win.webContents)
    installWindowsCaptionButtons(win)
    installMacWindowDragCapture(win)
    this.trackAppshotCaptureWindow(win)
    return win
  }

  private async loadSurfaceRenderer(
    win: BrowserWindow,
    initialBinding?: Pick<TearoffSurfaceBinding, 'surfaceId' | 'route'>,
  ): Promise<void> {
    if (process.env.ELECTRON_RENDERER_URL) {
      const url = new URL('/tearoff.html', process.env.ELECTRON_RENDERER_URL)
      if (initialBinding) {
        url.searchParams.set('surface', initialBinding.surfaceId)
      }
      url.searchParams.set('tearoff', 'true')
      await win.loadURL(url.toString())
      return
    }
    await win.loadFile(resolveDesktopRendererTearoffPath(), {
      query: {
        ...(initialBinding ? { surface: initialBinding.surfaceId } : {}),
        tearoff: 'true',
      },
    })
  }

  private bindSurfaceWindow(win: BrowserWindow): void {
    const binding = this.surfaceBindings.get(win)
    if (!binding || win.isDestroyed()) {
      return
    }
    win.webContents.send('window:tearoff-surface-bound', binding)
  }

  private presentSurfaceWindow(win: BrowserWindow): void {
    if (!this.surfaceBindings.has(win) || win.isDestroyed()) {
      return
    }
    if (!win.isVisible()) {
      win.show()
    }
    win.focus()
    if (this.continuePointerDragWindows.delete(win)) {
      if (!beginMacWindowDrag(win)) {
        beginWindowsWindowDrag(win)
      }
    }
    if (this.warmSurfaceWindows) {
      void this.primeSurfaceWindow()
    }
  }

  private takeWarmSurfaceWindow(): BrowserWindow | null {
    const win = this.warmSurfaceWindow
    this.warmSurfaceWindow = null
    return win && !win.isDestroyed() ? win : null
  }

  private async primeSurfaceWindow(): Promise<void> {
    if (this.warmSurfaceWindow || this.warmingSurfaceWindow) {
      return
    }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const size = resolveWindowSize(null, {
      defaultWidth: TEAROFF_WINDOW_DEFAULT_WIDTH,
      defaultHeight: TEAROFF_WINDOW_DEFAULT_HEIGHT,
      minWidth: TEAROFF_WINDOW_MIN_WIDTH,
      minHeight: TEAROFF_WINDOW_MIN_HEIGHT,
    }, display.workArea)
    const win = this.createSurfaceBrowserWindow({
      x: display.workArea.x,
      y: display.workArea.y,
      ...size,
    })
    this.warmingSurfaceWindow = win
    win.once('closed', () => {
      if (this.warmingSurfaceWindow === win) {
        this.warmingSurfaceWindow = null
      }
      if (this.warmSurfaceWindow === win) {
        this.warmSurfaceWindow = null
      }
    })
    try {
      await this.loadSurfaceRenderer(win)
    }
    catch (error) {
      if (this.warmingSurfaceWindow === win) {
        this.warmingSurfaceWindow = null
      }
      if (!win.isDestroyed()) {
        win.destroy()
      }
      console.warn('[desktop] failed to warm tear-off renderer:', error)
    }
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
          `--browser-panel-preload-url=${resolveDesktopBrowserPanelPreloadUrl(__dirname)}`,
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

    subscribeIpcDevtool(win.webContents)
    subscribeAcpDevtool(win.webContents)

    this.devtoolWindow = win
    win.on('closed', () => {
      this.devtoolWindow = null
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
