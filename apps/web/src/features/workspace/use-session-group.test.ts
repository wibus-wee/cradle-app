import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { kanbanKeys } from '~/features/kanban/use-kanban'
import { sessionDetailQueryKey, sessionsQueryKey } from '~/features/session/api/session-projection'

import { sessionGroupDetailQueryKey, sessionGroupsQueryKey } from './session-group-projection'
import { useCreateSessionGroup, useUpdateSessionGroup } from './use-session-group'

const mocks = vi.hoisted(() => ({
  patchSessionGroupsById: vi.fn(),
  postSessionGroups: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', async importOriginal => ({
  ...(await importOriginal<typeof import('~/api-gen/sdk.gen')>()),
  patchSessionGroupsById: mocks.patchSessionGroupsById,
  postSessionGroups: mocks.postSessionGroups,
}))

function setup() {
  const queryClient = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return { queryClient, wrapper }
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

function groupFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'group-1',
    workspaceId: 'workspace-1',
    title: 'Group',
    description: null,
    linkedIssueId: null,
    status: 'active',
    configJson: '{}',
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    sessionCount: 0,
    statusAggregate: 'idle',
    latestActivityAt: null,
    sessions: [],
    ...overrides,
  }
}

describe('session-group association reconciliation', () => {
  it('update with a relink transition reconciles group, session lists, and both issues', async () => {
    const { queryClient, wrapper } = setup()
    seed(queryClient, [
      sessionGroupsQueryKey('workspace-1'),
      sessionGroupDetailQueryKey('group-1'),
      sessionsQueryKey(),
      kanbanKeys.linkedSessions('issue-a'),
      kanbanKeys.linkedSessions('issue-b'),
      kanbanKeys.linkedSessionGroups('issue-a'),
      kanbanKeys.linkedSessionGroups('issue-b'),
    ])
    mocks.patchSessionGroupsById.mockResolvedValue({
      data: {
        group: groupFixture({ linkedIssueId: 'issue-b' }),
        association: {
          participantKind: 'session-group',
          participantId: 'group-1',
          previousIssueId: 'issue-a',
          nextIssueId: 'issue-b',
        },
      },
    })

    const { result } = renderHook(() => useUpdateSessionGroup('workspace-1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        path: { id: 'group-1' },
        body: { linkedIssueId: 'issue-b' },
      })
    })

    await waitFor(() => {
      expectInvalidated(queryClient, sessionGroupsQueryKey('workspace-1'))
      expectInvalidated(queryClient, sessionGroupDetailQueryKey('group-1'))
      expectInvalidated(queryClient, sessionsQueryKey())
      for (const issueId of ['issue-a', 'issue-b']) {
        expectInvalidated(queryClient, kanbanKeys.linkedSessions(issueId))
        expectInvalidated(queryClient, kanbanKeys.linkedSessionGroups(issueId))
      }
    })
    // The group transition must not invalidate a session detail projection.
    expectNotInvalidated(queryClient, sessionDetailQueryKey('group-1'))
  })

  it('update without linkedIssueId leaves issue projections untouched', async () => {
    const { queryClient, wrapper } = setup()
    seed(queryClient, [
      sessionGroupsQueryKey('workspace-1'),
      kanbanKeys.linkedSessions('issue-a'),
      kanbanKeys.linkedSessionGroups('issue-a'),
    ])
    mocks.patchSessionGroupsById.mockResolvedValue({
      data: { group: groupFixture({ title: 'Renamed' }), association: null },
    })

    const { result } = renderHook(() => useUpdateSessionGroup('workspace-1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        path: { id: 'group-1' },
        body: { title: 'Renamed' },
      })
    })

    await waitFor(() => {
      expectInvalidated(queryClient, sessionGroupsQueryKey('workspace-1'))
    })
    expectNotInvalidated(queryClient, kanbanKeys.linkedSessions('issue-a'))
    expectNotInvalidated(queryClient, kanbanKeys.linkedSessionGroups('issue-a'))
  })

  it('create-with-link reconciles the linked issue projections', async () => {
    const { queryClient, wrapper } = setup()
    seed(queryClient, [
      sessionGroupsQueryKey('workspace-1'),
      kanbanKeys.linkedSessionGroups('issue-a'),
      kanbanKeys.linkedSessions('issue-a'),
    ])
    mocks.postSessionGroups.mockResolvedValue({
      data: groupFixture({ linkedIssueId: 'issue-a' }),
    })

    const { result } = renderHook(() => useCreateSessionGroup('workspace-1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        body: { workspaceId: 'workspace-1', title: 'Linked group', linkedIssueId: 'issue-a' },
      })
    })

    await waitFor(() => {
      expectInvalidated(queryClient, sessionGroupsQueryKey('workspace-1'))
      expectInvalidated(queryClient, kanbanKeys.linkedSessionGroups('issue-a'))
      expectInvalidated(queryClient, kanbanKeys.linkedSessions('issue-a'))
    })
  })
})
