import type { QueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { getSessionAwaitsByIdLiveStatusOptions } from '~/api-gen/@tanstack/react-query.gen'
import { queryRefreshPolicy } from '~/lib/query-refresh-policy'

export type GitHubReviewMode = 'approved' | 'changes-requested' | 'reviewed'

export interface LiveCheckRun {
  id: number | null
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
  required: boolean
  htmlUrl: string | null
  detailsUrl: string | null
  workflowRunId: number | null
  workflowJobId: number | null
  steps: LiveWorkflowJobStep[]
}

export interface LiveWorkflowJobStep {
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'pending'
  conclusion: string | null
  number: number
  startedAt: string | null
  completedAt: string | null
}

export interface LiveWorkflowJob {
  id: number
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'
  conclusion: string | null
  htmlUrl: string | null
  checkRunId: number | null
  startedAt: string | null
  completedAt: string | null
  runnerName: string | null
  labels: string[]
  steps: LiveWorkflowJobStep[]
}

export interface LiveWorkflowRun {
  id: number
  name: string | null
  displayTitle: string | null
  runNumber: number
  runAttempt: number
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'
  conclusion: string | null
  headSha: string
  htmlUrl: string | null
  createdAt: string
  updatedAt: string
  jobs: LiveWorkflowJob[]
}

export interface LiveCommitStatus {
  context: string
  state: 'error' | 'failure' | 'pending' | 'success'
  description: string | null
  targetUrl: string | null
}

export interface LiveCIStatus {
  supported: true
  stale: boolean
  snapshotAt: number
  kind: 'github-ci'
  owner: string
  repo: string
  prNumber: number | null
  prTitle: string | null
  ref: string
  checkRuns: LiveCheckRun[]
  workflowRuns: LiveWorkflowRun[]
  statuses: LiveCommitStatus[]
  totalCount: number
  pendingCount: number
  failureCount: number
  allCompleted: boolean
  allPassed: boolean
  noCIConfigured: boolean
  hasToken: boolean
}

export interface LiveReview {
  id: number
  reviewer: string | null
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  commitId: string
  submittedAt: string | null
}

export interface LiveReviewStatus {
  supported: true
  stale: boolean
  snapshotAt: number
  kind: 'github-review'
  owner: string
  repo: string
  prNumber: number
  prTitle: string | null
  mode: GitHubReviewMode
  headSha: string | null
  matched: boolean
  approvedCount: number
  changesRequestedCount: number
  reviews: LiveReview[]
  hasToken: boolean
}

export type LiveAwaitStatus = LiveCIStatus | LiveReviewStatus

export interface UnsupportedLiveAwaitStatus {
  supported: false
  error?: {
    code: string
    message: string
  }
}

interface LiveAwaitStatusCacheEntry {
  version: 1
  capturedAt: number
  status: LiveAwaitStatus
}

const LIVE_AWAIT_STATUS_CACHE_PREFIX = 'cradle:session-await:live-status:'

export function isLiveAwaitStatus(value: unknown): value is LiveAwaitStatus {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as { supported?: unknown, kind?: unknown }
  return candidate.supported === true && (candidate.kind === 'github-ci' || candidate.kind === 'github-review')
}

function readCachedLiveAwaitStatus(awaitId: string | null): LiveAwaitStatus | undefined {
  if (!awaitId || typeof globalThis.localStorage === 'undefined') {
    return undefined
  }

  try {
    const raw = globalThis.localStorage.getItem(`${LIVE_AWAIT_STATUS_CACHE_PREFIX}${awaitId}`)
    if (!raw) {
      return undefined
    }
    const entry = JSON.parse(raw) as Partial<LiveAwaitStatusCacheEntry>
    return entry.version === 1 && isLiveAwaitStatus(entry.status) ? entry.status : undefined
  }
  catch {
    return undefined
  }
}

function writeCachedLiveAwaitStatus(awaitId: string | null, status: LiveAwaitStatus | UnsupportedLiveAwaitStatus | undefined): void {
  if (!awaitId || !isLiveAwaitStatus(status) || typeof globalThis.localStorage === 'undefined') {
    return
  }

  try {
    const entry: LiveAwaitStatusCacheEntry = {
      version: 1,
      capturedAt: Date.now(),
      status,
    }
    globalThis.localStorage.setItem(`${LIVE_AWAIT_STATUS_CACHE_PREFIX}${awaitId}`, JSON.stringify(entry))
  }
  catch {
    // Cache failure should never block live status rendering.
  }
}

export function useLiveAwaitStatus(awaitId: string | null, active: boolean) {
  const query = useQuery({
    ...getSessionAwaitsByIdLiveStatusOptions({ path: { id: awaitId! } }),
    ...queryRefreshPolicy(active ? 'active' : 'static', active ? { refetchInterval: 20_000 } : { staleTime: 60_000 }),
    initialData: () => readCachedLiveAwaitStatus(awaitId),
    enabled: !!awaitId,
  })

  useEffect(() => {
    writeCachedLiveAwaitStatus(awaitId, query.data as LiveAwaitStatus | UnsupportedLiveAwaitStatus | undefined)
  }, [awaitId, query.data])

  return query
}

export async function prefetchLiveAwaitStatus(queryClient: QueryClient, awaitId: string): Promise<void> {
  try {
    const status = await queryClient.fetchQuery(getSessionAwaitsByIdLiveStatusOptions({ path: { id: awaitId } }))
    writeCachedLiveAwaitStatus(awaitId, status as LiveAwaitStatus | UnsupportedLiveAwaitStatus | undefined)
  }
  catch {
    // Live status prefetch is opportunistic; the mounted query owns visible errors.
  }
}

export function describeLiveAwaitStatus(status: LiveAwaitStatus | UnsupportedLiveAwaitStatus | undefined): string | null {
  if (!status) {
    return null
  }
  if (!status.supported) {
    return status.error?.message ?? null
  }
  const withFreshness = (message: string) => status.stale
    ? `Last known status (GitHub temporarily unavailable): ${message}`
    : message
  if (status.kind === 'github-ci') {
    if (!status.hasToken) {
      return withFreshness('GitHub token not available')
    }
    if (status.noCIConfigured || status.totalCount === 0) {
      return withFreshness('No checks or statuses found yet')
    }
    if (status.allCompleted && status.allPassed) {
      return withFreshness(`All ${status.totalCount} checks/statuses passed`)
    }
    if (status.allCompleted) {
      return withFreshness(`Completed with ${status.failureCount} failing`)
    }
    if (status.failureCount > 0) {
      return withFreshness(`${status.pendingCount} pending, ${status.failureCount} failing`)
    }
    return withFreshness(`${status.pendingCount} pending`)
  }

  if (!status.hasToken) {
    return withFreshness('GitHub token not available')
  }
  if (status.changesRequestedCount > 0) {
    return withFreshness(`${status.changesRequestedCount} changes requested`)
  }
  if (status.approvedCount > 0) {
    return withFreshness(`${status.approvedCount} approvals`)
  }
  return withFreshness(status.reviews.length > 0 ? `${status.reviews.length} reviews` : 'Waiting for review')
}
