import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'

import { useChatStore } from '~/store/chat'
import { useRendererChatStore } from '~/store/renderer-chat'

import { readRetainableStreamingSessionIds } from './streaming-session-retention'

function resetChatStore(store: typeof useChatStore): void {
  store.setState(state => ({
    ...state,
    messagesMap: new Map(),
    hydratedSessionIds: new Set(),
    runStateMap: new Map(),
    activeAbortControllers: new Map(),
    runDisplayMetaMap: new Map(),
    errorMap: new Map(),
    assistantDisplaySplitMap: new Map(),
  }))
}

function appendStreamingMessage(store: typeof useChatStore, sessionId: string, messageId: string): void {
  const message: UIMessage = {
    id: messageId,
    role: 'assistant',
    parts: [{ type: 'text', text: 'Streaming' }],
  }
  store.getState().appendMessage(sessionId, message)
  store.getState().startGeneration(sessionId, messageId, new AbortController())
}

describe('streaming session retention', () => {
  beforeEach(() => {
    resetChatStore(useChatStore)
    resetChatStore(useRendererChatStore)
  })

  it('retains streaming sessions from the main chat store', () => {
    appendStreamingMessage(useChatStore, 'session-1', 'assistant-1')

    expect(readRetainableStreamingSessionIds(useChatStore.getState())).toEqual(['session-1'])
  })

  it('does not see renderer-only side or provider-thread live store entries', () => {
    appendStreamingMessage(useChatStore, 'session-1', 'assistant-1')
    appendStreamingMessage(useRendererChatStore, 'side:side-conversation-1', 'side-assistant-1')
    appendStreamingMessage(useRendererChatStore, 'provider-thread:session-1:thread-1', 'thread-assistant-1')

    expect(readRetainableStreamingSessionIds(useChatStore.getState())).toEqual(['session-1'])
    expect(useChatStore.getState().messagesMap.has('side:side-conversation-1')).toBe(false)
    expect(useChatStore.getState().messagesMap.has('provider-thread:session-1:thread-1')).toBe(false)
  })
})
