import type { Disposable, Logger, PluginManifest } from './index'

export type { Disposable, Logger, PluginManifest } from './index'

/** Desktop plugin context — provided by Electron main process host */
export interface DesktopPluginContext {
  /** Electron userData path */
  userDataPath: string

  /** Electron webview lifecycle registrations */
  webviews: DesktopPluginWebviewRegistry

  /** Browser panel tab bridge */
  browserTabs: DesktopPluginBrowserTabBridge

  /** Shared config bus — values propagated to server via env vars */
  sharedConfig: DesktopPluginSharedConfigRegistry

  /** Disposables that the host releases when this plugin layer deactivates */
  subscriptions: Disposable[]

  /** Plugin-scoped logger */
  logger: Logger

  /** Plugin manifest metadata */
  manifest: PluginManifest
}

export interface DesktopPluginWebviewRegistry {
  /** Listen for webview creation through the host-owned webview facade. */
  onCreated: (handler: (webview: DesktopWebview, tabId: string) => void) => Disposable
}

export interface DesktopWebview {
  /** Host renderer tab id associated with this webview. */
  readonly tabId: string
  /** Whether the underlying webview has already been destroyed. */
  isDestroyed: () => boolean
  /** Navigate the webview. */
  navigate: (url: string) => Promise<void>
  /** Current webview URL. */
  getUrl: () => string
  /** Current webview title. */
  getTitle: () => string
  /** Capture the current visible page as PNG bytes. */
  capturePng: () => Promise<Uint8Array>
  /** Close the webview. */
  close: () => void
  /** Subscribe to webview destruction. */
  onDestroyed: (handler: () => void) => Disposable
  /** Chrome DevTools Protocol session for browser automation plugins. */
  cdp: DesktopWebviewCdpSession
}

export interface DesktopWebviewCdpSession {
  /** Attach the Chrome DevTools Protocol debugger. */
  attach: (protocolVersion?: string) => void
  /** Detach the Chrome DevTools Protocol debugger. */
  detach: () => void
  /** Send a Chrome DevTools Protocol command. */
  sendCommand: <T = unknown>(command: string, params?: Record<string, unknown>) => Promise<T>
  /** Subscribe to debugger detach notifications. */
  onDetached: (handler: (reason: string) => void) => Disposable
}

export interface DesktopPluginBrowserTabBridge {
  /** Ask the active renderer to create a visible browser panel tab */
  request: (url?: string) => Promise<string | undefined>
  /** Ask the active renderer to show a browser panel tab */
  activate: (tabId: string) => Promise<boolean>
  /** Ask the active renderer to hide the browser panel without closing tabs */
  goOffScreen: (tabId?: string) => Promise<boolean>
  /** Ask the active renderer which browser panel tab is visible */
  getActive: () => Promise<string | undefined>
}

export interface DesktopPluginSharedConfigRegistry {
  /** Write to shared config bus — values propagated to server via env vars */
  set: (key: string, value: string) => void
}

/** Desktop plugin module shape */
export interface DesktopPlugin {
  activate: (ctx: DesktopPluginContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
}
