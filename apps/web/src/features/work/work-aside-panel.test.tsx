import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkAsidePanel } from './work-aside-panel'

const mocks = vi.hoisted(() => ({
  reviewChanges: vi.fn(),
  repair: vi.fn(),
  getWorkDetail: vi.fn(),
  openWorkspaceDiffs: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('~/api-gen/@tanstack/react-query.gen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/api-gen/@tanstack/react-query.gen')>()
  return {
    ...actual,
    postWorkspacesByWorkspaceIdDiffReviewsLocalBranchCompareMutation: () => ({
      mutationFn: mocks.reviewChanges,
    }),
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./use-work', () => ({
  useWorkDetail: () => ({
    data: mocks.getWorkDetail(),
    refetch: vi.fn(),
  }),
}))

vi.mock('~/features/session/use-session-isolation', () => ({
  useRepairSessionIsolation: () => ({
    mutateAsync: mocks.repair,
    isPending: false,
    error: null,
  }),
}))

vi.mock('~/navigation/navigation-commands', () => ({
  openWorkspaceDiffs: mocks.openWorkspaceDiffs,
}))

vi.mock('~/components/ui/toast', () => ({
  toastManager: { add: mocks.toast },
}))

function createWorkDetail() {
  return {
    work: {
      id: 'work-1',
      title: 'Fix retries',
      objective: 'Make retries deterministic.',
      linkedIssueId: null,
      handoffTitle: 'Fix retries',
      handoffSummary: 'Implemented deterministic retries.',
      handoffTestPlan: 'Run focused tests.',
      preparedAt: 20,
      lastSubmittedAt: 10,
      closedAt: null,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 20,
    },
    primaryThread: {
      id: 'session-1',
      workspaceId: 'workspace-1',
    },
    execution: {
      worktreeId: 'worktree-1',
      worktreeBranch: 'cradle/wt/work-1',
      worktreeHealth: 'ok',
    },
    readiness: {
      isolated: true,
      clean: true,
      branch: 'cradle/wt/work-1',
      baseRef: 'base',
      commitsAhead: 1,
      changedFiles: 0,
    },
    pullRequest: null,
    activity: 'idle',
  }
}

describe('work aside panel reference view', () => {
  beforeEach(() => {
    mocks.reviewChanges.mockReset().mockResolvedValue({ id: 'review-1' })
    mocks.repair.mockReset().mockResolvedValue(undefined)
    mocks.getWorkDetail.mockReset().mockReturnValue(createWorkDetail())
    mocks.openWorkspaceDiffs.mockReset()
    mocks.toast.mockReset()
  })

  afterEach(cleanup)

  it('opens a committed branch comparison from the execution section', async () => {
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkAsidePanel workId="work-1" />
      </QueryClientProvider>,
    )

    fireEvent.click(view.getByText('aside.reviewChanges'))

    await waitFor(() => expect(mocks.reviewChanges).toHaveBeenCalledWith({
      path: { workspaceId: 'workspace-1' },
      body: {
        baseRef: 'base',
        headRef: 'cradle/wt/work-1',
      },
    }, expect.anything()))
    expect(mocks.openWorkspaceDiffs).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      reviewId: 'review-1',
    })
  })
})
