/* Verifies Electron tear-off window lifecycle ownership and de-duplication. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TearoffSurfaceRoute } from './window-manager'

const CHAT_SURFACE_ROUTE: TearoffSurfaceRoute = { to: '/chat/$sessionId', params: { sessionId: 'session-1' } }

const electronMocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void

  let userDataPath = '/tmp/cradle-window-manager-test'

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = []
    static loadURLImpl: (url: string) => Promise<void> = () => Promise.resolve()

    readonly options: Record<string, unknown>
    readonly handlers = new Map<string, Listener[]>()
    readonly onceHandlers = new Map<string, Listener[]>()
    readonly webContents = {
      getURL: vi.fn(() => 'http://127.0.0.1:5174/'),
      on: vi.fn(),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    }

    destroyed = false
    focused = false
    shown = false
    loadURL = vi.fn((url: string) => FakeBrowserWindow.loadURLImpl(url))
    loadFile = vi.fn(() => Promise.resolve())

    constructor(options: Record<string, unknown>) {
      this.options = options
      FakeBrowserWindow.instances.push(this)
    }

    on(eventName: string, listener: Listener): void {
      const listeners = this.handlers.get(eventName) ?? []
      listeners.push(listener)
      this.handlers.set(eventName, listeners)
    }

    once(eventName: string, listener: Listener): void {
      const listeners = this.onceHandlers.get(eventName) ?? []
      listeners.push(listener)
      this.onceHandlers.set(eventName, listeners)
    }

    emit(eventName: string, ...args: unknown[]): void {
      for (const listener of this.handlers.get(eventName) ?? []) {
        listener(...args)
      }
      const onceListeners = this.onceHandlers.get(eventName) ?? []
      this.onceHandlers.delete(eventName)
      for (const listener of onceListeners) {
        listener(...args)
      }
    }

    getBounds(): { width: number, height: number } {
      return {
        width: Number(this.options.width ?? 720),
        height: Number(this.options.height ?? 640),
      }
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    isFocused(): boolean {
      return this.focused
    }

    focus(): void {
      this.focused = true
      this.emit('focus')
    }

    show(): void {
      this.shown = true
    }

    destroy(): void {
      this.destroyed = true
      this.emit('closed')
    }
  }

  return {
    app: {
      getPath: vi.fn((name: string) => {
        if (name === 'userData') {
          return userDataPath
        }
        return '/tmp'
      }),
      __setUserDataPath: (path: string) => {
        userDataPath = path
      },
    },
    BrowserWindow: FakeBrowserWindow,
    nativeTheme: {
      shouldUseDarkColors: false,
    },
    screen: {
      getDisplayNearestPoint: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      })),
    },
    shell: {
      openExternal: vi.fn(),
    },
  }
})

vi.mock('electron', () => electronMocks)

const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
const tempRoots: string[] = []

afterEach(() => {
  electronMocks.BrowserWindow.instances.length = 0
  electronMocks.BrowserWindow.loadURLImpl = () => Promise.resolve()
  vi.clearAllMocks()

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

describe('windowManager tear-off windows', () => {
  it('uses the last focused main or tear-off window for AppShot capture routing', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'cradle-window-manager-'))
    tempRoots.push(userDataPath)
    electronMocks.app.__setUserDataPath(userDataPath)
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5174'

    const { WindowManager } = await import('./window-manager')
    const manager = new WindowManager('http://localhost:3010')
    const mainWindow = new electronMocks.BrowserWindow({})

    manager.setMainWindow(mainWindow as never)
    expect(manager.getLastFocusedAppshotWindow()).toBe(mainWindow)

    const tearoffWindow = await manager.openSurfaceWindow('chat:session-1', CHAT_SURFACE_ROUTE, 1200, 40)
    expect(manager.getLastFocusedAppshotWindow()).toBe(mainWindow)

    tearoffWindow.focus()
    expect(manager.getLastFocusedAppshotWindow()).toBe(tearoffWindow)

    mainWindow.focus()
    expect(manager.getLastFocusedAppshotWindow()).toBe(mainWindow)

    tearoffWindow.focus()
    tearoffWindow.destroy()
    expect(manager.getLastFocusedAppshotWindow()).toBe(mainWindow)
  })

  it('deduplicates concurrent opens for the same session before the renderer finishes loading', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'cradle-window-manager-'))
    tempRoots.push(userDataPath)
    electronMocks.app.__setUserDataPath(userDataPath)
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5174'

    const deferredLoadUrl: { resolve?: () => void } = {}
    electronMocks.BrowserWindow.loadURLImpl = () => new Promise<void>((resolve) => {
      deferredLoadUrl.resolve = resolve
    })

    const { WindowManager } = await import('./window-manager')
    const manager = new WindowManager('http://localhost:3010')

    const firstOpen = manager.openSurfaceWindow('chat:session-1', CHAT_SURFACE_ROUTE, 1200, 40)
    const secondOpen = manager.openSurfaceWindow('chat:session-1', CHAT_SURFACE_ROUTE, 1204, 44)

    expect(electronMocks.BrowserWindow.instances).toHaveLength(1)
    expect(electronMocks.BrowserWindow.instances[0]?.focused).toBe(true)

    deferredLoadUrl.resolve?.()

    await expect(firstOpen).resolves.toBe(electronMocks.BrowserWindow.instances[0])
    await expect(secondOpen).resolves.toBe(electronMocks.BrowserWindow.instances[0])
  })

  it('clears the pending session window when the tear-off renderer fails to load', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'cradle-window-manager-'))
    tempRoots.push(userDataPath)
    electronMocks.app.__setUserDataPath(userDataPath)
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5174'

    electronMocks.BrowserWindow.loadURLImpl = () => Promise.reject(new Error('load failed'))

    const { WindowManager } = await import('./window-manager')
    const manager = new WindowManager('http://localhost:3010')

    await expect(manager.openSurfaceWindow('chat:session-1', CHAT_SURFACE_ROUTE, 1200, 40)).rejects.toThrow('load failed')

    expect(electronMocks.BrowserWindow.instances).toHaveLength(1)
    expect(electronMocks.BrowserWindow.instances[0]?.destroyed).toBe(true)

    electronMocks.BrowserWindow.loadURLImpl = () => Promise.resolve()

    await expect(manager.openSurfaceWindow('chat:session-1', CHAT_SURFACE_ROUTE, 1200, 40)).resolves.toBe(electronMocks.BrowserWindow.instances[1])

    expect(electronMocks.BrowserWindow.instances).toHaveLength(2)
  })
})
