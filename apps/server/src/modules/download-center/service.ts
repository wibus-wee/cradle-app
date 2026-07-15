import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'

import type { DownloadCenterTask } from '@cradle/db'
import type {
  DownloadedArtifact,
  DownloadExecution,
  DownloadExecutionResult,
  DownloadProgress,
  DownloadRequest,
  DownloadResumeState,
  DownloadTaskView,
} from '@cradle/download-center'
import {
  asDownloadError,
  DownloadError,
  HttpArtifactDownloader,
  isStrongEtag,
  validateDownloadRequest,
} from '@cradle/download-center'

import { AppError } from '../../errors/app-error'
import { db, getServerConfig } from '../../infra'
import { DownloadCenterRepository, RETRYABLE_DOWNLOAD_ERROR_CODES } from './repository'
import { DownloadTaskEvents } from './task-events'

const CONCURRENCY = 2
const CLEANUP_AGE_SECONDS = 7 * 24 * 60 * 60
type ServerDownloadTaskView = DownloadTaskView & { scope: 'server' }
const RETRYABLE_FAILURE_CODES = new Set<string>(RETRYABLE_DOWNLOAD_ERROR_CODES)

function isRetryableFailure(code: string | null): boolean {
  return code !== null && RETRYABLE_FAILURE_CODES.has(code)
}

interface DownloadRunner {
  download: (execution: DownloadExecution) => Promise<DownloadExecutionResult>
}

interface QueuedExecution {
  taskId: string
  request: DownloadRequest
  prior?: DownloadResumeState
  resolve: (artifact: DownloadedArtifact) => void
  reject: (error: Error) => void
}

export interface DownloadCenterServiceOptions {
  repository?: DownloadCenterRepository
  rootDir?: string
  downloader?: DownloadRunner
  events?: DownloadTaskEvents
  now?: () => number
}

function defaultRootDir(): string {
  const config = getServerConfig()
  return path.join(config.dataDir ?? path.dirname(config.dbPath), 'download-center')
}

function taskView(task: DownloadCenterTask): ServerDownloadTaskView {
  const error = task.errorCode && task.errorMessage
    ? { code: task.errorCode, message: task.errorMessage, retryable: isRetryableFailure(task.errorCode) }
    : null
  const checksum = task.actualChecksum && task.checksumAlgorithm
    ? {
        algorithm: task.checksumAlgorithm as 'sha256' | 'sha512',
        expected: task.expectedChecksum,
        actual: task.actualChecksum,
        matched: task.expectedChecksum === null ? null : task.expectedChecksum === task.actualChecksum,
      }
    : null
  return {
    taskId: task.id,
    scope: 'server',
    owner: { namespace: task.ownerNamespace, resourceType: task.ownerResourceType, resourceId: task.ownerResourceId, displayName: task.displayName },
    fileName: task.fileName,
    sourceId: task.sourceId,
    status: task.status,
    transferredBytes: task.transferredBytes,
    totalBytes: task.totalBytes,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    error,
    result: checksum ? { taskId: task.id, bytes: task.transferredBytes, checksum } : null,
    createdAt: new Date(task.createdAt * 1000).toISOString(),
    updatedAt: new Date(task.updatedAt * 1000).toISOString(),
    startedAt: task.startedAt === null ? null : new Date(task.startedAt * 1000).toISOString(),
    finishedAt: task.finishedAt === null ? null : new Date(task.finishedAt * 1000).toISOString(),
  }
}

export class DownloadCenterService {
  readonly events: DownloadTaskEvents
  private readonly repository: DownloadCenterRepository
  private readonly rootDir: string
  private readonly now: () => number
  private readonly downloader: DownloadRunner
  private readonly queue: QueuedExecution[] = []
  private readonly active = new Map<string, AbortController>()
  private readonly promises = new Map<string, Promise<DownloadedArtifact>>()
  private acceptingWork = true

  constructor(options: DownloadCenterServiceOptions = {}) {
    this.repository = options.repository ?? new DownloadCenterRepository(db())
    this.rootDir = options.rootDir ?? defaultRootDir()
    this.events = options.events ?? new DownloadTaskEvents()
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
    this.downloader = options.downloader ?? new HttpArtifactDownloader({
      rootDir: this.rootDir,
      onProgress: progress => this.recordProgress(progress),
    })
  }

  async boot(): Promise<void> {
    this.repository.interruptActive()
    await this.cleanup()
  }

  execute(request: DownloadRequest): Promise<DownloadedArtifact> {
    this.assertAcceptingWork()
    validateDownloadRequest(request)
    this.scheduleCleanup()
    const taskId = randomUUID()
    const checksum = request.integrity?.checksum
    const task = this.repository.create({
      id: taskId,
      ownerNamespace: request.owner.namespace,
      ownerResourceType: request.owner.resourceType,
      ownerResourceId: request.owner.resourceId,
      displayName: request.owner.displayName,
      fileName: request.fileName,
      sourceId: request.sources[0]?.id ?? null,
      status: 'queued',
      transferredBytes: 0,
      totalBytes: null,
      checksumAlgorithm: checksum?.algorithm ?? null,
      expectedChecksum: checksum?.value.toLowerCase() ?? null,
      actualChecksum: null,
      expectedBytes: request.integrity?.expectedBytes ?? null,
      attempts: 0,
      maxAttempts: request.maxAttempts ?? 1,
      etag: null,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      artifactReleasedAt: null,
    })
    this.publish(task)
    return this.enqueue(taskId, request)
  }

  async retry(taskId: string, request: DownloadRequest): Promise<DownloadedArtifact> {
    this.assertAcceptingWork()
    validateDownloadRequest(request)
    const inFlight = this.promises.get(taskId)
    if (inFlight) { return inFlight }
    const task = this.require(taskId)
    const sameOwner = task.ownerNamespace === request.owner.namespace
      && task.ownerResourceType === request.owner.resourceType
      && task.ownerResourceId === request.owner.resourceId
    const source = task.sourceId ? request.sources.find(candidate => candidate.id === task.sourceId) : undefined
    if (!sameOwner || !source) {
      throw new AppError({ code: 'download_retry_identity_mismatch', status: 409, message: 'The retry request does not match the original download owner and source.' })
    }
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new AppError({ code: 'download_not_retryable', status: 409, message: 'Only failed or cancelled downloads can be retried.' })
    }
    if (task.status === 'failed' && !isRetryableFailure(task.errorCode)) {
      throw new AppError({ code: 'download_not_retryable', status: 409, message: 'This download failure cannot be retried.' })
    }
    const prior = isStrongEtag(task.etag) && await this.partialExists(taskId)
      ? { sourceId: task.sourceId!, etag: task.etag }
      : undefined
    const resumed = this.promises.get(taskId)
    if (resumed) { return resumed }
    const queued = this.repository.retry(taskId, {
      status: 'queued',
transferredBytes: prior ? task.transferredBytes : 0,
totalBytes: prior ? task.totalBytes : null,
      etag: prior ? task.etag : null,
errorCode: null,
errorMessage: null,
finishedAt: null,
actualChecksum: null,
    })
    if (!queued) {
      const existing = this.promises.get(taskId)
      if (existing) { return existing }
      throw new AppError({ code: 'download_execution_conflict', status: 409, message: 'The download retry is already being processed.' })
    }
    this.publish(queued)
    return this.enqueue(taskId, request, prior)
  }

  get(taskId: string): ServerDownloadTaskView | null {
    const task = this.repository.get(taskId)
    return task ? taskView(task) : null
  }

  findLatestRetryable(owner: { namespace: string, resourceType: string, resourceId: string }, sourceId: string): ServerDownloadTaskView | null {
    const task = this.repository.latestRetryable(owner, sourceId)
    return task ? taskView(task) : null
  }

  list(filters: { status?: DownloadCenterTask['status'], ownerNamespace?: string, ownerResourceType?: string, ownerResourceId?: string, limit?: number } = {}): ServerDownloadTaskView[] {
    return this.repository.list({ ...filters, limit: Math.min(Math.max(filters.limit ?? 100, 1), 100) }).map(taskView)
  }

  cancel(taskId: string): ServerDownloadTaskView | null {
    const task = this.repository.cancel(taskId)
    if (!task) { return null }
    this.publish(task)
    this.active.get(taskId)?.abort()
    const queueIndex = this.queue.findIndex(item => item.taskId === taskId)
    if (queueIndex >= 0) {
      const [queued] = this.queue.splice(queueIndex, 1)
      queued?.reject(new DownloadError('cancelled', false))
      this.promises.delete(taskId)
    }
    return taskView(task)
  }

  async release(taskId: string): Promise<ServerDownloadTaskView> {
    const task = this.require(taskId)
    if (task.status !== 'completed') {
      throw new AppError({ code: 'download_not_releasable', status: 409, message: 'Only completed downloads can be released.' })
    }
    if (task.artifactReleasedAt !== null) { return taskView(task) }
    await this.removeArtifact(task.id)
    const released = this.repository.releaseArtifact(taskId)
    if (!released) { return taskView(this.require(taskId)) }
    this.publish(released)
    return taskView(released)
  }

  async shutdown(): Promise<void> {
    this.acceptingWork = false
    for (const item of [...this.queue]) { this.cancel(item.taskId) }
    for (const taskId of this.active.keys()) { this.cancel(taskId) }
    await Promise.allSettled(this.promises.values())
  }

  private enqueue(taskId: string, request: DownloadRequest, prior?: DownloadResumeState): Promise<DownloadedArtifact> {
    const existing = this.promises.get(taskId)
    if (existing) { return existing }
    let resolve!: (artifact: DownloadedArtifact) => void
    let reject!: (error: Error) => void
    const promise = new Promise<DownloadedArtifact>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
    this.promises.set(taskId, promise)
    this.queue.push({ taskId, request, prior, resolve, reject })
    this.startQueued()
    return promise
  }

  private startQueued(): void {
    while (this.acceptingWork && this.active.size < CONCURRENCY && this.queue.length > 0) {
      const next = this.queue.shift()
      if (next) { void this.run(next) }
    }
  }

  private async run(item: QueuedExecution): Promise<void> {
    const started = this.repository.transitionToDownloading(item.taskId)
    if (!started || started.status !== 'downloading') {
      item.reject(new AppError({ code: 'download_execution_conflict', status: 409, message: 'The download cannot be started.' }))
      this.promises.delete(item.taskId)
      return
    }
    this.publish(started)
    const controller = new AbortController()
    this.active.set(item.taskId, controller)
    try {
      const result = await this.downloader.download({ taskId: item.taskId, request: item.request, signal: controller.signal, prior: item.prior })
      const completed = this.repository.updateIfActive(item.taskId, {
        status: 'completed',
sourceId: result.sourceId,
etag: result.etag,
transferredBytes: result.artifact.bytes,
totalBytes: result.artifact.bytes,
        checksumAlgorithm: result.artifact.checksum.algorithm,
expectedChecksum: result.artifact.checksum.expected,
actualChecksum: result.artifact.checksum.actual,
        errorCode: null,
errorMessage: null,
finishedAt: this.now(),
      })
      if (!completed || completed.status !== 'completed') {
        await this.removeArtifact(item.taskId)
        throw new DownloadError('cancelled', false)
      }
      this.publish(completed)
      item.resolve(result.artifact)
    }
    catch (cause) {
      const error = asDownloadError(cause)
      const context = error.resumeContext
      const failed = this.repository.updateIfActive(item.taskId, {
        status: error.code === 'cancelled' ? 'cancelled' : 'failed',
        sourceId: context?.sourceId ?? this.repository.get(item.taskId)?.sourceId ?? null,
        etag: context?.etag ?? null,
        transferredBytes: context?.transferredBytes ?? 0,
        totalBytes: context?.totalBytes ?? null,
        errorCode: error.code,
errorMessage: error.message,
finishedAt: this.now(),
      })
      if (failed) { this.publish(failed) }
      item.reject(error)
    }
    finally {
      this.active.delete(item.taskId)
      this.promises.delete(item.taskId)
      this.scheduleCleanup()
      this.startQueued()
    }
  }

  private recordProgress(progress: DownloadProgress): void {
    const task = this.repository.updateIfActive(progress.taskId, {
      status: progress.status === 'verifying' ? 'verifying' : 'downloading',
sourceId: progress.sourceId,
      transferredBytes: progress.transferredBytes,
totalBytes: progress.totalBytes,
      errorCode: progress.error?.code ?? null,
errorMessage: progress.error?.message ?? null,
    })
    if (task) { this.publish(task) }
  }

  private publish(task: DownloadCenterTask): void { this.events.publish(taskView(task)) }

  private require(taskId: string): DownloadCenterTask {
    const task = this.repository.get(taskId)
    if (!task) { throw new AppError({ code: 'download_not_found', status: 404, message: 'Download task was not found.' }) }
    return task
  }

  private assertAcceptingWork(): void {
    if (!this.acceptingWork) { throw new AppError({ code: 'download_center_stopping', status: 503, message: 'The download center is stopping.' }) }
  }

  private async partialExists(taskId: string): Promise<boolean> {
    try {
      await stat(path.join(this.rootDir, 'partial', `${taskId}.part`))
      return true
    }
    catch {
      return false
    }
  }

  private async cleanup(): Promise<void> {
    const cutoff = this.now() - CLEANUP_AGE_SECONDS
    await Promise.all(this.repository.expiredForCleanup(cutoff).map(async (task) => {
      if (task.status === 'failed' || task.status === 'cancelled') { await this.removePartial(task.id) }
      else if (task.status === 'completed' && task.artifactReleasedAt === null) { await this.removeArtifact(task.id) }
    }))
  }

  private scheduleCleanup(): void {
    void this.cleanup().catch(error => console.error('[download-center] cleanup failed:', error))
  }

  private async removePartial(taskId: string): Promise<void> { await rm(path.join(this.rootDir, 'partial', `${taskId}.part`), { force: true }) }
  private async removeArtifact(taskId: string): Promise<void> { await rm(path.join(this.rootDir, 'artifacts', taskId), { recursive: true, force: true }) }
}
