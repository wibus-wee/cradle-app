import type { ChatStreamTransportResult } from '~/features/chat/transport/chat-stream-transport'
import type { ChatStreamChunk } from '~/features/chat/transport/chat-stream-types'
import { liveChatStreamChunk, replayChatStreamChunk } from '~/features/chat/transport/chat-stream-types'

import {
  subscribeSyncChannel,
  unsubscribeSyncChannel,
  updateSyncRunSubscriptionCursor,
} from '../client'

export class SyncRunStreamError extends Error {
  constructor(
    readonly code: 'snapshot-required' | 'not-found' | 'protocol-error' | 'server-error',
    message: string,
  ) {
    super(message)
    this.name = 'SyncRunStreamError'
  }
}

export function subscribeSyncSessionRunChunks(input: {
  sessionId: string
  signal?: AbortSignal
}): Promise<ChatStreamTransportResult> {
  const subId = crypto.randomUUID()
  let closed = false
  let terminal = false
  let detachAbortListener = () => {}

  const stream = new ReadableStream<ChatStreamChunk>({
    start(controller) {
      const close = () => {
        if (closed) {
          return
        }
        closed = true
        detachAbortListener()
        unsubscribeSyncChannel(subId)
        controller.close()
      }

      const fail = (error: Error) => {
        if (closed) {
          return
        }
        closed = true
        detachAbortListener()
        unsubscribeSyncChannel(subId)
        controller.error(error)
      }

      const abort = () => {
        close()
      }

      if (input.signal?.aborted) {
        abort()
        return
      }
      input.signal?.addEventListener('abort', abort, { once: true })
      detachAbortListener = () => input.signal?.removeEventListener('abort', abort)

      subscribeSyncChannel(
        {
          op: 'sub',
          subId,
          channel: 'run-chunks',
          sessionId: input.sessionId,
        },
        (frame) => {
          if (closed || terminal) {
            return
          }
          if (!('kind' in frame)) {
            return
          }
          if (frame.kind === 'chunk') {
            const cursorResult = updateSyncRunSubscriptionCursor(subId, {
              runId: frame.runId,
              cursor: frame.cursor,
            })
            if (cursorResult === 'duplicate') {
              return
            }
            if (cursorResult === 'invalid') {
              fail(new SyncRunStreamError(
                'protocol-error',
                `Invalid run chunk cursor ${frame.runId}:${frame.cursor}`,
              ))
              return
            }
            controller.enqueue(frame.replay ? replayChatStreamChunk(frame.chunk) : liveChatStreamChunk(frame.chunk))
            if (frame.terminal) {
              terminal = true
              close()
            }
            return
          }
          if (frame.kind === 'end') {
            switch (frame.reason) {
              case 'terminal':
                terminal = true
                close()
                return
              case 'backpressure':
              case 'upstream-closed':
                return
              case 'snapshot-required':
                fail(new SyncRunStreamError(
                  'snapshot-required',
                  frame.detail ?? 'Run stream replay requires a fresh session snapshot',
                ))
                return
              case 'not-found':
                fail(new SyncRunStreamError(
                  'not-found',
                  frame.detail ?? 'No active run stream was found for this session',
                ))
                return
              case 'error':
                fail(new SyncRunStreamError(
                  'server-error',
                  frame.detail ?? 'Sync chunk stream failed',
                ))
            }
          }
        },
      )
    },
    cancel() {
      if (closed) {
        return
      }
      closed = true
      detachAbortListener()
      unsubscribeSyncChannel(subId)
    },
  })

  return Promise.resolve({
    streamId: subId,
    sessionId: input.sessionId,
    runId: null,
    telemetrySessionId: null,
    telemetryRunId: null,
    stream,
  })
}
