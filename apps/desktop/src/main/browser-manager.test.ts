import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void

  let processCounter = 1
  let webContentsCounter = 1
  const webContentsById = new Map<number, FakeWebContents>()

  class FakeWebContents {
    readonly id = webContentsCounter++
    readonly processId = processCounter++
    readonly listeners = new Map<string, Listener[]>()
    readonly session = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    }

    readonly debugger = {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    }

    readonly navigationHistory = {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
    }

    destroyed = false
    loading = false
    url = ''
    title = ''

    constructor() {
      webContentsById.set(this.id, this)
    }

    loadURL = vi.fn(async (url: string) => {
      this.loading = true
      this.url = url
      try {
        this.title = new URL(url).hostname
      }
      catch {
        this.title = url
      }
      this.loading = false
    })

    close = vi.fn(() => {
      this.destroyed = true
    })

    setWindowOpenHandler = vi.fn()
    capturePage = vi.fn(async () => ({ toPNG: () => Buffer.from('png') }))
    goBack = vi.fn()
    goForward = vi.fn()
    canGoBack = vi.fn(() => false)
    canGoForward = vi.fn(() => false)

    on(eventName: string, listener: Listener): void {
      const listeners = this.listeners.get(eventName) ?? []
      listeners.push(listener)
      this.listeners.set(eventName, listeners)
    }

    removeListener(eventName: string, listener: Listener): void {
      const listeners = this.listeners.get(eventName) ?? []
      this.listeners.set(eventName, listeners.filter(item => item !== listener))
    }

    getURL(): string {
      return this.url
    }

    getTitle(): string {
      return this.title
    }

    isLoading(): boolean {
      return this.loading
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    getProcessId(): number {
      return this.processId
    }
  }

  class FakeWebContentsView {
    static instances: FakeWebContentsView[] = []

    readonly webContents = new FakeWebContents()
    readonly setBounds = vi.fn()
    readonly setVisible = vi.fn()
    readonly options: unknown

    constructor(options?: unknown) {
      this.options = options
      FakeWebContentsView.instances.push(this)
    }
  }

  class FakeBrowserWindow {
    readonly contentView: {
      children: FakeWebContentsView[]
      addChildView: ReturnType<typeof vi.fn>
      removeChildView: ReturnType<typeof vi.fn>
    }

    constructor() {
      const children: FakeWebContentsView[] = []
      this.contentView = {
        children,
        addChildView: vi.fn((view: FakeWebContentsView) => {
          children.push(view)
        }),
        removeChildView: vi.fn((view: FakeWebContentsView) => {
          const index = children.indexOf(view)
          if (index === -1) {
            throw new Error('View is not attached')
          }
          children.splice(index, 1)
        }),
      }
    }
  }

  return {
    app: {
      getAppPath: vi.fn(() => '/Applications/Cradle.app/Contents/Resources/app.asar'),
    },
    BrowserWindow: FakeBrowserWindow,
    WebContentsView: FakeWebContentsView,
    clipboard: {
      writeImage: vi.fn(),
    },
    nativeImage: {
      createFromBuffer: vi.fn(() => ({ isEmpty: () => false })),
    },
    shell: {
      openExternal: vi.fn(),
    },
    webContents: {
      fromId: vi.fn((id: number) => webContentsById.get(id) ?? null),
    },
    createWebContents: () => new FakeWebContents(),
    __reset: () => {
      FakeWebContentsView.instances.length = 0
      processCounter = 1
      webContentsCounter = 1
      webContentsById.clear()
    },
  }
})

vi.mock('electron', () => electronMocks)

const bounds = { x: 0, y: 0, width: 900, height: 600 }
const previousRendererUrl = process.env.ELECTRON_RENDERER_URL

async function flushBrowserWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function createManager() {
  const { manager } = await createManagerWithWindow()
  return manager
}

async function createManagerWithWindow() {
  const { DesktopBrowserManager } = await import('./browser-manager')
  const manager = new DesktopBrowserManager()
  const window = new electronMocks.BrowserWindow()
  manager.setWindow(window as never)
  return { manager, window }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.clearAllMocks()
  electronMocks.__reset()
  if (previousRendererUrl === undefined) {
    delete process.env.ELECTRON_RENDERER_URL
  }
 else {
    process.env.ELECTRON_RENDERER_URL = previousRendererUrl
  }
})

describe('desktop browser manager tab runtime retention', () => {
  it('adopts a renderer webview without creating or owning a native view', async () => {
    const manager = await createManager()
    const threadId = 'thread-1'
    const createdWebContents: unknown[] = []
    manager.subscribeToWebContentsCreated(webContents => createdWebContents.push(webContents))

    const initialState = manager.open({ threadId, initialUrl: 'https://one.test/' })
    const tabId = initialState.activeTabId!
    manager.setPanelBounds({ threadId, bounds, surface: 'renderer' })

    expect(electronMocks.WebContentsView.instances).toHaveLength(0)

    const rendererWebContents = electronMocks.createWebContents()
    rendererWebContents.url = 'https://one.test/'
    const attachedState = manager.attachWebview({
      threadId,
      tabId,
      webContentsId: rendererWebContents.id,
    })

    expect(attachedState.tabs[0]?.status).toBe('live')
    expect(createdWebContents).toEqual([rendererWebContents])
    expect(electronMocks.WebContentsView.instances).toHaveLength(0)

    manager.detachWebview({ threadId, tabId, webContentsId: rendererWebContents.id })

    expect(rendererWebContents.close).not.toHaveBeenCalled()
    expect(manager.getState({ threadId }).tabs[0]?.status).toBe('suspended')

    manager.dispose()
  })

  it('only returns ready local servers from discovery', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const port = Number(new URL(url).port)
      if (port === 3000) {
        return {
          status: 200,
          headers: { get: () => 'text/html' },
          text: async () => '<title>Ready App</title>',
        }
      }
      if (port === 3001) {
        return {
          status: 302,
          headers: { get: () => 'text/html' },
          text: async () => '<title>Redirect App</title>',
        }
      }
      if (port === 3002) {
        return {
          status: 404,
          headers: { get: () => 'text/html' },
          text: async () => '<title>Missing App</title>',
        }
      }
      throw new Error('closed')
    }))

    const manager = await createManager()

    expect(await manager.discoverLocalServers()).toEqual([{
      port: 3000,
      url: 'http://localhost:3000/',
      title: 'Ready App',
      statusCode: 200,
    }])

    manager.dispose()
  })

  it('suspends inactive browser tab runtimes and restores them on selection', async () => {
    vi.useFakeTimers()
    const manager = await createManager()
    const threadId = 'thread-1'

    const firstState = manager.open({ threadId, initialUrl: 'https://one.test/' })
    const firstTabId = firstState.activeTabId!
    manager.setPanelBounds({ threadId, bounds, surface: 'native' })
    await flushBrowserWork()

    const firstView = electronMocks.WebContentsView.instances[0]!
    expect(firstView.webContents.loadURL).toHaveBeenCalledTimes(1)

    const secondState = manager.newTab({ threadId, url: 'https://two.test/', activate: true })
    const secondTabId = secondState.activeTabId!
    await flushBrowserWork()

    expect(electronMocks.WebContentsView.instances).toHaveLength(2)
    const secondView = electronMocks.WebContentsView.instances[1]!
    expect(secondView.webContents.loadURL).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2_000)

    expect(firstView.webContents.close).toHaveBeenCalledTimes(1)
    expect(manager.getState({ threadId }).tabs.find(tab => tab.id === firstTabId)?.status)
      .toBe('suspended')

    manager.selectTab({ threadId, tabId: firstTabId })
    await flushBrowserWork()

    expect(electronMocks.WebContentsView.instances).toHaveLength(3)
    const restoredFirstView = electronMocks.WebContentsView.instances[2]!
    expect(restoredFirstView.webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(manager.getState({ threadId }).activeTabId).toBe(firstTabId)

    manager.selectTab({ threadId, tabId: secondTabId })
    await flushBrowserWork()

    expect(secondView.webContents.close).not.toHaveBeenCalled()
    expect(secondView.webContents.loadURL).toHaveBeenCalledTimes(1)

    manager.dispose()
  })

  it('activates the previous adjacent tab when closing the active tab', async () => {
    const manager = await createManager()
    const threadId = 'thread-1'

    const firstState = manager.open({ threadId, initialUrl: 'https://one.test/' })
    const firstTabId = firstState.activeTabId!
    const secondState = manager.newTab({ threadId, url: 'https://two.test/', activate: true })
    const secondTabId = secondState.activeTabId!
    const thirdState = manager.newTab({ threadId, url: 'https://three.test/', activate: true })
    const thirdTabId = thirdState.activeTabId!

    manager.selectTab({ threadId, tabId: secondTabId })
    const closedState = manager.closeTab({ threadId, tabId: secondTabId })

    expect(closedState.tabs.map(tab => tab.id)).toEqual([firstTabId, thirdTabId])
    expect(closedState.activeTabId).toBe(firstTabId)
    expect(manager.getState({ threadId }).activeTabId).toBe(firstTabId)

    manager.dispose()
  })

  it('replaces the final closed browser tab with a fresh blank tab', async () => {
    const manager = await createManager()
    const threadId = 'thread-1'

    const initialState = manager.open({ threadId, initialUrl: 'https://one.test/' })
    const closedState = manager.closeTab({ threadId, tabId: initialState.activeTabId! })

    expect(closedState.open).toBe(true)
    expect(closedState.tabs).toHaveLength(1)
    expect(closedState.tabs[0]).toMatchObject({
      id: closedState.activeTabId,
      url: 'about:blank',
      status: 'suspended',
    })

    manager.dispose()
  })

  it('suspends browser runtimes after the hidden-panel grace period', async () => {
    vi.useFakeTimers()
    const { manager, window } = await createManagerWithWindow()
    const threadId = 'thread-1'

    const initialState = manager.open({ threadId, initialUrl: 'https://one.test/' })
    const tabId = initialState.activeTabId!
    manager.setPanelBounds({ threadId, bounds, surface: 'native' })
    await flushBrowserWork()

    const view = electronMocks.WebContentsView.instances[0]!
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)

    manager.hide({ threadId })
    expect(window.contentView.removeChildView).toHaveBeenCalledWith(view)
    await vi.advanceTimersByTimeAsync(31_000)

    expect(view.webContents.close).toHaveBeenCalledTimes(1)
    expect(view.setBounds).toHaveBeenLastCalledWith(bounds)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(manager.getState({ threadId }).tabs[0]?.status).toBe('suspended')

    manager.setPanelBounds({ threadId, bounds, surface: 'native' })
    manager.selectTab({ threadId, tabId })
    await flushBrowserWork()

    expect(electronMocks.WebContentsView.instances).toHaveLength(2)
    const restoredView = electronMocks.WebContentsView.instances[1]!
    expect(restoredView.webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(restoredView.setBounds).toHaveBeenLastCalledWith(bounds)
    expect(restoredView.setVisible).toHaveBeenLastCalledWith(true)
    expect(window.contentView.addChildView).toHaveBeenCalledTimes(2)
    expect(manager.getState({ threadId }).activeTabId).toBe(tabId)

    manager.dispose()
  })

  it('does not restore a hidden browser view from stale bounds when selecting a tab', async () => {
    vi.useFakeTimers()
    const manager = await createManager()
    const threadId = 'thread-1'

    const initialState = manager.open({ threadId, initialUrl: 'https://one.test/' })
    const tabId = initialState.activeTabId!
    manager.setPanelBounds({ threadId, bounds, surface: 'native' })
    await flushBrowserWork()

    const view = electronMocks.WebContentsView.instances[0]!
    expect(view.setBounds).toHaveBeenLastCalledWith(bounds)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)

    manager.hide({ threadId })
    expect(view.setBounds).toHaveBeenLastCalledWith(bounds)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)

    manager.selectTab({ threadId, tabId })
    await flushBrowserWork()

    expect(view.setBounds).toHaveBeenLastCalledWith(bounds)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)

    manager.dispose()
  })

  it('updates attached runtime bounds without reattaching the native view', async () => {
    const { manager, window } = await createManagerWithWindow()
    const threadId = 'thread-1'
    const nextBounds = { x: 12, y: 34, width: 800, height: 500 }

    manager.open({ threadId, initialUrl: 'https://one.test/' })
    manager.setPanelBounds({ threadId, bounds, surface: 'native' })
    await flushBrowserWork()

    const view = electronMocks.WebContentsView.instances[0]!
    expect(window.contentView.addChildView).toHaveBeenCalledTimes(1)
    expect(window.contentView.removeChildView).not.toHaveBeenCalled()

    manager.setPanelBounds({ threadId, bounds: nextBounds, surface: 'native' })
    await flushBrowserWork()

    expect(view.setBounds).toHaveBeenLastCalledWith(nextBounds)
    expect(window.contentView.addChildView).toHaveBeenCalledTimes(1)
    expect(window.contentView.removeChildView).not.toHaveBeenCalled()

    manager.dispose()
  })

  it('does not select an inactive tab when capturing its screenshot', async () => {
    vi.useFakeTimers()
    const manager = await createManager()
    const threadId = 'thread-1'

    const initialState = manager.open({ threadId, initialUrl: 'https://one.test/' })
    const firstTabId = initialState.activeTabId!
    manager.setPanelBounds({ threadId, bounds, surface: 'native' })
    await flushBrowserWork()

    const nextState = manager.newTab({ threadId, url: 'https://two.test/', activate: false })
    const secondTabId = nextState.tabs.find(tab => tab.id !== firstTabId)!.id
    await manager.captureScreenshot({ threadId, tabId: secondTabId })
    await flushBrowserWork()

    expect(manager.getState({ threadId }).activeTabId).toBe(firstTabId)
    expect(electronMocks.WebContentsView.instances).toHaveLength(2)
    expect(electronMocks.WebContentsView.instances[1]!.webContents.capturePage).toHaveBeenCalledTimes(1)

    manager.dispose()
  })

  it('maps guest prompt requests to the owning browser tab runtime', async () => {
    vi.useFakeTimers()
    delete process.env.ELECTRON_RENDERER_URL
    const manager = await createManager()
    const threadId = 'thread-1'
    const requests: unknown[] = []
    manager.subscribeToPromptRequests(request => requests.push(request))

    const initialState = manager.open({ threadId, initialUrl: 'https://one.test/path' })
    const tabId = initialState.activeTabId!
    manager.setPanelBounds({ threadId, bounds, surface: 'native' })
    await flushBrowserWork()

    const view = electronMocks.WebContentsView.instances[0]!
    expect(view.options).toMatchObject({
      webPreferences: {
        preload: '/Applications/Cradle.app/Contents/Resources/app.asar/dist/preload/browser-panel.js',
      },
    })

    const request = manager.handlePromptRequest(view.webContents as never, {
      text: 'Summarize this page.',
      attachments: [{
        filename: 'screen.png',
        mediaType: 'image/png',
        url: 'data:image/png;base64,test',
      }],
    })

    expect(request).toMatchObject({
      threadId,
      tabId,
      text: 'Summarize this page.',
      attachments: [{
        filename: 'screen.png',
        mediaType: 'image/png',
        url: 'data:image/png;base64,test',
      }],
      sourceUrl: 'https://one.test/path',
      sourceTitle: 'one.test',
    })
    expect(requests).toEqual([request])

    manager.dispose()
  })
})
