import { useChatStore } from '~/store/chat'

import { subscribeChatSessionStreamForSession } from '../transport/chat-stream-transport'
import { ChatStreamingHandler } from '../transport/chat-streaming-handler'
import type { SessionPassiveStreamRequest } from './session-sync-engine'
import {
  detachPassiveSessionStreamingState,
  QUEUE_DRAIN_SYNC_DELAY_MS,
} from './use-chat-session-types'

export interface OpenPassiveSessionStreamInput {
  request: SessionPassiveStreamRequest
  scheduleSnapshotRefresh: (delay?: number) => void
  refreshQueue: (delay?: number) => void
}

export function openPassiveSessionStream(input: OpenPassiveSessionStreamInput) {
  const { request, scheduleSnapshotRefresh, refreshQueue } = input
  const controller = new AbortController()
  const handler = new ChatStreamingHandler(
    request.sessionId,
    request.messageId,
    performance.now(),
    { mode: 'passive', useStoredMessageSnapshot: false },
  )
  handler.start(controller)

  void (async () => {
    try {
      const transport = await subscribeChatSessionStreamForSession({
        sessionId: request.sessionId,
        signal: controller.signal,
      })
      if (transport.runId) {
        useChatStore.getState().setRunDisplayId(request.messageId, transport.runId)
      }

      await handler.consume(transport.stream)
      handler.finish()
    }
    catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        handler.fail(err instanceof Error ? err.message : 'Stream failed')
      }
    }
    finally {
      handler.dispose()
      request.onSettled()
      scheduleSnapshotRefresh(0)
      refreshQueue(QUEUE_DRAIN_SYNC_DELAY_MS)
    }
  })()

  return {
    close: () => {
      controller.abort()
      handler.dispose()
      detachPassiveSessionStreamingState(request.sessionId)
    },
  }
}
