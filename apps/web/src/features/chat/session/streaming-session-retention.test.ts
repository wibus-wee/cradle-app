import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'

import { useChatStore } from '~/store/chat'

import {
  isRendererOnlyChatViewId,
  readRetainableStreamingSessionIds,
} from './streaming-session-retention'

function resetChatStore(): void {
  useChatStore.setState(state => ({
    ...state,
    messagesMap: new Map(),
    hydratedSessionIds: new Set(),
    generatingMessageIds: new Set(),
    passiveStreamingMessageIds: new Set(),
    activeAbortControllers: new Map(),
    runDisplayMetaMap: new Map(),
    errorMap: new Map(),
    sessionMetaMap: new Map(),
    assistantDisplaySplitMap: new Map(),
  }))
}

function appendStreamingMessage(sessionId: string, messageId: string): void {
  const message: UIMessage = {
    id: messageId,
    role: 'assistant',
    parts: [{ type: 'text', text: 'Streaming' }],
  }
  useChatStore.getState().appendMessage(sessionId, message)
  useChatStore.getState().startGeneration(sessionId, messageId, new AbortController())
}

describe('streaming session retention', () => {
  beforeEach(() => {
    resetChatStore()
  })

  it('retains only durable chat sessions and ignores renderer-only side views', () => {
    appendStreamingMessage('session-1', 'assistant-1')
    appendStreamingMessage('side:side-conversation-1', 'side-assistant-1')
    appendStreamingMessage('provider-thread:session-1:thread-1', 'thread-assistant-1')

    expect(isRendererOnlyChatViewId('side:side-conversation-1')).toBe(true)
    expect(isRendererOnlyChatViewId('provider-thread:session-1:thread-1')).toBe(true)
    expect(isRendererOnlyChatViewId('session-1')).toBe(false)
    expect(readRetainableStreamingSessionIds(useChatStore.getState())).toEqual(['session-1'])
  })
})
