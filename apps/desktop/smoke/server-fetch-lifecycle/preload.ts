import { contextBridge, ipcRenderer } from 'electron'

import { createDesktopServerFetchBridge } from '../../src/preload/server-fetch'

const bridge = createDesktopServerFetchBridge(ipcRenderer)

contextBridge.exposeInMainWorld('serverFetchSmoke', {
  openAll: (iteration: number) => Promise.all([
    { name: 'finite', path: `/large?iteration=${iteration}`, stream: false },
    { name: 'workspace', path: '/workspaces/smoke/files/events', stream: true },
    { name: 'plugins', path: '/plugins/dev-sessions/events', stream: true },
    { name: 'downloads', path: '/download-center/events', stream: true },
  ].map(request => bridge.open({
    requestId: `${request.name}-${iteration}`,
    generation: 1,
    method: 'GET',
    path: request.path,
    headers: request.stream ? [['accept', 'text/event-stream']] : [],
    body: null,
  }))),
})
