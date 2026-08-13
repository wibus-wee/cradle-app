import type { IpcRenderer } from 'electron'

import type {
  DesktopServerFetchChunk,
  DesktopServerFetchErrorEvent,
  DesktopServerFetchRequest,
  DesktopServerFetchResponseHead,
  DesktopServerFetchTerminalEvent,
} from '../shared/server-fetch-transport'
import {
  DESKTOP_SERVER_FETCH_CANCEL_CHANNEL,
  DESKTOP_SERVER_FETCH_CHUNK_CHANNEL,
  DESKTOP_SERVER_FETCH_CLOSED_CHANNEL,
  DESKTOP_SERVER_FETCH_CREDIT_CHANNEL,
  DESKTOP_SERVER_FETCH_ERROR_CHANNEL,
  DESKTOP_SERVER_FETCH_OPEN_CHANNEL,
} from '../shared/server-fetch-transport'

type ServerFetchIpcRenderer = Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener' | 'send'>

export function createDesktopServerFetchBridge(ipcRenderer: ServerFetchIpcRenderer) {
  function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }

  return {
    open: (request: DesktopServerFetchRequest) =>
      ipcRenderer.invoke(
        DESKTOP_SERVER_FETCH_OPEN_CHANNEL,
        request,
      ) as Promise<DesktopServerFetchResponseHead>,
    credit: (requestId: string, credit: number) =>
      ipcRenderer.send(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL, requestId, credit),
    cancel: (requestId: string) =>
      ipcRenderer.send(DESKTOP_SERVER_FETCH_CANCEL_CHANNEL, requestId),
    onChunk: (handler: (event: DesktopServerFetchChunk) => void) =>
      subscribe(DESKTOP_SERVER_FETCH_CHUNK_CHANNEL, handler),
    onClosed: (handler: (event: DesktopServerFetchTerminalEvent) => void) =>
      subscribe(DESKTOP_SERVER_FETCH_CLOSED_CHANNEL, handler),
    onError: (handler: (event: DesktopServerFetchErrorEvent) => void) =>
      subscribe(DESKTOP_SERVER_FETCH_ERROR_CHANNEL, handler),
  }
}

export type DesktopServerFetchBridge = ReturnType<typeof createDesktopServerFetchBridge>
