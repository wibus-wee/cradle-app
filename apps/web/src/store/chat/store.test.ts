import { describe, expect, it } from 'vitest'

import { chatSelectors, createChatStore } from './store'

describe('chat store selectors', () => {
  it('returns a stable streaming message id set while membership is unchanged', () => {
    const store = createChatStore()

    const idleIds = chatSelectors.streamingMessageIdSet(store.getState())
    expect(chatSelectors.streamingMessageIdSet(store.getState())).toBe(idleIds)
    expect(idleIds.size).toBe(0)

    store.getState().startGeneration('session-a', 'message-a', new AbortController())
    const activeIds = chatSelectors.streamingMessageIdSet(store.getState())
    expect(chatSelectors.streamingMessageIdSet(store.getState())).toBe(activeIds)
    expect([...activeIds]).toEqual(['message-a'])

    store.getState().setMessages('session-a', [{
      id: 'user-a',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    }])
    expect(chatSelectors.streamingMessageIdSet(store.getState())).toBe(activeIds)

    store.getState().startGeneration('session-b', 'message-b', new AbortController())
    const nextActiveIds = chatSelectors.streamingMessageIdSet(store.getState())
    expect(nextActiveIds).not.toBe(activeIds)
    expect(new Set(nextActiveIds)).toEqual(new Set(['message-a', 'message-b']))

    store.getState().finishGeneration('message-a')
    store.getState().finishGeneration('message-b')
    expect(chatSelectors.streamingMessageIdSet(store.getState())).toBe(idleIds)
  })

  it('does not replace leased stream content with an empty snapshot row', () => {
    const store = createChatStore()

    store.getState().setMessages('session-a', [{
      id: 'assistant-a',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Streaming text' }],
    }])
    store.getState().acquireStreamLease({
      sessionId: 'session-a',
      messageId: 'assistant-a',
      source: 'passive',
    })
    store.getState().setMessages('session-a', [{
      id: 'assistant-a',
      role: 'assistant',
      parts: [],
    }])

    expect(chatSelectors.messages('session-a')(store.getState())[0]?.parts).toEqual([
      { type: 'text', text: 'Streaming text' },
    ])
  })
})
