import { createIpcProxy } from '@cradle/ipc/client'

import type { SurfaceRoute } from '~/navigation/surface-identity'

import { cradleFetch } from './server-credential'
import { getConfiguredServerUrl } from './server-endpoint-preferences'

/**
 * Whether we're running inside Electron.
 */
export const isElectron = !!window.cradle?.env?.isElectron

/**
 * Whether we're in a local development environment where both
 * Electron and Server are running locally. In this mode, we can
 * use file:// paths directly instead of uploading file contents.
 */
export function isLocalMode(): boolean {
  if (!isElectron) {
    return false
  }
  const serverUrl = getServerUrl()
  return serverUrl.startsWith('http://127.0.0.1') || serverUrl.startsWith('http://localhost')
}

/**
 * The server URL — from renderer-local override, Electron preload, or Vite env.
 * WARNING: Unless you need to bypass api-gen's react-query integration, do not use this client directly.
 */
export function getServerUrl(): string {
  return getConfiguredServerUrl()
}

/**
 * Build a WebSocket URL from the configured server base URL.
 */
export function getServerWebSocketUrl(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  const url = new URL(path, getServerUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) {
        continue
      }
      url.searchParams.set(key, String(value))
    }
  }

  return url.toString()
}

export async function getAuthenticatedServerWebSocketUrl(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): Promise<string> {
  const response = await cradleFetch(new URL('/auth/websocket-ticket', getServerUrl()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audience: path }),
  })
  if (!response.ok) {
    throw new Error(`Failed to issue WebSocket ticket: HTTP ${response.status}`)
  }
  const payload = await response.json() as { ticket: string }
  return getServerWebSocketUrl(path, { ...query, ticket: payload.ticket })
}

export async function getAuthenticatedEventSourceUrl(url: string): Promise<string> {
  const target = new URL(url, getServerUrl())
  const audience = `sse:${target.pathname}`
  const response = await cradleFetch(new URL('/auth/websocket-ticket', getServerUrl()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audience }),
  })
  if (!response.ok) {
    throw new Error(`Failed to issue event stream ticket: HTTP ${response.status}`)
  }
  const payload = await response.json() as { ticket: string }
  target.searchParams.set('eventTicket', payload.ticket)
  return target.toString()
}

/**
 * Whether this is a tearoff window (surface torn off into its own window).
 */
export const isTearoffWindow = !!window.cradle?.env?.isTearoff

/**
 * The surface id for tearoff windows (e.g. `chat:<sessionId>`, `workspace:<id>`).
 */
export const tearoffSurfaceId = window.cradle?.env?.surface ?? null

/**
 * The route to navigate to inside a tearoff window. Null outside tearoff windows
 * or when the surface route could not be parsed.
 */
export const tearoffSurfaceRoute = (window.cradle?.env?.surfaceRoute ?? null) as SurfaceRoute | null

/**
 * The OS platform.
 */
export const platform = window.cradle?.env?.platform ?? 'darwin'

export interface WindowControlsSafeArea {
  side: 'left' | 'right' | 'none'
  x: number
  y: number
  width: number
  height: number
}

export const windowControlsSafeArea: WindowControlsSafeArea = window.cradle?.env?.windowControlsSafeArea ?? {
  side: 'none',
  x: 0,
  y: 0,
  width: 0,
  height: 0,
}

interface WindowTitleBarOverlayInput {
  color: string
  symbolColor: string
}

type ChatThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
type RuntimeSettingsValue = string | number | boolean | null

// ── Desktop Chat Stream Bridge ────────────────────────────────────────────────

export interface DesktopChatStartResponseRequest {
  sessionId: string
  body: {
    text: string
    files?: unknown[]
    messages?: unknown[]
    providerTargetId?: string
    modelId?: string | null
    thinkingEffort?: ChatThinkingEffort
    /** Provider-native session settings (e.g. permissionMode for claude-agent). */
    runtimeSettings?: Record<string, RuntimeSettingsValue>
  }
}

export interface DesktopChatSubscribeSessionRequest {
  sessionId: string
}

export interface DesktopChatAbortRequest {
  streamId: string
}

export interface DesktopChatStreamHandle {
  streamId: string
  sessionId: string
  runId: string | null
  telemetrySessionId: string | null
  telemetryRunId: string | null
  assistantMessageId?: string
  userMessageId?: string
}

export interface DesktopChatStreamChunkEvent {
  streamId: string
  sessionId: string
  runId: string | null
  chunk: unknown
  replay?: boolean
}

export interface DesktopChatStreamClosedEvent {
  streamId: string
  sessionId: string
  runId: string | null
  reason: 'done' | 'aborted' | 'upstream-closed'
}

export interface DesktopChatStreamErrorEvent {
  streamId: string
  sessionId: string
  runId: string | null
  message: string
}

export interface DesktopChatStreamDiagnostics {
  streams: Array<{
    sessionId: string
    mode: 'response' | 'session'
    runId: string | null
    assistantMessageId?: string
    userMessageId?: string
    subscriberCount: number
    replayChunkCount: number
    keepAliveWithoutSubscribers: boolean
    startedAtMs: number
  }>
}

export interface DesktopChatStreamBridge {
  startResponse: (request: DesktopChatStartResponseRequest) => Promise<DesktopChatStreamHandle>
  subscribeSession: (request: DesktopChatSubscribeSessionRequest) => Promise<DesktopChatStreamHandle>
  abort: (request: DesktopChatAbortRequest) => Promise<void>
  diagnostics: () => Promise<DesktopChatStreamDiagnostics>
  onChunk: (handler: (event: DesktopChatStreamChunkEvent) => void) => () => void
  onClosed: (handler: (event: DesktopChatStreamClosedEvent) => void) => () => void
  onError: (handler: (event: DesktopChatStreamErrorEvent) => void) => () => void
}

export function readDesktopChatStreamBridge(): DesktopChatStreamBridge | null {
  return window.cradle?.chatStream ?? null
}

// ── Desktop Chat Event Tail Bridge ───────────────────────────────────────────

export interface DesktopChatSubscribeSessionEventsRequest {
  sessionId: string
  afterVersion?: number
}

export interface DesktopChatSubscribeGlobalSessionEventsRequest {
  afterSequenceId?: number
  workspaceId?: string | null
}

export interface DesktopChatEventTailAbortRequest {
  tailId: string
}

export interface DesktopChatEventTailHandle {
  tailId: string
  scope: 'session' | 'sessions'
  sessionId: string | null
}

export interface DesktopChatEventTailEvent {
  tailId: string
  sessionId: string
  event: unknown
}

export interface DesktopChatEventTailClosedEvent {
  tailId: string
  sessionId: string
  reason: 'aborted' | 'upstream-closed'
}

export interface DesktopChatEventTailErrorEvent {
  tailId: string
  sessionId: string
  message: string
}

export interface DesktopChatEventTailDiagnostics {
  tails: Array<{
    scope: 'session' | 'sessions'
    sessionId: string | null
    workspaceId: string | null
    afterVersion: number | null
    afterSequenceId: number | null
    subscriberCount: number
    replayEventCount: number
    startedAtMs: number
  }>
}

export interface DesktopChatEventTailBridge {
  subscribeSessionEvents: (
    request: DesktopChatSubscribeSessionEventsRequest,
  ) => Promise<DesktopChatEventTailHandle>
  subscribeGlobalSessionEvents: (
    request: DesktopChatSubscribeGlobalSessionEventsRequest,
  ) => Promise<DesktopChatEventTailHandle>
  abort: (request: DesktopChatEventTailAbortRequest) => Promise<void>
  diagnostics: () => Promise<DesktopChatEventTailDiagnostics>
  onEvent: (handler: (event: DesktopChatEventTailEvent) => void) => () => void
  onClosed: (handler: (event: DesktopChatEventTailClosedEvent) => void) => () => void
  onError: (handler: (event: DesktopChatEventTailErrorEvent) => void) => () => void
}

export function readDesktopChatEventTailBridge(): DesktopChatEventTailBridge | null {
  return window.cradle?.chatEventTail ?? null
}

// ── IPC Proxy (typed) ─────────────────────────────────────────────────────────

export interface AvailableEditor {
  id: string
  label: string
  iconDataUrl?: string
}

interface NativeServiceMethods {
  showOpenDialog: (options: {
    title?: string
    defaultPath?: string
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>
    filters?: Array<{ name: string, extensions: string[] }>
  }) => Promise<{ canceled: boolean, filePaths: string[] }>

  showSaveDialog: (options: {
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string, extensions: string[] }>
  }) => Promise<{ canceled: boolean, filePath?: string }>

  openExternal: (url: string) => Promise<void>
  openPath: (fullPath: string) => Promise<void>
  showItemInFolder: (fullPath: string) => Promise<void>
  openPathInEditor: (fullPath: string, editorId?: string) => Promise<{ editor: string }>
  listAvailableEditors: () => Promise<AvailableEditor[]>
  openPathInTerminal: (fullPath: string) => Promise<{ terminal: string }>
  getCradleDataPaths: () => Promise<{
    userDataPath: string
    serverDataPath: string
    databasePath: string
    serverLogPath: string
    serverDataSource: 'default' | 'custom'
    migration: {
      phase: string
      sourceRoot: string | null
      targetRoot: string | null
      backupRoot: string | null
      errorMessage: string | null
    }
  }>
  chooseCradleDataDirectory: () => Promise<{ canceled: boolean, filePath?: string }>
  scheduleCradleDataDirectoryMigration: (targetPath: string) => Promise<{
    scheduled: boolean
    targetPath: string
    restartRequired: true
  }>
  getCradleDataMigrationStatus: () => Promise<{
    phase: string
    sourceRoot: string | null
    targetRoot: string | null
    backupRoot: string | null
    errorMessage: string | null
  }>
  getDesktopCliStatus: () => Promise<DesktopCliStatus>
  installDesktopCliCommand: () => Promise<DesktopCliStatus>
  removeDesktopCliCommand: () => Promise<DesktopCliStatus>
  setDesktopPreferences: (preferences: DesktopPreferences) => Promise<DesktopPreferences>
}

export interface NativeAuthCapability {
  supported: boolean
  method: 'local-authentication' | null
  reason: 'available' | 'unsupported-platform' | 'unavailable'
}

export interface NativeAuthAuthenticateResult {
  status: 'authenticated' | 'unsupported' | 'canceled' | 'failed'
  method: 'local-authentication' | null
  message?: string
}

interface NativeAuthServiceMethods {
  getCapability: () => Promise<NativeAuthCapability>
  authenticate: (options?: { reason?: string }) => Promise<NativeAuthAuthenticateResult>
}

export interface DesktopCliStatus {
  supported: boolean
  installed: boolean
  linked: boolean
  requiresRepair: boolean
  commandPath: string
  sourcePath: string | null
  errorMessage: string | null
}

export interface DesktopPreferences {
  requireDoubleCommandQToQuit: boolean
  appshotHotkeyEnabled: boolean
  appshotHotkeyTrigger: MacInputBareModifier
  autoCheckForUpdates: boolean
  autoDownloadUpdates: boolean
  externalTerminalApp: string | null
}

interface WindowServiceMethods {
  tearOffSurface: (surfaceId: string, route: SurfaceRoute, screenX: number, screenY: number) => Promise<void>
  focusSurface: (surfaceId: string) => Promise<boolean>
  closeSurface: (surfaceId: string) => Promise<void>
  getOpenSurfaces: () => Promise<string[]>
  startPointerMonitor: () => Promise<void>
  stopPointerMonitor: () => Promise<void>
  focusCurrent: () => Promise<boolean>
  setTitleBarOverlay: (input: WindowTitleBarOverlayInput) => Promise<void>
  close: () => Promise<void>
}

export interface DesktopUpdateFile {
  url: string
  size: number | null
  sha512: string | null
}

export interface DesktopUpdateInfo {
  version: string
  releaseName: string | null
  releaseNotes: string | null
  releaseDate: string | null
  files: DesktopUpdateFile[]
}

export interface DesktopUpdateStatus {
  unsupported: boolean
  currentVersion: string
  isCheckingForUpdates: boolean
  isPreparingUpdate: boolean
  updateDownloaded: boolean
  updateInfo: DesktopUpdateInfo | null
  errorMessage: string | null
}

interface DesktopUpdateServiceMethods {
  getStatus: () => Promise<DesktopUpdateStatus>
  checkForUpdates: () => Promise<DesktopUpdateStatus>
  downloadUpdate: () => Promise<DesktopUpdateStatus>
  applyUpdate: () => Promise<void>
}

export type BrowserTabScriptRunAt = 'document-start' | 'document-end' | 'document-idle'

export interface BrowserTabScriptPayload {
  id: string
  label?: string
  runAt: BrowserTabScriptRunAt
  source: string
}

interface BrowserTabScriptsServiceMethods {
  setScripts: (input: {
    webContentsId: number
    scripts: BrowserTabScriptPayload[]
  }) => Promise<{ scriptIds: string[] }>
  runScript: (input: {
    webContentsId: number
    script: BrowserTabScriptPayload
  }) => Promise<{ result: unknown }>
  clearScripts: (input: {
    webContentsId: number
  }) => Promise<void>
}

export interface MacBridgeRuntimeStatus {
  available: boolean
  running: boolean
  platform: 'darwin' | 'win32' | 'linux' | string
  binaryPath: string | null
  pid: number | null
  startedAt: string | null
  lastError: string | null
}

export interface MacPermissionsStatus {
  accessibility: 'granted' | 'denied' | 'notDetermined' | 'unsupported' | 'unknown'
  screenRecording: 'granted' | 'denied' | 'notDetermined' | 'unsupported' | 'unknown'
  inputMonitoring: 'granted' | 'denied' | 'notDetermined' | 'unsupported' | 'unknown'
}

export type MacPermissionKind = 'accessibility' | 'screenRecording' | 'inputMonitoring'

export type MacPermissionSettingsTarget
  = | 'privacy'
    | 'accessibility'
    | 'screenRecording'
    | 'inputMonitoring'

export interface MacPermissionsRequestResult {
  requested: MacPermissionKind[]
  status: MacPermissionsStatus
}

export interface MacPermissionSettingsResult {
  target: MacPermissionSettingsTarget
  url: string
  opened: boolean
}

export type MacInputBareModifier = 'DoubleCommand' | 'DoubleOption' | 'DoubleShift'

export interface MacCaptureResponse {
  capture: {
    filePath: string
    metadataPath: string
    capturedAt: string
    captureBackend?: 'screen-capture-kit' | 'screencapture-fallback' | 'screencapture'
    captureImageSize?: {
      pixelWidth: number
      pixelHeight: number
    } | null
    screenCaptureKitError?: unknown
    window: {
      windowId: number
      appName: string | null
      bundleId: string | null
      appIconDataUrl?: string | null
      axTree?: string | null
      processId: number
      title: string | null
      bounds: {
        x: number
        y: number
        width: number
        height: number
      } | null
    }
  }
  sink: {
    sink: 'file' | 'clipboard' | 'cleanshot'
    ok: boolean
    message: string | null
  }
}

export interface MacCaptureWindowTarget {
  windowId: number
  processId?: number
  bundleId?: string
}

export interface MacAppshotAnimationTarget {
  coordinateSpace?: 'viewportPixels' | 'screenPoints' | 'pixels'
  codexDisplay: {
    id: number
    scaleFactor: number
    bounds: {
      x: number
      y: number
      width: number
      height: number
    }
    workArea: {
      x: number
      y: number
      width: number
      height: number
    }
  }
  destinationBackgroundColor: string
  destinationCornerRadius: number
  destinationFrame: {
    x: number
    y: number
    width: number
    height: number
  }
  destinationPrimaryTextColor: string
  transitionSnapshotScale?: number
}

export interface MacAppshotFrontmostContext {
  window: MacCaptureResponse['capture']['window']
  bundleIdentifier: string | null
  animationTarget: MacAppshotAnimationTarget
}

export interface MacAppshotHotkeyEvent {
  trigger: MacInputBareModifier
  capturedAt: string
  targetWindow?: MacCaptureWindowTarget
  sourceWindow?: MacCaptureResponse['capture']['window']
  bundleIdentifier?: string | null
  context?: MacAppshotFrontmostContext
}

export interface MacAppshotImageAsset {
  path: string
  dataURL: string
  mimeType: 'image/png' | 'image/jpeg'
}

export interface MacCradleAppshotCaptureResponse {
  strategy: 'cradle-native'
  capture: MacCaptureResponse['capture'] & {
    appshot: {
      strategy: 'cradle-native'
      animationDuration: number
      transitionSnapshotPath: string | null
      transitionSnapshotHeight: number | null
      transitionSnapshotImageSize?: {
        pixelWidth: number
        pixelHeight: number
      } | null
      transitionSpringDampingFraction: number | null
      transitionSpringResponse: number | null
      transitionGeometry?: Record<string, unknown>
    }
  }
  asset: MacAppshotImageAsset | null
  transitionSnapshotAsset: MacAppshotImageAsset | null
  sink: MacCaptureResponse['sink']
}

export type MacAppshotCaptureResponse = MacCradleAppshotCaptureResponse

export interface MacCodexAppshotObservedAsset extends MacAppshotImageAsset {
  relativePath: string
  size: number
  modifiedAtMs: number
  sha256: string
}

export interface MacCodexAppshotObserveResponse {
  rootPath: string
  startedAtMs: number
  durationMs: number
  assets: MacCodexAppshotObservedAsset[]
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

interface MacCaptureServiceMethods {
  getStatus: () => Promise<MacBridgeRuntimeStatus>
  getPermissions: () => Promise<MacPermissionsStatus>
  requestPermissions: (options?: { permissions?: MacPermissionKind[] }) => Promise<MacPermissionsRequestResult>
  openPermissionSettings: (options?: { target?: MacPermissionSettingsTarget }) => Promise<MacPermissionSettingsResult>
  configureBothCommandHotkey: (enabled: boolean) => Promise<{ trigger: 'DoubleCommand', enabled: boolean }>
  captureFrontmostWindow: (options?: {
    sink?: 'file' | 'clipboard' | 'cleanshot'
    targetWindow?: MacCaptureWindowTarget
    privacySensitiveAppBundleIds?: string[]
    privacySensitiveTitlePatterns?: string[]
  }) => Promise<MacCaptureResponse>
  captureAppshot: (options?: {
    sink?: 'file' | 'clipboard' | 'cleanshot'
    strategy?: 'cradle-native'
    targetWindow?: MacCaptureWindowTarget
    animationTarget?: MacAppshotAnimationTarget
    animationDuration?: number
    requestId?: string
    soundEnabled?: boolean
    transitionSnapshotHeight?: number
    transitionSpringDampingFraction?: number
    transitionSpringResponse?: number
    privacySensitiveAppBundleIds?: string[]
    privacySensitiveTitlePatterns?: string[]
  }) => Promise<MacAppshotCaptureResponse>
  captureAppshotParityProbe: (options?: {
    sink?: 'file' | 'clipboard' | 'cleanshot'
    targetWindow?: MacCaptureWindowTarget
    soundEnabled?: boolean
    animationTarget?: MacAppshotAnimationTarget
    privacySensitiveAppBundleIds?: string[]
    privacySensitiveTitlePatterns?: string[]
  }) => Promise<MacAppshotParityProbeResponse>
  observeCodexAppshotAssets: (options?: {
    durationMs?: number
    pollIntervalMs?: number
    baselinePaths?: string[]
    startedAtMs?: number
  }) => Promise<MacCodexAppshotObserveResponse>
  getAppshotFrontmostContext: () => Promise<MacAppshotFrontmostContext>
}

interface CradleIpcServices {
  native: NativeServiceMethods
  nativeAuth: NativeAuthServiceMethods
  window: WindowServiceMethods
  desktopUpdate: DesktopUpdateServiceMethods
  browserTabScripts: BrowserTabScriptsServiceMethods
  macCapture: MacCaptureServiceMethods
}

/**
 * Typed IPC proxy for native services.
 * Returns null when not in Electron.
 */
export const nativeIpc = createIpcProxy<CradleIpcServices>(
  window.cradle?.ipc ?? null,
)

let lastSyncedWindowControlsOverlay: string | null = null

const RGB_COLOR_RE = /^rgba?\(\s*(\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(\d+(?:\.\d+)?)/
const SRGB_COLOR_RE = /^color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/

function readWindowControlsOverlayColors(): WindowTitleBarOverlayInput | null {
  if (typeof document === 'undefined') {
    return null
  }

  const probe = document.createElement('span')
  probe.style.position = 'fixed'
  probe.style.pointerEvents = 'none'
  probe.style.visibility = 'hidden'
  probe.style.backgroundColor = 'var(--sidebar)'
  probe.style.color = 'var(--foreground)'

  document.documentElement.append(probe)
  const computed = window.getComputedStyle(probe)
  const color = normalizeCssColor(computed.backgroundColor.trim())
  const symbolColor = normalizeCssColor(computed.color.trim())
  probe.remove()

  return color && symbolColor ? { color, symbolColor } : null
}

function normalizeCssColor(computed: string): string | null {
  const rgbMatch = computed.match(RGB_COLOR_RE)
  if (rgbMatch) {
    return formatHexColor(
      Number(rgbMatch[1]),
      Number(rgbMatch[2]),
      Number(rgbMatch[3]),
    )
  }

  const srgbMatch = computed.match(SRGB_COLOR_RE)
  if (srgbMatch) {
    return formatHexColor(
      Number(srgbMatch[1]) * 255,
      Number(srgbMatch[2]) * 255,
      Number(srgbMatch[3]) * 255,
    )
  }

  return computed.startsWith('#') ? computed : null
}

function formatHexColor(red: number, green: number, blue: number): string {
  const channels = [red, green, blue].map(channel =>
    Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16)
      .padStart(2, '0'))
  return `#${channels.join('')}`
}

export function syncDesktopWindowControlsOverlay(): void {
  if (!isElectron || !nativeIpc) {
    return
  }

  window.requestAnimationFrame(() => {
    const overlayColors = readWindowControlsOverlayColors()
    if (!overlayColors) {
      return
    }

    const syncKey = `${overlayColors.color}:${overlayColors.symbolColor}`
    if (syncKey === lastSyncedWindowControlsOverlay) {
      return
    }
    lastSyncedWindowControlsOverlay = syncKey

    void nativeIpc.window.setTitleBarOverlay(overlayColors).catch(() => {
      lastSyncedWindowControlsOverlay = null
    })
  })
}

export interface DangerousActionAuthorizationOptions {
  action: 'delete' | 'remove'
  resource: string
  label?: string | null
  enabled?: boolean
}

function buildDangerousActionReason(options: DangerousActionAuthorizationOptions): string {
  const resource = options.resource.trim() || 'item'
  const label = typeof options.label === 'string' && options.label.trim().length > 0
    ? ` "${options.label.trim()}"`
    : ''
  return `Confirm ${options.action} ${resource}${label} in Cradle.`
}

export async function authorizeDangerousAction(
  options: DangerousActionAuthorizationOptions,
): Promise<boolean> {
  if (options.enabled !== true || !isElectron || !nativeIpc) {
    return true
  }

  const result = await nativeIpc.nativeAuth.authenticate({
    reason: buildDangerousActionReason(options),
  })
  return result.status === 'authenticated' || result.status === 'unsupported'
}

export function subscribeDesktopUpdateStatus(
  handler: (status: DesktopUpdateStatus) => void,
): () => void {
  return window.cradle?.desktopUpdate.onStatusChanged((status) => {
    handler(status as DesktopUpdateStatus)
  }) ?? (() => {})
}

export function subscribeDesktopQuitGuardArmed(
  handler: (event: { expiresAt: number }) => void,
): () => void {
  return window.cradle?.ipc.on('desktop:quit-guard-armed', (payload) => {
    if (
      typeof payload === 'object'
      && payload !== null
      && typeof (payload as { expiresAt?: unknown }).expiresAt === 'number'
    ) {
      handler(payload as { expiresAt: number })
    }
  }) ?? (() => {})
}

export function subscribeTearoffSurfaceClosed(
  handler: (surfaceId: string) => void,
): () => void {
  return window.cradle?.window.onTearoffSurfaceClosed(handler) ?? (() => {})
}

export function subscribePointerOutsideWindow(
  handler: (screenX: number, screenY: number) => void,
): () => void {
  return window.cradle?.window.onPointerOutsideWindow(handler) ?? (() => {})
}
