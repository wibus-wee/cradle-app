import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkHeaderChrome } from './work-header-chrome'

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  markReady: vi.fn(),
  getWorkDetail: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./use-work', () => ({
  useWorkDetail: () => ({ data: mocks.getWorkDetail() }),
  useSubmitWork: () => ({ mutateAsync: mocks.submit, isPending: false, error: null }),
}))

vi.mock('~/features/session/use-session-pull-request', () => ({
  useMarkSessionPullRequestReady: () => ({ mutateAsync: mocks.markReady, isPending: false }),
}))

vi.mock('~/components/ui/toast', () => ({
  toastManager: { add: mocks.toast },
}))

function createWorkDetail(options: { submitted?: boolean } = {}) {
  const submitted = options.submitted ?? false
  return {
    work: {
      id: 'work-1',
      title: 'Fix retries',
      objective: 'Make retries deterministic.',
      linkedIssueId: null,
      handoffTitle: 'Fix retries',
      handoffSummary: null,
      handoffTestPlan: null,
      preparedAt: 20,
      lastSubmittedAt: submitted ? 20 : 10,
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
    pullRequest: submitted
      ? {
          owner: 'cradle',
          repo: 'app',
          number: 14,
          url: 'https://github.com/cradle/app/pull/14',
          title: 'Fix retries',
          isDraft: true,
          state: 'open',
          merged: false,
          headRef: 'cradle/wt/work-1',
          baseRef: 'main',
          headSha: 'head',
          createdAt: 1,
          updatedAt: 2,
        }
      : null,
    activity: 'idle',
  }
}

describe('work header chrome delivery actions', () => {
  beforeEach(() => {
    mocks.submit.mockReset().mockResolvedValue(undefined)
    mocks.markReady.mockReset().mockResolvedValue({
      ...createWorkDetail({ submitted: true }).pullRequest,
      isDraft: false,
    })
    mocks.getWorkDetail.mockReset().mockReturnValue(createWorkDetail())
    mocks.toast.mockReset()
  })

  afterEach(cleanup)

  it('submits only after the user clicks Create Draft PR', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkHeaderChrome workId="work-1" />
      </QueryClientProvider>,
    )

    expect(mocks.submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('work-submit'))
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(mocks.submit).toHaveBeenCalledWith({
      path: { id: 'work-1' },
      body: {},
    })
  })

  it('marks the submitted draft ready and reports success', async () => {
    mocks.getWorkDetail.mockReturnValue(createWorkDetail({ submitted: true }))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkHeaderChrome workId="work-1" />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByTestId('work-mark-ready'))

    await waitFor(() => expect(mocks.markReady).toHaveBeenCalledWith('session-1'))
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      title: 'aside.markReadySuccessTitle',
    }))
  })
})
