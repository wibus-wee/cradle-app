import { EventEmitter } from 'node:events'

import { z } from 'zod'

const WaitForResponseInputSchema = z.object({
  callId: z.string(),
  threadTs: z.string(),
  timeoutMs: z.number().positive().optional(),
})

/**
 * Manages pending zhi calls waiting for user replies from Slack.
 *
 * When a zhi tool is called, we create a pending call and block.
 * When a Slack reply comes in, we resolve the pending call.
 */
export class PendingCallManager extends EventEmitter {
  private pending = new Map<string, {
    threadTs: string
    resolve: (response: string) => void
    reject: (error: Error) => void
    timeout?: ReturnType<typeof setTimeout>
  }>()

  private threadToCallId = new Map<string, string>()

  /**
   * Wait for a response to a pending call.
   * Returns when the user replies in Slack.
   */
  waitForResponse(rawCallId: string, rawThreadTs: string, rawTimeoutMs?: number): Promise<string> {
    const { callId, threadTs, timeoutMs } = WaitForResponseInputSchema.parse({
      callId: rawCallId,
      threadTs: rawThreadTs,
      timeoutMs: rawTimeoutMs,
    })

    return new Promise<string>((resolve, reject) => {
      const timeout = timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.cleanup(callId)
            reject(new Error(`Zhi call ${callId} timed out after ${timeoutMs}ms`))
          }, timeoutMs)

      this.pending.set(callId, { threadTs, resolve, reject, timeout })
      this.threadToCallId.set(threadTs, callId)
    })
  }

  private cleanup(callId: string): void {
    const pending = this.pending.get(callId)
    if (!pending) {
      return
    }
    this.threadToCallId.delete(pending.threadTs)
    this.pending.delete(callId)
  }

  /**
   * Resolve a pending call with the user's response.
   */
  resolveCall(callId: string, response: string): boolean {
    const pending = this.pending.get(callId)
    if (!pending) {
      return false
    }
    if (pending.timeout) {
      clearTimeout(pending.timeout)
    }
    pending.resolve(response)
    this.cleanup(callId)
    return true
  }

  /**
   * Resolve the most recent pending call for a given thread.
   * Returns the callId if resolved, null otherwise.
   */
  resolveByThreadTs(threadTs: string, response: string): string | null {
    const callId = this.threadToCallId.get(threadTs)
    if (!callId) {
      return null
    }
    const resolved = this.resolveCall(callId, response)
    return resolved ? callId : null
  }

  /**
   * Get number of pending calls
   */
  get size(): number {
    return this.pending.size
  }

  /**
   * Cancel all pending calls
   */
  cancelAll(): void {
    for (const [_callId, pending] of this.pending) {
      if (pending.timeout) {
        clearTimeout(pending.timeout)
      }
      pending.reject(new Error('Bridge shutting down'))
    }
    this.pending.clear()
    this.threadToCallId.clear()
  }
}
