import type { PullRequestListItem } from './pull-request-list-view-contract'

export const pullRequestGroupTitles = ['Today', 'This week', 'Older'] as const

export function pullRequestGroup(updatedAt: number): typeof pullRequestGroupTitles[number] {
  const timestamp = updatedAt < 10_000_000_000 ? updatedAt * 1_000 : updatedAt
  const age = Date.now() - timestamp
  if (age < 86_400_000) { return 'Today' }
  if (age < 604_800_000) { return 'This week' }
  return 'Older'
}

export function pullRequestMatchesSearch(
  pullRequest: PullRequestListItem,
  normalizedSearch: string,
): boolean {
  return [
    pullRequest.title,
    pullRequest.owner,
    pullRequest.repo,
    `#${pullRequest.number}`,
  ].some(value => value.toLocaleLowerCase().includes(normalizedSearch))
}
