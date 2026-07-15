import {
  getDownloadCenterTasks,
  postDownloadCenterTasksByIdCancel,
} from '~/api-gen/sdk.gen'
import { getAuthenticatedEventSourceUrl, getServerUrl, isElectron } from '~/lib/electron'

import type { DownloadTask } from './types'

export interface DownloadCenterTransport {
  scope: DownloadTask['scope']
  list: () => Promise<readonly DownloadTask[]>
  cancel: (task: DownloadTask) => Promise<DownloadTask | null>
  subscribe: (onTask: (task: DownloadTask) => void, onReconnect: () => Promise<void>) => () => void
}

export const serverDownloadCenterTransport: DownloadCenterTransport = {
  scope: 'server',
  async list() {
    const { data } = await getDownloadCenterTasks()
    return (data ?? []) as DownloadTask[]
  },
  async cancel(task) {
    if (task.scope !== 'server') { return null }
    const { data } = await postDownloadCenterTasksByIdCancel({ path: { id: task.taskId } })
    return data as DownloadTask | null
  },
  subscribe(onTask, onReconnect) {
    let source: EventSource | null = null
    let disposed = false
    let acceptingEvents = false
    void getAuthenticatedEventSourceUrl(new URL('/download-center/events', getServerUrl()).toString()).then((url) => {
      if (disposed) { return }
      source = new EventSource(url)
      source.onmessage = (event) => {
        if (!acceptingEvents) { return }
        const task = JSON.parse(event.data) as DownloadTask
        onTask(task)
      }
      source.onopen = () => {
        acceptingEvents = false
        // A stream can replay an old event after reconnecting. Establish a fresh
        // generated-GET snapshot before accepting any subsequent event frames.
        void onReconnect().finally(() => { acceptingEvents = !disposed })
      }
      source.onerror = () => { acceptingEvents = false }
    }).catch(() => {})
    return () => {
      disposed = true
      source?.close()
    }
  },
}

type DesktopDownloadCenterBridge = NonNullable<NonNullable<Window['cradle']>['downloadCenter']>

export function createDesktopDownloadCenterTransport(bridge: DesktopDownloadCenterBridge): DownloadCenterTransport {
  return {
      scope: 'desktop',
      async list() {
        return await bridge.list()
      },
      async cancel(task) {
        if (task.scope !== 'desktop') { return null }
        const next = await bridge.cancel(task.taskId)
        return next
      },
      subscribe(onTask) {
        return bridge.onTaskChanged(onTask)
      },
  }
}

export const desktopDownloadCenterTransport: DownloadCenterTransport | null = isElectron && window.cradle?.downloadCenter
  ? createDesktopDownloadCenterTransport(window.cradle.downloadCenter)
  : null
