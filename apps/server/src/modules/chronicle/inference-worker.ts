import { z } from 'zod'

import type { ManagedChildProcess } from '../../infra/managed-process'
import { spawnManagedProcess } from '../../infra/managed-process'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_PENDING = 16
const DEFAULT_MAX_TEXTS = 64
const DEFAULT_MAX_INPUT_BYTES = 4 * 1024 * 1024
const MAX_RESPONSE_BUFFER_BYTES = 64 * 1024 * 1024
const MAX_STDERR_BYTES = 8 * 1024

const WorkerResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    id: z.string(),
    ok: z.literal(true),
    result: z.object({
      modelId: z.string(),
      modelVersion: z.string(),
      dimensions: z.number().int().positive(),
      embeddings: z.array(z.array(z.number().finite())),
    }),
  }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    error: z.object({ message: z.string() }),
  }),
])

export interface ChronicleEmbeddingBatch {
  modelId: string
  modelVersion: string
  dimensions: number
  embeddings: number[][]
}

export interface ChronicleInferenceWorker {
  embed: (
    texts: readonly string[],
    options?: { signal?: AbortSignal, timeoutMs?: number },
  ) => Promise<ChronicleEmbeddingBatch>
  stop: () => Promise<void>
}

interface PendingEmbeddingRequest {
  id: string
  texts: readonly string[]
  resolve: (value: ChronicleEmbeddingBatch) => void
  reject: (error: Error) => void
  timeoutMs: number
  signal?: AbortSignal
  abortHandler?: () => void
  timeout?: ReturnType<typeof setTimeout>
  callerSettled: boolean
}

type WorkerProcessFactory = () => ManagedChildProcess

interface SupervisedChronicleInferenceWorkerOptions {
  command: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  maxPending?: number
  maxTexts?: number
  maxInputBytes?: number
  defaultTimeoutMs?: number
  processFactory?: WorkerProcessFactory
}

/**
 * Owns a single long-lived Chronicle inference process.
 *
 * The worker intentionally dispatches one request at a time because the Rust ONNX
 * runtime is single-threaded. Callers may queue concurrently, but both queue depth
 * and request size are bounded. A process failure rejects every pending caller;
 * the next request lazily starts a fresh worker and reloads the model once.
 */
export class SupervisedChronicleInferenceWorker implements ChronicleInferenceWorker {
  private readonly maxPending: number
  private readonly maxTexts: number
  private readonly maxInputBytes: number
  private readonly defaultTimeoutMs: number
  private readonly processFactory: WorkerProcessFactory
  private process: ManagedChildProcess | null = null
  private active: PendingEmbeddingRequest | null = null
  private readonly queue: PendingEmbeddingRequest[] = []
  private responseBuffer = ''
  private stderrBuffer = ''
  private nextRequestId = 1
  private stopping = false

  constructor(options: SupervisedChronicleInferenceWorkerOptions) {
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING
    this.maxTexts = options.maxTexts ?? DEFAULT_MAX_TEXTS
    this.maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.processFactory = options.processFactory ?? (() => spawnManagedProcess({
      kind: 'spawn',
      command: options.command,
      args: options.args ?? ['--embedding-worker'],
      env: options.env,
      stdin: 'pipe',
      shutdownGraceMs: 1_000,
    }))
  }

  embed(
    texts: readonly string[],
    options: { signal?: AbortSignal, timeoutMs?: number } = {},
  ): Promise<ChronicleEmbeddingBatch> {
    if (this.stopping) {
      return Promise.reject(new Error('Chronicle inference worker is stopping'))
    }
    if (texts.length === 0 || texts.length > this.maxTexts) {
      return Promise.reject(new Error(`Chronicle embedding requests require 1-${this.maxTexts} texts`))
    }
    const normalizedTexts = texts.map(text => text.trim())
    if (normalizedTexts.some(text => text.length === 0)) {
      return Promise.reject(new Error('Chronicle embedding request texts must be non-empty'))
    }
    const inputBytes = Buffer.byteLength(JSON.stringify(normalizedTexts), 'utf8')
    if (inputBytes > this.maxInputBytes) {
      return Promise.reject(new Error(`Chronicle embedding request exceeds ${this.maxInputBytes} bytes`))
    }
    if ((this.active ? 1 : 0) + this.queue.length >= this.maxPending) {
      return Promise.reject(new Error(`Chronicle inference queue is full (${this.maxPending} pending requests)`))
    }
    if (options.signal?.aborted) {
      return Promise.reject(abortError())
    }

    return new Promise<ChronicleEmbeddingBatch>((resolve, reject) => {
      const request: PendingEmbeddingRequest = {
        id: String(this.nextRequestId++),
        texts: normalizedTexts,
        resolve,
        reject,
        timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
        signal: options.signal,
        callerSettled: false,
      }
      request.abortHandler = () => this.abortRequest(request)
      request.signal?.addEventListener('abort', request.abortHandler, { once: true })
      this.queue.push(request)
      this.dispatchNext()
    })
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      return
    }
    this.stopping = true
    const process = this.process
    this.process = null
    this.rejectAll(new Error('Chronicle inference worker stopped'))
    if (process) {
      await process.stop('SIGTERM')
    }
  }

  private dispatchNext(): void {
    if (this.stopping || this.active || this.queue.length === 0) {
      return
    }
    const request = this.queue.shift()!
    if (request.signal?.aborted) {
      this.rejectCaller(request, abortError())
      this.dispatchNext()
      return
    }

    const process = this.ensureProcess()
    if (!process.stdin) {
      this.handleProcessFailure(process, new Error('Chronicle inference worker stdin is unavailable'))
      return
    }

    this.active = request
    request.timeout = setTimeout(() => {
      const error = new Error(`Chronicle inference request timed out after ${request.timeoutMs} ms`)
      this.rejectCaller(request, error)
      this.handleProcessFailure(process, error)
      void process.stop('SIGKILL')
    }, request.timeoutMs)
    request.timeout.unref()

    process.stdin.write(`${JSON.stringify({ id: request.id, texts: request.texts })}\n`, (error) => {
      if (error) {
        this.handleProcessFailure(process, error)
      }
    })
  }

  private ensureProcess(): ManagedChildProcess {
    if (this.process) {
      return this.process
    }
    const process = this.processFactory()
    this.process = process
    this.responseBuffer = ''
    this.stderrBuffer = ''
    process.stdout?.setEncoding('utf8')
    process.stderr?.setEncoding('utf8')
    process.stdout?.on('data', chunk => this.onStdout(process, String(chunk)))
    process.stderr?.on('data', (chunk) => {
      this.stderrBuffer = `${this.stderrBuffer}${String(chunk)}`.slice(-MAX_STDERR_BYTES)
    })
    process.once('error', error => this.handleProcessFailure(process, error))
    process.once('exit', (code, signal) => {
      const detail = this.stderrBuffer.trim()
      this.handleProcessFailure(process, new Error(
        detail || `Chronicle inference worker exited (${code ?? signal ?? 'unknown'})`,
      ))
    })
    return process
  }

  private onStdout(process: ManagedChildProcess, chunk: string): void {
    if (process !== this.process) {
      return
    }
    this.responseBuffer += chunk
    if (Buffer.byteLength(this.responseBuffer, 'utf8') > MAX_RESPONSE_BUFFER_BYTES) {
      const error = new Error('Chronicle inference worker response exceeded the buffer limit')
      this.handleProcessFailure(process, error)
      void process.stop('SIGKILL')
      return
    }
    let newlineIndex = this.responseBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.responseBuffer.slice(0, newlineIndex).trim()
      this.responseBuffer = this.responseBuffer.slice(newlineIndex + 1)
      if (line) {
        this.handleResponse(process, line)
      }
      newlineIndex = this.responseBuffer.indexOf('\n')
    }
  }

  private handleResponse(process: ManagedChildProcess, line: string): void {
    if (process !== this.process) {
      return
    }
    let response: z.infer<typeof WorkerResponseSchema>
    try {
      response = WorkerResponseSchema.parse(JSON.parse(line))
    }
    catch (error) {
      this.handleProcessFailure(process, new Error(
        `Chronicle inference worker returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ))
      void process.stop('SIGKILL')
      return
    }

    const request = this.active
    if (!request || response.id !== request.id) {
      this.handleProcessFailure(process, new Error(`Chronicle inference worker returned unexpected request id ${response.id}`))
      void process.stop('SIGKILL')
      return
    }
    this.active = null
    this.clearRequestResources(request)
    if (response.ok) {
      if (response.result.embeddings.length !== request.texts.length) {
        this.rejectCaller(request, new Error('Chronicle inference worker returned an invalid embedding count'))
      }
      else {
        this.resolveCaller(request, response.result)
      }
    }
    else {
      this.rejectCaller(request, new Error(response.error.message))
    }
    this.dispatchNext()
  }

  private abortRequest(request: PendingEmbeddingRequest): void {
    const queuedIndex = this.queue.indexOf(request)
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1)
      this.rejectCaller(request, abortError())
      return
    }
    if (this.active === request) {
      // ONNX execution is not preemptible. Reject the caller immediately, discard
      // the eventual response, then continue with the next bounded request.
      this.rejectCaller(request, abortError())
    }
  }

  private handleProcessFailure(process: ManagedChildProcess, error: Error): void {
    if (process !== this.process) {
      return
    }
    this.process = null
    this.responseBuffer = ''
    this.rejectAll(error)
  }

  private rejectAll(error: Error): void {
    const active = this.active
    this.active = null
    if (active) {
      this.rejectCaller(active, error)
    }
    for (const request of this.queue.splice(0)) {
      this.rejectCaller(request, error)
    }
  }

  private resolveCaller(request: PendingEmbeddingRequest, value: ChronicleEmbeddingBatch): void {
    if (!request.callerSettled) {
      request.callerSettled = true
      request.resolve(value)
    }
  }

  private rejectCaller(request: PendingEmbeddingRequest, error: Error): void {
    this.clearRequestResources(request)
    if (!request.callerSettled) {
      request.callerSettled = true
      request.reject(error)
    }
  }

  private clearRequestResources(request: PendingEmbeddingRequest): void {
    if (request.timeout) {
      clearTimeout(request.timeout)
      request.timeout = undefined
    }
    if (request.signal && request.abortHandler) {
      request.signal.removeEventListener('abort', request.abortHandler)
      request.abortHandler = undefined
    }
  }
}

function abortError(): Error {
  const error = new Error('Chronicle inference request aborted')
  error.name = 'AbortError'
  return error
}
