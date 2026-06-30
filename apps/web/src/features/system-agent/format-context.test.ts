import { describe, expect, it } from 'vitest'

import { formatContextEnvelopeForAgent, formatContextForAgent } from './format-context'

describe('jarvis context formatting', () => {
  it('keeps the legacy snapshot formatter available during migration', () => {
    expect(formatContextForAgent({
      activeSurface: {
        type: 'chat',
        label: 'Architecture discussion',
        params: { sessionId: 'session-1' },
      },
      openSurfaces: [{ type: 'chat', label: 'Architecture discussion' }],
      chatContext: null,
      layout: {
        sidebarCollapsed: false,
        asideOpen: false,
        asideActiveTab: 'browser',
        bottomPanelOpen: false,
        settingsOpen: false,
        settingsSection: 'general',
      },
      activeProfileId: null,
      unreadSessionIds: [],
    })).toBe([
      '<cradle_context>',
      'viewing: Architecture discussion (chat)',
      '  params: sessionId=session-1',
      '</cradle_context>',
    ].join('\n'))
  })

  it('formats typed context envelopes by priority with references and content', () => {
    const text = formatContextEnvelopeForAgent({
      id: 'ctx-1',
      capturedAt: 1779781200000,
      activeSurfaceId: 'chat:session-1',
      activeSurfaceType: 'chat',
      activeSurfaceParams: { sessionId: 'session-1' },
      activeSurfaceSearch: {},
      items: [
        {
          id: 'layout-1',
          kind: 'layout',
          owner: 'system-agent',
          title: 'Layout',
          summary: 'sidebar collapsed',
          priority: 10,
          freshness: 'live',
          sensitivity: 'public',
          tokenEstimate: 4,
          createdAt: 1779781200000,
        },
        {
          id: 'chat-1',
          kind: 'attention',
          owner: 'chat',
          title: 'Chat viewport',
          summary: 'User is viewing historical messages.',
          content: 'visible messages: 12-18 of 42',
          references: [{
            kind: 'chat-session',
            id: 'session-1',
            label: 'Architecture discussion',
          }],
          priority: 90,
          freshness: 'live',
          sensitivity: 'private',
          tokenEstimate: 12,
          createdAt: 1779781200000,
        },
      ],
    })

    expect(text).toBe([
      '<cradle_context>',
      'attention: Chat viewport - User is viewing historical messages.',
      '  content: visible messages: 12-18 of 42',
      '  refs: chat-session:Architecture discussion',
      'layout: Layout - sidebar collapsed',
      '</cradle_context>',
    ].join('\n'))
  })
})
