import { mkdtempSync, rmSync } from 'node:fs'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { downloadCenterTasks } from '@cradle/db'
import type { DownloadExecution, DownloadExecutionResult, DownloadRequest } from '@cradle/download-center'
import { DownloadError } from '@cradle/download-center'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../src/infra'
import { DownloadCenterService } from '../src/modules/download-center/service'

interface PendingDownload {
  execution: DownloadExecution
  resolve: (result: DownloadExecutionResult) => void
  reject: (error: Error) => void
}

class ControlledDownloader {
  readonly pending: PendingDownload[] = []

  download(execution: DownloadExecution): Promise<DownloadExecutionResult> {
    return new Promise((resolve, reject) => this.pending.push({ execution, resolve, reject }))
  }

  succeed(index: number): void {
    const pending = this.pending[index]!
    pending.resolve({
      sourceId: pending.execution.request.sources[0]!.id,
      etag: '"stable"',
      artifact: {
        taskId: pending.execution.taskId,
        filePath: `/unexposed/${pending.execution.taskId}`,
        bytes: 5,
        checksum: { algorithm: 'sha256', expected: null, actual: 'a'.repeat(64), matched: null },
      },
    })
  }
}

class ArtifactPromotingDownloader extends ControlledDownloader {
  constructor(private readonly rootDir: string) {
    super()
  }

  async succeedWithPromotedArtifact(index: number): Promise<string> {
    const pending = this.pending[index]!
    const artifactPath = path.join(this.rootDir, 'artifacts', pending.execution.taskId, pending.execution.request.fileName)
    await mkdir(path.dirname(artifactPath), { recursive: true })
    await writeFile(artifactPath, 'artifact')
    pending.resolve({
      sourceId: pending.execution.request.sources[0]!.id,
      etag: '"stable"',
      artifact: {
        taskId: pending.execution.taskId,
        filePath: artifactPath,
        bytes: 8,
        checksum: { algorithm: 'sha256', expected: null, actual: 'a'.repeat(64), matched: null },
      },
    })
    return artifactPath
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) { return }
    await flush()
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  throw new Error('Condition did not become true.')
}

function request(sourceId = 'source-a'): DownloadRequest {
  return {
    owner: { namespace: 'test', resourceType: 'fixture', resourceId: 'resource-1', displayName: 'Fixture' },
    fileName: 'artifact.bin',
    sources: [{ id: sourceId, url: 'https://example.test/private-artifact', headers: { authorization: 'secret' } }],
    maxBytes: 100,
  }
}

describe('download center service', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'cradle-download-center-'))
    process.env.CRADLE_DATA_DIR = dataDir
  })

  afterEach(() => {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('runs FIFO with two concurrent workers and keeps queued work cancellable', async () => {
    const downloader = new ControlledDownloader()
    const service = new DownloadCenterService({ downloader, rootDir: path.join(dataDir, 'downloads') })
    const first = service.execute(request('one'))
    const second = service.execute(request('two'))
    const third = service.execute(request('three'))
    await flush()
    expect(downloader.pending).toHaveLength(2)
    const queued = service.list({ status: 'queued' })[0]!
    expect(queued.sourceId).toBe('three')
    expect(service.cancel(queued.taskId)?.status).toBe('cancelled')
    await expect(third).rejects.toMatchObject({ code: 'cancelled' })
    downloader.succeed(0)
    downloader.succeed(1)
    await expect(first).resolves.toMatchObject({ bytes: 5 })
    await expect(second).resolves.toMatchObject({ bytes: 5 })
  })

  it('persists cancellation before an active worker can finish', async () => {
    const downloader = new ControlledDownloader()
    const service = new DownloadCenterService({ downloader, rootDir: path.join(dataDir, 'downloads') })
    const completion = service.execute(request())
    await flush()
    const task = service.list()[0]!
    const publish = vi.spyOn(service.events, 'publish')
    expect(service.cancel(task.taskId)?.status).toBe('cancelled')
    const publishesAfterCancel = publish.mock.calls.length
    downloader.succeed(0)
    await expect(completion).rejects.toMatchObject({ code: 'cancelled' })
    expect(publish).toHaveBeenCalledTimes(publishesAfterCancel)
    expect(service.get(task.taskId)?.status).toBe('cancelled')
  })

  it('removes a promoted artifact when cancellation wins the terminal-state race', async () => {
    const rootDir = path.join(dataDir, 'downloads')
    const downloader = new ArtifactPromotingDownloader(rootDir)
    const service = new DownloadCenterService({ downloader, rootDir })
    const completion = service.execute(request())
    await flush()
    const task = service.list()[0]!
    expect(service.cancel(task.taskId)?.status).toBe('cancelled')
    const artifactPath = await downloader.succeedWithPromotedArtifact(0)
    await expect(completion).rejects.toMatchObject({ code: 'cancelled' })
    await expect(access(artifactPath)).rejects.toBeDefined()
    expect(service.get(task.taskId)?.status).toBe('cancelled')
  })

  it('retries only the exact owner and source, resuming only with a stored strong ETag', async () => {
    const downloader = new ControlledDownloader()
    const rootDir = path.join(dataDir, 'downloads')
    const service = new DownloadCenterService({ downloader, rootDir })
    const fallbackRequest: DownloadRequest = {
      ...request('primary'),
      sources: [
        { id: 'primary', url: 'https://example.test/primary' },
        { id: 'fallback', url: 'https://example.test/fallback' },
      ],
    }
    const failed = service.execute(fallbackRequest)
    await flush()
    downloader.pending[0]!.reject(new DownloadError('network_error', true).withResumeContext({ sourceId: 'fallback', etag: '"stable"', transferredBytes: 3, totalBytes: 5 }))
    await expect(failed).rejects.toMatchObject({ code: 'network_error' })
    const task = service.list()[0]!
    await mkdir(path.join(rootDir, 'partial'), { recursive: true })
    await writeFile(path.join(rootDir, 'partial', `${task.taskId}.part`), 'abc')
    await expect(service.retry(task.taskId, request('other'))).rejects.toMatchObject({ code: 'download_retry_identity_mismatch' })
    expect(service.findLatestRetryable(fallbackRequest.owner, 'fallback')?.taskId).toBe(task.taskId)
    expect(service.findLatestRetryable({ ...fallbackRequest.owner, resourceId: 'other' }, 'fallback')).toBeNull()
    expect(service.findLatestRetryable(fallbackRequest.owner, 'other')).toBeNull()
    const retry = service.retry(task.taskId, fallbackRequest)
    await waitFor(() => downloader.pending.length === 2)
    expect(downloader.pending[1]!.execution.prior).toEqual({ sourceId: 'fallback', etag: '"stable"' })
    downloader.succeed(1)
    await expect(retry).resolves.toMatchObject({ bytes: 5 })
  })

  it('atomically coalesces concurrent retries into one execution', async () => {
    const downloader = new ControlledDownloader()
    const service = new DownloadCenterService({ downloader, rootDir: path.join(dataDir, 'downloads') })
    const failed = service.execute(request())
    await flush()
    downloader.pending[0]!.reject(new DownloadError('network_error', true))
    await expect(failed).rejects.toMatchObject({ code: 'network_error' })
    const task = service.list()[0]!
    const retries = [service.retry(task.taskId, request()), service.retry(task.taskId, request())]
    await waitFor(() => downloader.pending.length === 2)
    downloader.succeed(1)
    await expect(Promise.all(retries)).resolves.toHaveLength(2)
    expect(service.get(task.taskId)?.status).toBe('completed')
  })

  it('does not expose or retry a non-retryable checksum failure', async () => {
    const downloader = new ControlledDownloader()
    const service = new DownloadCenterService({ downloader, rootDir: path.join(dataDir, 'downloads') })
    const failed = service.execute(request())
    await flush()
    downloader.pending[0]!.reject(new DownloadError('checksum_mismatch', false))
    await expect(failed).rejects.toMatchObject({ code: 'checksum_mismatch' })
    const task = service.list()[0]!
    expect(service.get(task.taskId)?.error).toMatchObject({ code: 'checksum_mismatch', retryable: false })
    expect(service.findLatestRetryable(request().owner, 'source-a')).toBeNull()
    await expect(service.retry(task.taskId, request())).rejects.toMatchObject({ code: 'download_not_retryable' })
  })

  it('marks interrupted work failed on boot, cleans expired artifacts, releases idempotently, and redacts task views', async () => {
    const downloader = new ControlledDownloader()
    const rootDir = path.join(dataDir, 'downloads')
    const service = new DownloadCenterService({ downloader, rootDir, now: () => 1_000_000 })
    const completion = service.execute(request())
    await flush()
    const task = service.list()[0]!
    expect(service.cancel(task.taskId)?.status).toBe('cancelled')
    downloader.succeed(0)
    await expect(completion).rejects.toMatchObject({ code: 'cancelled' })
    db().update(downloadCenterTasks).set({ status: 'downloading', updatedAt: 0 }).where(eq(downloadCenterTasks.id, task.taskId)).run()
    await mkdir(path.join(rootDir, 'partial'), { recursive: true })
    await writeFile(path.join(rootDir, 'partial', `${task.taskId}.part`), 'partial')
    await service.boot()
    expect(service.get(task.taskId)?.status).toBe('failed')
    expect(service.get(task.taskId)?.error).toMatchObject({ code: 'interrupted', retryable: true })
    expect(service.findLatestRetryable(request().owner, 'source-a')?.taskId).toBe(task.taskId)
    await expect(access(path.join(rootDir, 'partial', `${task.taskId}.part`))).resolves.toBeUndefined()
    db().update(downloadCenterTasks).set({ updatedAt: 0 }).where(eq(downloadCenterTasks.id, task.taskId)).run()
    await service.boot()
    await expect(access(path.join(rootDir, 'partial', `${task.taskId}.part`))).rejects.toBeDefined()
    expect(JSON.stringify(service.get(task.taskId))).not.toContain('private-artifact')
    expect(JSON.stringify(service.get(task.taskId))).not.toContain('secret')

    const interruptedRetry = service.retry(task.taskId, request())
    await waitFor(() => downloader.pending.length === 2)
    downloader.succeed(1)
    await expect(interruptedRetry).resolves.toMatchObject({ bytes: 5 })

    const completed = service.execute(request('release'))
    await flush()
    const completeTask = service.list({ status: 'downloading' })[0]!
    await mkdir(path.join(rootDir, 'artifacts', completeTask.taskId), { recursive: true })
    await writeFile(path.join(rootDir, 'artifacts', completeTask.taskId, 'artifact.bin'), 'artifact')
    downloader.succeed(2)
    await completed
    const publish = vi.spyOn(service.events, 'publish')
    await service.release(completeTask.taskId)
    const publishesAfterFirstRelease = publish.mock.calls.length
    const releasedAt = service.get(completeTask.taskId)?.updatedAt
    await service.release(completeTask.taskId)
    expect(publish).toHaveBeenCalledTimes(publishesAfterFirstRelease)
    expect(service.get(completeTask.taskId)?.updatedAt).toBe(releasedAt)
    await expect(access(path.join(rootDir, 'artifacts', completeTask.taskId))).rejects.toBeDefined()
  })

  it('does not snapshot SSE events and removes a disconnected listener', async () => {
    const service = new DownloadCenterService({ downloader: new ControlledDownloader(), rootDir: path.join(dataDir, 'downloads') })
    const controller = new AbortController()
    const reader = service.events.stream(controller.signal).getReader()
    expect(service.events.listenerCount).toBe(1)
    controller.abort()
    expect(service.events.listenerCount).toBe(0)
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
  })

  it('removes an SSE listener when its stream is cancelled', async () => {
    const service = new DownloadCenterService({ downloader: new ControlledDownloader(), rootDir: path.join(dataDir, 'downloads') })
    const reader = service.events.stream(new AbortController().signal).getReader()
    expect(service.events.listenerCount).toBe(1)
    await reader.cancel()
    expect(service.events.listenerCount).toBe(0)
  })
})
