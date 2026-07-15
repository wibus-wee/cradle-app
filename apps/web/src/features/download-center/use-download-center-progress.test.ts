import { describe, expect, it } from 'vitest'

import type { DownloadTask } from './types'
import { aggregateDownloadProgressByKey } from './use-download-center-progress'

function downloadTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    taskId: 'task-1',
    scope: 'server',
    owner: {
      namespace: 'chronicle',
      resourceType: 'model-resource-file',
      resourceId: 'audio-asr:model',
      displayName: 'Model',
    },
    fileName: 'model.bin',
    sourceId: 'source',
    status: 'downloading',
    transferredBytes: 50,
    totalBytes: 200,
    attempts: 1,
    maxAttempts: 1,
    error: null,
    result: null,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    startedAt: '2026-07-15T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  }
}

function modelResourceKey(task: DownloadTask): string | null {
  if (task.scope !== 'server' || task.owner.namespace !== 'chronicle' || task.owner.resourceType !== 'model-resource-file') { return null }
  return task.owner.resourceId.split(':')[0] ?? null
}

describe('download Center owner progress aggregation', () => {
  it('aggregates matching owner tasks by the caller key', () => {
    expect(aggregateDownloadProgressByKey([
      downloadTask(),
      downloadTask({ taskId: 'task-2', owner: { namespace: 'chronicle', resourceType: 'model-resource-file', resourceId: 'audio-asr:tokenizer', displayName: 'Tokenizer' }, transferredBytes: 150, totalBytes: 300 }),
      downloadTask({ taskId: 'task-3', owner: { namespace: 'plugins', resourceType: 'archive', resourceId: 'x', displayName: 'Plugin' } }),
    ], modelResourceKey)).toEqual({ 'audio-asr': 40 })
  })

  it('keeps unknown totals indeterminate', () => {
    expect(aggregateDownloadProgressByKey([downloadTask({ totalBytes: null })], modelResourceKey)).toEqual({})
  })

  it('does not aggregate a desktop task that happens to have the same owner', () => {
    expect(aggregateDownloadProgressByKey([downloadTask({ scope: 'desktop' })], modelResourceKey)).toEqual({})
  })
})
