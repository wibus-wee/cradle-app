// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { downloadErrorKey, downloadStatusKey, retryOwner } from './presentation'
import type { DownloadTask } from './types'
import { downloadTaskKey } from './types'
import {
  applyDownloadCenterTask,
  projectDownloadCenterTasks,
  replaceDownloadScopeSnapshot,
  useDownloadCenter,
  useDownloadCenterOwner,
} from './use-download-center'

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    taskId: 'same-id',
    scope: 'server',
    owner: { namespace: 'chronicle', resourceType: 'model-resource-file', resourceId: 'resource', displayName: 'Resource' },
    fileName: 'resource.bin',
    sourceId: null,
    status: 'downloading',
    transferredBytes: 50,
    totalBytes: 100,
    attempts: 1,
    maxAttempts: 3,
    error: null,
    result: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

describe('download Center projection', () => {
  it('keeps duplicate IDs in separate scopes and orders active tasks before recent history', () => {
    const projected = projectDownloadCenterTasks([
      task({ scope: 'desktop', updatedAt: '2026-01-01T00:00:03.000Z' }),
      task({ taskId: 'completed', status: 'completed', updatedAt: '2026-01-01T00:00:04.000Z' }),
      task({ taskId: 'queued', status: 'queued', updatedAt: '2026-01-01T00:00:02.000Z' }),
    ])
    expect(projected.active.map(downloadTaskKey)).toEqual(['desktop:same-id', 'server:queued'])
    expect(projected.recent.map(downloadTaskKey)).toEqual(['server:completed'])
  })

  it('uses scope and task ID as the merge key', () => {
    const projected = projectDownloadCenterTasks([
      task({ transferredBytes: 10 }),
      task({ transferredBytes: 80 }),
    ])
    expect(projected.tasks).toHaveLength(1)
    expect(projected.tasks[0]?.transferredBytes).toBe(80)
  })

  it('replaces only the refreshed scope so removed tasks do not linger after reconnect', () => {
    const current = new Map([
      [downloadTaskKey(task({ taskId: 'old-server' })), task({ taskId: 'old-server' })],
      [downloadTaskKey(task({ taskId: 'desktop-task', scope: 'desktop' })), task({ taskId: 'desktop-task', scope: 'desktop' })],
    ])
    const refreshed = replaceDownloadScopeSnapshot(current, 'server', [task({ taskId: 'new-server' })])
    expect(Array.from(refreshed.keys())).toEqual(['desktop:desktop-task', 'server:new-server'])
  })

  it('routes retries to the owning feature rather than exposing a generic retry', () => {
    expect(retryOwner(task({ owner: { namespace: 'chronicle', resourceType: 'model-resource-file', resourceId: 'x', displayName: 'Chronicle' } }))).toBe('chronicle')
    expect(retryOwner(task({ owner: { namespace: 'desktop-update', resourceType: 'macos-update', resourceId: 'x', displayName: 'Desktop' } }))).toBe('desktop')
    expect(retryOwner(task({ owner: { namespace: 'plugins', resourceType: 'archive', resourceId: 'x', displayName: 'Plugin' } }))).toBeNull()
  })

  it('redacts raw download errors from the global status label', () => {
    const failedTask = task({ status: 'failed', error: { code: 'network_error', message: 'https://secret.example/path?token=nope', retryable: true } })
    expect(downloadStatusKey(failedTask)).toBe('download.status.failed')
    expect(downloadErrorKey(failedTask)).toBe('download.error.network')
  })

  it('refreshes an owner selector on remount after it unsubscribed while a global subscriber remained', () => {
    const global = renderHook(() => useDownloadCenter())
    const firstOwner = renderHook(() => useDownloadCenterOwner({ namespace: 'chronicle' }))
    act(() => {
      applyDownloadCenterTask(task({ taskId: 'resource', transferredBytes: 10 }))
    })
    expect(firstOwner.result.current[0]?.transferredBytes).toBe(10)
    firstOwner.unmount()

    act(() => {
      applyDownloadCenterTask(task({ taskId: 'resource', transferredBytes: 80, updatedAt: '2026-01-01T00:00:02.000Z' }))
    })
    const remountedOwner = renderHook(() => useDownloadCenterOwner({ namespace: 'chronicle' }))
    expect(remountedOwner.result.current[0]?.transferredBytes).toBe(80)

    remountedOwner.unmount()
    global.unmount()
  })
})
