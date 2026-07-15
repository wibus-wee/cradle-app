import type { DownloadTaskView } from '@cradle/download-center'

/** The shared public task projection used by both server HTTP and Desktop IPC. */
export type DownloadTask = DownloadTaskView
export type DownloadStatus = DownloadTask['status']

export interface DownloadCenterSnapshot {
  tasks: readonly DownloadTask[]
  active: readonly DownloadTask[]
  recent: readonly DownloadTask[]
}

export const ACTIVE_DOWNLOAD_STATUSES: readonly DownloadStatus[] = ['queued', 'downloading', 'verifying']

export function downloadTaskKey(task: Pick<DownloadTask, 'scope' | 'taskId'>): string {
  return `${task.scope}:${task.taskId}`
}

export function isActiveDownload(task: Pick<DownloadTask, 'status'>): boolean {
  return ACTIVE_DOWNLOAD_STATUSES.includes(task.status)
}
