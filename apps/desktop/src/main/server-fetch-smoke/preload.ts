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
})
