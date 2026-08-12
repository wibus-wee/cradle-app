import { contextBridge, ipcRenderer } from 'electron'

import type { M0MemoryTrace, M0RendererDiagnostics, M0RendererReport } from './result-schema'

const api = {
  platform: process.platform,
  arch: process.arch,
  startMemoryTrace: (label: '64MiB' | '128MiB') => ipcRenderer.invoke('m0:memory:start', label) as Promise<void>,
  stopMemoryTrace: () => ipcRenderer.invoke('m0:memory:stop') as Promise<M0MemoryTrace>,
  diagnostics: () => ipcRenderer.invoke('m0:diagnostics') as Promise<M0RendererDiagnostics>,
  complete: (report: M0RendererReport) => ipcRenderer.send('m0:complete', report),
}

contextBridge.exposeInMainWorld('m0', api)

export type M0PreloadApi = typeof api
