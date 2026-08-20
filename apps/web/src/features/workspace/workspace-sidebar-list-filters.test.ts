import { describe, expect, it } from 'vitest'

import { workspaceSessionFixtures } from './fixtures/workspace-sidebar'
import type { WorkspaceSession } from './use-session'
import { sessionMatchesListFilters } from './workspace-sidebar-list-filters'
import {
  DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS,
} from './workspace-sidebar-ui-store'

const noStreaming = new Set<string>()
const noAttention = new Map<string, 'userInput' | 'toolApproval'>()

function matchesErrorFilter(
  session: WorkspaceSession,
  locallyErroredSessionIds: ReadonlySet<string> = new Set(),
): boolean {
  return sessionMatchesListFilters(
    session,
    null,
    {
      ...DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS,
      statusFilters: ['error'],
    },
    noStreaming,
    locallyErroredSessionIds,
    noAttention,
  )
}

describe('sessionMatchesListFilters', () => {
  it('only treats unread session errors as error-filter matches', () => {
    const unreadError = {
      ...workspaceSessionFixtures.unread,
      status: 'error',
    } satisfies WorkspaceSession
    const readError = {
      ...unreadError,
      unread: false,
    }

    expect(matchesErrorFilter(unreadError)).toBe(true)
    expect(matchesErrorFilter(readError)).toBe(false)
  })

  it('applies unread state to locally observed session errors', () => {
    const unreadSession = workspaceSessionFixtures.unread
    const readSession = workspaceSessionFixtures.active
    const locallyErroredSessionIds = new Set([
      unreadSession.id,
      readSession.id,
    ])

    expect(matchesErrorFilter(unreadSession, locallyErroredSessionIds)).toBe(true)
    expect(matchesErrorFilter(readSession, locallyErroredSessionIds)).toBe(false)
  })
})
