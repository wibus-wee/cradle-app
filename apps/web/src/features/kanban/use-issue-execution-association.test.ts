import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { runtimeSessionStatusQueryKey } from '~/features/chat/commands/runtime-session-status-command'
import {
  sessionDetailQueryKey,
  sessionQueueQueryKey,
  sessionsQueryKey,
} from '~/features/session/api/session-projection'
import {
  sessionGroupDetailQueryKey,
  sessionGroupsQueryKey,
} from '~/features/workspace/session-group-projection'

import type { IssueExecutionAssociationTransition } from './use-issue-execution-association'
import {
  reconcileIssueExecutionAssociation,
  useLinkIssue,
  useUnlinkIssue,
} from './use-issue-execution-association'
import { kanbanKeys } from './use-kanban'

const mocks = vi.hoisted(() => ({
  postLinkedIssue: vi.fn(),
  deleteLinkedIssue: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', async importOriginal => ({
  ...(await importOriginal<typeof import('~/api-gen/sdk.gen')>()),
  postSessionsByIdLinkedIssue: mocks.postLinkedIssue,
  deleteSessionsByIdLinkedIssue: mocks.deleteLinkedIssue,
}))

function transition(overrides: Partial<IssueExecutionAssociationTransition> = {}): IssueExecutionAssociationTransition {
  return {
    participantKind: 'session',
    participantId: 'session-1',
    previousIssueId: null,
    nextIssueId: 'issue-b',
    ...overrides,
  }
}

function seed(queryClient: QueryClient, keys: readonly (readonly unknown[])[]) {
  for (const key of keys) {
    queryClient.setQueryData(key as never, { seeded: true } as never)
  }
}

function invalidatedKeys(queryClient: QueryClient): string[] {
  return queryClient.getQueryCache().getAll().filter(query => query.state.isInvalidated).map(query => JSON.stringify(query.queryKey))
}

function expectInvalidated(queryClient: QueryClient, key: readonly unknown[]) {
  expect(invalidatedKeys(queryClient)).toContain(JSON.stringify(key))
}

function expectNotInvalidated(queryClient: QueryClient, key: readonly unknown[]) {
  expect(invalidatedKeys(queryClient)).not.toContain(JSON.stringify(key))
}

const sessionProjectionKeys = (sessionId: string) => [
  sessionDetailQueryKey(sessionId),
  sessionsQueryKey(),
  runtimeSessionStatusQueryKey(sessionId),
  sessionQueueQueryKey(sessionId),
  kanbanKeys.linkedIssueRef(sessionId),
] as const

const issueProjectionKeys = (issueId: string) => [
  kanbanKeys.linkedSessions(issueId),
  kanbanKeys.linkedSessionGroups(issueId),
] as const

describe('reconcileIssueExecutionAssociation', () => {
  it('reconciles the session participant and the new issue on link', async () => {
    const queryClient = new QueryClient()
    seed(queryClient, [
      ...sessionProjectionKeys('session-1'),
      ...issueProjectionKeys('issue-b'),
      ...issueProjectionKeys('issue-unrelated'),
      sessionGroupsQueryKey('workspace-1'),
      sessionGroupDetailQueryKey('group-1'),
    ])

    await reconcileIssueExecutionAssociation(queryClient, transition())

    for (const key of sessionProjectionKeys('session-1')) {
      expectInvalidated(queryClient, key)
    }
    for (const key of issueProjectionKeys('issue-b')) {
      expectInvalidated(queryClient, key)
    }
    for (const key of issueProjectionKeys('issue-unrelated')) {
      expectNotInvalidated(queryClient, key)
    }
    expectNotInvalidated(queryClient, sessionGroupsQueryKey('workspace-1'))
    expectNotInvalidated(queryClient, sessionGroupDetailQueryKey('group-1'))
  })

  it('reconciles only the previous issue on unlink', async () => {
    const queryClient = new QueryClient()
    seed(queryClient, [
      ...sessionProjectionKeys('session-1'),
      ...issueProjectionKeys('issue-a'),
      ...issueProjectionKeys('issue-b'),
    ])

    await reconcileIssueExecutionAssociation(queryClient, transition({
      previousIssueId: 'issue-a',
      nextIssueId: null,
    }))

    for (const key of issueProjectionKeys('issue-a')) {
      expectInvalidated(queryClient, key)
    }
    for (const key of issueProjectionKeys('issue-b')) {
      expectNotInvalidated(queryClient, key)
    }
  })

  it('reconciles both old and new issues on relink', async () => {
    const queryClient = new QueryClient()
    seed(queryClient, [
      ...sessionProjectionKeys('session-1'),
      ...issueProjectionKeys('issue-a'),
      ...issueProjectionKeys('issue-b'),
    ])

    await reconcileIssueExecutionAssociation(queryClient, transition({
      previousIssueId: 'issue-a',
      nextIssueId: 'issue-b',
    }))

    for (const key of [...issueProjectionKeys('issue-a'), ...issueProjectionKeys('issue-b')]) {
      expectInvalidated(queryClient, key)
    }
  })

  it('reconciles session-group participants through the group owner API', async () => {
    const queryClient = new QueryClient()
    seed(queryClient, [
      sessionGroupsQueryKey('workspace-1'),
      sessionGroupsQueryKey(),
      sessionGroupDetailQueryKey('group-1'),
      sessionGroupDetailQueryKey('group-other'),
      ...issueProjectionKeys('issue-a'),
      ...issueProjectionKeys('issue-b'),
      ...sessionProjectionKeys('group-1'),
    ])

    await reconcileIssueExecutionAssociation(queryClient, transition({
      participantKind: 'session-group',
      participantId: 'group-1',
      previousIssueId: 'issue-a',
      nextIssueId: 'issue-b',
    }))

    // Every cached group list variant refreshes, plus the group's detail.
    expectInvalidated(queryClient, sessionGroupsQueryKey('workspace-1'))
    expectInvalidated(queryClient, sessionGroupsQueryKey())
    expectInvalidated(queryClient, sessionGroupDetailQueryKey('group-1'))
    expectNotInvalidated(queryClient, sessionGroupDetailQueryKey('group-other'))
    for (const key of [...issueProjectionKeys('issue-a'), ...issueProjectionKeys('issue-b')]) {
      expectInvalidated(queryClient, key)
    }
    // A session-group transition never touches session projections — even a
    // session whose id collides with the participant id.
    for (const key of sessionProjectionKeys('group-1')) {
      expectNotInvalidated(queryClient, key)
    }
  })
})

describe('useLinkIssue / useUnlinkIssue', () => {
  function setup() {
    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    return { queryClient, wrapper }
  }

  it('link success consumes the typed transition and reconciles participant + next issue', async () => {
    const { queryClient, wrapper } = setup()
    seed(queryClient, [
      ...sessionProjectionKeys('session-1'),
      ...issueProjectionKeys('issue-a'),
      ...issueProjectionKeys('issue-b'),
    ])
    queryClient.setQueryData(kanbanKeys.linkedIssueRef('session-1'), { issueId: 'issue-a' })
    mocks.postLinkedIssue.mockResolvedValue({
      data: transition({ previousIssueId: 'issue-a', nextIssueId: 'issue-b' }),
    })

    const { result } = renderHook(() => useLinkIssue(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ chatSessionId: 'session-1', issueId: 'issue-b' })
    })

    await waitFor(() => {
      for (const key of sessionProjectionKeys('session-1')) {
        expectInvalidated(queryClient, key)
      }
      for (const key of issueProjectionKeys('issue-b')) {
        expectInvalidated(queryClient, key)
      }
    })
    // The previous issue's linked lists reconcile too (relink A → B).
    for (const key of issueProjectionKeys('issue-a')) {
      expectInvalidated(queryClient, key)
    }
  })

  it('unlink success reconciles participant + previous issue from the response', async () => {
    const { queryClient, wrapper } = setup()
    seed(queryClient, [
      ...sessionProjectionKeys('session-1'),
      ...issueProjectionKeys('issue-a'),
      ...issueProjectionKeys('issue-b'),
    ])
    mocks.deleteLinkedIssue.mockResolvedValue({
      data: transition({ previousIssueId: 'issue-a', nextIssueId: null }),
    })

    const { result } = renderHook(() => useUnlinkIssue(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('session-1')
    })

    await waitFor(() => {
      for (const key of sessionProjectionKeys('session-1')) {
        expectInvalidated(queryClient, key)
      }
      for (const key of issueProjectionKeys('issue-a')) {
        expectInvalidated(queryClient, key)
      }
    })
    for (const key of issueProjectionKeys('issue-b')) {
      expectNotInvalidated(queryClient, key)
    }
  })

  it('failed link returns participant, previous and attempted issue projections to server state', async () => {
    const { queryClient, wrapper } = setup()
    seed(queryClient, [
      ...sessionProjectionKeys('session-1'),
      ...issueProjectionKeys('issue-a'),
      ...issueProjectionKeys('issue-b'),
    ])
    // Cached ref records the server-confirmed previous link.
    queryClient.setQueryData(kanbanKeys.linkedIssueRef('session-1'), { issueId: 'issue-a' })
    mocks.postLinkedIssue.mockRejectedValue(new Error('issue_workspace_mismatch'))

    const { result } = renderHook(() => useLinkIssue(), { wrapper })
    await act(async () => {
      await expect(
        result.current.mutateAsync({ chatSessionId: 'session-1', issueId: 'issue-b' }),
      ).rejects.toThrow('issue_workspace_mismatch')
    })

    await waitFor(() => {
      for (const key of sessionProjectionKeys('session-1')) {
        expectInvalidated(queryClient, key)
      }
      for (const key of [...issueProjectionKeys('issue-a'), ...issueProjectionKeys('issue-b')]) {
        expectInvalidated(queryClient, key)
      }
    })
  })
})
