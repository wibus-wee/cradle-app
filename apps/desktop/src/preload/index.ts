import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { DownloadTaskView } from '@cradle/download-center'
import { contextBridge, ipcRenderer } from 'electron'

import { browserSessionPartition } from '../shared/browser-session'
import type { DesktopServerStatus } from '../shared/server-runtime'
import {
  DESKTOP_SERVER_STATUS_CHANGED_CHANNEL,
  DESKTOP_SERVER_STATUS_GET_CHANNEL,
} from '../shared/server-runtime'
import { resolveWindowControlsSafeArea } from '../shared/window-controls-safe-area'

// Parse --server-url, --surface and --surface-route from additionalArguments
function getArg(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(a => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}

function parseSurfaceRoute(raw: string | null): unknown | null {
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw)
  }
  catch {
    return null
  }
}

const serverUrl = getArg('server-url') ?? 'http://127.0.0.1:21423'
const serverAuthToken = getArg('server-auth-token')
const sessionId = getArg('session-id')
const isTearoff = getArg('tearoff') === 'true'
const surface = getArg('surface')
const surfaceRoute = parseSurfaceRoute(getArg('surface-route'))

const CHAT_STREAM_CHUNK_CHANNEL = 'chat-stream:chunk'
const CHAT_STREAM_CLOSED_CHANNEL = 'chat-stream:closed'
const CHAT_STREAM_ERROR_CHANNEL = 'chat-stream:error'
const CHAT_EVENT_TAIL_EVENT_CHANNEL = 'chat-event-tail:event'
const CHAT_EVENT_TAIL_CLOSED_CHANNEL = 'chat-event-tail:closed'
const CHAT_EVENT_TAIL_ERROR_CHANNEL = 'chat-event-tail:error'
const BROWSER_STATE_CHANNEL = 'desktop:browser-state'
const BROWSER_PROMPT_REQUESTED_CHANNEL = 'desktop:browser-prompt-requested'
const BROWSER_ANNOTATION_RUNTIME_EVENTED_CHANNEL = 'desktop:browser-annotation-runtime-evented'
const DOWNLOAD_CENTER_TASK_CHANGED_CHANNEL = 'download-center:task-changed'

const IPC_DEVTOOL_EVENT_CHANNEL = 'ipc-devtool:event'
const IPC_DEVTOOL_ACP_EVENT_CHANNEL = 'ipc-devtool:acp-event'

function subscribeIpc<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// Expose a minimal, typesafe API to the renderer
const cradleElectron = {
  /** IPC invoke — matches the InvokableIpc interface from @cradle/ipc/client */
  ipc: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
    on: (channel: string, handler: (...args: unknown[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => handler(...args)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
  },

  /** Environment info */
  env: {
    serverUrl,
    serverAuthToken,
    sessionId,
    isTearoff,
    surface,
    surfaceRoute,
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    isElectron: true as const,
    windowControlsSafeArea: resolveWindowControlsSafeArea(process.platform),
  },

  /** Window controls (for custom titlebar if needed) */
  window: {
    minimize: () => ipcRenderer.invoke('window.minimize'),
    maximize: () => ipcRenderer.invoke('window.maximize'),
    close: () => ipcRenderer.invoke('window.close'),
    startPointerMonitor: () => ipcRenderer.invoke('window.startPointerMonitor'),
    stopPointerMonitor: () => ipcRenderer.invoke('window.stopPointerMonitor'),
    onTearoffSurfaceClosed: (handler: (surfaceId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, surfaceId: string) => handler(surfaceId)
      ipcRenderer.on('window:tearoff-surface-closed', listener)
      return () => {
        ipcRenderer.removeListener('window:tearoff-surface-closed', listener)
      }
    },
    onPointerOutsideWindow: (handler: (screenX: number, screenY: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, screenX: number, screenY: number) =>
        handler(screenX, screenY)
      ipcRenderer.on('window:pointer-outside-window', listener)
      return () => {
        ipcRenderer.removeListener('window:pointer-outside-window', listener)
      }
    },
  },

  /** Desktop update status events pushed by the main process */
  desktopUpdate: {
    onStatusChanged: (handler: (status: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown) => handler(status)
      ipcRenderer.on('desktop-update:status-changed', listener)
      return () => {
        ipcRenderer.removeListener('desktop-update:status-changed', listener)
      }
    },
  },

  /** Redacted desktop-owned download task status. */
  downloadCenter: {
    list: () => ipcRenderer.invoke('downloadCenter.list') as Promise<DownloadTaskView[]>,
    get: (taskId: string) => ipcRenderer.invoke('downloadCenter.get', taskId) as Promise<DownloadTaskView | null>,
    cancel: (taskId: string) => ipcRenderer.invoke('downloadCenter.cancel', taskId) as Promise<DownloadTaskView | null>,
    onTaskChanged: (handler: (task: DownloadTaskView) => void) =>
      subscribeIpc(DOWNLOAD_CENTER_TASK_CHANGED_CHANNEL, handler),
  },

  /** Desktop-owned server lifecycle facts for renderer bootstrap. */
  serverRuntime: {
    getStatus: () => ipcRenderer.invoke(DESKTOP_SERVER_STATUS_GET_CHANNEL) as Promise<DesktopServerStatus>,
    onStatusChanged: (handler: (status: DesktopServerStatus) => void) =>
      subscribeIpc(DESKTOP_SERVER_STATUS_CHANGED_CHANNEL, handler),
  },

  /** Desktop app icon badge bridge */
  desktopAppBadge: {
    setUnreadCount: (count: number) =>
      ipcRenderer.invoke('desktop-app-badge:set-unread-count', count),
  },

  /** Desktop plugin source sync bridge */
  plugins: {
    syncSource: (sourceId: string) => ipcRenderer.invoke('desktop:plugins-sync-source', sourceId),
    unsyncSource: (pluginName: string) => ipcRenderer.invoke('desktop:plugins-unsync-source', pluginName),
  },

  /** Desktop-owned long-lived chat stream bridge */
  chatStream: {
    startResponse: (request: unknown) => ipcRenderer.invoke('chatStream.startResponse', request),
    subscribeSession: (request: unknown) =>
      ipcRenderer.invoke('chatStream.subscribeSession', request),
    abort: (request: unknown) => ipcRenderer.invoke('chatStream.abort', request),
    diagnostics: () => ipcRenderer.invoke('chatStream.diagnostics'),
    onChunk: (handler: (event: unknown) => void) =>
      subscribeIpc(CHAT_STREAM_CHUNK_CHANNEL, handler),
    onClosed: (handler: (event: unknown) => void) =>
      subscribeIpc(CHAT_STREAM_CLOSED_CHANNEL, handler),
    onError: (handler: (event: unknown) => void) => subscribeIpc(CHAT_STREAM_ERROR_CHANNEL, handler),
  },

  /** Desktop-owned chat event tail bridge */
  chatEventTail: {
    subscribeSessionEvents: (request: unknown) =>
      ipcRenderer.invoke('chatEventTail.subscribeSessionEvents', request),
    subscribeGlobalSessionEvents: (request: unknown) =>
      ipcRenderer.invoke('chatEventTail.subscribeGlobalSessionEvents', request),
    abort: (request: unknown) => ipcRenderer.invoke('chatEventTail.abort', request),
    diagnostics: () => ipcRenderer.invoke('chatEventTail.diagnostics'),
    onEvent: (handler: (event: unknown) => void) =>
      subscribeIpc(CHAT_EVENT_TAIL_EVENT_CHANNEL, handler),
    onClosed: (handler: (event: unknown) => void) =>
      subscribeIpc(CHAT_EVENT_TAIL_CLOSED_CHANNEL, handler),
    onError: (handler: (event: unknown) => void) =>
      subscribeIpc(CHAT_EVENT_TAIL_ERROR_CHANNEL, handler),
  },

  /** Native BrowserPanel bridge backed by Electron WebContentsView. */
  browser: {
    getWebviewConfig: (input: { threadId: string }) => ({
      partition: browserSessionPartition(input.threadId),
      preloadUrl: pathToFileURL(path.join(__dirname, 'browser-panel.js')).toString(),
    }),
    open: (input: unknown) => ipcRenderer.invoke('desktop:browser-open', input),
    close: (input: unknown) => ipcRenderer.invoke('desktop:browser-close', input),
    hide: (input: unknown) => ipcRenderer.invoke('desktop:browser-hide', input),
    getState: (input: unknown) => ipcRenderer.invoke('desktop:browser-get-state', input),
    setBounds: (input: unknown) => ipcRenderer.send('desktop:browser-set-bounds', input),
    attachWebview: (input: unknown) => ipcRenderer.invoke('desktop:browser-attach-webview', input),
    detachWebview: (input: unknown) => ipcRenderer.invoke('desktop:browser-detach-webview', input),
    captureScreenshot: (input: unknown) =>
      ipcRenderer.invoke('desktop:browser-capture-screenshot', input),
    copyScreenshotToClipboard: (input: unknown) =>
      ipcRenderer.invoke('desktop:browser-copy-screenshot-to-clipboard', input),
    applyAnnotationDesign: (input: unknown) =>
      ipcRenderer.invoke('desktop:browser-apply-annotation-design', input),
    clearAnnotationDesign: (input: unknown) =>
      ipcRenderer.invoke('desktop:browser-clear-annotation-design', input),
    startAnnotationRuntime: (input: unknown) =>
      ipcRenderer.invoke('desktop:browser-start-annotation-runtime', input),
    stopAnnotationRuntime: (input: unknown) =>
      ipcRenderer.invoke('desktop:browser-stop-annotation-runtime', input),
    notifyAnnotationRuntime: (input: unknown) =>
      ipcRenderer.invoke('desktop:browser-notify-annotation-runtime', input),
    executeCdp: (input: unknown) => ipcRenderer.invoke('desktop:browser-execute-cdp', input),
    discoverLocalServers: () => ipcRenderer.invoke('desktop:browser-discover-local-servers'),
    navigate: (input: unknown) => ipcRenderer.invoke('desktop:browser-navigate', input),
    reload: (input: unknown) => ipcRenderer.invoke('desktop:browser-reload', input),
    goBack: (input: unknown) => ipcRenderer.invoke('desktop:browser-go-back', input),
    goForward: (input: unknown) => ipcRenderer.invoke('desktop:browser-go-forward', input),
    newTab: (input: unknown) => ipcRenderer.invoke('desktop:browser-new-tab', input),
    closeTab: (input: unknown) => ipcRenderer.invoke('desktop:browser-close-tab', input),
    selectTab: (input: unknown) => ipcRenderer.invoke('desktop:browser-select-tab', input),
    openDevTools: (input: unknown) => ipcRenderer.invoke('desktop:browser-open-devtools', input),
    onState: (handler: (state: unknown) => void) => subscribeIpc(BROWSER_STATE_CHANNEL, handler),
    onPromptRequested: (handler: (request: unknown) => void) =>
      subscribeIpc(BROWSER_PROMPT_REQUESTED_CHANNEL, handler),
    onAnnotationRuntimeEvent: (handler: (event: unknown) => void) =>
      subscribeIpc(BROWSER_ANNOTATION_RUNTIME_EVENTED_CHANNEL, handler),
  },

  /** Desktop tray action bridge */
  desktopTray: {
    performAction: (actionId: string, payload?: unknown) =>
      ipcRenderer.invoke('desktop-tray:perform-action', actionId, payload),
    consumePendingActionRequests: () => ipcRenderer.invoke('desktop-tray:consume-pending-actions'),
    onActionRequested: (handler: (request: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: unknown) => handler(request)
      ipcRenderer.on('desktop-tray:action-requested', listener)
      return () => {
        ipcRenderer.removeListener('desktop-tray:action-requested', listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('cradle', cradleElectron)

const ipcDevtool = {
  getSnapshot: () => ipcRenderer.invoke('ipcDevtool.getSnapshot'),
  clear: () => ipcRenderer.invoke('ipcDevtool.clear'),
  onEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(IPC_DEVTOOL_EVENT_CHANNEL, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_DEVTOOL_EVENT_CHANNEL, wrapped)
    }
  },
  getAcpSnapshot: () => ipcRenderer.invoke('ipcDevtool.getAcpSnapshot'),
  clearAcp: () => ipcRenderer.invoke('ipcDevtool.clearAcp'),
  onAcpEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(IPC_DEVTOOL_ACP_EVENT_CHANNEL, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_DEVTOOL_ACP_EVENT_CHANNEL, wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('ipcDevtool', ipcDevtool)

// Type declaration for renderer access
export type CradleElectronAPI = typeof cradleElectron
