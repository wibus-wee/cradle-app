import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { DownloadExecution, DownloadExecutionResult, DownloadRequest } from '@cradle/download-center'
import { DownloadError } from '@cradle/download-center'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DesktopDownloadCenterService } from './download-center-service'
import { DesktopDownloadTaskStore } from './download-task-store'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/unused') } }))

const tempRoots: string[] = []

async function temporaryUserData(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cradle-desktop-download-service-'))
  tempRoots.push(root)
  return root
}

function request(name: string): DownloadRequest {
  return {
    owner: { namespace: 'plugin', resourceType: 'release', resourceId: name, displayName: name },
    fileName: `${name}.zip`,
    sources: [{ id: 'primary', url: 'https://downloads.example.com/example.zip' }],
    maxBytes: 1024,
  }
}

function result(taskId: string): DownloadExecutionResult {
  return {
    sourceId: 'primary',
    etag: '"etag"',
    artifact: {
      taskId,
      filePath: `/artifacts/${taskId}/example.zip`,
      bytes: 7,
      checksum: { algorithm: 'sha256', expected: null, actual: 'a'.repeat(64), matched: null },
    },
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) { return }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Condition was not reached in time.')
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktopDownloadCenterService', () => {
  it('marks persisted active tasks as interrupted on boot without rerunning them', async () => {
    const userDataPath = await temporaryUserData()
    const store = new DesktopDownloadTaskStore({ userDataPath })
    await store.load()
    await store.put({
      task: {
        taskId: 'interrupted',
        scope: 'desktop',
        owner: { namespace: 'plugin', resourceType: 'release', resourceId: '1', displayName: 'Interrupted' },
        fileName: 'interrupted.zip',
        sourceId: 'primary',
        status: 'downloading',
        transferredBytes: 5,
        totalBytes: 10,
        attempts: 1,
        maxAttempts: 2,
        error: null,
        result: null,
        createdAt: '2026-07-15T12:00:00.000Z',
        updatedAt: '2026-07-15T12:00:01.000Z',
        startedAt: '2026-07-15T12:00:01.000Z',
        finishedAt: null,
      },
      resume: { sourceId: 'primary', etag: '"etag"' },
      artifactReleasedAt: null,
    })
    await store.put({
      task: {
        taskId: 'queued-before-exit',
        scope: 'desktop',
        owner: { namespace: 'plugin', resourceType: 'release', resourceId: '2', displayName: 'Queued' },
        fileName: 'queued.zip',
        sourceId: 'primary',
        status: 'queued',
        transferredBytes: 0,
        totalBytes: null,
        attempts: 0,
        maxAttempts: 2,
        error: null,
        result: null,
        createdAt: '2026-07-15T12:00:00.000Z',
        updatedAt: '2026-07-15T12:00:01.000Z',
        startedAt: null,
        finishedAt: null,
      },
      resume: null,
      artifactReleasedAt: null,
    })
    const downloader = { download: vi.fn<(execution: DownloadExecution) => Promise<DownloadExecutionResult>>() }
    const service = new DesktopDownloadCenterService({ userDataPath, store, downloader })

    await service.boot()

    expect(service.get('interrupted')).toMatchObject({ status: 'failed', error: { code: 'interrupted', retryable: true } })
    expect(service.get('queued-before-exit')).toMatchObject({ status: 'failed', error: { code: 'interrupted', retryable: true } })
    expect(downloader.download).not.toHaveBeenCalled()
  })

  it('runs its one-at-a-time queue in FIFO order', async () => {
    const starts: string[] = []
    const finishers = new Map<string, () => void>()
    const downloader = {
      download: (execution: DownloadExecution) => new Promise<DownloadExecutionResult>((resolve) => {
        starts.push(execution.taskId)
        finishers.set(execution.taskId, () => resolve(result(execution.taskId)))
      }),
    }
    const service = new DesktopDownloadCenterService({
      userDataPath: await temporaryUserData(),
      downloader,
      createTaskId: (() => {
        let next = 0
        return () => `task-${++next}`
      })(),
    })

    const first = service.execute(request('first'))
    const second = service.execute(request('second'))
    await waitFor(() => starts.length === 1)
    expect(starts).toEqual(['task-1'])

    finishers.get('task-1')?.()
    await first
    await waitFor(() => starts.length === 2)
    expect(starts).toEqual(['task-1', 'task-2'])
    finishers.get('task-2')?.()
    await second
  })

  it('cancels a queued task without starting it', async () => {
    const starts: string[] = []
    const downloader = {
      download: (execution: DownloadExecution) => new Promise<DownloadExecutionResult>((_resolve, reject) => {
        starts.push(execution.taskId)
        execution.signal?.addEventListener('abort', () => reject(new DownloadError('cancelled', false)), { once: true })
      }),
    }
    const service = new DesktopDownloadCenterService({
      userDataPath: await temporaryUserData(),
      downloader,
      createTaskId: (() => {
        let next = 0
        return () => `task-${++next}`
      })(),
    })

    const active = service.execute(request('active'))
    const queued = service.execute(request('queued'))
    const queuedFailure = expect(queued).rejects.toMatchObject({ code: 'cancelled' })
    await waitFor(() => starts.length === 1)

    await expect(service.cancel('task-2')).resolves.toMatchObject({ status: 'cancelled' })
    await queuedFailure
    expect(starts).toEqual(['task-1'])

    const activeFailure = expect(active).rejects.toMatchObject({ code: 'cancelled' })
    await service.shutdown()
    await activeFailure
  })

  it('rejects queued work, aborts the active task, and drains on shutdown', async () => {
    const starts: string[] = []
    const downloader = {
      download: (execution: DownloadExecution) => new Promise<DownloadExecutionResult>((_resolve, reject) => {
        starts.push(execution.taskId)
        execution.signal?.addEventListener('abort', () => reject(new DownloadError('cancelled', false)), { once: true })
      }),
    }
    const service = new DesktopDownloadCenterService({
      userDataPath: await temporaryUserData(),
      downloader,
      createTaskId: (() => {
        let next = 0
        return () => `task-${++next}`
      })(),
    })

    const first = service.execute(request('first'))
    const second = service.execute(request('second'))
    const firstFailure = expect(first).rejects.toMatchObject({ code: 'cancelled' })
    const secondFailure = expect(second).rejects.toMatchObject({ code: 'cancelled' })
    await waitFor(() => starts.length === 1)

    await service.shutdown()

    await Promise.all([firstFailure, secondFailure])
    expect(starts).toEqual(['task-1'])
    expect(service.list().map(task => task.status)).toEqual(['cancelled', 'cancelled'])
    await expect(service.execute(request('after-shutdown'))).rejects.toThrow('stopping')
  })

  it('coalesces high-frequency progress persistence while terminal state remains synchronous', async () => {
    vi.useFakeTimers()
    try {
      let started!: () => void
      let finish!: () => void
      const running = new Promise<void>((resolve) => { started = resolve })
      const complete = new Promise<void>((resolve) => { finish = resolve })
      const downloader = {
        download: async (execution: DownloadExecution) => {
          started()
          await complete
          return result(execution.taskId)
        },
      }
      const service = new DesktopDownloadCenterService({
        userDataPath: await temporaryUserData(),
        downloader,
        createTaskId: () => 'task-progress',
      })
      const writes = vi.spyOn(service.store, 'put')
      const transfer = service.execute(request('progress'))
      await running

      const recordProgress = (service as unknown as { recordProgress: (progress: import('@cradle/download-center').DownloadProgress) => void }).recordProgress.bind(service)
      recordProgress({ taskId: 'task-progress', sourceId: 'primary', status: 'downloading', transferredBytes: 10, totalBytes: 100, error: null })
      recordProgress({ taskId: 'task-progress', sourceId: 'primary', status: 'downloading', transferredBytes: 20, totalBytes: 100, error: null })
      expect(writes).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(500)
      expect(writes).toHaveBeenCalledTimes(3)

      finish()
      await transfer
      expect(writes).toHaveBeenCalledTimes(4)
    }
    finally {
      vi.useRealTimers()
    }
  })
})
