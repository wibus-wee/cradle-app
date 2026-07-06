// FILE: browser-ipc.ts
// Purpose: Centralizes the desktop browser IPC contract and handler wiring.
// Layer: Desktop IPC adapter
// Depends on: Electron ipcMain/webContents and DesktopBrowserManager

import type { IpcMain, WebContents } from 'electron'

import type {
  BrowserAnnotationDesignInput,
  BrowserAnnotationElement,
  BrowserAnnotationRuntimeEvent,
  BrowserAnnotationRuntimeInput,
  BrowserAnnotationRuntimeNotificationInput,
  BrowserCaptureScreenshotResult,
  BrowserExecuteCdpInput,
  BrowserLocalServer,
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserPromptRequest,
  BrowserSetPanelBoundsInput,
  BrowserTabInput,
  BrowserThreadInput,
  DesktopBrowserManager,
  ThreadBrowserState,
} from './browser-manager'

export const BROWSER_IPC_CHANNELS = {
  state: 'desktop:browser-state',
  open: 'desktop:browser-open',
  close: 'desktop:browser-close',
  hide: 'desktop:browser-hide',
  getState: 'desktop:browser-get-state',
  setBounds: 'desktop:browser-set-bounds',
  requestOpenPanel: 'desktop:browser-use-request-open-panel',
  copyScreenshotToClipboard: 'desktop:browser-copy-screenshot-to-clipboard',
  captureScreenshot: 'desktop:browser-capture-screenshot',
  applyAnnotationDesign: 'desktop:browser-apply-annotation-design',
  clearAnnotationDesign: 'desktop:browser-clear-annotation-design',
  startAnnotationRuntime: 'desktop:browser-start-annotation-runtime',
  stopAnnotationRuntime: 'desktop:browser-stop-annotation-runtime',
  notifyAnnotationRuntime: 'desktop:browser-notify-annotation-runtime',
  annotationRuntimeEvent: 'desktop:browser-annotation-runtime-event',
  annotationRuntimeEvented: 'desktop:browser-annotation-runtime-evented',
  executeCdp: 'desktop:browser-execute-cdp',
  discoverLocalServers: 'desktop:browser-discover-local-servers',
  navigate: 'desktop:browser-navigate',
  reload: 'desktop:browser-reload',
  goBack: 'desktop:browser-go-back',
  goForward: 'desktop:browser-go-forward',
  newTab: 'desktop:browser-new-tab',
  closeTab: 'desktop:browser-close-tab',
  selectTab: 'desktop:browser-select-tab',
  openDevTools: 'desktop:browser-open-devtools',
  sendPrompt: 'desktop:browser-send-prompt',
  promptRequested: 'desktop:browser-prompt-requested',
} as const

// Pushes the latest browser state snapshot to the renderer shell.
export function sendBrowserState(
  webContents: WebContents | null | undefined,
  state: ThreadBrowserState,
): void {
  webContents?.send(BROWSER_IPC_CHANNELS.state, state)
}

export function sendBrowserPromptRequest(
  webContents: WebContents | null | undefined,
  request: BrowserPromptRequest,
): void {
  webContents?.send(BROWSER_IPC_CHANNELS.promptRequested, request)
}

export function sendBrowserAnnotationRuntimeEvent(
  webContents: WebContents | null | undefined,
  event: BrowserAnnotationRuntimeEvent,
): void {
  webContents?.send(BROWSER_IPC_CHANNELS.annotationRuntimeEvented, event)
}

// Registers the desktop browser bridge in one place so main.ts stays focused on app boot.
export function registerBrowserIpcHandlers(
  ipcMain: IpcMain,
  browserManager: DesktopBrowserManager,
): void {
  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.sendPrompt)
  ipcMain.handle(BROWSER_IPC_CHANNELS.sendPrompt, async (event, payload: unknown) =>
    browserManager.handlePromptRequest(event.sender, payload) !== null)

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.annotationRuntimeEvent)
  ipcMain.handle(BROWSER_IPC_CHANNELS.annotationRuntimeEvent, async (event, payload: unknown) =>
    browserManager.handleAnnotationRuntimeEvent(event.sender, payload) !== null)

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.open)
  ipcMain.handle(BROWSER_IPC_CHANNELS.open, async (_event, input: BrowserOpenInput) =>
    browserManager.open(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.close)
  ipcMain.handle(BROWSER_IPC_CHANNELS.close, async (_event, input: BrowserThreadInput) =>
    browserManager.close(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.hide)
  ipcMain.handle(BROWSER_IPC_CHANNELS.hide, async (_event, input: BrowserThreadInput) => {
    browserManager.hide(input)
  })

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.getState)
  ipcMain.handle(BROWSER_IPC_CHANNELS.getState, async (_event, input: BrowserThreadInput) =>
    browserManager.getState(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.setBounds)
  ipcMain.removeAllListeners(BROWSER_IPC_CHANNELS.setBounds)
  ipcMain.on(BROWSER_IPC_CHANNELS.setBounds, (_event, input: BrowserSetPanelBoundsInput) => {
    browserManager.setPanelBounds(input)
  })

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.captureScreenshot)
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.captureScreenshot,
    async (_event, input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult> =>
      browserManager.captureScreenshot(input),
  )

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.copyScreenshotToClipboard)
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.copyScreenshotToClipboard,
    async (_event, input: BrowserTabInput) => {
      await browserManager.copyScreenshotToClipboard(input)
    },
  )

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.applyAnnotationDesign)
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.applyAnnotationDesign,
    async (_event, input: BrowserAnnotationDesignInput): Promise<BrowserAnnotationElement | null> =>
      browserManager.applyAnnotationDesign(input),
  )

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.clearAnnotationDesign)
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.clearAnnotationDesign,
    async (_event, input: BrowserTabInput) => {
      await browserManager.clearAnnotationDesign(input)
    },
  )

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.startAnnotationRuntime)
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.startAnnotationRuntime,
    async (_event, input: BrowserAnnotationRuntimeInput) => {
      await browserManager.startAnnotationRuntime(input)
    },
  )

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.stopAnnotationRuntime)
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.stopAnnotationRuntime,
    async (_event, input: BrowserAnnotationRuntimeInput) => {
      await browserManager.stopAnnotationRuntime(input)
    },
  )

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.notifyAnnotationRuntime)
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.notifyAnnotationRuntime,
    async (_event, input: BrowserAnnotationRuntimeNotificationInput) => {
      await browserManager.notifyAnnotationRuntime(input)
    },
  )

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.executeCdp)
  ipcMain.handle(BROWSER_IPC_CHANNELS.executeCdp, async (_event, input: BrowserExecuteCdpInput) =>
    browserManager.executeCdp(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.discoverLocalServers)
  ipcMain.handle(
    BROWSER_IPC_CHANNELS.discoverLocalServers,
    async (): Promise<BrowserLocalServer[]> => browserManager.discoverLocalServers(),
  )

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.navigate)
  ipcMain.handle(BROWSER_IPC_CHANNELS.navigate, async (_event, input: BrowserNavigateInput) =>
    browserManager.navigate(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.reload)
  ipcMain.handle(BROWSER_IPC_CHANNELS.reload, async (_event, input: BrowserTabInput) =>
    browserManager.reload(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.goBack)
  ipcMain.handle(BROWSER_IPC_CHANNELS.goBack, async (_event, input: BrowserTabInput) =>
    browserManager.goBack(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.goForward)
  ipcMain.handle(BROWSER_IPC_CHANNELS.goForward, async (_event, input: BrowserTabInput) =>
    browserManager.goForward(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.newTab)
  ipcMain.handle(BROWSER_IPC_CHANNELS.newTab, async (_event, input: BrowserNewTabInput) =>
    browserManager.newTab(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.closeTab)
  ipcMain.handle(BROWSER_IPC_CHANNELS.closeTab, async (_event, input: BrowserTabInput) =>
    browserManager.closeTab(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.selectTab)
  ipcMain.handle(BROWSER_IPC_CHANNELS.selectTab, async (_event, input: BrowserTabInput) =>
    browserManager.selectTab(input))

  ipcMain.removeHandler(BROWSER_IPC_CHANNELS.openDevTools)
  ipcMain.handle(BROWSER_IPC_CHANNELS.openDevTools, async (_event, input: BrowserTabInput) => {
    browserManager.openDevTools(input)
  })
}
