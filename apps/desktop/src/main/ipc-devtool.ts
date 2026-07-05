// Input: @cradle/ipc observer registration, Electron ipcMain/WebContents, IpcDevtoolStore
// Output: Shared main-process IPC devtool backend — observer wiring, IPC handler registration
// Position: Main-process integration point that connects IPC instrumentation to the devtool window

import type { IpcObservedEvent } from '@cradle/ipc'
import { setIpcObserver } from '@cradle/ipc'
import type { WebContents } from 'electron'
import { ipcMain } from 'electron'

import { IpcDevtoolStore } from './ipc-devtool-store'

export const IPC_DEVTOOL_EVENT_CHANNEL = 'ipc-devtool:event'
export const IPC_DEVTOOL_ACP_EVENT_CHANNEL = 'ipc-devtool:acp-event'

const store = new IpcDevtoolStore({
  eventChannel: IPC_DEVTOOL_EVENT_CHANNEL,
  acpEventChannel: IPC_DEVTOOL_ACP_EVENT_CHANNEL,
})

let initialized = false

export function initializeIpcDevtool(): IpcDevtoolStore {
  if (initialized) {
    return store
  }
  initialized = true

  setIpcObserver((event: IpcObservedEvent) => {
    store.record(event)
  })

  ipcMain.handle('ipcDevtool.getSnapshot', () => {
    return store.getSnapshot()
  })

  ipcMain.handle('ipcDevtool.clear', () => {
    store.clear()
  })

  ipcMain.handle('ipcDevtool.getAcpSnapshot', () => {
    return store.getAcpSnapshot()
  })

  ipcMain.handle('ipcDevtool.clearAcp', () => {
    store.clearAcp()
  })

  return store
}

export function getIpcDevtoolStore(): IpcDevtoolStore {
  return store
}

export function subscribeIpcDevtool(webContents: WebContents): () => void {
  return store.subscribe(webContents)
}

export function subscribeAcpDevtool(webContents: WebContents): () => void {
  return store.subscribeAcp(webContents)
}
