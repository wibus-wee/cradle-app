import { join, resolve } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, net, screen } from 'electron'
import windowStateKeeper from 'electron-window-state'

import {
  registerBrowserIpcHandlers,
  sendBrowserAnnotationRuntimeEvent,
  sendBrowserPromptRequest,
  sendBrowserState,
} from './browser-ipc'
import { DesktopBrowserManager } from './browser-manager'
import { ChatEventTailBroker } from './chat-event-tail-broker'
import { ChatStreamBroker } from './chat-stream-broker'
import { DesktopAppBadgeManager } from './desktop-app-badge-manager'
import { resolveDesktopPreloadPath, resolveDesktopRendererIndexPath } from './desktop-assets'
import { installExternalLinkPolicy } from './external-link-policy'
import { MacBridgeManager } from './mac-bridge-manager'
import type { MacInputBareModifier } from './mac-bridge-protocol'
import { createNativeServices } from './native-services'
import { NotificationCenterManager } from './notification-center-manager'
import {
  bindDesktopObservabilityServerUrl,
  setDesktopRuntimeDiagnosticsProvider,
  startDesktopResourceReporting,
} from './observability-reporter'
import type { PluginInstallResult, PluginInstallSummary } from './plugin-install-links'
import {
  collectPluginInstallUrls,
  installPluginFromRequest,
  parsePluginInstallUrl,
  PluginInstallLinkError,
} from './plugin-install-links'
import {
  activateDesktopPlugins,
  deactivateDesktopPlugins,
  notifyWebviewCreated,
} from './plugin-loader'
import { resolveDesktopPrimaryPluginsDir } from './plugin-paths'
import { QuitGuard } from './quit-guard'
import { detachServer, startServer, stopServer } from './server-process'
import { TrayManager } from './tray-manager'
import { DesktopUpdateManager } from './update-manager'
import { WindowManager } from './window-manager'
import { readStoredWindowBounds, resolveVisibleWindowBounds } from './window-state'

let mainWindow: BrowserWindow | null = null
let windowManager: WindowManager | undefined
let updateManager: DesktopUpdateManager | null = null
let trayManager: TrayManager | null = null
let desktopAppBadgeManager: DesktopAppBadgeManager | null = null
let macBridgeManager: MacBridgeManager | null = null
let chatStreamBroker: ChatStreamBroker | null = null
let chatEventTailBroker: ChatEventTailBroker | null = null

function fetchWithElectronNet(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestInput = input instanceof URL ? input.toString() : input
  return net.fetch(requestInput, init) as Promise<Response>
}
let notificationCenterManager: NotificationCenterManager | null = null
let isQuitting = false
let shutdownPromise: Promise<void> | null = null
const quitGuard = new QuitGuard()

const MAIN_WINDOW_DEFAULT_WIDTH = 1280
const MAIN_WINDOW_DEFAULT_HEIGHT = 820
const MAIN_WINDOW_MIN_WIDTH = 800
const MAIN_WINDOW_MIN_HEIGHT = 600
const MAIN_WINDOW_STATE_FILE = 'main-window-state.json'
const DEEP_LINK_PROTOCOL = 'cradle'

let installQueue = Promise.resolve()
let canProcessPluginInstallLinks = false
const pendingPluginInstallUrls: string[] = []
const browserManager = new DesktopBrowserManager()

async function readRendererRuntimeDiagnostics(): Promise<Array<Record<string, unknown>>> {
  const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed())
  const diagnostics: Array<Record<string, unknown>> = []
  for (const window of windows) {
    const webContents = window.webContents
    const base = {
      windowId: window.id,
      title: window.getTitle(),
      visible: window.isVisible(),
      webContentsId: webContents.id,
      rendererProcessId: webContents.getOSProcessId(),
      url: webContents.getURL(),
    }
    try {
      const renderer = await webContents.executeJavaScript(
        'globalThis.__CRADLE_RENDERER_DIAGNOSTICS__?.() ?? null',
        true,
      ) as unknown
      diagnostics.push({ ...base, renderer })
    }
    catch (error) {
      diagnostics.push({
        ...base,
        renderer: null,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) },
      })
    }
  }
  return diagnostics
}

setDesktopRuntimeDiagnosticsProvider(async () => ({
  browser: browserManager.getPerformanceSnapshot(),
  renderers: await readRendererRuntimeDiagnostics(),
}))

interface DesktopRuntimePreferences {
  requireDoubleCommandQToQuit: boolean
  appshotHotkeyEnabled: boolean
  appshotHotkeyTrigger?: MacInputBareModifier
  autoCheckForUpdates: boolean
  autoDownloadUpdates: boolean
}

async function createMainWindow(serverUrl: string): Promise<BrowserWindow> {
  const mainWindowStatePath = join(app.getPath('userData'), MAIN_WINDOW_STATE_FILE)
  const storedBounds = readStoredWindowBounds(mainWindowStatePath)
  const mainWindowState = windowStateKeeper({
    defaultWidth: MAIN_WINDOW_DEFAULT_WIDTH,
    defaultHeight: MAIN_WINDOW_DEFAULT_HEIGHT,
    file: MAIN_WINDOW_STATE_FILE,
  })
  const restoredBounds = resolveVisibleWindowBounds(
    storedBounds ?? {
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
    },
    screen.getAllDisplays().map(display => display.workArea),
    {
      defaultWidth: MAIN_WINDOW_DEFAULT_WIDTH,
      defaultHeight: MAIN_WINDOW_DEFAULT_HEIGHT,
      minWidth: MAIN_WINDOW_MIN_WIDTH,
      minHeight: MAIN_WINDOW_MIN_HEIGHT,
    },
    screen.getPrimaryDisplay().workArea,
  )

  const isMacOS = process.platform === 'darwin'

  const win = new BrowserWindow({
    x: restoredBounds.x,
    y: restoredBounds.y,
    width: restoredBounds.width,
    height: restoredBounds.height,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
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
      webviewTag: false,
      additionalArguments: [`--server-url=${serverUrl}`],
    },
    show: false,
  })
  mainWindowState.manage(win)
  installExternalLinkPolicy(win.webContents)

  win.once('ready-to-show', () => {
    win.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  }
 else {
    await win.loadFile(resolveDesktopRendererIndexPath())
  }

  return win
}

function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
  windowManager?.setMainWindow(win)
  browserManager.setWindow(win)

  win.webContents.once('did-finish-load', () => {
    if (updateManager) {
      broadcastUpdateStatus(updateManager.status)
    }
  })

  win.on('close', (event) => {
    if (isQuitting || !trayManager) {
      return // allow close → triggers 'closed' → cleanup + app.quit()
    }
    event.preventDefault()
    win.hide()
    // External close requests (installer WM_CLOSE, task manager) are also
    // delivered as 'close' events.  By calling app.quit() here we ensure the
    // process actually terminates instead of hiding forever.
    quitGuard.allowNextQuit()
    app.quit()
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      browserManager.setWindow(null)
    }
    if (!isQuitting && !trayManager && process.platform !== 'darwin') {
      app.quit()
    }
  })
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }
  mainWindow.focus()
}

function broadcastUpdateStatus(status: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('desktop-update:status-changed', status)
    }
  }
}

function registerPluginInstallProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
      resolve(process.argv[1]!),
    ])
    return
  }
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL)
}

function describePluginInstallSummary(summary: PluginInstallSummary): string {
  const capabilities
    = summary.declaredCapabilities.length > 0
      ? summary.declaredCapabilities
          .map(
            capability =>
              `- ${capability.type}:${capability.localId}${capability.layer ? ` (${capability.layer})` : ''}`,
          )
          .join('\n')
      : '- None declared'
  const permissions
    = summary.requiredPermissions.length > 0
      ? summary.requiredPermissions.map(permission => `- ${permission}`).join('\n')
      : '- None required'

  return [
    `Package: ${summary.packageName}`,
    `Version: ${summary.version}`,
    `Display name: ${summary.displayName ?? summary.packageName}`,
    `Mode: ${summary.mode}`,
    `Repository: ${summary.request.repository}`,
    `Path: ${summary.request.path}`,
    `Ref: ${summary.request.ref}`,
    '',
    'Required permissions:',
    permissions,
    '',
    'Declared capabilities:',
    capabilities,
  ].join('\n')
}

async function askPluginInstallConsent(summary: PluginInstallSummary): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Install Cradle Plugin',
    message: `Install ${summary.packageName}?`,
    detail: `${describePluginInstallSummary(summary)}\n\nCradle will install this first-party plugin into the desktop Marketplace plugin directory. The plugin is activated after restart.`,
    buttons: ['Install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  })
  return response === 0
}

async function showPluginInstallSuccess(result: PluginInstallResult): Promise<void> {
  const detail
    = result.mode === 'alreadyAvailable'
      ? 'This plugin is already available in the current Cradle plugin directory. Cradle recorded the Marketplace install request.'
      : 'Restart Cradle to activate the plugin in the desktop and server runtimes.'
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Plugin Installed',
    message: `${result.request.packageName} was installed.`,
    detail,
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) {
    quitGuard.allowNextQuit()
    app.relaunch()
    app.exit(0)
  }
}

async function showPluginInstallFailure(err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  await dialog.showMessageBox({
    type: 'error',
    title: 'Plugin Install Failed',
    message:
      err instanceof PluginInstallLinkError
        ? 'The plugin install link is invalid.'
        : 'Cradle could not install the plugin.',
    detail: message,
    buttons: ['OK'],
  })
}

async function installPluginFromDeepLink(rawUrl: string): Promise<void> {
  showMainWindow()
  try {
    const request = parsePluginInstallUrl(rawUrl)

    const isDev = !!process.env.ELECTRON_RENDERER_URL
    const result = await installPluginFromRequest(request, {
      availablePluginsDir: resolveDesktopPrimaryPluginsDir({ isDev, moduleDir: __dirname }),
      confirmInstall: askPluginInstallConsent,
      userDataPath: app.getPath('userData'),
    })
    if (!result) {
      return
    }
    await showPluginInstallSuccess(result)
  }
 catch (err) {
    console.error('[plugin-marketplace] install link failed:', err)
    await showPluginInstallFailure(err)
  }
}

function handlePluginInstallUrls(urls: readonly string[]): void {
  if (!canProcessPluginInstallLinks) {
    pendingPluginInstallUrls.push(...urls)
    return
  }
  for (const url of urls) {
    installQueue = installQueue.then(() => installPluginFromDeepLink(url))
  }
}

function processPendingPluginInstallUrls(): void {
  canProcessPluginInstallLinks = true
  const urls = pendingPluginInstallUrls.splice(0)
  handlePluginInstallUrls(urls)
}

async function shutdownDesktopRuntime(options: { stopServerRuntime: boolean }): Promise<void> {
  if (!options.stopServerRuntime) {
    detachServer()
  }

  browserManager.dispose()
  updateManager?.stopBackgroundChecks()
  notificationCenterManager?.stop()
  notificationCenterManager = null
  chatStreamBroker?.stop()
  chatStreamBroker = null
  chatEventTailBroker?.stop()
  chatEventTailBroker = null
  trayManager?.destroy()
  trayManager = null
  desktopAppBadgeManager?.destroy()
  desktopAppBadgeManager = null
  await macBridgeManager?.stop()
  macBridgeManager = null
  await deactivateDesktopPlugins()
  if (options.stopServerRuntime) {
    await stopServer()
  }
}

function requestDesktopExit(input: { reason: string, exitCode: number, stopServerRuntime: boolean }): void {
  if (shutdownPromise) {
    return
  }

  console.warn(`[desktop] shutting down runtime: ${input.reason}`)
  isQuitting = true

  // Force-kill the process if async cleanup takes too long.
  // Without this, a hanging stopServer() or plugin teardown prevents the
  // process from ever exiting, which blocks installers (NSIS WM_CLOSE).
  const forceExitTimer = setTimeout(() => {
    console.error('[desktop] graceful shutdown timed out, force-exiting')
    process.exit(input.exitCode)
  }, 5_000)
  forceExitTimer.unref() // don't keep the event loop alive just for the timer

  shutdownPromise = shutdownDesktopRuntime({ stopServerRuntime: input.stopServerRuntime })
    .catch((error) => {
      console.error('[desktop] runtime shutdown failed:', error)
    })
    .finally(() => {
      clearTimeout(forceExitTimer)
      app.exit(input.exitCode)
    })
}

async function prepareDesktopExitForExternalQuit(input: { reason: string, stopServerRuntime: boolean }): Promise<void> {
  if (shutdownPromise) {
    await shutdownPromise
    return
  }

  console.warn(`[desktop] preparing runtime shutdown: ${input.reason}`)
  isQuitting = true
  shutdownPromise = shutdownDesktopRuntime({ stopServerRuntime: input.stopServerRuntime })
    .catch((error) => {
      console.error('[desktop] runtime shutdown failed:', error)
    })
  await shutdownPromise
}

function registerProcessShutdownHandlers(): void {
  const handleSignal = (signal: NodeJS.Signals) => {
    quitGuard.allowNextQuit()
    requestDesktopExit({
      reason: signal,
      exitCode: 0,
      stopServerRuntime: true,
    })
  }

  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)
}

async function applyAppshotHotkeyPreference(enabled: boolean, trigger: MacInputBareModifier = 'DoubleCommand'): Promise<void> {
  if (process.platform !== 'darwin' || !macBridgeManager) {
    return
  }

  const inputConfiguration = await macBridgeManager
    .configureInput({ trigger, enabled })
    .catch((error) => {
      console.warn('[mac-bridge] AppShot hotkey unavailable:', error)
      return null
    })

  if (inputConfiguration) {
    console.debug('[mac-bridge] AppShot hotkey configured:', inputConfiguration)
  }
}

async function syncDesktopPreferencesFromServer(serverUrl: string): Promise<void> {
  try {
    const response = await fetch(new URL('/preferences/desktop', serverUrl))
    if (!response.ok) {
      await applyAppshotHotkeyPreference(true)
      updateManager?.configurePreferences({
        autoCheckForUpdates: true,
        autoDownloadUpdates: false,
      })
      return
    }
    const preferences = await response.json() as DesktopRuntimePreferences
    quitGuard.updatePreferences({
      requireDoubleCommandQToQuit: preferences.requireDoubleCommandQToQuit,
    })
    await applyAppshotHotkeyPreference(
      preferences.appshotHotkeyEnabled,
      preferences.appshotHotkeyTrigger ?? 'DoubleCommand',
    )
    updateManager?.configurePreferences({
      autoCheckForUpdates: preferences.autoCheckForUpdates,
      autoDownloadUpdates: preferences.autoDownloadUpdates,
    })
  }
  catch (error) {
    console.warn('[preferences] failed to read desktop preferences:', error)
    await applyAppshotHotkeyPreference(true)
    updateManager?.configurePreferences({
      autoCheckForUpdates: true,
      autoDownloadUpdates: false,
    })
  }
}

export async function startDesktopApp(): Promise<void> {
  registerProcessShutdownHandlers()
  registerPluginInstallProtocol()
  registerBrowserIpcHandlers(ipcMain, browserManager)
  browserManager.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        sendBrowserState(window.webContents, state)
      }
    }
  })
  browserManager.subscribeToWebContentsCreated((webContents, tabId) => {
    notifyWebviewCreated(webContents, tabId)
  })
  browserManager.subscribeToPromptRequests((request) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        sendBrowserPromptRequest(window.webContents, request)
      }
    }
  })
  browserManager.subscribeToAnnotationRuntimeEvents((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        sendBrowserAnnotationRuntimeEvent(window.webContents, event)
      }
    }
  })
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  updateManager = new DesktopUpdateManager({
    prepareQuitForUpdate: async () => {
      quitGuard.allowNextQuit()
      await prepareDesktopExitForExternalQuit({
        reason: 'desktop update',
        stopServerRuntime: true,
      })
    },
    requestQuitForUpdate: () => {
      quitGuard.allowNextQuit()
      requestDesktopExit({
        reason: 'desktop update',
        exitCode: 0,
        stopServerRuntime: true,
      })
    },
  })
  const appBadgeManager = new DesktopAppBadgeManager()
  desktopAppBadgeManager = appBadgeManager
  macBridgeManager = new MacBridgeManager({
    moduleDir: __dirname,
  })
  macBridgeManager.on('hotkeyTriggered', (event) => {
    console.log('[mac-bridge] forwarding Appshot hotkey to renderer:', event)
    const targetWindow = windowManager?.getLastFocusedAppshotWindow()
      ?? (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)
    if (!targetWindow || targetWindow.isDestroyed()) {
      console.warn('[mac-bridge] Appshot hotkey ignored because no Appshot renderer window is available.')
      return
    }
    targetWindow.webContents.send('capture:appshot-hotkey', event)
  })
  createNativeServices({
    getWindowManager: () => windowManager,
    getUpdateManager: () => updateManager,
    getMacBridgeManager: () => macBridgeManager,
    getChatStreamBroker: () => chatStreamBroker,
    getChatEventTailBroker: () => chatEventTailBroker,
    getQuitGuard: () => quitGuard,
  })
  updateManager.on('statusChanged', broadcastUpdateStatus)

  app.on('open-url', (event, url) => {
    event.preventDefault()
    handlePluginInstallUrls([url])
  })

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
      await macBridgeManager?.start()
    }

    await activateDesktopPlugins()

    const serverUrl = await startServer()
    bindDesktopObservabilityServerUrl(serverUrl)
    startDesktopResourceReporting()
    await syncDesktopPreferencesFromServer(serverUrl)
    chatStreamBroker = new ChatStreamBroker({ serverUrl, fetchFn: fetchWithElectronNet })
    chatEventTailBroker = new ChatEventTailBroker({ serverUrl, fetchFn: fetchWithElectronNet })

    windowManager = new WindowManager(serverUrl)
    appBadgeManager.initialize()

    trayManager = new TrayManager({
      serverUrl,
      getMainWindow: () => mainWindow,
      createMainWindow: async () => {
        const win = await createMainWindow(serverUrl)
        setMainWindow(win)
        return win
      },
      requestQuit: () => {
        quitGuard.allowNextQuit()
        requestDesktopExit({
          reason: 'tray quit',
          exitCode: 0,
          stopServerRuntime: true,
        })
      },
    })
    trayManager.initialize()

    mainWindow = await createMainWindow(serverUrl)
    setMainWindow(mainWindow)

    notificationCenterManager = new NotificationCenterManager({
      serverUrl,
      chatStreamBroker,
      getMainWindow: () => mainWindow,
    })
    notificationCenterManager.start()

    updateManager?.startBackgroundChecks()
    processPendingPluginInstallUrls()
    handlePluginInstallUrls(collectPluginInstallUrls(process.argv))

    app.on('activate', async () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        const restoredWindow = await createMainWindow(serverUrl)
        setMainWindow(restoredWindow)
        return
      }
      showMainWindow()
    })
  }).catch((error) => {
    console.error('[desktop] app startup failed:', error)
    requestDesktopExit({
      reason: 'startup failure',
      exitCode: 1,
      stopServerRuntime: true,
    })
  })

  app.on('window-all-closed', () => {
    if (!trayManager && process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', (event) => {
    if (!quitGuard.handleBeforeQuit(event)) {
      return
    }
    event.preventDefault()
    requestDesktopExit({
      reason: 'app quit',
      exitCode: 0,
      stopServerRuntime: true,
    })
  })

  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    handlePluginInstallUrls(collectPluginInstallUrls(argv))
  })
}
