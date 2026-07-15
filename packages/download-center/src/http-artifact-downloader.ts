import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat, truncate, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type {
  DownloadExecution,
  DownloadExecutionResult,
  DownloadFailureContext,
  DownloadProgress,
  DownloadRequest,
  DownloadSource,
} from './contract'
import {
  isStrongEtag,
  validateDownloadRequest,
} from './contract'
import { asDownloadError, DownloadError } from './errors'
import { computeFileChecksum } from './file-integrity'

const MAX_REDIRECTS = 5
const PROGRESS_INTERVAL_MS = 200
const DEFAULT_INACTIVITY_TIMEOUT_MS = 30_000

export interface DownloadTimerHooks {
  now: () => number
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface HttpArtifactDownloaderOptions {
  rootDir: string
  fetch?: typeof globalThis.fetch
  timers?: DownloadTimerHooks
  inactivityTimeoutMs?: number
  onProgress?: (progress: DownloadProgress) => void
  writeStreamFactory?: (filePath: string, flags: 'a' | 'w') => Writable
}

interface TransferResult {
  etag: string | null
  bytes: number
  totalBytes: number | null
}

interface ProgressState {
  sourceId: string | null
  status: DownloadProgress['status']
  transferredBytes: number
  totalBytes: number | null
  error: DownloadProgress['error']
}

class ProgressEmitter {
  private lastEmittedAt: number | null = null
  private pending: ProgressState | null = null
  private timer: unknown | null = null

  constructor(
    private readonly taskId: string,
    private readonly hooks: DownloadTimerHooks,
    private readonly callback: ((progress: DownloadProgress) => void) | undefined,
  ) {}

  emit(state: ProgressState, force = false): void {
    if (!this.callback) {
      return
    }
    const now = this.hooks.now()
    if (force || this.lastEmittedAt === null || now - this.lastEmittedAt >= PROGRESS_INTERVAL_MS) {
      this.clearPending()
      this.publish(state, now)
      return
    }
    this.pending = state
    if (this.timer === null) {
      const remaining = PROGRESS_INTERVAL_MS - (now - this.lastEmittedAt)
      this.timer = this.hooks.setTimeout(() => {
        this.timer = null
        const pending = this.pending
        this.pending = null
        if (pending) {
          this.publish(pending, this.hooks.now())
        }
      }, remaining)
    }
  }

  private publish(state: ProgressState, now: number): void {
    this.lastEmittedAt = now
    this.callback?.({ taskId: this.taskId, ...state })
  }

  private clearPending(): void {
    this.pending = null
    if (this.timer !== null) {
      this.hooks.clearTimeout(this.timer)
      this.timer = null
    }
  }
}

const defaultTimers: DownloadTimerHooks = {
  now: Date.now,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * Host-agnostic HTTPS artifact runner. Hosts own durable task state and invoke
 * this runner with an opaque task id; it owns streaming, resume, integrity,
 * cancellation, and throttled progress only.
 */
export class HttpArtifactDownloader {
  private readonly fetchImplementation: typeof globalThis.fetch
  private readonly timers: DownloadTimerHooks
  private readonly inactivityTimeoutMs: number
  private readonly onProgress: ((progress: DownloadProgress) => void) | undefined
  private readonly writeStreamFactory: (filePath: string, flags: 'a' | 'w') => Writable

  constructor(private readonly options: HttpArtifactDownloaderOptions) {
    this.fetchImplementation = options.fetch ?? globalThis.fetch
    this.timers = options.timers ?? defaultTimers
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS
    this.onProgress = options.onProgress
    this.writeStreamFactory = options.writeStreamFactory ?? ((filePath, flags) => createWriteStream(filePath, { flags }))
    if (!Number.isFinite(this.inactivityTimeoutMs) || this.inactivityTimeoutMs <= 0) {
      throw new TypeError('inactivityTimeoutMs must be positive.')
    }
  }

  async download(execution: DownloadExecution): Promise<DownloadExecutionResult> {
    validateDownloadRequest(execution.request)
    const { taskId, request } = execution
    if (
      taskId.length === 0
      || taskId === '.'
      || taskId === '..'
      || taskId.includes('/')
      || taskId.includes('\\')
      || taskId.includes('\0')
    ) {
      throw new TypeError('taskId must be a single non-empty path segment.')
    }
    const partialPath = this.partialPath(taskId)
    const artifactPath = this.artifactPath(taskId, request.fileName)
    const progress = new ProgressEmitter(taskId, this.timers, this.onProgress)
    const priorSourceIndex = execution.prior
      ? request.sources.findIndex(source => source.id === execution.prior?.sourceId)
      : -1
    const startSourceIndex = priorSourceIndex >= 0 ? priorSourceIndex : 0
    const startSource = request.sources[startSourceIndex]
    if (!startSource) {
      throw new TypeError('At least one download source is required.')
    }
    const observation: DownloadFailureContext = {
      sourceId: startSource.id,
      etag: priorSourceIndex >= 0 && isStrongEtag(execution.prior?.etag) ? execution.prior.etag : null,
      transferredBytes: 0,
      totalBytes: null,
    }
    let initialProgressEmitted = false

    try {
      await this.filesystem(() => mkdir(path.dirname(partialPath), { recursive: true }))
      await this.filesystem(() => mkdir(path.dirname(artifactPath), { recursive: true }))
      if (priorSourceIndex < 0) {
        await this.removePartial(partialPath)
      }
      observation.transferredBytes = await this.fileSize(partialPath)
      progress.emit(this.progressState(
        observation.sourceId,
        'downloading',
        observation.transferredBytes,
        observation.totalBytes,
      ), true)
      initialProgressEmitted = true

      for (let sourceIndex = startSourceIndex; sourceIndex < request.sources.length; sourceIndex += 1) {
        const source = request.sources[sourceIndex]
        if (!source) {
          continue
        }
        const matchingPrior = sourceIndex === priorSourceIndex ? execution.prior : undefined
        if (sourceIndex !== startSourceIndex) {
          await this.removePartial(partialPath)
          observation.sourceId = source.id
          observation.etag = null
          observation.transferredBytes = 0
          observation.totalBytes = null
        }

        try {
          const transfer = await this.transferSource({
            source,
            request,
            partialPath,
            signal: execution.signal,
            priorEtag: matchingPrior?.etag ?? null,
            progress,
            observation,
          })
          this.throwIfCancelled(execution.signal)
          observation.transferredBytes = transfer.bytes
          observation.totalBytes = transfer.totalBytes ?? transfer.bytes
          observation.etag = transfer.etag
          progress.emit(this.progressState(
            source.id,
            'verifying',
            observation.transferredBytes,
            observation.totalBytes,
          ), true)
          const artifact = await this.verifyAndPromote(
            taskId,
            request,
            partialPath,
            artifactPath,
            execution.signal,
            observation,
          )
          this.throwIfCancelled(execution.signal)
          progress.emit(this.progressState(source.id, 'completed', artifact.bytes, artifact.bytes), true)
          return { artifact, sourceId: source.id, etag: transfer.etag }
        }
        catch (error) {
          const downloadError = this.classifyError(error, execution.signal).withResumeContext({ ...observation })
          const canFallback = downloadError.code !== 'cancelled'
            && sourceIndex + 1 < request.sources.length
            && downloadError.code !== 'byte_limit_exceeded'
            && downloadError.code !== 'filesystem_error'
          if (canFallback) {
            continue
          }
          throw downloadError
        }
      }
      throw new DownloadError('invalid_response', false).withResumeContext({ ...observation })
    }
    catch (error) {
      const downloadError = this.classifyError(error, execution.signal).withResumeContext({ ...observation })
      if (!initialProgressEmitted) {
        progress.emit(this.progressState(
          observation.sourceId,
          'downloading',
          observation.transferredBytes,
          observation.totalBytes,
        ), true)
      }
      progress.emit(this.progressState(
        observation.sourceId,
        downloadError.code === 'cancelled' ? 'cancelled' : 'failed',
        observation.transferredBytes,
        observation.totalBytes,
        downloadError,
      ), true)
      throw downloadError
    }
  }

  private async transferSource(input: {
    source: DownloadSource
    request: DownloadRequest
    partialPath: string
    signal: AbortSignal | undefined
    priorEtag: string | null
    progress: ProgressEmitter
    observation: DownloadFailureContext
  }): Promise<TransferResult> {
    let offset = await this.fileSize(input.partialPath)
    let resumeEtag = offset > 0 && isStrongEtag(input.priorEtag) ? input.priorEtag : null
    input.observation.transferredBytes = offset
    input.observation.etag = resumeEtag
    if (offset > 0 && resumeEtag === null) {
      await this.filesystem(() => truncate(input.partialPath, 0))
      offset = 0
      input.observation.transferredBytes = 0
    }

    for (let pass = 0; pass < 2; pass += 1) {
      const response = await this.fetchWithRedirects(input.source, input.signal, offset, resumeEtag)
      const responseEtag = response.headers.get('etag')

      if (offset > 0 && resumeEtag !== null && response.status === 416) {
        const remoteTotal = this.parseUnsatisfiedRange(response.headers.get('content-range'))
        await response.body?.cancel()
        if (remoteTotal === offset) {
          input.observation.totalBytes = remoteTotal
          return { etag: resumeEtag, bytes: offset, totalBytes: remoteTotal }
        }
        if (pass === 0) {
          await this.filesystem(() => truncate(input.partialPath, 0))
          offset = 0
          resumeEtag = null
          input.observation.etag = null
          input.observation.transferredBytes = 0
          input.observation.totalBytes = null
          continue
        }
        throw new DownloadError('invalid_response', false)
      }

      let append = false
      let totalBytes: number | null
      let expectedBodyBytes: number | null
      if (offset > 0 && resumeEtag !== null && response.status === 206) {
        const range = this.parseContentRange(response.headers.get('content-range'))
        const encoding = response.headers.get('content-encoding')
        const validatorMatches = isStrongEtag(responseEtag) && responseEtag === resumeEtag
        if (!range || range.start !== offset || (encoding !== null && encoding.toLowerCase() !== 'identity') || !validatorMatches) {
          await response.body?.cancel()
          if (pass === 0) {
            await this.filesystem(() => truncate(input.partialPath, 0))
            offset = 0
            resumeEtag = null
            input.observation.etag = null
            input.observation.transferredBytes = 0
            input.observation.totalBytes = null
            continue
          }
          throw new DownloadError('invalid_response', false)
        }
        append = true
        totalBytes = range.total
        expectedBodyBytes = range.end - range.start + 1
        input.observation.etag = resumeEtag
      }
      else if (response.status === 200) {
        if (offset > 0) {
          await this.filesystem(() => truncate(input.partialPath, 0))
          offset = 0
          input.observation.transferredBytes = 0
        }
        totalBytes = this.parseContentLength(response.headers.get('content-length'))
        expectedBodyBytes = totalBytes
        input.observation.etag = isStrongEtag(responseEtag) ? responseEtag : null
      }
      else {
        await response.body?.cancel()
        throw this.httpError(response.status)
      }

      if (!response.body) {
        throw new DownloadError('invalid_response', false)
      }
      const remainingLength = this.parseContentLength(response.headers.get('content-length'))
      if (expectedBodyBytes !== null && remainingLength !== null && expectedBodyBytes !== remainingLength) {
        await response.body.cancel()
        throw new DownloadError('invalid_response', false)
      }
      input.observation.totalBytes = totalBytes
      if (remainingLength !== null && offset + remainingLength > input.request.maxBytes) {
        await response.body.cancel()
        throw new DownloadError('byte_limit_exceeded', false)
      }
      const transferredBytes = await this.streamBody({
        response,
        partialPath: input.partialPath,
        append,
        initialBytes: offset,
        maxBytes: input.request.maxBytes,
        expectedBodyBytes,
        totalBytes,
        sourceId: input.source.id,
        signal: input.signal,
        progress: input.progress,
        observation: input.observation,
      })
      return {
        etag: isStrongEtag(responseEtag) ? responseEtag : null,
        bytes: transferredBytes,
        totalBytes,
      }
    }
    throw new DownloadError('invalid_response', false)
  }

  private async fetchWithRedirects(
    source: DownloadSource,
    callerSignal: AbortSignal | undefined,
    offset: number,
    etag: string | null,
  ): Promise<Response> {
    let url = new URL(source.url)
    let headers = new Headers(source.headers)
    if (offset > 0 && etag !== null) {
      headers.set('range', `bytes=${offset}-`)
      headers.set('if-range', etag)
      headers.set('accept-encoding', 'identity')
    }
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const timeout = this.createInactivityController(callerSignal)
      let response: Response
      try {
        response = await this.fetchImplementation(url, { headers, redirect: 'manual', signal: timeout.signal })
      }
      catch (error) {
        throw timeout.error(error)
      }
      finally {
        timeout.dispose()
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response
      }
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (location === null || redirects === MAX_REDIRECTS) {
        throw new DownloadError('redirect_error', false)
      }
      let nextUrl: URL
      try {
        nextUrl = new URL(location, url)
      }
      catch (error) {
        throw new DownloadError('redirect_error', false, error instanceof Error ? { cause: error } : undefined)
      }
      if (nextUrl.protocol !== 'https:') {
        throw new DownloadError('redirect_error', false)
      }
      if (nextUrl.origin !== url.origin) {
        headers = new Headers()
        if (offset > 0 && etag !== null) {
          headers.set('range', `bytes=${offset}-`)
          headers.set('if-range', etag)
          headers.set('accept-encoding', 'identity')
        }
      }
      url = nextUrl
    }
    throw new DownloadError('redirect_error', false)
  }

  private async streamBody(input: {
    response: Response
    partialPath: string
    append: boolean
    initialBytes: number
    maxBytes: number
    expectedBodyBytes: number | null
    totalBytes: number | null
    sourceId: string
    signal: AbortSignal | undefined
    progress: ProgressEmitter
    observation: DownloadFailureContext
  }): Promise<number> {
    const timeout = this.createInactivityController(input.signal)
    let bytes = input.initialBytes
    let receivedBytes = 0
    const meter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        receivedBytes += chunk.byteLength
        bytes += chunk.byteLength
        if (bytes > input.maxBytes) {
          callback(new DownloadError('byte_limit_exceeded', false))
          return
        }
        timeout.reset()
        input.observation.transferredBytes = bytes
        input.observation.totalBytes = input.totalBytes
        input.progress.emit(this.progressState(input.sourceId, 'downloading', bytes, input.totalBytes))
        callback(null, chunk)
      },
    })
    let readable: Readable | null = null
    const abortReadable = (): void => {
      readable?.destroy(new DOMException('The transfer was aborted.', 'AbortError'))
    }
    timeout.signal.addEventListener('abort', abortReadable, { once: true })
    try {
      readable = Readable.fromWeb(
        input.response.body as import('node:stream/web').ReadableStream<Uint8Array>,
        { signal: timeout.signal },
      )
      const writer = this.writerBoundary(input.partialPath, input.append ? 'a' : 'w')
      await pipeline(readable, meter, writer, { signal: timeout.signal })
      if (input.expectedBodyBytes !== null && receivedBytes !== input.expectedBodyBytes) {
        throw new DownloadError('invalid_response', false)
      }
      input.observation.transferredBytes = bytes
      return bytes
    }
    catch (error) {
      input.observation.transferredBytes = await this.fileSize(input.partialPath)
      throw timeout.error(error)
    }
    finally {
      timeout.signal.removeEventListener('abort', abortReadable)
      timeout.dispose()
    }
  }

  private writerBoundary(filePath: string, flags: 'a' | 'w'): Writable {
    let destination: Writable
    try {
      destination = this.writeStreamFactory(filePath, flags)
    }
    catch (error) {
      throw new DownloadError('filesystem_error', false, error instanceof Error ? { cause: error } : undefined)
    }
    const filesystemError = (error: unknown): DownloadError =>
      new DownloadError('filesystem_error', false, error instanceof Error ? { cause: error } : undefined)
    let destinationFailure: DownloadError | null = destination.closed || destination.destroyed
      ? new DownloadError('filesystem_error', false)
      : null
    let resolveDestinationClosed: (() => void) | undefined
    const destinationClosed = destination.closed
      ? Promise.resolve()
      : new Promise<void>((resolve) => { resolveDestinationClosed = resolve })
    let boundary: Writable
    const onDestinationFinish = (): void => {
      if (!destination.closed && !destination.destroyed) {
        destination.destroy()
      }
    }
    const onDestinationError = (error: Error): void => {
      destinationFailure ??= filesystemError(error)
      boundary.destroy(destinationFailure)
    }
    const onDestinationClose = (): void => {
      destination.removeListener('finish', onDestinationFinish)
      destination.removeListener('error', onDestinationError)
      resolveDestinationClosed?.()
      resolveDestinationClosed = undefined
    }
    if (!destination.closed) {
      destination.once('finish', onDestinationFinish)
      destination.on('error', onDestinationError)
      destination.once('close', onDestinationClose)
    }
    boundary = new Writable({
      write(chunk, encoding, callback) {
        if (destinationFailure) {
          callback(destinationFailure)
          return
        }
        try {
          destination.write(chunk, encoding, (error) => {
            callback(error ? filesystemError(error) : undefined)
          })
        }
        catch (error) {
          callback(filesystemError(error))
        }
      },
      final(callback) {
        void (async () => {
          try {
            if (!destinationFailure) {
              destination.end()
            }
            await destinationClosed
            callback(destinationFailure ?? undefined)
          }
          catch (error) {
            callback(filesystemError(error))
          }
        })()
      },
      destroy(error, callback) {
        void (async () => {
          try {
            if (!destination.closed && !destination.destroyed) {
              destination.destroy()
            }
            await destinationClosed
            callback(error ?? destinationFailure)
          }
          catch (closeError) {
            callback(filesystemError(closeError))
          }
        })()
      },
    })
    return boundary
  }

  private createInactivityController(callerSignal: AbortSignal | undefined): {
    signal: AbortSignal
    reset: () => void
    dispose: () => void
    error: (cause: unknown) => DownloadError
  } {
    const controller = new AbortController()
    let reason: 'timeout' | 'cancelled' | null = null
    let timer: unknown | null = null
    const abortForCancellation = (): void => {
      if (reason !== null) {
        return
      }
      reason = 'cancelled'
      controller.abort()
    }
    const reset = (): void => {
      if (reason !== null) {
        return
      }
      if (timer !== null) {
        this.timers.clearTimeout(timer)
      }
      timer = this.timers.setTimeout(() => {
        if (reason !== null) {
          return
        }
        reason = 'timeout'
        controller.abort()
      }, this.inactivityTimeoutMs)
    }
    if (callerSignal?.aborted) {
      abortForCancellation()
    }
    else {
      callerSignal?.addEventListener('abort', abortForCancellation, { once: true })
    }
    reset()
    return {
      signal: controller.signal,
      reset,
      dispose: () => {
        if (timer !== null) {
          this.timers.clearTimeout(timer)
        }
        callerSignal?.removeEventListener('abort', abortForCancellation)
      },
      error: (cause) => {
        if (reason === 'cancelled') {
          return new DownloadError('cancelled', false, cause instanceof Error ? { cause } : undefined)
        }
        if (reason === 'timeout') {
          return new DownloadError('timeout', true, cause instanceof Error ? { cause } : undefined)
        }
        return asDownloadError(cause)
      },
    }
  }

  private async verifyAndPromote(
    taskId: string,
    request: DownloadRequest,
    partialPath: string,
    artifactPath: string,
    signal: AbortSignal | undefined,
    observation: DownloadFailureContext,
  ) {
    const file = await this.filesystem(() => stat(partialPath))
    observation.transferredBytes = file.size
    observation.totalBytes ??= file.size
    if (file.size > request.maxBytes) {
      throw new DownloadError('byte_limit_exceeded', false)
    }
    if (request.integrity?.expectedBytes !== undefined && file.size !== request.integrity.expectedBytes) {
      throw new DownloadError('size_mismatch', false)
    }
    const algorithm = request.integrity?.checksum?.algorithm ?? 'sha256'
    const actual = await this.filesystem(() => computeFileChecksum(partialPath, algorithm))
    const expected = request.integrity?.checksum?.value.toLowerCase() ?? null
    const matched = expected === null ? null : actual === expected
    if (matched === false) {
      throw new DownloadError('checksum_mismatch', false)
    }
    this.throwIfCancelled(signal)
    await this.filesystem(() => rename(partialPath, artifactPath))
    if (signal?.aborted) {
      await this.filesystem(() => unlink(artifactPath))
      throw new DownloadError('cancelled', false)
    }
    return {
      taskId,
      filePath: artifactPath,
      bytes: file.size,
      checksum: { algorithm, expected, actual, matched },
    }
  }

  private partialPath(taskId: string): string {
    return path.join(this.options.rootDir, 'partial', `${taskId}.part`)
  }

  private artifactPath(taskId: string, fileName: string): string {
    return path.join(this.options.rootDir, 'artifacts', taskId, fileName)
  }

  private async fileSize(filePath: string): Promise<number> {
    try {
      return (await stat(filePath)).size
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return 0
      }
      throw new DownloadError('filesystem_error', false, error instanceof Error ? { cause: error } : undefined)
    }
  }

  private async removePartial(filePath: string): Promise<void> {
    try {
      await unlink(filePath)
    }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw new DownloadError('filesystem_error', false, error instanceof Error ? { cause: error } : undefined)
      }
    }
  }

  private throwIfCancelled(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw new DownloadError('cancelled', false)
    }
  }

  private classifyError(error: unknown, signal: AbortSignal | undefined): DownloadError {
    if (error instanceof DownloadError) {
      return error
    }
    if (signal?.aborted) {
      return new DownloadError('cancelled', false, error instanceof Error ? { cause: error } : undefined)
    }
    return asDownloadError(error)
  }

  private async filesystem<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error) {
      if (error instanceof DownloadError) {
        throw error
      }
      throw new DownloadError('filesystem_error', false, error instanceof Error ? { cause: error } : undefined)
    }
  }

  private httpError(status: number): DownloadError {
    if (status >= 500) {
      return new DownloadError('http_server_error', true)
    }
    if (status >= 400) {
      return new DownloadError('http_client_error', false)
    }
    return new DownloadError('invalid_response', false)
  }

  private parseContentLength(value: string | null): number | null {
    if (value === null || !/^\d+$/.test(value)) {
      return null
    }
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }

  private parseContentRange(value: string | null): { start: number, end: number, total: number | null } | null {
    const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/)
    if (!match?.[1] || !match[2] || !match[3]) {
      return null
    }
    const start = Number(match[1])
    const end = Number(match[2])
    const total = match[3] === '*' ? null : Number(match[3])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || (total !== null && (!Number.isSafeInteger(total) || end >= total))) {
      return null
    }
    return { start, end, total }
  }

  private parseUnsatisfiedRange(value: string | null): number | null {
    const match = value?.match(/^bytes \*\/(\d+)$/)
    if (!match?.[1]) {
      return null
    }
    const total = Number(match[1])
    return Number.isSafeInteger(total) ? total : null
  }

  private progressState(
    sourceId: string | null,
    status: DownloadProgress['status'],
    transferredBytes: number,
    totalBytes: number | null,
    error: DownloadError | null = null,
  ): ProgressState {
    return { sourceId, status, transferredBytes, totalBytes, error: error?.toView() ?? null }
  }
}
