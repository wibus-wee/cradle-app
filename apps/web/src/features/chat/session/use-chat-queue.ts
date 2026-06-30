import { useCallback } from 'react'

import type { ChatQueueEnqueueBody } from '../commands/chat-response-command'
import {
  cancelChatSessionQueueItem,
  listChatSessionQueue,
  reorderChatSessionQueue,
  updateChatSessionQueueItem,
} from '../commands/chat-response-command'
import type { ChatSessionRuntimeControls } from './use-chat-session-runtime-controls'

export function useChatQueue(
  chatSessionId: string | null,
  controls: Pick<ChatSessionRuntimeControls, 'refreshQueue'>,
) {
  const { refreshQueue } = controls

  const cancelQueueItem = useCallback(async (queueItemId: string) => {
    if (!chatSessionId) {
      return
    }
    await cancelChatSessionQueueItem({ sessionId: chatSessionId, queueItemId })
    refreshQueue()
  }, [chatSessionId, refreshQueue])

  const reorderQueueItems = useCallback(async (queueItemIds: string[]) => {
    if (!chatSessionId) {
      return
    }
    await reorderChatSessionQueue({ sessionId: chatSessionId, queueItemIds })
    refreshQueue()
  }, [chatSessionId, refreshQueue])

  const updateQueueItem = useCallback(async (queueItemId: string, body: ChatQueueEnqueueBody) => {
    if (!chatSessionId) {
      return
    }
    await updateChatSessionQueueItem({ sessionId: chatSessionId, queueItemId, body })
    refreshQueue()
  }, [chatSessionId, refreshQueue])

  return {
    listChatSessionQueue: chatSessionId ? () => listChatSessionQueue(chatSessionId) : undefined,
    cancelQueueItem,
    reorderQueueItems,
    updateQueueItem,
  }
}
