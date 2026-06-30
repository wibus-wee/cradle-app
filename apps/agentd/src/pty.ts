import { randomUUID } from 'node:crypto'

import * as nodePty from 'node-pty'

import type {
  PtyCloseParams,
  PtyOpenEvent,
  PtyOpenParams,
  PtyResizeParams,
  PtyWriteParams,
} from '@cradle/remote-agent-protocol'

interface PtyRecord {
  process: nodePty.IPty
  queue: AsyncQueue<PtyOpenEvent>
}

export class PtyRegistry {
  private readonly ptys = new Map<string, PtyRecord>()

  async* open(rawParams: unknown): AsyncGenerator<PtyOpenEvent, void, void> {
    const params = rawParams as PtyOpenParams
    const ptyId = params.ptyId ?? randomUUID()
    const shell = params.shell
      || (process.platform === 'win32' ? process.env.COMSPEC : process.env.SHELL)
      || (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh')
    const queue = new AsyncQueue<PtyOpenEvent>()
    const child = nodePty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: params.cols,
      rows: params.rows,
      cwd: params.cwd,
      env: process.env as Record<string, string>,
    })

    this.ptys.set(ptyId, { process: child, queue })
    queue.push({ kind: 'opened', ptyId, cwd: params.cwd, pid: child.pid })
    child.onData((data) => {
      queue.push({ kind: 'output', ptyId, data })
    })
    child.onExit(({ exitCode, signal }) => {
      this.ptys.delete(ptyId)
      queue.push({
        kind: 'exit',
        ptyId,
        exitCode,
        signal: signal === undefined ? null : String(signal),
      })
      queue.close()
    })

    try {
      for await (const event of queue) {
        yield event
      }
    }
    finally {
      this.ptys.get(ptyId)?.process.kill()
      this.ptys.delete(ptyId)
    }
  }

  write(rawParams: unknown): { ok: boolean } {
    const params = rawParams as PtyWriteParams
    const record = this.ptys.get(params.ptyId)
    if (!record) {
      return { ok: false }
    }
    record.process.write(params.data)
    return { ok: true }
  }

  resize(rawParams: unknown): { ok: boolean } {
    const params = rawParams as PtyResizeParams
    const record = this.ptys.get(params.ptyId)
    if (!record) {
      return { ok: false }
    }
    record.process.resize(params.cols, params.rows)
    return { ok: true }
  }

  close(rawParams: unknown): { ok: boolean } {
    const params = rawParams as PtyCloseParams
    const record = this.ptys.get(params.ptyId)
    if (!record) {
      return { ok: false }
    }
    record.process.kill()
    return { ok: true }
  }
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value, done: false })
      return
    }
    this.values.push(value)
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.values.shift()
        if (value !== undefined) {
          return { value, done: false }
        }
        if (this.closed) {
          return { value: undefined, done: true }
        }
        return await new Promise<IteratorResult<T>>(resolve => this.waiters.push(resolve))
      },
    }
  }
}
