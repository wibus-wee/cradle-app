import type { UIMessage } from 'ai'

import type { BlobStoreWriteHandle } from '../blob-store/service'
import { externalizeMessageBlobs } from './message-blob-externalization'
import { extractMessageText } from './ui-message'

/**
 * Single durable-path seam: externalize oversized attachment/tool bytes and
 * text/reasoning overflow, then produce the content + messageJson primitives
 * each persist site embeds in its own fact shape. Every durable UIMessage
 * JSON.stringify must go through here.
 */
export function toDurableMessagePayload(input: {
  sessionId: string
  message: UIMessage
  d?: BlobStoreWriteHandle
}): { message: UIMessage, content: string, messageJson: string } {
  const message = externalizeMessageBlobs(input)
  return {
    message,
    content: extractMessageText(message),
    messageJson: JSON.stringify(message),
  }
}
