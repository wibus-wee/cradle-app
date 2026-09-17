import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppSurface } from './surface-identity'
import {
  releaseSurfaceResources,
  selectClosedChatSessionIds,
} from './surface-resource-lifecycle'

const draftLifecycleMocks = vi.hoisted(() => ({
  discardComposerDraftSurface: vi.fn(),
}))

vi.mock('~/features/chat/composer/draft/composer-draft-lifecycle', () => draftLifecycleMocks)

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selects only CLI TUI candidates whose chat surface was closed', () => {
    expect(selectClosedChatSessionIds(
      [chatSurface('one', 0), chatSurface('two', 1)],
      [chatSurface('two', 0)],
    )).toEqual(['one'])
  })

  it('releases retained TUI runtimes without stopping their server PTYs', () => {
    const releaseTuiSessions = vi.fn()

    releaseSurfaceResources(
      [chatSurface('one', 0), chatSurface('two', 1)],
      [chatSurface('two', 0)],
      vi.fn(),
      vi.fn(),
      releaseTuiSessions,
    )

    expect(releaseTuiSessions).toHaveBeenCalledWith(['one'])
  })

  it('routes closed surfaces through the single draft discard operation', () => {
    releaseSurfaceResources(
      [chatSurface('one', 0), chatSurface('two', 1)],
      [chatSurface('two', 0)],
      vi.fn(),
      vi.fn(),
      vi.fn(),
    )

    expect(draftLifecycleMocks.discardComposerDraftSurface).toHaveBeenCalledTimes(1)
    expect(draftLifecycleMocks.discardComposerDraftSurface).toHaveBeenCalledWith('chat:one')
  })
})
