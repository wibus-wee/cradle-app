import { describe, expect, it } from 'vitest'

import type { WorkSummary } from './use-work'
import { hasOpenWorkPullRequest } from './use-work'

function createWork(pullRequest: WorkSummary['pullRequest']): WorkSummary {
  return {
    id: 'work-1',
    workspaceId: 'workspace-1',
    primarySessionId: 'session-1',
    title: 'Refresh pull request state',
    objective: 'Keep the sidebar current.',
    linkedIssueId: null,
    handoffTitle: null,
    handoffSummary: null,
    handoffTestPlan: null,
    preparedAt: null,
    lastSubmittedAt: null,
    closedAt: null,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    activity: 'idle',
    pullRequest,
  }
}

const openPullRequest: NonNullable<WorkSummary['pullRequest']> = {
  owner: 'cradle',
  repo: 'app',
  number: 41,
  url: 'https://example.test/pull/41',
  title: 'Refresh status',
  isDraft: false,
  state: 'open',
  merged: false,
  headRef: 'cradle/wt/refresh-status',
  baseRef: 'main',
  headSha: 'abc123',
  createdAt: 1,
  updatedAt: 1,
}

describe('hasOpenWorkPullRequest', () => {
  it('continues sidebar refreshes only while a Work pull request is open', () => {
    expect(hasOpenWorkPullRequest(undefined)).toBe(false)
    expect(hasOpenWorkPullRequest([createWork(null)])).toBe(false)
    expect(hasOpenWorkPullRequest([createWork(openPullRequest)])).toBe(true)
    expect(hasOpenWorkPullRequest([
      createWork({ ...openPullRequest, state: 'closed', merged: true }),
    ])).toBe(false)
  })
})
