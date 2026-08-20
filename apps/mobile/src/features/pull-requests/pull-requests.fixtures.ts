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
  onNavigate: () => {},
  onOpen: () => {},
  onOpenUsage: () => {},
}
