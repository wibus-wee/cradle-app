import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, relative } from 'node:path'

import type { DownloadTaskView } from '@cradle/download-center'
import { createServices, getIpcContext, IpcMethod, IpcService } from '@cradle/ipc'
import { app, BrowserWindow, dialog, nativeImage, screen, shell as nativeLauncher, systemPreferences } from 'electron'

import { resolveWindowControlsSafeArea } from '../shared/window-controls-safe-area'
import type {
  ChatEventTailBroker,
  DesktopChatEventTailAbortRequest,
  DesktopChatEventTailDiagnostics,
  DesktopChatEventTailHandle,
  DesktopChatSubscribeGlobalSessionEventsRequest,
  DesktopChatSubscribeSessionEventsRequest,
} from './chat-event-tail-broker'
import type {
  ChatStreamBroker,
  DesktopChatAbortRequest,
  DesktopChatStartResponseRequest,
  DesktopChatStreamDiagnostics,
  DesktopChatStreamHandle,
  DesktopChatSubscribeSessionRequest,
} from './chat-stream-broker'
import type { DesktopCliStatus } from './desktop-cli-manager'
import {
  installDesktopCliCommand,
  readDesktopCliStatus,
  removeDesktopCliCommand,
} from './desktop-cli-manager'
import type { DesktopDownloadCenterService } from './download-center'
import type { MacBridgeManager } from './mac-bridge-manager'
import type {
  MacAppshotAnimationTarget,
  MacAppshotCaptureFrontmostWindowResult,
  MacAppshotFrontmostContext,
  MacCaptureFrontmostWindowResult,
  MacCaptureWindowTarget,
  MacInputBareModifier,
  MacPermissionSettingsRequest,
  MacPermissionSettingsResult,
  MacPermissionsRequest,
  MacPermissionsRequestResult,
  MacPermissionsStatus,
} from './mac-bridge-protocol'
import type { MacScreenshotSinkId, MacScreenshotSinkResult } from './mac-screenshot-sinks'
import { runMacScreenshotSink } from './mac-screenshot-sinks'
import type { CodexAppshotObservedAsset, CodexAppshotObserveResult } from './native-appshot-codex-assets'
import { observeCodexAppshotAssets } from './native-appshot-codex-assets'
import {
  createParityAppshotAnimationTarget,
  readScreenPointAppshotAnimationTarget,
  readScreenPointAppshotDestinationFrame,
} from './native-appshot-target'
import { resolveMacApplicationIconPath } from './native-editor-icon'
import { launchPathInEditor, readAvailableEditors } from './native-editor-launcher'
import { launchPathInTerminal } from './native-terminal-launcher'
import type { QuitGuard } from './quit-guard'
import type { DesktopUpdateManager, DesktopUpdateStatus } from './update-manager'
import type { TearoffSurfaceRoute, WindowManager } from './window-manager'

const DEFAULT_PRIVACY_SENSITIVE_APP_BUNDLE_IDS = [
  'com.apple.keychainaccess',
  'com.1password.1password',
  'com.agilebits.onepassword7',
  'com.bitwarden.desktop',
]

const DEFAULT_PRIVACY_SENSITIVE_TITLE_PATTERNS = [
  'password',
  'passkey',
  'secret',
  'recovery key',
  'one-time code',
]

export interface DesktopPreferences {
  requireDoubleCommandQToQuit: boolean
  appshotHotkeyEnabled: boolean
  appshotHotkeyTrigger: MacInputBareModifier
  autoCheckForUpdates: boolean
  autoDownloadUpdates: boolean
  externalTerminalApp: string | null
}

export type NativeAuthCapabilityReason = 'available' | 'unsupported-platform' | 'unavailable'

export interface NativeAuthCapability {
  supported: boolean
  method: 'local-authentication' | null
  reason: NativeAuthCapabilityReason
}

export type NativeAuthAuthenticateStatus = 'authenticated' | 'unsupported' | 'canceled' | 'failed'

export interface NativeAuthAuthenticateOptions {
  reason?: string
}

export interface NativeAuthAuthenticateResult {
  status: NativeAuthAuthenticateStatus
  method: 'local-authentication' | null
  message?: string
}

export interface AvailableEditor {
  id: string
  label: string
  iconDataUrl?: string
}

/**
 * Read the user's preferred external terminal app name from the server-owned
 * desktop preferences file. Returns undefined when unset (or unreadable), so the
 * launcher falls back to the platform default. Read on demand rather than cached
 * so it always reflects the latest value written by the server.
 */
async function readExternalTerminalApp(): Promise<string | undefined> {
  const filePath = join(app.getPath('userData'), 'data', 'preferences', 'desktop.json')
  try {
    const raw = await readFile(filePath, 'utf8')
    const value = (JSON.parse(raw) as { externalTerminalApp?: unknown }).externalTerminalApp
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  catch {
    return undefined
  }
}

const MAX_CODEX_APP_CAPTURE_BYTES = 25 * 1024 * 1024
const MAX_EXTERNAL_WORK_IMPORT_BYTES = 8 * 1024 * 1024

type ExternalWorkImportSourceApp = 'claude' | 'codex'

interface ExternalWorkImportFile {
  sourceApp: ExternalWorkImportSourceApp
  path: string
  content: string
  workspacePath: string | null
  modifiedAt: number | null
}

async function readExternalWorkImportFile(
  sourceApp: ExternalWorkImportSourceApp,
  path: string,
  workspacePath: string | null = null,
): Promise<ExternalWorkImportFile | null> {
  try {
    const fileStat = await stat(path)
    if (!fileStat.isFile() || fileStat.size > MAX_EXTERNAL_WORK_IMPORT_BYTES) {
      return null
    }
    return {
      sourceApp,
      path,
      content: await readFile(path, 'utf8'),
      workspacePath,
      modifiedAt: Math.floor(fileStat.mtimeMs / 1000),
    }
  }
  catch {
    return null
  }
}

async function collectExternalWorkImportFiles(input: {
  sourceApp: ExternalWorkImportSourceApp
  root: string
  extensions: string | Set<string>
  limit: number
  workspacePath?: string | null
}): Promise<ExternalWorkImportFile[]> {
  const allowedExtensions = typeof input.extensions === 'string' ? new Set([input.extensions]) : input.extensions
  const found: Array<{ path: string, modifiedAt: number }> = []

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > 4 || found.length > input.limit * 8) {
      return
    }
    let children: Array<{ name: string, isDirectory: () => boolean, isFile: () => boolean }>
    try {
      children = await readdir(dir, { withFileTypes: true })
    }
    catch {
      return
    }

    await Promise.all(children.map(async (entry) => {
      const childPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(childPath, depth + 1)
        return
      }
      if (!entry.isFile() || !allowedExtensions.has(extname(childPath).toLowerCase())) {
        return
      }
      try {
        const fileStat = await stat(childPath)
        found.push({ path: childPath, modifiedAt: Math.floor(fileStat.mtimeMs / 1000) })
      }
      catch {
        // Ignore unreadable candidates.
      }
    }))
  }

  await visit(input.root, 0)
  const files = await Promise.all(
    found
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(0, input.limit)
      .map(entry => readExternalWorkImportFile(input.sourceApp, entry.path, input.workspacePath ?? null)),
  )
  return files.filter((file): file is ExternalWorkImportFile => Boolean(file))
}

async function validateNativePath(targetPath: string): Promise<string> {
  if (!targetPath || !isAbsolute(targetPath)) {
    throw new Error('Native file actions require an absolute path')
  }
  return realpath(targetPath)
}

async function validateNativeDirectory(targetPath: string): Promise<string> {
  const resolvedPath = await validateNativePath(targetPath)
  const pathStat = await stat(resolvedPath)
  if (!pathStat.isDirectory()) {
    throw new Error('Native terminal actions require a directory path')
  }
  return resolvedPath
}

// ── Native File System Service ────────────────────────────────────────────────

class NativeService extends IpcService {
  static readonly groupName = 'native'

  @IpcMethod()
  async showOpenDialog(options: {
    title?: string
    defaultPath?: string
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>
    filters?: Array<{ name: string, extensions: string[] }>
  }): Promise<{ canceled: boolean, filePaths: string[] }> {
    const result = await dialog.showOpenDialog({
      title: options.title,
      defaultPath: options.defaultPath,
      properties: options.properties ?? ['openDirectory'],
      filters: options.filters,
    })
    return { canceled: result.canceled, filePaths: result.filePaths }
  }

  @IpcMethod()
  async showSaveDialog(options: {
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string, extensions: string[] }>
  }): Promise<{ canceled: boolean, filePath?: string }> {
    const result = await dialog.showSaveDialog({
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    })
    return { canceled: result.canceled, filePath: result.filePath }
  }

  @IpcMethod()
  async openExternal(url: string): Promise<void> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'mailto:') {
      throw new Error(`Unsupported external URL scheme: ${parsed.protocol}`)
    }
    await nativeLauncher.openExternal(url)
  }

  @IpcMethod()
  async openPath(fullPath: string): Promise<void> {
    const resolvedPath = await validateNativePath(fullPath)
    const errorMessage = await nativeLauncher.openPath(resolvedPath)
    if (errorMessage) {
      throw new Error(errorMessage)
    }
  }

  @IpcMethod()
  async showItemInFolder(fullPath: string): Promise<void> {
    const resolvedPath = await validateNativePath(fullPath)
    nativeLauncher.showItemInFolder(resolvedPath)
  }

  @IpcMethod()
  async openPathInEditor(fullPath: string, editorId?: string): Promise<{ editor: string }> {
    const resolvedPath = await validateNativePath(fullPath)
    const editor = await launchPathInEditor(resolvedPath, editorId)
    return { editor }
  }

  @IpcMethod()
  async listAvailableEditors(): Promise<AvailableEditor[]> {
    const editors = await readAvailableEditors()
    return Promise.all(editors.map(async ({ applicationPath, ...editor }) => {
      if (!applicationPath) {
        return editor
      }

      try {
        const iconPath = process.platform === 'darwin'
          ? await resolveMacApplicationIconPath(applicationPath)
          : undefined
        const icon = iconPath
          ? nativeImage.createFromPath(iconPath)
          : await app.getFileIcon(applicationPath, { size: 'normal' })
        return icon.isEmpty() ? editor : { ...editor, iconDataUrl: icon.toDataURL() }
      }
      catch {
        return editor
      }
    }))
  }

  @IpcMethod()
  async openPathInTerminal(fullPath: string): Promise<{ terminal: string }> {
    const resolvedPath = await validateNativeDirectory(fullPath)
    const terminal = await launchPathInTerminal(resolvedPath, await readExternalTerminalApp())
    return { terminal }
  }

  @IpcMethod()
  async getCradleDataPaths(): Promise<{
    userDataPath: string
    serverDataPath: string
    databasePath: string
    serverLogPath: string
  }> {
    const userDataPath = app.getPath('userData')
    const serverDataPath = join(userDataPath, 'data')
    return {
      userDataPath,
      serverDataPath,
      databasePath: join(serverDataPath, 'cradle.db'),
      serverLogPath: join(serverDataPath, 'server.log'),
    }
  }

  @IpcMethod()
  async getDesktopCliStatus(): Promise<DesktopCliStatus> {
    return readDesktopCliStatus()
  }

  @IpcMethod()
  async installDesktopCliCommand(): Promise<DesktopCliStatus> {
    return installDesktopCliCommand()
  }

  @IpcMethod()
  async removeDesktopCliCommand(): Promise<DesktopCliStatus> {
    return removeDesktopCliCommand()
  }

  @IpcMethod()
  async setDesktopPreferences(preferences: DesktopPreferences): Promise<DesktopPreferences> {
    const guard = getQuitGuard()
    if (!guard) {
      throw new Error('Quit guard is not initialized')
    }
    guard.updatePreferences({
      requireDoubleCommandQToQuit: preferences.requireDoubleCommandQToQuit,
    })
    const manager = getMacBridgeManager()
    if (manager && process.platform === 'darwin') {
      await manager.configureInput({
        trigger: preferences.appshotHotkeyTrigger,
        enabled: preferences.appshotHotkeyEnabled,
      })
    }
    getUpdateManager()?.configurePreferences({
      autoCheckForUpdates: preferences.autoCheckForUpdates,
      autoDownloadUpdates: preferences.autoDownloadUpdates,
    })
    return preferences
  }

  @IpcMethod()
  async scanExternalWorkImportFiles(options: {
    limitPerSource?: number
  } = {}): Promise<{ files: ExternalWorkImportFile[], warnings: string[] }> {
    const limit = Math.min(Math.max(options.limitPerSource ?? 500, 1), 500)
    const home = homedir()
    const files: ExternalWorkImportFile[] = []
    const warnings: string[] = []
    const fixedCandidates: Array<{ sourceApp: ExternalWorkImportSourceApp, path: string }> = [
      { sourceApp: 'codex', path: join(home, '.codex', 'history.jsonl') },
    ]

    for (const candidate of fixedCandidates) {
      const file = await readExternalWorkImportFile(candidate.sourceApp, candidate.path)
      if (file) {
        files.push(file)
      }
    }

    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'claude',
      root: join(home, '.claude', 'projects'),
      extensions: '.jsonl',
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'codex',
      root: join(home, '.codex', 'archived_sessions'),
      extensions: '.jsonl',
      limit,
    }))

    if (files.length === 0) {
      warnings.push('No supported Claude or Codex work files were found on this device.')
    }

    return { files, warnings }
  }
}

// ── Native Local Authentication Service ──────────────────────────────────────

function readNativeAuthCapability(): NativeAuthCapability {
  if (process.platform !== 'darwin') {
    return {
      supported: false,
      method: null,
      reason: 'unsupported-platform',
    }
  }

  try {
    if (!systemPreferences.canPromptTouchID()) {
      return {
        supported: false,
        method: null,
        reason: 'unavailable',
      }
    }
  }
  catch {
    return {
      supported: false,
      method: null,
      reason: 'unavailable',
    }
  }

  return {
    supported: true,
    method: 'local-authentication',
    reason: 'available',
  }
}

function readNativeAuthPromptReason(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Confirm this action in Cradle.'
  }
  const reason = value.trim()
  return reason.length > 0 ? reason.slice(0, 180) : 'Confirm this action in Cradle.'
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNativeAuthCancellation(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase()
  return message.includes('cancel') || message.includes('user')
}

class NativeAuthService extends IpcService {
  static readonly groupName = 'nativeAuth'

  @IpcMethod()
  async getCapability(): Promise<NativeAuthCapability> {
    return readNativeAuthCapability()
  }

  @IpcMethod()
  async authenticate(options: NativeAuthAuthenticateOptions = {}): Promise<NativeAuthAuthenticateResult> {
    const capability = readNativeAuthCapability()
    if (!capability.supported) {
      return {
        status: 'unsupported',
        method: null,
        message: capability.reason,
      }
    }

    try {
      await systemPreferences.promptTouchID(readNativeAuthPromptReason(options.reason))
      return {
        status: 'authenticated',
        method: 'local-authentication',
      }
    }
    catch (error) {
      return {
        status: isNativeAuthCancellation(error) ? 'canceled' : 'failed',
        method: 'local-authentication',
        message: readErrorMessage(error),
      }
    }
  }
}

// ── Window Management Service ─────────────────────────────────────────────────

interface NativeServicesContext {
  getWindowManager: () => WindowManager | undefined
  getUpdateManager: () => DesktopUpdateManager | null
  getDesktopDownloadCenter: () => DesktopDownloadCenterService | null
  getMacBridgeManager: () => MacBridgeManager | null
  getChatStreamBroker: () => ChatStreamBroker | null
  getChatEventTailBroker: () => ChatEventTailBroker | null
  getQuitGuard: () => QuitGuard
}

let nativeServicesContext: NativeServicesContext | null = null

function getWindowManager(): WindowManager | undefined {
  return nativeServicesContext?.getWindowManager()
}

function getUpdateManager(): DesktopUpdateManager | null {
  return nativeServicesContext?.getUpdateManager() ?? null
}

function getDesktopDownloadCenter(): DesktopDownloadCenterService | null {
  return nativeServicesContext?.getDesktopDownloadCenter() ?? null
}

function getMacBridgeManager(): MacBridgeManager | null {
  return nativeServicesContext?.getMacBridgeManager() ?? null
}

function getChatStreamBroker(): ChatStreamBroker | null {
  return nativeServicesContext?.getChatStreamBroker() ?? null
}

function getChatEventTailBroker(): ChatEventTailBroker | null {
  return nativeServicesContext?.getChatEventTailBroker() ?? null
}

function getQuitGuard(): QuitGuard | null {
  return nativeServicesContext?.getQuitGuard() ?? null
}

function readIpcSenderWindow(): BrowserWindow | null {
  try {
    return BrowserWindow.fromWebContents(getIpcContext().sender)
  }
  catch {
    return null
  }
}

function focusBrowserWindow(window: BrowserWindow | null | undefined): boolean {
  if (!window || window.isDestroyed()) {
    return false
  }
  if (window.isMinimized()) {
    window.restore()
  }
  if (!window.isVisible()) {
    window.show()
  }
  if (process.platform === 'darwin') {
    app.focus({ steal: true })
  }
  window.focus()
  return true
}

function serializeAppshotBrowserWindowForLog(window: BrowserWindow | null | undefined) {
  if (!window || window.isDestroyed()) {
    return null
  }
  return {
    id: window.id,
    bounds: window.getBounds(),
    contentBounds: window.getContentBounds(),
    url: window.webContents.getURL(),
    isFocused: window.isFocused(),
  }
}

function readScreenAppshotAnimationTarget(
  target: MacAppshotAnimationTarget | undefined,
  rendererWindow: BrowserWindow | null = readIpcSenderWindow(),
): MacAppshotAnimationTarget | undefined {
  if (!target || target.coordinateSpace !== 'viewportPixels') {
    return target
  }
  const windowManager = getWindowManager()
  const window = rendererWindow && !rendererWindow.isDestroyed()
    ? rendererWindow
    : windowManager?.getMainWindow()
  if (!window || window.isDestroyed()) {
    return target
  }
  const scaleFactor = target.codexDisplay.scaleFactor
  const windowBounds = window.getBounds()
  const contentBounds = window.getContentBounds()
  const destinationFrame = readScreenPointAppshotDestinationFrame(target, contentBounds)
  const display = screen.getDisplayMatching(destinationFrame)
  const convertedTarget = readScreenPointAppshotAnimationTarget(target, contentBounds, display)
  console.debug('[mac-capture] Appshot destination converted:', {
    inputCoordinateSpace: target.coordinateSpace,
    inputScaleFactor: scaleFactor,
    rendererWindow: serializeAppshotBrowserWindowForLog(rendererWindow),
    selectedWindow: serializeAppshotBrowserWindowForLog(window),
    windowBounds,
    contentBounds,
    displays: screen.getAllDisplays(),
    inputDestinationFrame: target.destinationFrame,
    convertedDestinationFrame: convertedTarget.destinationFrame,
    display: convertedTarget.codexDisplay,
  })
  return convertedTarget
}

const pointerMonitors = new Map<number, ReturnType<typeof setInterval>>()

interface WindowTitleBarOverlayInput {
  color: string
  symbolColor: string
}

class WindowService extends IpcService {
  static readonly groupName = 'window'

  @IpcMethod()
  async tearOffSurface(surfaceId: string, route: TearoffSurfaceRoute, screenX: number, screenY: number): Promise<void> {
    const windowManager = getWindowManager()
    if (!windowManager) {
      throw new Error('WindowManager not initialized')
    }
    await windowManager.openSurfaceWindow(surfaceId, route, screenX, screenY)
  }

  @IpcMethod()
  async focusSurface(surfaceId: string): Promise<boolean> {
    const windowManager = getWindowManager()
    if (!windowManager) {
      return false
    }
    return windowManager.focusSurfaceWindow(surfaceId)
  }

  @IpcMethod()
  async closeSurface(surfaceId: string): Promise<void> {
    getWindowManager()?.closeSurfaceWindow(surfaceId)
  }

  @IpcMethod()
  async getOpenSurfaces(): Promise<string[]> {
    return getWindowManager()?.getOpenSurfaceIds() ?? []
  }

  @IpcMethod()
  async openDevtool(): Promise<void> {
    const windowManager = getWindowManager()
    if (!windowManager) {
      throw new Error('WindowManager not initialized')
    }
    await windowManager.openDevtoolWindow()
  }

  @IpcMethod()
  async minimize(): Promise<void> {
    getWindowManager()?.getMainWindow()?.minimize()
  }

  @IpcMethod()
  async maximize(): Promise<void> {
    const win = getWindowManager()?.getMainWindow()
    if (!win) {
      return
    }
    if (win.isMaximized()) {
      win.unmaximize()
      return
    }
    win.maximize()
  }

  @IpcMethod()
  async startPointerMonitor(): Promise<void> {
    const ctx = getIpcContext()
    const webContents = ctx.sender
    const contentsId = webContents.id

    // Stop any existing monitor for this webContents
    const existing = pointerMonitors.get(contentsId)
    if (existing) {
      clearInterval(existing)
    }

    let wasOutside = false

    const interval = setInterval(() => {
      if (webContents.isDestroyed()) {
        clearInterval(interval)
        pointerMonitors.delete(contentsId)
        return
      }

      const cursor = screen.getCursorScreenPoint()
      const win = BrowserWindow.fromWebContents(webContents)
      if (!win || win.isDestroyed()) {
        return
      }

      const bounds = win.getBounds()
      const isOutside = (
        cursor.x < bounds.x
        || cursor.x > bounds.x + bounds.width
        || cursor.y < bounds.y
        || cursor.y > bounds.y + bounds.height
      )

      if (isOutside && !wasOutside) {
        wasOutside = true
        webContents.send('window:pointer-outside-window', cursor.x, cursor.y)
      }
      else if (!isOutside && wasOutside) {
        wasOutside = false
      }
    }, 16)

    pointerMonitors.set(contentsId, interval)
  }

  @IpcMethod()
  async stopPointerMonitor(): Promise<void> {
    const ctx = getIpcContext()
    const contentsId = ctx.sender.id
    const existing = pointerMonitors.get(contentsId)
    if (existing) {
      clearInterval(existing)
      pointerMonitors.delete(contentsId)
    }
  }

  @IpcMethod()
  async focusCurrent(): Promise<boolean> {
    return focusBrowserWindow(readIpcSenderWindow())
  }

  @IpcMethod()
  async setTitleBarOverlay(input: WindowTitleBarOverlayInput): Promise<void> {
    const win = readIpcSenderWindow()
    if (!win || win.isDestroyed()) {
      return
    }
    const safeArea = resolveWindowControlsSafeArea(process.platform)
    win.setBackgroundColor(input.color)
    if (process.platform !== 'darwin') {
      win.setTitleBarOverlay({
        color: input.color,
        symbolColor: input.symbolColor,
        height: safeArea.height,
      })
    }
  }

  @IpcMethod()
  async close(): Promise<void> {
    const ctx = getIpcContext()
    BrowserWindow.fromWebContents(ctx.sender)?.close()
  }
}

// ── Desktop Update Service ────────────────────────────────────────────────────

class DesktopUpdateService extends IpcService {
  static readonly groupName = 'desktopUpdate'

  @IpcMethod()
  async getStatus(): Promise<DesktopUpdateStatus> {
    const updateManager = this.readUpdateManager()
    return updateManager.status
  }

  @IpcMethod()
  async checkForUpdates(): Promise<DesktopUpdateStatus> {
    const updateManager = this.readUpdateManager()
    return updateManager.checkForUpdates()
  }

  @IpcMethod()
  async downloadUpdate(): Promise<DesktopUpdateStatus> {
    const updateManager = this.readUpdateManager()
    return updateManager.downloadUpdate()
  }

  @IpcMethod()
  async applyUpdate(): Promise<void> {
    const updateManager = this.readUpdateManager()
    await updateManager.applyUpdate()
  }

  private readUpdateManager(): DesktopUpdateManager {
    const updateManager = getUpdateManager()
    if (!updateManager) {
      throw new Error('Desktop update manager is not initialized')
    }
    return updateManager
  }
}

// ── Desktop Download Center Service ─────────────────────────────────────────

class DesktopDownloadCenterIpcService extends IpcService {
  static readonly groupName = 'downloadCenter'

  @IpcMethod()
  async list(): Promise<DownloadTaskView[]> {
    return this.readCenter().list()
  }

  @IpcMethod()
  async get(taskId: string): Promise<DownloadTaskView | null> {
    return this.readCenter().get(taskId)
  }

  @IpcMethod()
  async cancel(taskId: string): Promise<DownloadTaskView | null> {
    return await this.readCenter().cancel(taskId)
  }

  private readCenter(): DesktopDownloadCenterService {
    const center = getDesktopDownloadCenter()
    if (!center) {
      throw new Error('Desktop download center is not initialized')
    }
    return center
  }
}

// ── Desktop Chat Stream Service ───────────────────────────────────────────────

class DesktopChatStreamService extends IpcService {
  static readonly groupName = 'chatStream'

  @IpcMethod()
  async startResponse(request: DesktopChatStartResponseRequest): Promise<DesktopChatStreamHandle> {
    return await this.readBroker().startResponse(getIpcContext().sender, request)
  }

  @IpcMethod()
  async subscribeSession(request: DesktopChatSubscribeSessionRequest): Promise<DesktopChatStreamHandle> {
    return await this.readBroker().subscribeSession(getIpcContext().sender, request)
  }

  @IpcMethod()
  async abort(request: DesktopChatAbortRequest): Promise<void> {
    this.readBroker().abortStream(getIpcContext().sender, request)
  }

  @IpcMethod()
  async diagnostics(): Promise<DesktopChatStreamDiagnostics> {
    return this.readBroker().diagnostics()
  }

  private readBroker(): ChatStreamBroker {
    const broker = getChatStreamBroker()
    if (!broker) {
      throw new Error('Desktop chat stream broker is not initialized')
    }
    return broker
  }
}

// ── Desktop Chat Event Tail Service ──────────────────────────────────────────

class DesktopChatEventTailService extends IpcService {
  static readonly groupName = 'chatEventTail'

  @IpcMethod()
  async subscribeSessionEvents(
    request: DesktopChatSubscribeSessionEventsRequest,
  ): Promise<DesktopChatEventTailHandle> {
    return this.readBroker().subscribeSessionEvents(getIpcContext().sender, request)
  }

  @IpcMethod()
  async subscribeGlobalSessionEvents(
    request: DesktopChatSubscribeGlobalSessionEventsRequest,
  ): Promise<DesktopChatEventTailHandle> {
    return this.readBroker().subscribeGlobalSessionEvents(getIpcContext().sender, request)
  }

  @IpcMethod()
  async abort(request: DesktopChatEventTailAbortRequest): Promise<void> {
    this.readBroker().abortTail(getIpcContext().sender, request)
  }

  @IpcMethod()
  async diagnostics(): Promise<DesktopChatEventTailDiagnostics> {
    return this.readBroker().diagnostics()
  }

  private readBroker(): ChatEventTailBroker {
    const broker = getChatEventTailBroker()
    if (!broker) {
      throw new Error('Desktop chat event tail broker is not initialized')
    }
    return broker
  }
}

// ── Mac Capture Service ──────────────────────────────────────────────────────

export interface MacCaptureRequest {
  sink?: MacScreenshotSinkId
  targetWindow?: MacCaptureWindowTarget
  privacySensitiveAppBundleIds?: string[]
  privacySensitiveTitlePatterns?: string[]
}

export interface MacCaptureResponse {
  capture: MacCaptureFrontmostWindowResult
  sink: MacScreenshotSinkResult
}

export type MacAppshotStrategy = 'cradle-native'

export interface MacAppshotCaptureRequest extends MacCaptureRequest {
  strategy?: MacAppshotStrategy
  animationTarget?: MacAppshotAnimationTarget
  animationDuration?: number
  requestId?: string
  soundEnabled?: boolean
  transitionSnapshotHeight?: number
  transitionSpringDampingFraction?: number
  transitionSpringResponse?: number
}

export interface MacAppshotImageAsset {
  path: string
  dataURL: string
  mimeType: 'image/png' | 'image/jpeg'
}

export interface MacCradleAppshotCaptureResponse {
  strategy: 'cradle-native'
  capture: MacAppshotCaptureFrontmostWindowResult
  asset: MacAppshotImageAsset | null
  transitionSnapshotAsset: MacAppshotImageAsset | null
  sink: MacScreenshotSinkResult
}

export type MacAppshotCaptureResponse = MacCradleAppshotCaptureResponse

export interface MacAppshotParityProbeRequest extends MacCaptureRequest {
  soundEnabled?: boolean
  animationTarget?: MacAppshotAnimationTarget
}

export interface MacCodexAppshotObserveRequest {
  durationMs?: number
  pollIntervalMs?: number
  baselinePaths?: string[]
  startedAtMs?: number
}

export interface MacAppshotParityProbeResponse {
  context: MacAppshotFrontmostContext
  animationTarget: MacAppshotAnimationTarget
  cradle: MacCradleAppshotCaptureResponse
  appliedCalibration: {
    animationDuration?: number
    transitionSnapshotHeight?: number
    transitionSpringDampingFraction?: number
    transitionSpringResponse?: number
  }
}

export interface MacCodexAppshotObserveResponse extends CodexAppshotObserveResult {
  assets: CodexAppshotObservedAsset[]
}

class MacCaptureService extends IpcService {
  static readonly groupName = 'macCapture'

  @IpcMethod()
  async getStatus() {
    return getMacBridgeManager()?.getStatus() ?? {
      available: false,
      running: false,
      platform: process.platform,
      binaryPath: null,
      pid: null,
      startedAt: null,
      lastError: 'Mac Bridge manager is not initialized',
    }
  }

  @IpcMethod()
  async getPermissions(): Promise<MacPermissionsStatus> {
    const manager = this.readManager()
    return manager.readPermissions()
  }

  @IpcMethod()
  async requestPermissions(options: MacPermissionsRequest = {}): Promise<MacPermissionsRequestResult> {
    const manager = this.readManager()
    return manager.requestPermissions(options)
  }

  @IpcMethod()
  async openPermissionSettings(options: MacPermissionSettingsRequest = {}): Promise<MacPermissionSettingsResult> {
    const manager = this.readManager()
    return manager.openPermissionSettings(options)
  }

  @IpcMethod()
  async configureBothCommandHotkey(enabled: boolean) {
    const manager = this.readManager()
    return manager.configureInput({
      trigger: 'DoubleCommand',
      enabled,
    })
  }

  @IpcMethod()
  async captureFrontmostWindow(options: MacCaptureRequest = {}): Promise<MacCaptureResponse> {
    return captureFrontmostWindowWithMacBridge(options)
  }

  @IpcMethod()
  async captureAppshot(options: MacAppshotCaptureRequest = {}): Promise<MacAppshotCaptureResponse> {
    return captureAppshotWithMacBridge(options)
  }

  @IpcMethod()
  async captureAppshotParityProbe(options: MacAppshotParityProbeRequest = {}): Promise<MacAppshotParityProbeResponse> {
    return captureAppshotParityProbeWithMacBridge(options)
  }

  @IpcMethod()
  async observeCodexAppshotAssets(options: MacCodexAppshotObserveRequest = {}): Promise<MacCodexAppshotObserveResponse> {
    return observeCodexAppshotAssetsWithDesktop(options)
  }

  @IpcMethod()
  async getAppshotFrontmostContext(): Promise<MacAppshotFrontmostContext> {
    const manager = this.readManager()
    return manager.readAppshotFrontmostContext()
  }

  private readManager(): MacBridgeManager {
    const manager = getMacBridgeManager()
    if (!manager) {
      throw new Error('Mac Bridge manager is not initialized')
    }
    return manager
  }
}

function readMacCaptureOutputDir(): string {
  return join(app.getPath('userData'), 'mac-captures')
}

function readPrivacySensitiveAppBundleIds(options: MacCaptureRequest): string[] {
  return [
    ...DEFAULT_PRIVACY_SENSITIVE_APP_BUNDLE_IDS,
    ...(options.privacySensitiveAppBundleIds ?? []),
  ]
}

function readPrivacySensitiveTitlePatterns(options: MacCaptureRequest): string[] {
  return [
    ...DEFAULT_PRIVACY_SENSITIVE_TITLE_PATTERNS,
    ...(options.privacySensitiveTitlePatterns ?? []),
  ]
}

export async function captureFrontmostWindowWithMacBridge(options: MacCaptureRequest = {}): Promise<MacCaptureResponse> {
  const manager = getMacBridgeManager()
  if (!manager) {
    throw new Error('Mac Bridge manager is not initialized')
  }
  const outputDir = readMacCaptureOutputDir()
  const capture = await manager.captureFrontmostWindow({
    outputDir,
    targetWindow: options.targetWindow,
    privacySensitiveAppBundleIds: readPrivacySensitiveAppBundleIds(options),
    privacySensitiveTitlePatterns: readPrivacySensitiveTitlePatterns(options),
  })
  const sink = await runMacScreenshotSink({
    sink: options.sink ?? 'file',
    capture,
  })
  return {
    capture,
    sink,
  }
}

export async function captureAppshotWithMacBridge(
  options: MacAppshotCaptureRequest = {},
): Promise<MacAppshotCaptureResponse> {
  const rendererWindow = readIpcSenderWindow()
  const manager = getMacBridgeManager()
  if (!manager) {
    throw new Error('Mac Bridge manager is not initialized')
  }

  const strategy = options.strategy ?? 'cradle-native'
  if (strategy !== 'cradle-native') {
    throw new Error(`Unsupported Appshot strategy: ${strategy}`)
  }
  if (options.targetWindow && !options.animationTarget) {
    throw new Error('Appshot capture requires an animation target when a target window is provided.')
  }
  const context = await readAppshotContext(manager, options)
  const captureOptions = context
    ? {
        ...options,
        targetWindow: options.targetWindow ?? readCaptureTargetWindow(context),
        animationTarget: options.animationTarget ?? context.animationTarget,
      }
    : options
  const animationTarget = readScreenAppshotAnimationTarget(captureOptions.animationTarget, rendererWindow)
  console.debug('[mac-capture] Appshot capture starting:', {
    strategy,
    requestId: options.requestId,
    hasContext: Boolean(context),
    targetWindow: captureOptions.targetWindow,
    rendererWindow: serializeAppshotBrowserWindowForLog(rendererWindow),
    mainWindow: serializeAppshotBrowserWindowForLog(getWindowManager()?.getMainWindow()),
    animationTarget,
  })

  const capture = await manager.captureAppshotFrontmostWindow({
    outputDir: readMacCaptureOutputDir(),
    targetWindow: captureOptions.targetWindow,
    animationTarget,
    animationDuration: captureOptions.animationDuration,
    soundEnabled: captureOptions.soundEnabled,
    transitionSnapshotHeight: captureOptions.transitionSnapshotHeight,
    transitionSpringDampingFraction: captureOptions.transitionSpringDampingFraction,
    transitionSpringResponse: captureOptions.transitionSpringResponse,
    privacySensitiveAppBundleIds: readPrivacySensitiveAppBundleIds(captureOptions),
    privacySensitiveTitlePatterns: readPrivacySensitiveTitlePatterns(captureOptions),
  })
  console.debug('[mac-capture] Appshot capture completed:', {
    strategy: 'cradle-native',
    requestId: options.requestId,
    filePath: capture.filePath,
    window: capture.window,
    transitionSnapshotImageSize: capture.appshot.transitionSnapshotImageSize,
    transitionGeometry: capture.appshot.transitionGeometry,
  })
  const sink = await runMacScreenshotSink({
    sink: options.sink ?? 'file',
    capture,
  })
  return {
    strategy: 'cradle-native',
    capture,
    asset: await readCradleAppshotAsset(capture.filePath),
    transitionSnapshotAsset: capture.appshot.transitionSnapshotPath
      ? await readCradleAppshotAsset(capture.appshot.transitionSnapshotPath)
      : null,
    sink,
  }
}

async function readAppshotContext(
  manager: MacBridgeManager,
  options: MacAppshotCaptureRequest,
): Promise<MacAppshotFrontmostContext | null> {
  if (options.animationTarget && options.targetWindow) {
    return null
  }

  try {
    return await manager.readAppshotFrontmostContext()
  }
  catch {
    return null
  }
}

export async function captureAppshotParityProbeWithMacBridge(
  options: MacAppshotParityProbeRequest = {},
): Promise<MacAppshotParityProbeResponse> {
  const manager = getMacBridgeManager()
  if (!manager) {
    throw new Error('Mac Bridge manager is not initialized')
  }

  const context = await manager.readAppshotFrontmostContext()
  const animationTarget = options.animationTarget ?? createParityAppshotAnimationTarget(context)
  const targetWindow = readCaptureTargetWindow(context)

  const appliedCalibration: MacAppshotParityProbeResponse['appliedCalibration'] = {}
  const cradle = await captureAppshotWithMacBridge({
    ...options,
    strategy: 'cradle-native',
    targetWindow,
    animationTarget,
    animationDuration: appliedCalibration.animationDuration,
    transitionSnapshotHeight: appliedCalibration.transitionSnapshotHeight,
    transitionSpringDampingFraction: appliedCalibration.transitionSpringDampingFraction,
    transitionSpringResponse: appliedCalibration.transitionSpringResponse,
  })
  if (cradle.strategy !== 'cradle-native') {
    throw new Error('Appshot parity probe expected Cradle native capture')
  }

  return {
    context,
    animationTarget,
    cradle,
    appliedCalibration,
  }
}

function readCaptureTargetWindow(context: MacAppshotFrontmostContext): MacCaptureWindowTarget {
  return {
    windowId: context.window.windowId,
    processId: context.window.processId,
    bundleId: context.window.bundleId ?? undefined,
  }
}

export async function observeCodexAppshotAssetsWithDesktop(
  options: MacCodexAppshotObserveRequest = {},
): Promise<MacCodexAppshotObserveResponse> {
  return observeCodexAppshotAssets({
    durationMs: readCodexObserveDurationMs(options.durationMs),
    pollIntervalMs: readCodexObservePollIntervalMs(options.pollIntervalMs),
    baselinePaths: options.baselinePaths,
    startedAtMs: options.startedAtMs,
  })
}

async function readCradleAppshotAsset(filePath: string): Promise<MacAppshotImageAsset | null> {
  return readAppshotImageAsset(filePath, readMacCaptureOutputDir())
}

async function readAppshotImageAsset(filePath: string, rootPath: string): Promise<MacAppshotImageAsset | null> {
  const mimeType = readCaptureMimeType(filePath)
  if (!mimeType) {
    return null
  }

  try {
    const [resolvedCapturePath, resolvedRootPath] = await Promise.all([
      realpath(filePath),
      realpath(rootPath),
    ])
    const relativePath = relative(resolvedRootPath, resolvedCapturePath)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return null
    }
    const metadata = await stat(resolvedCapturePath)
    if (!metadata.isFile() || metadata.size > MAX_CODEX_APP_CAPTURE_BYTES) {
      return null
    }
    const dataURL = `data:${mimeType};base64,${(await readFile(resolvedCapturePath)).toString('base64')}`
    return {
      path: resolvedCapturePath,
      dataURL,
      mimeType,
    }
  }
  catch {
    return null
  }
}

function readCodexObserveDurationMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 8_000
  }
  return Math.min(Math.max(value, 0), 60_000)
}

function readCodexObservePollIntervalMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 250
  }
  return Math.min(Math.max(value, 100), 5_000)
}

function readCaptureMimeType(filePath: string): MacAppshotImageAsset['mimeType'] | null {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.png') {
    return 'image/png'
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  return null
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createNativeServices(context: NativeServicesContext) {
  nativeServicesContext = context
  return createServices([
    NativeService,
    NativeAuthService,
    WindowService,
    DesktopUpdateService,
    DesktopDownloadCenterIpcService,
    DesktopChatStreamService,
    DesktopChatEventTailService,
    MacCaptureService,
  ] as const)
}
