import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { GetSessionsResponse } from '~/api-gen/types.gen'

import { sessionsQueryKey, updateSessionInSessionLists } from './use-session'

type SessionRow = GetSessionsResponse['items'][number]

function createSessionRow(overrides: Partial<SessionRow> & Pick<SessionRow, 'id'>): SessionRow {
  const now = 1_700_000_000
  const { id, ...rest } = overrides
  return {
    id,
    execution: { kind: 'local' },
    parentSessionId: null,
    sideContextSource: null,
    workspaceId: 'workspace-1',
    title: 'Session',
    origin: 'manual',
    providerTargetId: null,
    agentId: null,
    modelId: null,
    thinkingEffort: null,
    linkedIssueId: null,
    sessionGroupId: null,
    runtimeKind: 'standard',
    status: 'idle',
    pinned: 0,
    archivedAt: null,
    lastReadAt: null,
    createdAt: now,
    updatedAt: now,
    activityAt: now,
    latestUserMessageAt: null,
    latestAssistantMessageAt: null,
    unread: false,
    isIsolated: false,
    worktreeId: null,
    worktreeBranch: null,
    worktreePath: null,
    worktreeHealth: null,
    pendingWorktreeId: null,
    isolationBoundaryRequired: false,
    ...rest,
  }
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

describe('updateSessionInSessionLists', () => {
  it('preserves an existing session status when the patch omits status', () => {
    const queryClient = createQueryClient()
    const queryKey = sessionsQueryKey('workspace-1')
    queryClient.setQueryData<GetSessionsResponse>(queryKey, {
      items: [createSessionRow({ id: 'session-1', status: 'idle' })],
      nextCursor: null,
    })

    updateSessionInSessionLists(queryClient, {
      id: 'session-1',
      title: 'Renamed',
    })

    expect(queryClient.getQueryData<GetSessionsResponse>(queryKey)).toEqual({
      items: [expect.objectContaining({
          id: 'session-1',
          title: 'Renamed',
          status: 'idle',
        })],
      nextCursor: null,
    })
  })

  it('defaults inserted non-promoted sessions to idle', () => {
    const queryClient = createQueryClient()
    const queryKey = sessionsQueryKey('workspace-1')
    queryClient.setQueryData<GetSessionsResponse>(queryKey, { items: [], nextCursor: null })

    updateSessionInSessionLists(queryClient, {
      id: 'session-2',
      workspaceId: 'workspace-1',
      title: 'External session',
    })

    expect(queryClient.getQueryData<GetSessionsResponse>(queryKey)).toEqual({
      items: [expect.objectContaining({
          id: 'session-2',
          status: 'idle',
        })],
      nextCursor: null,
    })
  })

  it('defaults inserted promoted sessions to streaming', () => {
    const queryClient = createQueryClient()
    const queryKey = sessionsQueryKey('workspace-1')
    queryClient.setQueryData<GetSessionsResponse>(queryKey, { items: [], nextCursor: null })

    updateSessionInSessionLists(queryClient, {
      id: 'session-3',
      workspaceId: 'workspace-1',
      title: 'Submitted session',
    }, { promote: true })

    expect(queryClient.getQueryData<GetSessionsResponse>(queryKey)).toEqual({
      items: [expect.objectContaining({
          id: 'session-3',
          status: 'streaming',
        })],
      nextCursor: null,
    })
  })

  it('keeps optimistic list pages bounded', () => {
    const queryClient = createQueryClient()
    const queryKey = sessionsQueryKey('workspace-1')
    queryClient.setQueryData<GetSessionsResponse>(queryKey, {
      items: Array.from({ length: 200 }, (_, index) => createSessionRow({
        id: `session-${index}`,
      })),
      nextCursor: 'next-page',
    })

    updateSessionInSessionLists(queryClient, {
      id: 'new-session',
      workspaceId: 'workspace-1',
      title: 'New session',
    }, { promote: true })

    const page = queryClient.getQueryData<GetSessionsResponse>(queryKey)
    expect(page?.items).toHaveLength(200)
    expect(page?.items[0]?.id).toBe('new-session')
    expect(page?.items.some(session => session.id === 'session-199')).toBe(false)
  })
})
