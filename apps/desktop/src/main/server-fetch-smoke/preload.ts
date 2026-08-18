import { contextBridge, ipcRenderer } from 'electron'

import { createDesktopServerFetchBridge } from '../../preload/server-fetch'

contextBridge.exposeInMainWorld('cradle', {
  env: {
    isElectron: true,
    serverAuthToken: null,
    serverUrl: 'http://127.0.0.1',
  },
  serverFetch: createDesktopServerFetchBridge(ipcRenderer),
})

contextBridge.exposeInMainWorld('serverFetchSmoke', {
  complete: (result: { finite: string, stream?: string }) =>
    ipcRenderer.send('server-fetch-smoke:complete', result),
  resource: {
    getConfig: () => ipcRenderer.invoke('server-fetch-resource:get-config'),
    markPhase: (phase: string) => ipcRenderer.send('server-fetch-resource:phase', phase),
    startChat: (request: unknown) => ipcRenderer.invoke('server-fetch-resource:chat-start', request),
    complete: (result: unknown) => ipcRenderer.send('server-fetch-resource:complete', result),
    onChatChunk: (handler: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => handler(payload)
      ipcRenderer.on('chat-stream:chunk', listener)
      return () => ipcRenderer.removeListener('chat-stream:chunk', listener)
    },
    onChatClosed: (handler: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => handler(payload)
      ipcRenderer.on('chat-stream:closed', listener)
      return () => ipcRenderer.removeListener('chat-stream:closed', listener)
    },
    onChatError: (handler: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => handler(payload)
      ipcRenderer.on('chat-stream:error', listener)
      return () => ipcRenderer.removeListener('chat-stream:error', listener)
    },
  },
})
