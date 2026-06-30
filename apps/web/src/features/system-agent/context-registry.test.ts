import { describe, expect, it, vi } from 'vitest'

import { useSurfaceStore } from '~/navigation/surface-store'
import { useChatStore } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'
import { useNewChatStore } from '~/store/new-chat'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import { readSystemAgentContextItems } from './system-context-provider'

const readActiveSurfaceMock = vi.hoisted(() => vi.fn())

vi.mock('~/navigation/active-surface', () => ({
  readActiveSurface: readActiveSurfaceMock,
}))

describe('system-agent Jarvis context provider', () => {
  it('represents current shell stores as typed context items', () => {
    readActiveSurfaceMock.mockReturnValue({
      id: 'chat:session-1',
      kind: 'chat',
      title: 'Architecture discussion',
      route: { to: '/chat/$sessionId', params: { sessionId: 'session-1' } },
    })
    useSurfaceStore.setState({
      surfaces: [
        { id: 'home', kind: 'home', title: 'Home', route: { to: '/' }, order: 0, closable: false },
        {
          id: 'chat:session-1',
          kind: 'chat',
          title: 'Architecture discussion',
          route: { to: '/chat/$sessionId', params: { sessionId: 'session-1' } },
          order: 1,
          closable: true,
        },
      ],
    })
    useChatStore.getState().setMessages('session-1', [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Can you inspect the context model?' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'The current model is too shallow.' }] },
    ])
    useLayoutStore.setState({ sidebarCollapsed: true, asideOpen: true, asideActiveTab: 'browser', bottomPanelOpen: false })
    useSettingsOverlayStore.setState({ settingsSection: 'general' })
    useNewChatStore.setState({ lastAgentProfileId: 'profile-1' })

    const items = readSystemAgentContextItems(1779781200000)

    expect(items.map(item => [item.kind, item.title, item.owner])).toEqual([
      ['view', 'Active view', 'system-agent'],
      ['view', 'Open surfaces', 'system-agent'],
      ['history', 'Active chat summary', 'system-agent'],
      ['layout', 'Layout', 'system-agent'],
      ['entity', 'Active Jarvis profile', 'system-agent'],
    ])
    expect(items.find(item => item.title === 'Active chat summary')).toMatchObject({
      references: [{
        kind: 'chat-session',
        id: 'session-1',
        label: 'session-1',
      }],
      content: 'last message: [assistant] The current model is too shallow.',
    })
  })
})
