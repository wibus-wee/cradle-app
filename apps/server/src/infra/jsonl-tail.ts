import type { FSWatcher } from 'node:fs'
import { watch } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

export interface JsonlTailOptions<TRecord> {
  path: string
  parse: (line: string) => TRecord
  onParseError?: (error: Error, line: string) => void
  startAt?: 'beginning' | 'end'
  maxBufferedBytes?: number
}

export interface JsonlTail<TRecord> {
  subscribe: (listener: (record: TRecord) => void) => () => void
  close: () => void
}

const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024

/**
 * Incrementally follows one JSONL file. It has no domain semantics: callers own
 * record interpretation, while this module owns file offsets, partial writes,
 * rename/recreate recovery, and watcher lifecycle.
 */
export function createJsonlTail<TRecord>(options: JsonlTailOptions<TRecord>): JsonlTail<TRecord> {
  return new JsonlTailReader(options)
}

class JsonlTailReader<TRecord> implements JsonlTail<TRecord> {
  private readonly path: string
  private readonly directory: string
  private readonly filename: string
  private readonly parse: (line: string) => TRecord
  private readonly onParseError: ((error: Error, line: string) => void) | null
  private readonly maxBufferedBytes: number
  private readonly listeners = new Set<(record: TRecord) => void>()

  private watcher: FSWatcher | null = null
  private offset = 0
  private remainder: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private readInFlight: Promise<void> | null = null
  private readPending = false
  private initialized = false
  private closed = false
  private inode: number | null = null
  private changedAt = 0
  private discardingOversizedLine = false

  constructor(options: JsonlTailOptions<TRecord>) {
    this.path = resolve(options.path)
    this.directory = dirname(this.path)
    this.filename = basename(this.path)
    this.parse = options.parse
    this.onParseError = options.onParseError ?? null
    this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES
    this.startAt = options.startAt ?? 'beginning'
  }

  private readonly startAt: 'beginning' | 'end'

  subscribe(listener: (record: TRecord) => void): () => void {
    if (this.closed) {
      throw new Error('Cannot subscribe to a closed JSONL tail')
    }
    this.listeners.add(listener)
    if (this.listeners.size === 1) {
      this.start()
    }

    let unsubscribed = false
    return () => {
      if (unsubscribed) {
        return
      }
      unsubscribed = true
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.stop()
      }
    }
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.listeners.clear()
    this.stop()
  }

  private start(): void {
    if (!this.watcher) {
      this.openWatcher()
    }
    this.queueRead()
  }

  private openWatcher(): void {
    try {
      const watcher = watch(this.directory, (_eventType, changed) => {
        if (changed && changed.toString() !== this.filename) {
          return
        }
        this.queueRead()
      })
      watcher.on('error', () => {
        if (this.watcher !== watcher) {
          return
        }
        watcher.close()
        this.watcher = null
        if (!this.closed && this.listeners.size > 0) {
          this.openWatcher()
          this.queueRead()
        }
      })
      this.watcher = watcher
    }
    catch {
      // The next subscriber or file-system event can retry creation. Read
      // directly as well, so a missing watcher never retains resources.
      this.watcher = null
    }
  }

  private stop(): void {
    this.watcher?.close()
    this.watcher = null
    this.readPending = false
    this.offset = Math.max(0, this.offset - this.remainder.length)
    this.remainder = Buffer.alloc(0)
    this.discardingOversizedLine = false
  }

  private queueRead(): void {
    if (this.closed || this.listeners.size === 0) {
      return
    }
    if (this.readInFlight) {
      this.readPending = true
      return
    }
    this.readInFlight = this.readAvailable()
      .catch(() => undefined)
      .finally(() => {
        this.readInFlight = null
        if (!this.readPending) {
          return
        }
        this.readPending = false
        this.queueRead()
      })
  }

  private async readAvailable(): Promise<void> {
    const fileStats = await stat(this.path).catch(() => null)
    if (!fileStats || !fileStats.isFile()) {
      return
    }

    if (!this.initialized) {
      this.initialized = true
      this.offset = this.startAt === 'end' ? fileStats.size : 0
      this.remainder = Buffer.alloc(0)
    }
    else if (
      fileStats.ino !== this.inode
      || fileStats.size < this.offset
      || (fileStats.size === this.offset && fileStats.ctimeMs > this.changedAt)
    ) {
      // The writer truncated or atomically replaced the file. Resetting to zero
      // is the only lossless cursor position for the new inode/content.
      this.offset = 0
      this.remainder = Buffer.alloc(0)
    }
    this.inode = fileStats.ino
    this.changedAt = fileStats.ctimeMs

    if (fileStats.size <= this.offset) {
      return
    }

    const handle = await open(this.path, 'r')
    try {
      while (!this.closed && this.listeners.size > 0) {
        const latestStats = await handle.stat()
        this.inode = latestStats.ino
        this.changedAt = latestStats.ctimeMs
        if (latestStats.size <= this.offset) {
          return
        }
        const bytesToRead = Math.min(READ_CHUNK_BYTES, latestStats.size - this.offset)
        const chunk = Buffer.allocUnsafe(bytesToRead)
        const { bytesRead } = await handle.read(chunk, 0, bytesToRead, this.offset)
        if (bytesRead === 0) {
          return
        }
        this.offset += bytesRead
        this.consume(Buffer.concat([this.remainder, chunk.subarray(0, bytesRead)]))
      }
    }
    finally {
      await handle.close()
    }
  }

  private consume(buffer: Buffer): void {
    let lineStart = 0
    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== 0x0A) {
        continue
      }
      const line = buffer.subarray(lineStart, index).toString('utf8').replace(/\r$/, '')
      lineStart = index + 1
      if (this.discardingOversizedLine) {
        this.discardingOversizedLine = false
        continue
      }
      if (line.length === 0) {
        continue
      }
      try {
        this.publish(this.parse(line))
      }
      catch (error) {
        this.onParseError?.(toError(error), line)
      }
    }

    this.remainder = buffer.subarray(lineStart)
    if (this.remainder.length > this.maxBufferedBytes) {
      // A never-terminated record must not retain an unbounded amount of memory.
      // Dropping it is safer than silently retaining a process-sized buffer.
      this.remainder = Buffer.alloc(0)
      this.discardingOversizedLine = true
    }
  }

  private publish(record: TRecord): void {
    for (const listener of this.listeners) {
      listener(record)
    }
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
