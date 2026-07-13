import { afterEach, describe, expect, it } from 'vitest'

import { useTerminalPanelStore } from './terminal-panel-store'

afterEach(() => {
  useTerminalPanelStore.setState({ owners: {} })
})

describe('terminal panel store', () => {
  it('removes an owner and returns the sessions that need PTY cleanup', () => {
    const store = useTerminalPanelStore.getState()

    store.registerOwner('chat:session-1', '/tmp/workspace')
    store.addSession('chat:session-1', '/tmp/workspace')

    const sessions = useTerminalPanelStore.getState().removeOwner('chat:session-1')

    expect(sessions.map(session => session.id)).toEqual([
      'terminal:chat:session-1:1',
      'terminal:chat:session-1:2',
    ])
    expect(useTerminalPanelStore.getState().owners['chat:session-1']).toBeUndefined()
  })

  it('returns an empty cleanup list for an unknown owner', () => {
    expect(useTerminalPanelStore.getState().removeOwner('chat:missing')).toEqual([])
  })

  it('returns null when removing a missing session', () => {
    const store = useTerminalPanelStore.getState()

    store.registerOwner('chat:session-1', '/tmp/workspace')

    expect(store.removeSession('chat:session-1', 'terminal:chat:session-1:missing')).toBeNull()
    expect(store.removeSession('chat:missing', 'terminal:chat:missing:1')).toBeNull()
    expect(useTerminalPanelStore.getState().owners['chat:session-1']!.sessions).toHaveLength(1)
  })

  it('leaves an empty owner instead of creating a replacement when the last session closes', () => {
    const store = useTerminalPanelStore.getState()

    store.registerOwner('chat:session-1', '/tmp/workspace')
    const sessionId = useTerminalPanelStore.getState().owners['chat:session-1']!.activeSessionId!

    const remainingCount = store.removeSession('chat:session-1', sessionId)

    expect(remainingCount).toBe(0)
    expect(useTerminalPanelStore.getState().owners['chat:session-1']).toMatchObject({
      sessions: [],
      activeSessionId: null,
      nextIndex: 2,
    })
  })

  it('creates a new session only when an empty owner is registered again', () => {
    const store = useTerminalPanelStore.getState()

    store.registerOwner('chat:session-1', '/tmp/workspace')
    store.removeSession('chat:session-1', 'terminal:chat:session-1:1')

    expect(useTerminalPanelStore.getState().owners['chat:session-1']!.sessions).toEqual([])

    store.registerOwner('chat:session-1', '/tmp/workspace')

    expect(useTerminalPanelStore.getState().owners['chat:session-1']).toMatchObject({
      sessions: [{ id: 'terminal:chat:session-1:2' }],
      activeSessionId: 'terminal:chat:session-1:2',
      nextIndex: 3,
    })
  })

  it('adds tabs to the focused pane and can split that pane for simultaneous terminals', () => {
    const store = useTerminalPanelStore.getState()
    store.registerOwner('chat:session-1', '/tmp/workspace')
    store.addSession('chat:session-1', '/tmp/workspace')
    store.splitSession('chat:session-1', '/tmp/workspace', 'horizontal')

    expect(useTerminalPanelStore.getState().owners['chat:session-1']).toMatchObject({
      activeSessionId: 'terminal:chat:session-1:3',
      layout: {
        type: 'split',
        direction: 'horizontal',
        children: [
          {
            type: 'terminal',
            sessionIds: ['terminal:chat:session-1:1', 'terminal:chat:session-1:2'],
            activeSessionId: 'terminal:chat:session-1:2',
          },
          {
            type: 'terminal',
            sessionIds: ['terminal:chat:session-1:3'],
          },
        ],
      },
    })
  })
})
