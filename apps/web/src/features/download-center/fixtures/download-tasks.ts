import type { DownloadTask } from '../types'

const BASE_TASK: DownloadTask = {
  taskId: 'download-1',
  scope: 'server',
  owner: {
    namespace: 'chronicle',
    resourceType: 'model-resource',
    resourceId: 'whisper-large-v3',
    displayName: 'Whisper Large v3',
  },
  fileName: 'whisper-large-v3.bin',
  sourceId: 'hugging-face',
  status: 'queued',
  transferredBytes: 0,
  totalBytes: 1_640_000_000,
  attempts: 1,
  maxAttempts: 3,
  error: null,
  result: null,
  createdAt: '2026-07-23T10:00:00.000Z',
  updatedAt: '2026-07-23T10:00:00.000Z',
  startedAt: null,
  finishedAt: null,
}

function task(
  status: DownloadTask['status'],
  overrides: Partial<DownloadTask>,
): DownloadTask {
  return {
    ...BASE_TASK,
    taskId: `download-${status}`,
    status,
    ...overrides,
  }
}

export const queuedDownloadTask = task('queued', {
  owner: { ...BASE_TASK.owner, displayName: 'Codex runtime' },
  fileName: 'codex-runtime.tar.gz',
  totalBytes: null,
})

export const activeDownloadTask = task('downloading', {
  transferredBytes: 728_000_000,
  startedAt: '2026-07-23T10:00:03.000Z',
})

export const verifyingDownloadTask = task('verifying', {
  transferredBytes: 1_640_000_000,
  startedAt: '2026-07-23T10:00:03.000Z',
})

export const completedDownloadTask = task('completed', {
  scope: 'desktop',
  owner: {
    namespace: 'desktop-update',
    resourceType: 'application',
    resourceId: 'cradle',
    displayName: 'Cradle 0.20.0',
  },
  fileName: 'Cradle-0.20.0-arm64.dmg',
  transferredBytes: 182_000_000,
  totalBytes: 182_000_000,
  finishedAt: '2026-07-23T10:04:20.000Z',
})

export const failedDownloadTask = task('failed', {
  owner: { ...BASE_TASK.owner, displayName: 'Embeddings model' },
  fileName: 'bge-m3-q8.bin',
  transferredBytes: 104_000_000,
  totalBytes: 612_000_000,
  error: {
    code: 'network_error',
    message: 'The download failed because of a network error.',
    retryable: true,
  },
  finishedAt: '2026-07-23T10:02:18.000Z',
})

export const cancelledDownloadTask = task('cancelled', {
  owner: { ...BASE_TASK.owner, displayName: 'Optional speech model' },
  transferredBytes: 32_000_000,
  error: {
    code: 'cancelled',
    message: 'The download was cancelled.',
    retryable: true,
  },
  finishedAt: '2026-07-23T10:01:00.000Z',
})

export const downloadTaskCatalog = [
  queuedDownloadTask,
  activeDownloadTask,
  verifyingDownloadTask,
  completedDownloadTask,
  failedDownloadTask,
  cancelledDownloadTask,
]
