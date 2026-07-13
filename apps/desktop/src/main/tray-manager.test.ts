import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MenuTreeItem = Record<string, unknown> & {
  submenu?: MenuTreeItem[]
}

function readMenuItems(value: unknown): MenuTreeItem[] {
  return Array.isArray(value) ? value as MenuTreeItem[] : []
}

const electronMocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = []

    readonly options: Record<string, unknown>
    readonly handlers = new Map<string, Listener[]>()
    readonly webContents = {
      isLoadingMainFrame: vi.fn(() => false),
      isDevToolsOpened: vi.fn(() => false),
      send: vi.fn(),
    }

    bounds: unknown = null
    visible = false
    destroyed = false
    minimized = false
    hidden = false
    loadURL = vi.fn(() => Promise.resolve())
    loadFile = vi.fn(() => Promise.resolve())
    setBounds = vi.fn((bounds: unknown) => {
      this.bounds = bounds
    })

    show = vi.fn(() => {
      this.visible = true
      this.hidden = false
    })

    focus = vi.fn()
    hide = vi.fn(() => {
      this.visible = false
      this.hidden = true
    })

    destroy = vi.fn(() => {
      this.destroyed = true
      this.emit('closed')
    })

    restore = vi.fn(() => {
      this.minimized = false
    })

    constructor(options: Record<string, unknown>) {
      this.options = options
      FakeBrowserWindow.instances.push(this)
    }

    on(eventName: string, listener: Listener): void {
      const listeners = this.handlers.get(eventName) ?? []
      listeners.push(listener)
      this.handlers.set(eventName, listeners)
    }

    emit(eventName: string, ...args: unknown[]): void {
      for (const listener of this.handlers.get(eventName) ?? []) {
        listener(...args)
      }
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    isVisible(): boolean {
      return this.visible
    }

    isMinimized(): boolean {
      return this.minimized
    }
  }

  class FakeTray {
    static instances: FakeTray[] = []

    readonly handlers = new Map<string, Listener[]>()
    tooltip: string | null = null
    title: string | null = null
    image: unknown = null
    pressedImage: unknown = null
    contextMenu: unknown = null
    popupMenu: unknown = null
    popupPosition: unknown = null
    balloon: unknown = null
    ignoreDoubleClickEvents = false
    focused = false
    contextMenuClosed = false
    balloonRemoved = false
    destroyed = false

    constructor() {
      FakeTray.instances.push(this)
    }

    setToolTip(tooltip: string): void {
      this.tooltip = tooltip
    }

    setImage(image: unknown): void {
      this.image = image
    }

    setPressedImage(image: unknown): void {
      this.pressedImage = image
    }

    setTitle(title: string): void {
      this.title = title
    }

    setIgnoreDoubleClickEvents(ignore: boolean): void {
      this.ignoreDoubleClickEvents = ignore
    }

    setContextMenu(menu: unknown): void {
      this.contextMenu = menu
    }

    popUpContextMenu(menu: unknown, position?: unknown): void {
      this.popupMenu = menu
      this.popupPosition = position
    }

    closeContextMenu(): void {
      this.contextMenuClosed = true
    }

    displayBalloon(options: unknown): void {
      this.balloon = options
    }

    removeBalloon(): void {
      this.balloonRemoved = true
    }

    focus(): void {
      this.focused = true
    }

    getBounds() {
      return { x: 80, y: 20, width: 24, height: 24 }
    }

    on(eventName: string, listener: Listener): void {
      const listeners = this.handlers.get(eventName) ?? []
      listeners.push(listener)
      this.handlers.set(eventName, listeners)
    }

    emit(eventName: string): void {
      for (const listener of this.handlers.get(eventName) ?? []) {
        listener()
      }
    }

    destroy(): void {
      this.destroyed = true
    }
  }

  const ipcHandlers = new Map<string, Listener>()
  const nativeImageValue = {
    resize: vi.fn(() => nativeImageValue),
    setTemplateImage: vi.fn(),
  }

  return {
    app: {
      dock: {
        setMenu: vi.fn(),
      },
      quit: vi.fn(),
    },
    BrowserWindow: FakeBrowserWindow,
    ipcHandlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Listener) => {
        ipcHandlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        ipcHandlers.delete(channel)
      }),
    },
    nativeImage: {
      createFromPath: vi.fn(() => nativeImageValue),
      createEmpty: vi.fn(() => nativeImageValue),
      createFromBuffer: vi.fn(() => nativeImageValue),
    },
    Menu: {
      buildFromTemplate: vi.fn((template: unknown[]) => ({ template })),
    },
    Tray: FakeTray,
  }
})

vi.mock('electron', () => electronMocks)

function lastMenuTemplate(): Array<Record<string, unknown>> {
  const calls = electronMocks.Menu.buildFromTemplate.mock.calls
  return calls.at(-1)?.[0] as Array<Record<string, unknown>>
}

function findMenuItem(
  items: Array<Record<string, unknown>>,
  label: string,
): Record<string, unknown> | undefined {
  for (const item of items) {
    if (item.label === label) {
      return item
    }
    const childItems = readMenuItems(item.submenu)
    if (childItems.length > 0) {
      const child = findMenuItem(childItems, label)
      if (child) {
        return child
      }
    }
  }
  return undefined
}

function submenuItems(
  items: Array<Record<string, unknown>>,
  label: string,
): Array<Record<string, unknown>> {
  const item = findMenuItem(items, label)
  return readMenuItems(item?.submenu)
}

describe('trayManager', () => {
  const originalRendererUrl = process.env.ELECTRON_RENDERER_URL

  beforeEach(() => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'
    electronMocks.BrowserWindow.instances.length = 0
    electronMocks.Tray.instances.length = 0
    electronMocks.ipcHandlers.clear()
    electronMocks.app.dock.setMenu.mockClear()
    electronMocks.app.quit.mockClear()
    electronMocks.ipcMain.handle.mockClear()
    electronMocks.ipcMain.removeHandler.mockClear()
    electronMocks.nativeImage.createFromPath.mockClear()
    electronMocks.nativeImage.createEmpty.mockClear()
    electronMocks.nativeImage.createFromBuffer.mockClear()
    electronMocks.Menu.buildFromTemplate.mockClear()
    vi.stubGlobal('fetch', vi.fn(async (input: URL | string) => {
      const pathname = input instanceof URL ? input.pathname : new URL(input).pathname
      const responses: Record<string, unknown> = {
        '/desktop/summary': {
          generatedAt: 1_780_753_882,
          running: 1,
          recentSessions: 2,
          pinnedSessions: 1,
          pendingAwaits: 3,
          enabledAutomations: 1,
          runningAutomations: 1,
          workspaces: 4,
          enabledProviders: 1,
          totalProviders: 2,
        },
        '/desktop/recent-sessions': [
          {
            sessionId: 'running-session',
            title: 'Active run',
            workspaceName: 'Cradle',
            runtimeKind: 'codex',
            modelId: 'gpt-5.5',
            updatedAt: 1_780_753_882,
            state: 'running',
            detail: 'Running codex',
          },
          {
            sessionId: 'pinned-session',
            title: 'Pinned chat',
            workspaceName: 'Cradle',
            runtimeKind: 'claude',
            modelId: null,
            updatedAt: 1_780_753_800,
            state: 'pinned',
            detail: 'Pinned claude',
          },
        ],
        '/desktop/health': [
          { id: 'server', label: 'Server', value: 'Online', status: 'ok', detail: null },
          { id: 'chat-runtime', label: 'Chat Runtime', value: '1 running', status: 'active', detail: null },
          { id: 'awaits', label: 'Awaits', value: '3 pending', status: 'warning', detail: 'Sessions are waiting.' },
          { id: 'providers', label: 'Providers', value: '1 enabled', status: 'ok', detail: null },
          { id: 'chronicle', label: 'Chronicle', value: 'Running', status: 'active', detail: null },
        ],
      }
      if (!(pathname in responses)) {
        return new Response(null, { status: 404 })
      }
      return new Response(JSON.stringify(responses[pathname]), { status: 200 })
    }))
  })

  afterEach(() => {
    if (originalRendererUrl === undefined) {
      delete process.env.ELECTRON_RENDERER_URL
    }
    else {
      process.env.ELECTRON_RENDERER_URL = originalRendererUrl
    }
    vi.unstubAllGlobals()
  })

  it('opens a native tray menu when the tray icon is clicked', async () => {
    const { TrayManager } = await import('./tray-manager')
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => null,
      createMainWindow: vi.fn(),
      requestQuit: vi.fn(),
    })

    manager.initialize()
    electronMocks.Tray.instances[0]?.emit('click')

    await vi.waitFor(() => {
      expect(electronMocks.Tray.instances[0]?.popupMenu).toBeTruthy()
    })

    expect(electronMocks.Tray.instances[0]?.popupPosition).toBeUndefined()
    expect(electronMocks.Tray.instances[0]?.tooltip).toBe('Cradle - 1 issue: 1 running, 3 awaits')
    expect(electronMocks.Tray.instances[0]?.ignoreDoubleClickEvents).toBe(true)
    expect(electronMocks.Tray.instances[0]?.image).toBeTruthy()
    expect(electronMocks.Tray.instances[0]?.pressedImage).toBeTruthy()
    expect(electronMocks.BrowserWindow.instances).toHaveLength(0)
    expect(electronMocks.nativeImage.createFromBuffer).toHaveBeenCalledWith(expect.any(Buffer), {
      width: 18,
      height: 18,
    })
    expect(electronMocks.nativeImage.createFromPath).not.toHaveBeenCalled()
    expect(electronMocks.nativeImage.createEmpty).not.toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalledWith(new URL('/desktop/summary', 'http://127.0.0.1:21423'), { headers: {} })
    expect(globalThis.fetch).toHaveBeenCalledWith(new URL('/desktop/recent-sessions', 'http://127.0.0.1:21423'), { headers: {} })
    expect(globalThis.fetch).toHaveBeenCalledWith(new URL('/desktop/health', 'http://127.0.0.1:21423'), { headers: {} })
    const template = lastMenuTemplate()
    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Cradle - 1 issue',
        sublabel: '1 running | 2 recent | 3 awaits',
        enabled: false,
      }),
      expect.objectContaining({ label: 'Open Cradle' }),
      expect.objectContaining({
        label: 'New Chat',
        accelerator: 'CommandOrControl+N',
        registerAccelerator: true,
        visible: true,
      }),
      expect.objectContaining({
        label: 'Search',
        accelerator: 'CommandOrControl+K',
        registerAccelerator: true,
        visible: true,
      }),
      expect.objectContaining({ label: 'Recent Sessions' }),
      expect.objectContaining({ label: 'Health (1 issue)' }),
      expect.objectContaining({ label: 'Quick' }),
      expect.objectContaining({
        label: 'Quit Cradle',
        accelerator: 'CommandOrControl+Q',
        registerAccelerator: true,
        click: expect.any(Function),
      }),
    ]))
    expect(submenuItems(template, 'Health (1 issue)')).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Server: Online', enabled: false }),
      expect.objectContaining({ label: 'Awaits: 3 pending', enabled: false }),
    ]))
    expect(findMenuItem(template, 'Active run')).toEqual(expect.objectContaining({
      sublabel: 'Running - Cradle - gpt-5.5',
      toolTip: 'Running codex',
    }))
    expect(findMenuItem(template, 'Pinned chat')).toEqual(expect.objectContaining({
      sublabel: 'Pinned - Cradle',
      toolTip: 'Pinned claude',
    }))
    expect(findMenuItem(template, 'Awaits (3)')).toBeTruthy()
    expect(findMenuItem(template, 'Automations (1)')).toBeTruthy()
    expect(findMenuItem(template, 'Workspaces (4)')).toBeTruthy()
    expect(findMenuItem(template, 'Settings')).toBeTruthy()

    manager.destroy()
    expect(electronMocks.Tray.instances[0]?.contextMenuClosed).toBe(true)
  })

  it('keeps the tray context menu refreshed in the background', async () => {
    const { TrayManager } = await import('./tray-manager')
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => null,
      createMainWindow: vi.fn(),
      requestQuit: vi.fn(),
    })

    manager.initialize()

    await vi.waitFor(() => {
      const contextMenu = electronMocks.Tray.instances[0]?.contextMenu as { template?: Array<Record<string, unknown>> }
      expect(contextMenu?.template).toEqual(expect.arrayContaining([
        expect.objectContaining({
          label: 'Cradle - 1 issue',
          sublabel: '1 running | 2 recent | 3 awaits',
        }),
      ]))
    })

    const contextMenu = electronMocks.Tray.instances[0]?.contextMenu as { template?: Array<Record<string, unknown>> }
    expect(findMenuItem(contextMenu.template ?? [], 'Active run')).toBeTruthy()
    expect(findMenuItem(contextMenu.template ?? [], 'Awaits (3)')).toBeTruthy()
    expect(electronMocks.Tray.instances[0]?.popupMenu).toBeNull()

    manager.destroy()
  })

  it('syncs the native menu to the macOS Dock right-click menu', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      const { TrayManager } = await import('./tray-manager')
      const manager = new TrayManager({
        serverUrl: 'http://127.0.0.1:21423',
        getMainWindow: () => null,
        createMainWindow: vi.fn(),
        requestQuit: vi.fn(),
      })

      manager.initialize()

      await vi.waitFor(() => {
        expect(electronMocks.app.dock.setMenu).toHaveBeenLastCalledWith(expect.objectContaining({
          template: expect.arrayContaining([
            expect.objectContaining({
              label: 'Cradle - 1 issue',
              sublabel: '1 running | 2 recent | 3 awaits',
            }),
          ]),
        }))
      })

      manager.destroy()
    }
    finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })

  it('opens a degraded native menu when tray data is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    const { TrayManager } = await import('./tray-manager')
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => null,
      createMainWindow: vi.fn(),
      requestQuit: vi.fn(),
    })

    manager.initialize()
    await manager.openNativeMenu()

    expect(electronMocks.Menu.buildFromTemplate).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ label: 'Desktop data unavailable', enabled: false }),
      expect.objectContaining({ label: 'Quit Cradle' }),
    ]))

    manager.destroy()
  })

  it('forwards native menu item clicks through desktop-owned actions', async () => {
    const { TrayManager } = await import('./tray-manager')
    const mainWindow = new electronMocks.BrowserWindow({})
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => mainWindow as never,
      createMainWindow: vi.fn(),
      requestQuit: vi.fn(),
    })

    manager.initialize()
    await manager.openNativeMenu()

    const template = lastMenuTemplate()
    const runningSession = findMenuItem(template, 'Active run')
    const awaitsAction = findMenuItem(template, 'Awaits (3)')

    await (runningSession?.click as () => Promise<void> | void)?.()
    await (awaitsAction?.click as () => Promise<void> | void)?.()

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-tray:action-requested', {
      actionId: 'open-chat',
      payload: { sessionId: 'running-session' },
    })
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-tray:action-requested', {
      actionId: 'open-awaits',
      payload: undefined,
    })

    manager.destroy()
  })

  it('focuses the main window and forwards non-quit actions to the renderer', async () => {
    const { TrayManager } = await import('./tray-manager')
    const mainWindow = new electronMocks.BrowserWindow({})
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => mainWindow as never,
      createMainWindow: vi.fn(),
      requestQuit: vi.fn(),
    })

    manager.initialize()
    await manager.performAction('open-chat', { sessionId: 'session-1' })

    expect(mainWindow.show).toHaveBeenCalled()
    expect(mainWindow.focus).toHaveBeenCalled()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-tray:action-requested', {
      actionId: 'open-chat',
      payload: { sessionId: 'session-1' },
    })

    manager.destroy()
  })

  it('queues actions while a new main window is loading and exposes pending requests', async () => {
    const { TrayManager, TRAY_PENDING_ACTIONS_CHANNEL } = await import('./tray-manager')
    const loadingWindow = new electronMocks.BrowserWindow({})
    loadingWindow.webContents.isLoadingMainFrame.mockReturnValue(true)
    const createMainWindow = vi.fn(async () => loadingWindow as never)
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => loadingWindow as never,
      createMainWindow,
      requestQuit: vi.fn(),
    })

    manager.initialize()
    await manager.performAction('new-chat')

    const pendingHandler = electronMocks.ipcHandlers.get(TRAY_PENDING_ACTIONS_CHANNEL)
    expect(pendingHandler?.()).toEqual([{ actionId: 'new-chat', payload: undefined }])
    expect(pendingHandler?.()).toEqual([])

    manager.destroy()
  })

  it('quits without forwarding a quit action to the renderer', async () => {
    const { TrayManager } = await import('./tray-manager')
    const mainWindow = new electronMocks.BrowserWindow({})
    const requestQuit = vi.fn()
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => mainWindow as never,
      createMainWindow: vi.fn(),
      requestQuit,
    })

    manager.initialize()
    await manager.performAction('quit')

    expect(requestQuit).toHaveBeenCalledTimes(1)
    expect(mainWindow.webContents.send).not.toHaveBeenCalled()

    manager.destroy()
  })
})
