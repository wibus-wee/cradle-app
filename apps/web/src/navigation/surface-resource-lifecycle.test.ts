import { describe, expect, it, vi } from 'vitest'

import type { AppSurface } from './surface-identity'
import {
  releaseSurfaceResources,
  selectClosedChatSessionIds,
} from './surface-resource-lifecycle'

function chatSurface(sessionId: string, order: number): AppSurface {
  return {
    id: `chat:${sessionId}`,
    kind: 'chat',
    title: sessionId,
    route: { to: '/chat/$sessionId', params: { sessionId } },
    order,
    closable: true,
  }
}

describe('surface resource lifecycle', () => {
  it('selects only CLI TUI candidates whose chat surface was closed', () => {
    expect(selectClosedChatSessionIds(
      [chatSurface('one', 0), chatSurface('two', 1)],
      [chatSurface('two', 0)],
    )).toEqual(['one'])
  })

  it('disposes retained TUI runtimes when their chat surface closes', () => {
    const disposeTuiSessions = vi.fn()

    releaseSurfaceResources(
      [chatSurface('one', 0), chatSurface('two', 1)],
      [chatSurface('two', 0)],
      vi.fn(),
      vi.fn(),
      disposeTuiSessions,
    )

    expect(disposeTuiSessions).toHaveBeenCalledWith(['one'])
  })
})
