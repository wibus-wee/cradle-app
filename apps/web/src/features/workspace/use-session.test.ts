import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { GetSessionsResponse } from '~/api-gen/types.gen'

import { sessionsQueryKey, updateSessionInSessionLists } from './use-session'

type SessionRow = GetSessionsResponse[number]

function createSessionRow(overrides: Partial<SessionRow> & Pick<SessionRow, 'id'>): SessionRow {
  const now = 1_700_000_000
  const { id, ...rest } = overrides
  return {
    id,
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
    runtimeKind: 'standard',
    status: 'idle',
    pinned: 0,
    archivedAt: null,
    lastReadAt: null,
    createdAt: now,
    updatedAt: now,
    latestUserMessageAt: null,
    latestAssistantMessageAt: null,
    unread: false,
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
    queryClient.setQueryData<GetSessionsResponse>(queryKey, [
      createSessionRow({ id: 'session-1', status: 'idle' }),
    ])

    updateSessionInSessionLists(queryClient, {
      id: 'session-1',
      title: 'Renamed',
    })

    expect(queryClient.getQueryData<GetSessionsResponse>(queryKey)).toEqual([
      expect.objectContaining({
        id: 'session-1',
        title: 'Renamed',
        status: 'idle',
      }),
    ])
  })

  it('defaults inserted non-promoted sessions to idle', () => {
    const queryClient = createQueryClient()
    const queryKey = sessionsQueryKey('workspace-1')
    queryClient.setQueryData<GetSessionsResponse>(queryKey, [])

    updateSessionInSessionLists(queryClient, {
      id: 'session-2',
      workspaceId: 'workspace-1',
      title: 'External session',
    })

    expect(queryClient.getQueryData<GetSessionsResponse>(queryKey)).toEqual([
      expect.objectContaining({
        id: 'session-2',
        status: 'idle',
      }),
    ])
  })

  it('defaults inserted promoted sessions to streaming', () => {
    const queryClient = createQueryClient()
    const queryKey = sessionsQueryKey('workspace-1')
    queryClient.setQueryData<GetSessionsResponse>(queryKey, [])

    updateSessionInSessionLists(queryClient, {
      id: 'session-3',
      workspaceId: 'workspace-1',
      title: 'Submitted session',
    }, { promote: true })

    expect(queryClient.getQueryData<GetSessionsResponse>(queryKey)).toEqual([
      expect.objectContaining({
        id: 'session-3',
        status: 'streaming',
      }),
    ])
  })
})
