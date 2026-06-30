import { describe, expect, it } from 'vitest'

import { createContextRegistry } from '~/features/context/context-registry'

import {
  clearChatAttentionSnapshot,
  createChatContextProvider,
  updateChatAttentionSnapshot,
} from './chat-context'

describe('chat attention context', () => {
  it('publishes active chat attention as typed context', () => {
    clearChatAttentionSnapshot('session-1')
    updateChatAttentionSnapshot('session-1', {
      messageCount: 24,
      firstVisibleIndex: 4,
      lastVisibleIndex: 9,
      scrollRatio: 0.42,
      isAtBottom: false,
      focusedArea: 'message-list',
      updatedAt: 1779782400000,
    })
    const registry = createContextRegistry({
      readActiveSurface: () => ({ id: 'chat:session-1', type: 'chat', params: { sessionId: 'session-1' }, search: {} }),
      readNow: () => 1779782400000,
      createEnvelopeId: now => `ctx-${now}`,
    })
    registry.setProvider(createChatContextProvider())

    expect(registry.collectEnvelope().items).toEqual([
      expect.objectContaining({
        id: 'chat:attention:session-1',
        kind: 'attention',
        owner: 'chat',
        title: 'Chat attention',
        summary: 'User manually scrolled away from the latest messages. Focused area: message-list.',
        content: 'visible messages: 5-10 of 24; scroll progress: 42%',
        priority: 90,
        freshness: 'live',
        sensitivity: 'private',
        references: [{
          kind: 'chat-session',
          id: 'session-1',
          label: 'session-1',
        }],
      }),
    ])
  })
})
