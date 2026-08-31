import type { PullRequestDetailViewProps } from './PullRequestDetailView'
import type { PullRequestListViewProps } from './PullRequestListView'

const pullRequest = {
  owner: 'cradle',
  repo: 'cradle',
  number: 42,
  url: 'https://github.com/cradle/cradle/pull/42',
  title: 'feat(mobile): add focused mobile controller',
  isDraft: true,
  state: 'open' as const,
  merged: false,
  headRef: 'cradle/wt/mobile',
  baseRef: 'main',
  headSha: 'abc123',
  createdAt: 1_750_000_000,
  updatedAt: 1_750_000_100,
  additions: 420,
  deletions: 12,
  checksState: 'pending' as const,
}

export const pullRequestListFixture: PullRequestListViewProps = {
  authored: [pullRequest],
  reviewing: [],
  login: 'demo',
  onOpen: () => {},
  onOpenUsage: () => {},
}

export const pullRequestDetailFixture: PullRequestDetailViewProps = {
  detail: {
    pullRequest: {
      ...pullRequest,
      allowedMergeMethods: ['squash'],
      assignees: [],
      author: {
        avatarUrl: 'https://github.com/demo.png',
        login: 'demo',
        url: 'https://github.com/demo',
      },
      baseRef: 'main',
      body: 'Adds a focused controller workflow for Mobile.',
      canMerge: false,
      changedFiles: 7,
      checks: [{
        conclusion: null,
        id: 'check-1',
        name: 'Mobile',
        status: 'in_progress',
        url: null,
      }],
      closedAtIso: null,
      comments: 1,
      commits: 2,
      createdAtIso: '2025-06-15T15:06:40.000Z',
      labels: [{ color: '3b82f6', name: 'mobile' }],
      mergeable: true,
      mergeableState: 'clean',
      mergeBlockers: ['Pull request is still a draft.'],
      mergedAtIso: null,
      reviewComments: 0,
      reviewers: [],
      updatedAtIso: '2025-06-15T15:08:20.000Z',
    },
    files: [],
    timeline: [],
  },
  onComment: async () => {},
  onOpenExternal: async () => {},
  onReview: async () => {},
}
