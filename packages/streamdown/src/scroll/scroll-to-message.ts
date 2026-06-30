import type { RefObject } from 'react'

interface ScrollToMessageOptions {
  /** Map of message ID to list index */
  messageIndexMap: Map<string, number>
  /** Virtual list ref with scrollToIndex method */
  virtualListRef: RefObject<{ scrollToIndex: (index: number, options?: { align?: 'start' | 'center' | 'end' }) => void } | null>
  /** Alignment within viewport */
  align?: 'start' | 'center' | 'end'
}

/**
 * Scroll to a specific message by ID.
 * Looks up the index in the messageIndexMap and calls virtualListRef.scrollToIndex().
 *
 * @returns true if message was found and scrolled to, false otherwise
 */
export function scrollToMessage(
  messageId: string,
  options: ScrollToMessageOptions,
): boolean {
  const { messageIndexMap, virtualListRef, align = 'center' } = options
  const index = messageIndexMap.get(messageId)

  if (index === undefined || !virtualListRef.current) {
    return false
  }

  virtualListRef.current.scrollToIndex(index, { align })
  return true
}

/**
 * Build a message index map from a list of messages.
 */
export function buildMessageIndexMap(messages: { id: string }[]): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i < messages.length; i++) {
    map.set(messages[i].id, i)
  }
  return map
}
