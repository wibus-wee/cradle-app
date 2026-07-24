import type { CradlePullRequest, PullRequestRole } from './use-pull-requests'

export type PullRequestFilter = 'all' | PullRequestRole
export type PullRequestRecencyGroupId = 'today' | 'yesterday' | 'thisWeek' | 'earlier'

export interface PullRequestRecencyGroup {
  id: PullRequestRecencyGroupId
  items: CradlePullRequest[]
}

export const PULL_REQUEST_FILTERS: PullRequestFilter[] = ['all', 'reviewing', 'authored']

const RECENCY_GROUP_ORDER: PullRequestRecencyGroupId[] = [
  'today',
  'yesterday',
  'thisWeek',
  'earlier',
]

export function matchesPullRequestFilter(
  item: CradlePullRequest,
  filter: PullRequestFilter,
): boolean {
  return filter === 'all' || item.role === filter
}

export function matchesPullRequestSearch(
  item: CradlePullRequest,
  query: string,
): boolean {
  if (!query) {
    return true
  }

  const pullRequest = item.pullRequest
  return [
    pullRequest.title,
    pullRequest.owner,
    pullRequest.repo,
    pullRequest.headRef,
    pullRequest.baseRef,
    String(pullRequest.number),
  ].some(value => value.toLocaleLowerCase().includes(query))
}

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function getRecencyGroupId(
  updatedAtSeconds: number,
  nowMs: number,
): PullRequestRecencyGroupId {
  const diffDays = Math.floor(
    (startOfDay(nowMs) - startOfDay(updatedAtSeconds * 1000)) / 86_400_000,
  )
  if (diffDays <= 0) {
    return 'today'
  }
  if (diffDays === 1) {
    return 'yesterday'
  }
  if (diffDays <= 7) {
    return 'thisWeek'
  }
  return 'earlier'
}

export function groupPullRequestsByRecency(
  items: CradlePullRequest[],
  nowMs: number,
): PullRequestRecencyGroup[] {
  const sorted = [...items].sort(
    (left, right) => right.pullRequest.updatedAt - left.pullRequest.updatedAt,
  )
  const buckets = new Map<PullRequestRecencyGroupId, CradlePullRequest[]>()

  for (const item of sorted) {
    const id = getRecencyGroupId(item.pullRequest.updatedAt, nowMs)
    const bucket = buckets.get(id)
    if (bucket) {
      bucket.push(item)
    }
    else {
      buckets.set(id, [item])
    }
  }

  return RECENCY_GROUP_ORDER
    .map(id => ({ id, items: buckets.get(id) ?? [] }))
    .filter(group => group.items.length > 0)
}

export function formatPullRequestDate(
  timestamp: number,
  locale: string,
  nowMs: number,
): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp * 1000).getFullYear() === new Date(nowMs).getFullYear()
      ? undefined
      : 'numeric',
  }).format(timestamp * 1000)
}
