import { join, resolve } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen } from 'electron'
import windowStateKeeper from 'electron-window-state'

import type { DesktopServerBootstrapSnapshot, DesktopServerStatus } from '../shared/server-runtime'
import {
  createDesktopServerBootstrapSnapshot,
  DESKTOP_SERVER_STATUS_CHANGED_CHANNEL,
  DESKTOP_SERVER_STATUS_GET_CHANNEL,
} from '../shared/server-runtime'
import {
  resolveTrafficLightPosition,
  resolveWindowControlsOverlay,
  resolveWindowControlsSafeArea,
} from '../shared/window-controls-safe-area'
import { setupApplicationMenu } from './application-menu'
import {
  registerBrowserIpcHandlers,
  sendBrowserAnnotationRuntimeEvent,
  sendBrowserPromptRequest,
  sendBrowserState,
} from './browser-ipc'
import { DesktopBrowserManager } from './browser-manager'
import { ChatEventTailBroker } from './chat-event-tail-broker'
import { ChatStreamBroker } from './chat-stream-broker'
import {
  completeDesktopDataBackupAfterHealthyStart,
  getDesktopDataBackupStatus,
  initializeDesktopDataBackup,
  rollbackDesktopDataBackupAfterHealthFailure,
  runPendingDesktopDataBackup,
} from './data-backup'
import {
  completeDesktopDataMigrationAfterHealthyStart,
  getDesktopDataDirectoryState,
  initializeDesktopDataDirectory,
  rollbackDesktopDataMigrationAfterHealthFailure,
  runPendingDesktopDataMigration,
} from './data-directory'
import { DesktopAppBadgeManager } from './desktop-app-badge-manager'
import {
  resolveDesktopBrowserPanelPreloadUrl,
  resolveDesktopPreloadPath,
  resolveDesktopRendererIndexPath,
} from './desktop-assets'
import { DesktopDownloadCenterService } from './download-center'
import { installExternalLinkPolicy } from './external-link-policy'
import { initializeIpcDevtool } from './ipc-devtool'
import { MacBridgeManager } from './mac-bridge-manager'
import type { MacInputBareModifier } from './mac-bridge-protocol'
import { createNativeServices } from './native-services'
import { NotificationCenterManager } from './notification-center-manager'
import {
  bindDesktopObservabilityServerUrl,
  setDesktopRuntimeDiagnosticsProvider,
  startDesktopResourceReporting,
} from './observability-reporter'
import {
  collectOpenWorkspaceUrls,
  isOpenWorkspaceUrl,
  OpenWorkspaceLinkError,
  parseOpenWorkspaceUrl,
} from './open-workspace-links'
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
import {
  registerPluginSourceSyncIpcHandlers,
  setPluginSourceSyncServerUrl,
  startPluginDevSessionSync,
  startPluginSourceLifecycleSync,
} from './plugin-source-sync'
import { QuitGuard } from './quit-guard'
import { DesktopServerFetchBroker } from './server-fetch-broker'
import { startServer, stopServer } from './server-process'
import { TrayManager } from './tray-manager'
import type { DesktopUpdateManager } from './update-manager'
import { WindowManager } from './window-manager'
import { readStoredWindowBounds, resolveVisibleWindowBounds } from './window-state'
import { installWindowsCaptionButtons } from './windows-caption-buttons'

let mainWindow: BrowserWindow | null = null
let windowManager: WindowManager | undefined
let updateManager: DesktopUpdateManager | null = null
let desktopDownloadCenter: DesktopDownloadCenterService | null = null
let trayManager: TrayManager | null = null
let desktopAppBadgeManager: DesktopAppBadgeManager | null = null
let macBridgeManager: MacBridgeManager | null = null
let chatStreamBroker: ChatStreamBroker | null = null
let chatEventTailBroker: ChatEventTailBroker | null = null
let stopPluginDevSessionSync: (() => void) | null = null
let stopPluginSourceLifecycleSync: (() => void) | null = null
let desktopServerGeneration = 0

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
let canProcessOpenWorkspaceLinks = false
const pendingOpenWorkspaceUrls: string[] = []
const browserManager = new DesktopBrowserManager()
const serverFetchBroker = new DesktopServerFetchBroker({
  isAllowedSender: sender => BrowserWindow.getAllWindows().some(
    window => !window.isDestroyed() && window.webContents.id === sender.id,
  ),
})
let desktopServerStatus: DesktopServerStatus = { state: 'starting' }
let desktopServerBootstrapSnapshot: DesktopServerBootstrapSnapshot | null = null

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
      const renderer = (await webContents.executeJavaScript(
        'globalThis.__CRADLE_RENDERER_DIAGNOSTICS__?.() ?? null',
        true,
      )) as unknown
      diagnostics.push({ ...base, renderer })
    }
 catch (error) {
      diagnostics.push({
        ...base,
        renderer: null,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
      })
    }
  }
  return diagnostics
}

setDesktopRuntimeDiagnosticsProvider(async () => ({
  browser: browserManager.getPerformanceSnapshot(),
  chatEventTail: chatEventTailBroker?.diagnostics() ?? null,
  chatStream: chatStreamBroker?.diagnostics() ?? null,
  serverFetch: serverFetchBroker.diagnostics(),
  renderers: await readRendererRuntimeDiagnostics(),
}))

interface DesktopRuntimePreferences {
  requireDoubleCommandQToQuit: boolean
  appshotHotkeyEnabled: boolean
  appshotHotkeyTrigger?: MacInputBareModifier
  autoCheckForUpdates: boolean
  autoDownloadUpdates: boolean
}

async function createMainWindow(): Promise<BrowserWindow> {
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
  const windowControlsSafeArea = resolveWindowControlsSafeArea(process.platform)
  const useNativeTitleBarOverlay = isMacOS || process.platform === 'linux'
  const windowControlsOverlay = resolveWindowControlsOverlay(
    nativeTheme.shouldUseDarkColors,
    windowControlsSafeArea,
  )

  const win = new BrowserWindow({
    x: restoredBounds.x,
    y: restoredBounds.y,
    width: restoredBounds.width,
    height: restoredBounds.height,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
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
        `--browser-panel-preload-url=${resolveDesktopBrowserPanelPreloadUrl(__dirname)}`,
      ],
    },
    show: false,
  })
  mainWindowState.manage(win)
  installExternalLinkPolicy(win.webContents)
  installWindowsCaptionButtons(win)

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

function publishDesktopServerStatus(status: DesktopServerStatus): void {
  desktopServerStatus = status
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(DESKTOP_SERVER_STATUS_CHANGED_CHANNEL, status)
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
    const downloadCenter = desktopDownloadCenter
    if (!downloadCenter) {
      throw new Error('Desktop Download Center is not ready')
    }

    const isDev = !!process.env.ELECTRON_RENDERER_URL
    const result = await installPluginFromRequest(request, {
      availablePluginsDir: resolveDesktopPrimaryPluginsDir({ isDev, moduleDir: __dirname }),
      confirmInstall: askPluginInstallConsent,
      downloadCenter,
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

async function openWorkspaceFromDeepLink(rawUrl: string): Promise<void> {
  showMainWindow()
  try {
    const request = parseOpenWorkspaceUrl(rawUrl)
    if (!trayManager) {
      // Tray owns the renderer action bridge (including pending queue while the
      // main window is still loading). Defer until desktop services are ready.
      pendingOpenWorkspaceUrls.push(rawUrl)
      return
    }
    await trayManager.performAction('open-workspace', { workspaceId: request.workspaceId })
  }
 catch (err) {
    console.error('[open-workspace] deep link failed:', err)
    const message = err instanceof Error ? err.message : String(err)
    await dialog.showMessageBox({
      type: 'error',
      title: 'Open Workspace Failed',
      message:
        err instanceof OpenWorkspaceLinkError
          ? 'The open workspace link is invalid.'
          : 'Cradle could not open the workspace.',
      detail: message,
      buttons: ['OK'],
    })
  }
}

function handleOpenWorkspaceUrls(urls: readonly string[]): void {
  if (!canProcessOpenWorkspaceLinks || !trayManager) {
    pendingOpenWorkspaceUrls.push(...urls)
    return
  }
  for (const url of urls) {
    void openWorkspaceFromDeepLink(url)
  }
}

function processPendingOpenWorkspaceUrls(): void {
  canProcessOpenWorkspaceLinks = true
  const urls = pendingOpenWorkspaceUrls.splice(0)
  handleOpenWorkspaceUrls(urls)
}

async function shutdownDesktopRuntime(options: { stopServerRuntime: boolean }): Promise<void> {
  if (!options.stopServerRuntime) {
    console.warn(
      '[desktop] stopServerRuntime=false is ignored; desktop-owned server will be stopped',
    )
  }

  browserManager.dispose()
  await updateManager?.shutdown()
  await desktopDownloadCenter?.shutdown()
  desktopDownloadCenter = null
  notificationCenterManager?.stop()
  notificationCenterManager = null
  chatStreamBroker?.stop()
  chatStreamBroker = null
  chatEventTailBroker?.stop()
  chatEventTailBroker = null
  stopPluginDevSessionSync?.()
  stopPluginDevSessionSync = null
  stopPluginSourceLifecycleSync?.()
  stopPluginSourceLifecycleSync = null
  trayManager?.destroy()
  trayManager = null
  desktopAppBadgeManager?.destroy()
  desktopAppBadgeManager = null
  await macBridgeManager?.stop()
  macBridgeManager = null
  await deactivateDesktopPlugins()
  await serverFetchBroker.close()
  await stopServer()
}

function requestDesktopExit(input: {
  reason: string
  exitCode: number
  stopServerRuntime: boolean
}): void {
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

async function prepareDesktopExitForExternalQuit(input: {
  reason: string
  stopServerRuntime: boolean
}): Promise<void> {
  if (shutdownPromise) {
    await shutdownPromise
    return
  }

  console.warn(`[desktop] preparing runtime shutdown: ${input.reason}`)
  isQuitting = true
  shutdownPromise = shutdownDesktopRuntime({ stopServerRuntime: input.stopServerRuntime }).catch(
    (error) => {
      console.error('[desktop] runtime shutdown failed:', error)
    },
  )
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

async function applyAppshotHotkeyPreference(
  enabled: boolean,
  trigger: MacInputBareModifier = 'DoubleCommand',
): Promise<void> {
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
    const preferences = (await response.json()) as DesktopRuntimePreferences
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

function initializeDesktopServicesForServer(serverUrl: string): void {
  desktopServerGeneration += 1
  serverFetchBroker.setServerUrl(serverUrl, desktopServerGeneration)
  setPluginSourceSyncServerUrl(serverUrl)
  bindDesktopObservabilityServerUrl(serverUrl)
  startDesktopResourceReporting()
  chatStreamBroker = new ChatStreamBroker({ serverUrl })
  chatEventTailBroker = new ChatEventTailBroker({ serverUrl })

  windowManager = new WindowManager(serverUrl)
  if (mainWindow && !mainWindow.isDestroyed()) {
    windowManager.setMainWindow(mainWindow)
  }

  trayManager = new TrayManager({
    serverUrl,
    getMainWindow: () => mainWindow,
    createMainWindow: async () => {
      const win = await createMainWindow()
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
  processPendingOpenWorkspaceUrls()

  notificationCenterManager = new NotificationCenterManager({
    serverUrl,
    chatStreamBroker,
    chatEventTailBroker,
    getMainWindow: () => mainWindow,
  })
  notificationCenterManager.start()

  void syncDesktopPreferencesFromServer(serverUrl).then(() => {
    updateManager?.startBackgroundChecks()
  })
  stopPluginSourceLifecycleSync?.()
  stopPluginSourceLifecycleSync = startPluginSourceLifecycleSync()
  stopPluginDevSessionSync?.()
  stopPluginDevSessionSync = startPluginDevSessionSync()
}

async function initializeDesktopUpdateManager(): Promise<void> {
  const { DesktopUpdateManager } = await import('./update-manager')
  updateManager = new DesktopUpdateManager({
    prepareQuitForUpdate: async () => {
      quitGuard.allowNextQuit()
      await prepareDesktopExitForExternalQuit({
        reason: 'desktop update',
        stopServerRuntime: true,
      })
    },
  })
  updateManager.on('statusChanged', broadcastUpdateStatus)
}

export async function startDesktopApp(): Promise<void> {
  registerProcessShutdownHandlers()
  registerPluginInstallProtocol()
  registerBrowserIpcHandlers(ipcMain, browserManager)
  ipcMain.on('window:tearoff-renderer-ready', (event) => {
    windowManager?.markTearoffRendererReady(event.sender.id)
  })
  ipcMain.on('window:tearoff-surface-presented', (event, surfaceId: string) => {
    windowManager?.markTearoffSurfacePresented(event.sender.id, surfaceId)
  })
  serverFetchBroker.register(ipcMain)
  initializeIpcDevtool()
  browserManager.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        sendBrowserState(window.webContents, state)
      }
    }
  })
  browserManager.subscribeToWebContentsCreated((webContents, ownerId, tabId) => {
    notifyWebviewCreated(webContents, ownerId, tabId)
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

  const appBadgeManager = new DesktopAppBadgeManager()
  desktopAppBadgeManager = appBadgeManager
  macBridgeManager = new MacBridgeManager({
    moduleDir: __dirname,
  })
  macBridgeManager.on('hotkeyTriggered', (event) => {
    console.log('[mac-bridge] forwarding Appshot hotkey to renderer:', event)
    const targetWindow
      = windowManager?.getLastFocusedAppshotWindow()
        ?? (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)
    if (!targetWindow || targetWindow.isDestroyed()) {
      console.warn(
        '[mac-bridge] Appshot hotkey ignored because no Appshot renderer window is available.',
      )
      return
    }
    targetWindow.webContents.send('capture:appshot-hotkey', event)
  })
  createNativeServices({
    getWindowManager: () => windowManager,
    getUpdateManager: () => updateManager,
    getDesktopDownloadCenter: () => desktopDownloadCenter,
    getMacBridgeManager: () => macBridgeManager,
    getChatStreamBroker: () => chatStreamBroker,
    getChatEventTailBroker: () => chatEventTailBroker,
    getQuitGuard: () => quitGuard,
    requestDataRestart: (reason) => {
      setTimeout(() => {
        quitGuard.allowNextQuit()
        app.relaunch()
        requestDesktopExit({
          reason,
          exitCode: 0,
          stopServerRuntime: true,
        })
      }, 100).unref()
    },
  })
  registerPluginSourceSyncIpcHandlers()
  ipcMain.handle(DESKTOP_SERVER_STATUS_GET_CHANNEL, () => desktopServerStatus)

  app.on('open-url', (event, url) => {
    event.preventDefault()
    // Prefer exact open-workspace parser over prefix match so future cradle://open/*
    // routes are not mis-handled, and plugin links stay on the install path.
    if (isOpenWorkspaceUrl(url)) {
      handleOpenWorkspaceUrls([url])
      return
    }
    handlePluginInstallUrls([url])
  })

  app
    .whenReady()
    .then(async () => {
      // Begin navigating the renderer before disk-bound recovery work. The
      // renderer remains on its static shell until the server publishes ready.
      mainWindow = await createMainWindow()
      setMainWindow(mainWindow)
      setupApplicationMenu({
        checkForUpdates: () => {
          void updateManager?.checkForUpdates()
        },
        openSettings: () => {
          void trayManager?.performAction('open-desktop-settings')
        },
      })

      await initializeDesktopUpdateManager()
      await initializeDesktopDataDirectory()
      await initializeDesktopDataBackup()
      desktopDownloadCenter = new DesktopDownloadCenterService({
        userDataPath: app.getPath('userData'),
      })
      await desktopDownloadCenter.boot()
      await updateManager?.recoverDownloadCenter(desktopDownloadCenter)
      desktopDownloadCenter.onTaskChange((task) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send('download-center:task-changed', task)
          }
        }
      })
      appBadgeManager.initialize()

      app.on('activate', async () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          const restoredWindow = await createMainWindow()
          setMainWindow(restoredWindow)
          return
        }
        showMainWindow()
      })

      void (async () => {
        publishDesktopServerStatus({ state: 'starting' })
        try {
          if (process.platform === 'darwin') {
            await macBridgeManager?.start()
          }

          const pendingDataMigration = getDesktopDataDirectoryState().pendingMigration
          const pendingDataBackup = getDesktopDataBackupStatus()
          if (
            (pendingDataMigration && !['completed', 'failed'].includes(pendingDataMigration.phase))
            || !['idle', 'completed', 'failed'].includes(pendingDataBackup.phase)
          ) {
            // A previous process may have survived a desktop crash. Stop its
            // located server before copying or replacing the filesystem tree.
            await stopServer()
          }
          const migration = await runPendingDesktopDataMigration((phase) => {
            publishDesktopServerStatus({ state: 'migrating', phase })
          })
          if (migration.failed) {
            console.error('[desktop] data migration failed:', migration.message)
          }
          const backup = await runPendingDesktopDataBackup(app.getVersion())
          if (backup.failed) {
            console.error('[desktop] data backup operation failed:', backup.message)
          }

          await activateDesktopPlugins()
          processPendingPluginInstallUrls()
          handlePluginInstallUrls(collectPluginInstallUrls(process.argv))
          handleOpenWorkspaceUrls(collectOpenWorkspaceUrls(process.argv))

          let serverUrl: string
          desktopServerBootstrapSnapshot = createDesktopServerBootstrapSnapshot()
          const publishServerBootstrapSnapshot = (snapshot: DesktopServerBootstrapSnapshot) => {
            desktopServerBootstrapSnapshot = snapshot
            publishDesktopServerStatus({ state: 'bootstrapping', bootstrap: snapshot })
          }
          try {
            serverUrl = await startServer(publishServerBootstrapSnapshot)
          }
          catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await rollbackDesktopDataMigrationAfterHealthFailure(message)
            await rollbackDesktopDataBackupAfterHealthFailure(message)
            if (migration.migrated) {
              console.error('[desktop] new data root failed health check; restored previous root')
              desktopServerBootstrapSnapshot = createDesktopServerBootstrapSnapshot()
              serverUrl = await startServer(publishServerBootstrapSnapshot)
            }
            else if (backup.restored) {
              console.error('[desktop] restored data failed health check; restored previous data')
              desktopServerBootstrapSnapshot = createDesktopServerBootstrapSnapshot()
              serverUrl = await startServer(publishServerBootstrapSnapshot)
            }
            else {
              throw error
            }
          }
          initializeDesktopServicesForServer(serverUrl)
          await completeDesktopDataMigrationAfterHealthyStart()
          await completeDesktopDataBackupAfterHealthyStart()
          publishDesktopServerStatus({
            state: 'ready',
            serverUrl,
            bootstrap: desktopServerBootstrapSnapshot ?? createDesktopServerBootstrapSnapshot(),
            connection: {
              kind: 'owned-ipc',
              serverUrl,
              rendererBaseUrl: serverUrl,
              generation: desktopServerGeneration,
            },
          })
        }
 catch (error) {
          console.error('[desktop] runtime startup failed:', error)
          publishDesktopServerStatus({
            state: 'failed',
            message: error instanceof Error ? error.message : String(error),
            bootstrap: desktopServerBootstrapSnapshot,
          })
        }
      })()
    })
    .catch((error) => {
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
    handleOpenWorkspaceUrls(collectOpenWorkspaceUrls(argv))
  })
}
