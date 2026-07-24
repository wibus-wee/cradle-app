/**
 * Output: provider-agnostic async FIFO queue for runtime adapter event streams.
 * Input: pushed events, close/fail signals, and optional abort signals for waiters.
 * Position: shared chat-runtime-providers infrastructure with no provider protocol semantics.
 */

export class AsyncEventQueue<TEvent> implements AsyncIterable<TEvent> {
  private readonly buffered: TEvent[] = []
  private readonly waiters: Array<{
    resolve: (value: TEvent | null) => void
    reject: (error: Error) => void
    signal: AbortSignal | null
    onAbort: (() => void) | null
  }> = []

  private closed = false
  private failure: Error | null = null

  push(event: TEvent): boolean {
    if (this.closed) {
      return false
    }

    const waiter = this.waiters.shift()
    if (waiter) {
      this.releaseWaiter(waiter)
      waiter.resolve(event)
      return true
    }

    this.buffered.push(event)
    return true
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      this.releaseWaiter(waiter)
      waiter.resolve(null)
    }
  }

  fail(error: Error): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.failure = error

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      this.releaseWaiter(waiter)
      waiter.reject(error)
    }
  }

  async next(signal?: AbortSignal): Promise<TEvent | null> {
    if (this.buffered.length > 0) {
      return this.buffered.shift() ?? null
    }
    if (this.failure) {
      throw this.failure
    }
    if (this.closed) {
      return null
    }

    return new Promise<TEvent | null>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal: signal ?? null,
        onAbort: null as (() => void) | null,
      }
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) {
          this.waiters.splice(index, 1)
        }
        reject(new Error('Async event queue wait aborted'))
      }

      if (signal?.aborted) {
        reject(new Error('Async event queue wait aborted'))
        return
      }

      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  /** True when at least one consumer is blocked waiting for the next event. */
  hasWaiters(): boolean {
    return this.waiters.length > 0
  }

  [Symbol.asyncIterator](): AsyncIterator<TEvent> {
    return {
      next: async (): Promise<IteratorResult<TEvent>> => {
        const event = await this.next()
        if (event === null) {
          return { done: true, value: undefined }
        }
        return { done: false, value: event }
      },
    }
  }

  private releaseWaiter(waiter: { signal: AbortSignal | null, onAbort: (() => void) | null }): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort)
    }
  }
}
