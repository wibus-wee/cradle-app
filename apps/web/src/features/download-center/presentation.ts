import type { DownloadTask } from './types'

/** Failed downloads return to their owning flow; the Download Center never retries itself. */
export function retryOwner(task: DownloadTask): 'chronicle' | 'desktop' | null {
  if (task.owner.namespace === 'chronicle') {
    return 'chronicle'
  }
  if (task.owner.namespace === 'desktop-update') {
    return 'desktop'
  }
  return null
}

/** Do not project raw transport errors (URLs, paths, retry details, or stacks) into chrome. */
export function downloadStatusKey(task: DownloadTask):
  | 'download.status.cancelled'
  | 'download.status.completed'
  | 'download.status.downloading'
  | 'download.status.failed'
  | 'download.status.queued'
  | 'download.status.verifying' {
  const keys = {
    cancelled: 'download.status.cancelled',
    completed: 'download.status.completed',
    downloading: 'download.status.downloading',
    failed: 'download.status.failed',
    queued: 'download.status.queued',
    verifying: 'download.status.verifying',
  } as const
  return keys[task.status]
}

export function downloadErrorKey(task: DownloadTask): 'download.error.cancelled' | 'download.error.network' | 'download.error.storage' | 'download.error.integrity' | 'download.error.general' {
  switch (task.error?.code) {
    case 'cancelled': return 'download.error.cancelled'
    case 'filesystem_error': return 'download.error.storage'
    case 'size_mismatch':
    case 'checksum_mismatch': return 'download.error.integrity'
    case 'timeout':
    case 'network_error':
    case 'http_client_error':
    case 'http_server_error':
    case 'redirect_error':
    case 'invalid_response':
    case 'updater_error': return 'download.error.network'
    default: return 'download.error.general'
  }
}
