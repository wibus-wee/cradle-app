import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'

import type {
  DownloadedArtifact,
  DownloadExecution,
  DownloadExecutionResult,
  DownloadProgress,
  DownloadRequest,
  DownloadResumeState,
} from '@cradle/download-center'
import {
  asDownloadError,
  DownloadError,
  HttpArtifactDownloader,
  isStrongEtag,
  toDownloadTaskResult,
  validateDownloadRequest,
} from '@cradle/download-center'
import { app } from 'electron'

import type { DesktopDownloadTaskRecord, DesktopDownloadTaskView } from './download-task-store'
import {
  DesktopDownloadTaskStore,
} from './download-task-store'

interface DownloadRunner {
  download: (execution: DownloadExecution) => Promise<DownloadExecutionResult>
}

interface QueuedExecution {
  taskId: string
  request: DownloadRequest
  prior: DownloadResumeState | undefined
  resolve: (artifact: DownloadedArtifact) => void
  reject: (error: Error) => void
}

type TaskListener = (task: DesktopDownloadTaskView) => void
const PROGRESS_PERSIST_INTERVAL_MS = 500

export interface DesktopDownloadCenterServiceOptions {
  userDataPath?: string
  store?: DesktopDownloadTaskStore
  downloader?: DownloadRunner
  now?: () => Date
  createTaskId?: () => string
}

/**
 * Desktop host owner for download execution. The task store persists only the
 * redacted task projection; requests are held in this process for their run.
 */
export class DesktopDownloadCenterService {
  readonly store: DesktopDownloadTaskStore
  readonly rootDir: string

  private readonly downloader: DownloadRunner
  private readonly now: () => Date
  private readonly createTaskId: () => string
  private readonly queue: QueuedExecution[] = []
  private readonly active = new Map<string, AbortController>()
  private readonly promises = new Map<string, Promise<DownloadedArtifact>>()
  private readonly listeners = new Set<TaskListener>()
  private readonly externalCancels = new Map<string, () => void>()
  private readonly pendingProgress = new Map<string, DesktopDownloadTaskRecord>()
  private readonly progressTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private bootPromise: Promise<void> | null = null
  private acceptingWork = true

  constructor(options: DesktopDownloadCenterServiceOptions = {}) {
    this.store = options.store ?? new DesktopDownloadTaskStore({ userDataPath: options.userDataPath ?? app.getPath('userData') })
    this.rootDir = this.store.rootDir
    this.now = options.now ?? (() => new Date())
    this.createTaskId = options.createTaskId ?? randomUUID
    this.downloader = options.downloader ?? new HttpArtifactDownloader({
      rootDir: this.rootDir,
      onProgress: progress => this.recordProgress(progress),
    })
  }

  boot(): Promise<void> {
    this.bootPromise ??= this.bootTasks()
    return this.bootPromise
  }

  get(taskId: string): DesktopDownloadTaskView | null {
    return this.store.get(taskId)?.task ?? null
  }

  list(): DesktopDownloadTaskView[] {
    return this.store.list().map(record => record.task)
  }

  onTaskChange(listener: TaskListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async execute(request: DownloadRequest): Promise<DownloadedArtifact> {
    await this.boot()
    this.assertAcceptingWork()
    validateDownloadRequest(request)
    const now = this.timestamp()
    const taskId = this.createTaskId()
    const task: DesktopDownloadTaskRecord = {
      task: {
        taskId,
        scope: 'desktop',
        owner: { ...request.owner },
        fileName: request.fileName,
        sourceId: request.sources[0]?.id ?? null,
        status: 'queued',
        transferredBytes: 0,
        totalBytes: null,
        attempts: 0,
        maxAttempts: request.maxAttempts ?? 1,
        error: null,
        result: null,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: null,
      },
      resume: null,
      artifactReleasedAt: null,
    }
    await this.persistAndPublish(task)
    return this.enqueue(taskId, request)
  }

  /**
   * Projects a host-owned transport into the same durable task lifecycle. The
   * caller owns bytes and integrity; this service owns the redacted state.
   */
  async beginExternal(request: DownloadRequest, cancel: () => void): Promise<DesktopDownloadTaskView> {
    await this.boot()
    this.assertAcceptingWork()
    validateDownloadRequest(request)
    const now = this.timestamp()
    const task: DesktopDownloadTaskRecord = {
      task: {
        taskId: this.createTaskId(),
        scope: 'desktop',
        owner: { ...request.owner },
        fileName: request.fileName,
        sourceId: request.sources[0]?.id ?? null,
        status: 'downloading',
        transferredBytes: 0,
        totalBytes: request.integrity?.expectedBytes ?? null,
        attempts: 1,
        maxAttempts: request.maxAttempts ?? 1,
        error: null,
        result: null,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: null,
      },
      resume: null,
      artifactReleasedAt: null,
    }
    this.externalCancels.set(task.task.taskId, cancel)
    await this.persistAndPublish(task)
    return task.task
  }

  async reportExternal(taskId: string, update: {
    status: Extract<DesktopDownloadTaskView['status'], 'downloading' | 'verifying' | 'completed' | 'failed' | 'cancelled'>
    transferredBytes?: number
    totalBytes?: number | null
    error?: DesktopDownloadTaskView['error']
    result?: DesktopDownloadTaskView['result']
  }): Promise<DesktopDownloadTaskView | null> {
    await this.boot()
    const record = this.store.get(taskId)
    if (!record || isTerminal(record.task.status)) { return record?.task ?? null }
    const terminal = isTerminal(update.status)
    const task: DesktopDownloadTaskRecord = {
      ...record,
      task: {
        ...record.task,
        status: update.status,
        transferredBytes: update.transferredBytes ?? record.task.transferredBytes,
        totalBytes: update.totalBytes === undefined ? record.task.totalBytes : update.totalBytes,
        error: update.error ?? null,
        result: update.result ?? null,
        updatedAt: this.timestamp(),
        finishedAt: terminal ? this.timestamp() : null,
      },
    }
    if (terminal) { this.externalCancels.delete(taskId) }
    await this.persistAndPublish(task)
    return task.task
  }

  async retry(taskId: string, request: DownloadRequest): Promise<DownloadedArtifact> {
    await this.boot()
    this.assertAcceptingWork()
    validateDownloadRequest(request)
    const existingPromise = this.promises.get(taskId)
    if (existingPromise) { return existingPromise }
    const record = this.require(taskId)
    const sourceId = record.task.sourceId
    const sameOwner = record.task.owner.namespace === request.owner.namespace
      && record.task.owner.resourceType === request.owner.resourceType
      && record.task.owner.resourceId === request.owner.resourceId
    if (!sameOwner || sourceId === null || !request.sources.some(source => source.id === sourceId)) {
      throw new Error('The retry request does not match the original download owner and source.')
    }
    if (record.task.status !== 'failed' && record.task.status !== 'cancelled') {
      throw new Error('Only failed or cancelled downloads can be retried.')
    }
    if (record.task.status === 'failed' && !record.task.error?.retryable) {
      throw new Error('This download failure cannot be retried.')
    }
    const prior = record.resume && isStrongEtag(record.resume.etag) && await this.partialExists(taskId)
      ? record.resume
      : undefined
    const now = this.timestamp()
    const queued: DesktopDownloadTaskRecord = {
      ...record,
      task: {
        ...record.task,
        status: 'queued',
        transferredBytes: prior ? record.task.transferredBytes : 0,
        totalBytes: prior ? record.task.totalBytes : null,
        error: null,
        result: null,
        updatedAt: now,
        finishedAt: null,
      },
      resume: prior ?? null,
    }
    await this.persistAndPublish(queued)
    return this.enqueue(taskId, request, prior)
  }

  async cancel(taskId: string): Promise<DesktopDownloadTaskView | null> {
    await this.boot()
    const record = this.store.get(taskId)
    if (!record) { return null }
    if (isTerminal(record.task.status)) { return record.task }

    this.discardPendingProgress(taskId)

    const queueIndex = this.queue.findIndex(item => item.taskId === taskId)
    if (queueIndex >= 0) {
      const [queued] = this.queue.splice(queueIndex, 1)
      queued?.reject(new DownloadError('cancelled', false))
      this.promises.delete(taskId)
    }
    this.active.get(taskId)?.abort()
    this.externalCancels.get(taskId)?.()
    this.externalCancels.delete(taskId)
    const cancelled: DesktopDownloadTaskRecord = {
      ...record,
      task: {
        ...record.task,
        status: 'cancelled',
        error: new DownloadError('cancelled', false).toView(),
        updatedAt: this.timestamp(),
        finishedAt: this.timestamp(),
      },
    }
    await this.persistAndPublish(cancelled)
    return cancelled.task
  }

  async release(taskId: string): Promise<DesktopDownloadTaskView> {
    await this.boot()
    const record = this.require(taskId)
    if (record.task.status !== 'completed') { throw new Error('Only completed downloads can be released.') }
    if (record.artifactReleasedAt !== null) { return record.task }
    await rm(path.join(this.rootDir, 'artifacts', taskId), { recursive: true, force: true })
    const released: DesktopDownloadTaskRecord = { ...record, artifactReleasedAt: this.timestamp() }
    await this.persistAndPublish(released)
    return released.task
  }

  async shutdown(): Promise<void> {
    await this.boot()
    this.acceptingWork = false
    for (const item of [...this.queue]) { await this.cancel(item.taskId) }
    for (const taskId of [...this.active.keys()]) { await this.cancel(taskId) }
    for (const taskId of [...this.externalCancels.keys()]) { await this.cancel(taskId) }
    await Promise.allSettled([...this.promises.values()])
  }

  private async bootTasks(): Promise<void> {
    const records = await this.store.load()
    for (const record of records) {
      if (record.task.status !== 'queued' && record.task.status !== 'downloading' && record.task.status !== 'verifying') { continue }
      const interrupted: DesktopDownloadTaskRecord = {
        ...record,
        task: {
          ...record.task,
          status: 'failed',
          error: { code: 'interrupted', message: 'The desktop app stopped while this download was active.', retryable: true },
          updatedAt: this.timestamp(),
          finishedAt: this.timestamp(),
        },
      }
      await this.persistAndPublish(interrupted)
    }
  }

  private enqueue(taskId: string, request: DownloadRequest, prior?: DownloadResumeState): Promise<DownloadedArtifact> {
    const existing = this.promises.get(taskId)
    if (existing) { return existing }
    let resolve!: (artifact: DownloadedArtifact) => void
    let reject!: (error: Error) => void
    const promise = new Promise<DownloadedArtifact>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    this.promises.set(taskId, promise)
    this.queue.push({ taskId, request, prior, resolve, reject })
    this.startQueued()
    return promise
  }

  private startQueued(): void {
    if (!this.acceptingWork || this.active.size !== 0) { return }
    const next = this.queue.shift()
    if (next) { void this.run(next) }
  }

  private async run(item: QueuedExecution): Promise<void> {
    const record = this.store.get(item.taskId)
    if (!record || record.task.status !== 'queued') {
      item.reject(new Error('The download cannot be started.'))
      this.promises.delete(item.taskId)
      this.startQueued()
      return
    }
    const controller = new AbortController()
    this.active.set(item.taskId, controller)
    const started: DesktopDownloadTaskRecord = {
      ...record,
      task: {
        ...record.task,
        status: 'downloading',
        attempts: record.task.attempts + 1,
        error: null,
        updatedAt: this.timestamp(),
        startedAt: this.timestamp(),
        finishedAt: null,
      },
    }

    try {
      await this.persistAndPublish(started)
      if (controller.signal.aborted || !isActive(this.store.get(item.taskId)?.task.status)) { throw new DownloadError('cancelled', false) }
      const result = await this.downloader.download({ taskId: item.taskId, request: item.request, signal: controller.signal, prior: item.prior })
      const current = this.store.get(item.taskId)
      if (!current || !isActive(current.task.status)) {
        await this.removeArtifact(item.taskId)
        throw new DownloadError('cancelled', false)
      }
      const completed: DesktopDownloadTaskRecord = {
        ...current,
        task: {
          ...current.task,
          status: 'completed',
          sourceId: result.sourceId,
          transferredBytes: result.artifact.bytes,
          totalBytes: result.artifact.bytes,
          error: null,
          result: toDownloadTaskResult(result.artifact),
          updatedAt: this.timestamp(),
          finishedAt: this.timestamp(),
        },
        resume: { sourceId: result.sourceId, etag: result.etag },
      }
      this.discardPendingProgress(item.taskId)
      await this.persistAndPublish(completed)
      item.resolve(result.artifact)
    }
    catch (cause) {
      const error = asDownloadError(cause)
      const current = this.store.get(item.taskId)
      if (current && isActive(current.task.status)) {
        this.discardPendingProgress(item.taskId)
        const context = error.resumeContext
        const failed: DesktopDownloadTaskRecord = {
          ...current,
          task: {
            ...current.task,
            status: error.code === 'cancelled' ? 'cancelled' : 'failed',
            sourceId: context?.sourceId ?? current.task.sourceId,
            transferredBytes: context?.transferredBytes ?? current.task.transferredBytes,
            totalBytes: context?.totalBytes ?? current.task.totalBytes,
            error: error.toView(),
            updatedAt: this.timestamp(),
            finishedAt: this.timestamp(),
          },
          resume: context && isStrongEtag(context.etag) ? { sourceId: context.sourceId, etag: context.etag } : null,
        }
        await this.persistAndPublish(failed)
      }
      item.reject(error)
    }
    finally {
      this.active.delete(item.taskId)
      this.promises.delete(item.taskId)
      this.startQueued()
    }
  }

  private recordProgress(progress: DownloadProgress): void {
    const record = this.store.get(progress.taskId)
    if (!record || !isActive(record.task.status)) { return }
    const next: DesktopDownloadTaskRecord = {
      ...record,
      task: {
        ...record.task,
        status: progress.status === 'verifying' ? 'verifying' : 'downloading',
        sourceId: progress.sourceId,
        transferredBytes: progress.transferredBytes,
        totalBytes: progress.totalBytes,
        error: progress.error,
        updatedAt: this.timestamp(),
      },
    }
    this.pendingProgress.set(progress.taskId, next)
    if (this.progressTimers.has(progress.taskId)) { return }
    const timer = setTimeout(() => {
      this.progressTimers.delete(progress.taskId)
      void this.flushProgress(progress.taskId)
    }, PROGRESS_PERSIST_INTERVAL_MS)
    timer.unref()
    this.progressTimers.set(progress.taskId, timer)
  }

  private async flushProgress(taskId: string): Promise<void> {
    const record = this.pendingProgress.get(taskId)
    this.pendingProgress.delete(taskId)
    if (!record || !isActive(this.store.get(taskId)?.task.status)) { return }
    try {
      await this.persistAndPublish(record)
    }
    catch (error) {
      console.error('[download-center] could not persist progress:', error)
    }
  }

  private discardPendingProgress(taskId: string): void {
    this.pendingProgress.delete(taskId)
    const timer = this.progressTimers.get(taskId)
    if (timer) { clearTimeout(timer) }
    this.progressTimers.delete(taskId)
  }

  private async persistAndPublish(record: DesktopDownloadTaskRecord): Promise<void> {
    await this.store.put(record)
    for (const listener of this.listeners) { listener(record.task) }
  }

  private require(taskId: string): DesktopDownloadTaskRecord {
    const record = this.store.get(taskId)
    if (!record) { throw new Error(`Download task ${taskId} was not found.`) }
    return record
  }

  private assertAcceptingWork(): void {
    if (!this.acceptingWork) { throw new Error('The desktop download center is stopping.') }
  }

  private timestamp(): string { return this.now().toISOString() }

  private async partialExists(taskId: string): Promise<boolean> {
    try {
      await stat(path.join(this.rootDir, 'partial', `${taskId}.part`))
      return true
    }
    catch {
      return false
    }
  }

  private async removeArtifact(taskId: string): Promise<void> {
    await rm(path.join(this.rootDir, 'artifacts', taskId), { recursive: true, force: true })
  }
}

function isTerminal(status: DesktopDownloadTaskView['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function isActive(status: DesktopDownloadTaskView['status'] | undefined): boolean {
  return status === 'downloading' || status === 'verifying'
}
