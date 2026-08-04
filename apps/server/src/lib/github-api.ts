import { Buffer } from 'node:buffer'

import { cachedFetch, cachedGitHubRead, octokitRestGet } from './github/cache-gate'
import type { CradleOctokitInstance } from './github/client'
import {
  getOctokit,
  GitHubAuthRequiredError,
  isGitHubRateLimited,
  RequestError,
  resetGitHubClientState,
} from './github/client'
import {
  hasGitHubToken,
  resetGitHubTokenCache,
  resolveGitHubToken,
} from './github-api-token'
import type { CachedFetchResult } from './github-cache'
import { deleteCache, deleteCachePrefix } from './github-cache'

export { hasGitHubToken, isGitHubRateLimited, resolveGitHubToken }

export class GitHubApiError extends Error {
  readonly status: number
  readonly path: string

  constructor(options: { status: number, path: string, message: string }) {
    super(options.message)
    this.status = options.status
    this.path = options.path
  }
}

export class GitHubTargetValidationError extends Error {
  readonly category: 'invalid' | 'unavailable'

  constructor(options: { category: 'invalid' | 'unavailable', message: string }) {
    super(options.message)
    this.category = options.category
  }
}

export function resetTokenCache() {
  resetGitHubTokenCache()
  resetGitHubClientState()
}

export function isGitHubMissingTarget(err: unknown): boolean {
  return err instanceof GitHubApiError && (err.status === 404 || err.status === 422)
}

function toGitHubApiError(error: unknown, path: string): GitHubApiError {
  if (error instanceof GitHubApiError) {
    return error
  }
  if (error instanceof GitHubAuthRequiredError) {
    return new GitHubApiError({ status: 401, path, message: error.message })
  }
  if (error instanceof RequestError) {
    const message = typeof error.message === 'string' && error.message.trim().length > 0
      ? error.message
      : `GitHub API returned ${error.status}`
    return new GitHubApiError({
      status: error.status ?? 500,
      path,
      message,
    })
  }
  return new GitHubApiError({
    status: 500,
    path,
    message: error instanceof Error ? error.message : 'GitHub request failed',
  })
}

async function restGetCached<T>(options: {
  cacheKey: string
  ttlS: number
  route: string
  params: Record<string, unknown>
  path: string
  etag?: boolean
  swr?: boolean
  mode?: 'read' | 'probe'
}): Promise<T | null> {
  return cachedGitHubRead({
    cacheKey: options.cacheKey,
    ttlS: options.ttlS,
    etag: options.etag,
    swr: options.swr,
    mode: options.mode ?? 'read',
    fetcher: async (etag) => {
      try {
        return await octokitRestGet<T>({
          route: options.route,
          params: options.params,
          etag,
        })
      }
      catch (error) {
        const mapped = toGitHubApiError(error, options.path)
        if (mapped.status === 304) {
          return { data: null, etag: null, status: 304 }
        }
        if (mapped.status === 404 || mapped.status === 422) {
          throw mapped
        }
        return { data: null, etag: null, status: mapped.status }
      }
    },
  })
}

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  try {
    const octokit = await getOctokit({ requireToken: true })
    return await octokit.graphql<T>(query, variables)
  }
  catch (error) {
    throw toGitHubApiError(error, '/graphql')
  }
}

async function paginateRest<T>(
  listPage: (page: number) => Promise<{ items: T[], totalCount?: number } | null>,
  maxPages = 10,
): Promise<T[] | null> {
  const items: T[] = []
  let totalCount = Number.POSITIVE_INFINITY
  for (let page = 1; page <= maxPages; page++) {
    const batch = await listPage(page)
    if (!batch) {
      return null
    }
    items.push(...batch.items)
    if (batch.totalCount !== undefined) {
      totalCount = batch.totalCount
    }
    if (batch.items.length < 100 || items.length >= totalCount) {
      break
    }
  }
  return items
}

// ─── Private Octokit / GraphQL shapes ───

type PullRequestData = Awaited<ReturnType<CradleOctokitInstance['rest']['pulls']['get']>>['data']
type PullRequestFileData = Awaited<
  ReturnType<CradleOctokitInstance['rest']['pulls']['listFiles']>
>['data'][number]
type IssueCommentData = Awaited<
  ReturnType<CradleOctokitInstance['rest']['issues']['listComments']>
>['data'][number]
type PullRequestReviewData = Awaited<
  ReturnType<CradleOctokitInstance['rest']['pulls']['listReviews']>
>['data'][number]
type CheckRunData = Awaited<
  ReturnType<CradleOctokitInstance['rest']['checks']['listForRef']>
>['data']['check_runs'][number]
type CombinedStatusData = Awaited<
  ReturnType<CradleOctokitInstance['rest']['repos']['getCombinedStatusForRef']>
>['data']
type WorkflowRunsResponseData = Awaited<
  ReturnType<CradleOctokitInstance['rest']['actions']['listWorkflowRunsForRepo']>
>['data']
type WorkflowJobData = Awaited<
  ReturnType<CradleOctokitInstance['rest']['actions']['listJobsForWorkflowRun']>
>['data']['jobs'][number]
type RepoData = Awaited<ReturnType<CradleOctokitInstance['rest']['repos']['get']>>['data']
type BranchProtectionData = Awaited<
  ReturnType<CradleOctokitInstance['rest']['repos']['getBranchProtection']>
>['data']

// ─── GraphQL search ───

type StatusCheckRollupState = 'EXPECTED' | 'ERROR' | 'FAILURE' | 'PENDING' | 'SUCCESS'

function mapStatusCheckRollupState(state: StatusCheckRollupState | undefined) {
  switch (state) {
    case 'SUCCESS':
      return 'success' as const
    case 'ERROR':
    case 'FAILURE':
      return 'failure' as const
    case 'EXPECTED':
    case 'PENDING':
      return 'pending' as const
    default:
      return 'neutral' as const
  }
}

interface SearchPullRequestNode {
  number: number
  title: string
  url: string
  isDraft: boolean
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  headRefName: string
  baseRefName: string
  additions: number
  deletions: number
  createdAt: string
  updatedAt: string
  repository: { name: string, owner: { login: string } }
  author: { login: string, avatarUrl: string, url: string } | null
  commits: {
    nodes: Array<{
      commit: {
        oid: string
        statusCheckRollup: { state: StatusCheckRollupState } | null
      }
    }>
  }
}

interface SearchPullRequestsData {
  search: {
    pageInfo: { hasNextPage: boolean, endCursor: string | null }
    nodes: SearchPullRequestNode[]
  }
}

const SEARCH_PULL_REQUESTS_QUERY = `
  query SearchPullRequests($searchQuery: String!, $first: Int!, $after: String) {
    search(query: $searchQuery, type: ISSUE, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          title
          url
          isDraft
          state
          headRefName
          baseRefName
          additions
          deletions
          createdAt
          updatedAt
          repository { name owner { login } }
          author { login avatarUrl url }
          commits(last: 1) {
            nodes {
              commit {
                oid
                statusCheckRollup { state }
              }
            }
          }
        }
      }
    }
  }
`

const SEARCH_PULL_REQUESTS_PAGE_SIZE = 25

function mapSearchPullRequestNode(node: SearchPullRequestNode) {
  const headCommit = node.commits.nodes[0]?.commit
  return {
    owner: node.repository.owner.login,
    repo: node.repository.name,
    number: node.number,
    title: node.title,
    url: node.url,
    isDraft: node.isDraft,
    state: (node.state === 'OPEN' ? 'open' : 'closed') as 'open' | 'closed',
    merged: node.state === 'MERGED',
    headRef: node.headRefName,
    baseRef: node.baseRefName,
    headSha: headCommit?.oid ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    author: node.author,
    additions: node.additions,
    deletions: node.deletions,
    checksState: mapStatusCheckRollupState(headCommit?.statusCheckRollup?.state),
  }
}

async function searchPullRequestsPage(
  searchQuery: string,
  after: string | null,
): Promise<{
  items: ReturnType<typeof mapSearchPullRequestNode>[]
  hasNextPage: boolean
  endCursor: string | null
}> {
  const data = await graphql<SearchPullRequestsData>(SEARCH_PULL_REQUESTS_QUERY, {
    searchQuery: `${searchQuery} sort:updated-desc`,
    first: SEARCH_PULL_REQUESTS_PAGE_SIZE,
    after,
  })
  return {
    items: data.search.nodes.map(mapSearchPullRequestNode),
    hasNextPage: data.search.pageInfo.hasNextPage,
    endCursor: data.search.pageInfo.endCursor,
  }
}

interface ReviewingPullRequestCursor {
  version: 1
  requestedAfter: string | null
  requestedDone: boolean
  reviewedAfter: string | null
  reviewedDone: boolean
}

const INITIAL_REVIEWING_CURSOR: ReviewingPullRequestCursor = {
  version: 1,
  requestedAfter: null,
  requestedDone: false,
  reviewedAfter: null,
  reviewedDone: false,
}

function isReviewingCursor(value: unknown): value is ReviewingPullRequestCursor {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const cursor = value as Record<string, unknown>
  return cursor.version === 1
    && (cursor.requestedAfter === null || typeof cursor.requestedAfter === 'string')
    && typeof cursor.requestedDone === 'boolean'
    && (cursor.reviewedAfter === null || typeof cursor.reviewedAfter === 'string')
    && typeof cursor.reviewedDone === 'boolean'
}

function decodeReviewingCursor(after: string | null): ReviewingPullRequestCursor {
  if (!after) {
    return INITIAL_REVIEWING_CURSOR
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(after, 'base64url').toString('utf8'))
    if (!isReviewingCursor(parsed)) {
      throw new Error('shape')
    }
    return parsed
  }
  catch {
    throw new GitHubApiError({
      status: 422,
      path: '/pull-requests/reviewing',
      message: 'Invalid reviewing pull request cursor.',
    })
  }
}

function encodeReviewingCursor(cursor: ReviewingPullRequestCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function pullRequestSearchKey(pullRequest: ReturnType<typeof mapSearchPullRequestNode>): string {
  return `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`
}

function mergePullRequestSearchPages(
  requestedPage: Awaited<ReturnType<typeof searchPullRequestsPage>> | null,
  reviewedPage: Awaited<ReturnType<typeof searchPullRequestsPage>> | null,
): ReturnType<typeof mapSearchPullRequestNode>[] {
  const pullRequests = new Map<string, ReturnType<typeof mapSearchPullRequestNode>>()
  for (const pullRequest of [...(requestedPage?.items ?? []), ...(reviewedPage?.items ?? [])]) {
    const key = pullRequestSearchKey(pullRequest)
    if (!pullRequests.has(key)) {
      pullRequests.set(key, pullRequest)
    }
  }
  return [...pullRequests.values()]
}

export function fetchAuthenticatedUser() {
  return cachedFetch({
    cacheKey: 'viewer',
    ttlS: 300,
    etag: false,
    fetcher: async (): Promise<CachedFetchResult<{ viewer: { login: string, avatarUrl: string, url: string } }>> => {
      const data = await graphql<{ viewer: { login: string, avatarUrl: string, url: string } }>(`query ViewerIdentity {
        viewer { login avatarUrl url }
      }`)
      return { data, etag: null, status: 200 }
    },
  }).then(data => data!.viewer)
}

export function searchAuthoredPullRequests(
  login: string,
  after: string | null = null,
): Promise<{
  items: ReturnType<typeof mapSearchPullRequestNode>[]
  hasNextPage: boolean
  endCursor: string | null
}> {
  return cachedFetch({
    cacheKey: `search-authored:login:${login}:${after ?? 'first'}`,
    ttlS: 15,
    etag: false,
    swr: false,
    fetcher: async () => {
      const data = await searchPullRequestsPage(`is:pr author:${login}`, after)
      return { data, etag: null, status: 200 }
    },
  }).then(data => data!)
}

export function searchReviewingPullRequests(
  login: string,
  after: string | null = null,
): Promise<{
  items: ReturnType<typeof mapSearchPullRequestNode>[]
  hasNextPage: boolean
  endCursor: string | null
}> {
  const cursor = decodeReviewingCursor(after)
  return cachedFetch({
    cacheKey: `search-reviewing:v2:login:${login}:${after ?? 'first'}`,
    ttlS: 15,
    etag: false,
    swr: false,
    fetcher: async () => {
      const [requestedPage, reviewedPage] = await Promise.all([
        cursor.requestedDone
          ? Promise.resolve(null)
          : searchPullRequestsPage(`is:pr review-requested:${login}`, cursor.requestedAfter),
        cursor.reviewedDone
          ? Promise.resolve(null)
          : searchPullRequestsPage(
              `is:pr reviewed-by:${login} -review-requested:${login}`,
              cursor.reviewedAfter,
            ),
      ])
      const nextCursor: ReviewingPullRequestCursor = {
        version: 1,
        requestedAfter: requestedPage?.endCursor ?? cursor.requestedAfter,
        requestedDone: cursor.requestedDone || requestedPage?.hasNextPage === false,
        reviewedAfter: reviewedPage?.endCursor ?? cursor.reviewedAfter,
        reviewedDone: cursor.reviewedDone || reviewedPage?.hasNextPage === false,
      }
      const hasNextPage = !nextCursor.requestedDone || !nextCursor.reviewedDone
      const data = {
        items: mergePullRequestSearchPages(requestedPage, reviewedPage),
        hasNextPage,
        endCursor: hasNextPage ? encodeReviewingCursor(nextCursor) : null,
      }
      return { data, etag: null, status: 200 }
    },
  }).then(data => data!)
}

// ─── REST reads ───

export function fetchPullRequest(
  owner: string,
  repo: string,
  pr: number,
): Promise<PullRequestData | null> {
  return restGetCached<PullRequestData>({
    cacheKey: `pr:${owner}/${repo}:${pr}`,
    ttlS: 30,
    route: 'GET /repos/{owner}/{repo}/pulls/{pull_number}',
    params: { owner, repo, pull_number: pr },
    path: `/repos/${owner}/${repo}/pulls/${pr}`,
  })
}

export function fetchPullRequestDetail(
  owner: string,
  repo: string,
  pr: number,
): Promise<PullRequestData | null> {
  return restGetCached<PullRequestData>({
    cacheKey: `pr-detail:${owner}/${repo}:${pr}`,
    ttlS: 30,
    route: 'GET /repos/{owner}/{repo}/pulls/{pull_number}',
    params: { owner, repo, pull_number: pr },
    path: `/repos/${owner}/${repo}/pulls/${pr}`,
  })
}

export function fetchPullRequestComments(
  owner: string,
  repo: string,
  pr: number,
): Promise<IssueCommentData[] | null> {
  return cachedFetch({
    cacheKey: `pr-comments:${owner}/${repo}:${pr}`,
    ttlS: 60,
    etag: false,
    fetcher: async () => {
      try {
        const octokit = await getOctokit()
        const items = await octokit.paginate(
          octokit.rest.issues.listComments,
          { owner, repo, issue_number: pr, per_page: 100 },
        )
        return { data: items, etag: null, status: 200 }
      }
      catch (error) {
        const mapped = toGitHubApiError(error, `/repos/${owner}/${repo}/issues/${pr}/comments`)
        if (mapped.status === 404 || mapped.status === 422) {
          throw mapped
        }
        return { data: null, etag: null, status: mapped.status }
      }
    },
  })
}

export function fetchPullRequestFiles(
  owner: string,
  repo: string,
  pr: number,
): Promise<PullRequestFileData[] | null> {
  return cachedFetch({
    cacheKey: `pr-files:${owner}/${repo}:${pr}`,
    ttlS: 60,
    etag: false,
    fetcher: async () => {
      try {
        const octokit = await getOctokit()
        const items = await octokit.paginate(
          octokit.rest.pulls.listFiles,
          { owner, repo, pull_number: pr, per_page: 100 },
        )
        return { data: items, etag: null, status: 200 }
      }
      catch (error) {
        const mapped = toGitHubApiError(error, `/repos/${owner}/${repo}/pulls/${pr}/files`)
        if (mapped.status === 404 || mapped.status === 422) {
          throw mapped
        }
        return { data: null, etag: null, status: mapped.status }
      }
    },
  })
}

async function fetchPullRequestNodeId(
  owner: string,
  repo: string,
  pr: number,
): Promise<string | null> {
  try {
    const { data } = await (await getOctokit()).rest.pulls.get({ owner, repo, pull_number: pr })
    return data.node_id
  }
  catch (error) {
    const mapped = toGitHubApiError(error, `/repos/${owner}/${repo}/pulls/${pr}`)
    if (mapped.status === 404 || mapped.status === 422) {
      return null
    }
    throw mapped
  }
}

export async function fetchCheckRuns(
  owner: string,
  repo: string,
  ref: string,
): Promise<{ total_count: number, check_runs: CheckRunData[] } | null> {
  return cachedFetch({
    cacheKey: `check-runs:${owner}/${repo}:${ref}`,
    ttlS: 30,
    etag: false,
    fetcher: async () => {
      try {
        const runs = await paginateRest<CheckRunData>(async (page) => {
          const { data } = await (await getOctokit()).rest.checks.listForRef({
            owner,
            repo,
            ref,
            per_page: 100,
            page,
          })
          return {
            items: data.check_runs,
            totalCount: data.total_count,
          }
        })
        if (!runs) {
          return { data: null, etag: null, status: 200 }
        }
        return {
          data: { total_count: runs.length, check_runs: runs },
          etag: null,
          status: 200,
        }
      }
      catch (error) {
        const mapped = toGitHubApiError(error, `/repos/${owner}/${repo}/commits/${ref}/check-runs`)
        if (mapped.status === 404 || mapped.status === 422) {
          throw mapped
        }
        return { data: null, etag: null, status: mapped.status }
      }
    },
  })
}

export async function fetchCheckRun(
  owner: string,
  repo: string,
  checkRunId: number,
): Promise<CheckRunData | null> {
  try {
    const { data } = await (await getOctokit()).rest.checks.get({
      owner,
      repo,
      check_run_id: checkRunId,
    })
    return data
  }
  catch (error) {
    const mapped = toGitHubApiError(error, `/repos/${owner}/${repo}/check-runs/${checkRunId}`)
    if (mapped.status === 404 || mapped.status === 422) {
      return null
    }
    throw mapped
  }
}

export async function fetchWorkflowRunsForHead(
  owner: string,
  repo: string,
  headSha: string,
): Promise<WorkflowRunsResponseData | null> {
  return cachedFetch({
    cacheKey: `workflow-runs:${owner}/${repo}:${headSha}`,
    ttlS: 30,
    etag: false,
    fetcher: async () => {
      try {
        const { data } = await (await getOctokit()).rest.actions.listWorkflowRunsForRepo({
          owner,
          repo,
          head_sha: headSha,
          per_page: 100,
        })
        return {
          data,
          etag: null,
          status: 200,
        }
      }
      catch (error) {
        const mapped = toGitHubApiError(error, `/repos/${owner}/${repo}/actions/runs`)
        if (mapped.status === 404 || mapped.status === 422) {
          throw mapped
        }
        return { data: null, etag: null, status: mapped.status }
      }
    },
  })
}

export async function fetchWorkflowRunJobs(
  owner: string,
  repo: string,
  runId: number,
): Promise<{ total_count: number, jobs: WorkflowJobData[] } | null> {
  try {
    const jobs = await paginateRest<WorkflowJobData>(async (page) => {
      const { data } = await (await getOctokit()).rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: runId,
        per_page: 100,
        page,
      })
      return {
        items: data.jobs,
        totalCount: data.total_count,
      }
    })
    if (!jobs) {
      return null
    }
    return { total_count: jobs.length, jobs }
  }
  catch (error) {
    const mapped = toGitHubApiError(error, `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`)
    if (mapped.status === 404 || mapped.status === 422) {
      return null
    }
    throw mapped
  }
}

export function fetchRepo(owner: string, repo: string): Promise<RepoData | null> {
  return restGetCached<RepoData>({
    cacheKey: `repo:${owner}/${repo}`,
    ttlS: 3600,
    route: 'GET /repos/{owner}/{repo}',
    params: { owner, repo },
    path: `/repos/${owner}/${repo}`,
  })
}

export function fetchBranchHead(
  owner: string,
  repo: string,
  branch: string,
): Promise<{ sha: string } | null> {
  return restGetCached<{ commit: { sha: string } }>({
    cacheKey: `branch-head:${owner}/${repo}:${branch}`,
    ttlS: 300,
    route: 'GET /repos/{owner}/{repo}/branches/{branch}',
    params: { owner, repo, branch },
    path: `/repos/${owner}/${repo}/branches/${branch}`,
  }).then(data => (data ? { sha: data.commit.sha } : null))
}

export function fetchCombinedStatus(
  owner: string,
  repo: string,
  ref: string,
): Promise<CombinedStatusData | null> {
  return restGetCached<CombinedStatusData>({
    cacheKey: `combined-status:${owner}/${repo}:${ref}`,
    ttlS: 30,
    route: 'GET /repos/{owner}/{repo}/commits/{ref}/status',
    params: { owner, repo, ref },
    path: `/repos/${owner}/${repo}/commits/${ref}/status`,
  })
}

export function fetchPullRequestReviews(
  owner: string,
  repo: string,
  pr: number,
): Promise<PullRequestReviewData[] | null> {
  return cachedFetch({
    cacheKey: `pr-reviews:${owner}/${repo}:${pr}`,
    ttlS: 60,
    etag: false,
    fetcher: async () => {
      try {
        const octokit = await getOctokit()
        const items = await octokit.paginate(
          octokit.rest.pulls.listReviews,
          { owner, repo, pull_number: pr, per_page: 100 },
        )
        return { data: items, etag: null, status: 200 }
      }
      catch (error) {
        const mapped = toGitHubApiError(error, `/repos/${owner}/${repo}/pulls/${pr}/reviews`)
        if (mapped.status === 404 || mapped.status === 422) {
          throw mapped
        }
        return { data: null, etag: null, status: mapped.status }
      }
    },
  })
}

const BRANCH_PROTECTION_CACHE_TTL_S = 60 * 60

export async function fetchBranchProtection(
  owner: string,
  repo: string,
  branch: string,
): Promise<BranchProtectionData | null> {
  return cachedFetch({
    cacheKey: `branch-protection:${owner}/${repo}:${branch}`,
    ttlS: BRANCH_PROTECTION_CACHE_TTL_S,
    fetcher: async (etag) => {
      try {
        const result = await octokitRestGet<BranchProtectionData>({
          route: 'GET /repos/{owner}/{repo}/branches/{branch}/protection',
          params: { owner, repo, branch },
          etag,
        })
        return result
      }
      catch (error) {
        const mapped = toGitHubApiError(error, `/repos/${owner}/${repo}/branches/${branch}/protection`)
        if (mapped.status === 404) {
          // Unprotected branch — treat as empty required checks, not a hard miss.
          return { data: null, etag: null, status: 404 }
        }
        throw mapped
      }
    },
  })
}

export function invalidatePullRequestCaches(owner: string, repo: string, number: number): void {
  const ref = `${owner}/${repo}:${number}`
  for (const key of [
    `pr:${ref}`,
    `pr-detail:${ref}`,
    `pr-comments:${ref}`,
    `pr-files:${ref}`,
    `pr-reviews:${ref}`,
    `pr-fingerprint:${ref}`,
    `pr-fingerprint-core:${ref}`,
  ]) {
    deleteCache(key)
  }
  deleteCachePrefix(`pr-fingerprint-checks:${owner}/${repo}:`)
  invalidatePullRequestSearchCaches()
}

export function invalidatePullRequestSearchCaches(): void {
  deleteCachePrefix('search-authored:')
  deleteCachePrefix('search-reviewing:')
}

function mapCombinedStatusToChecksState(state: string | undefined) {
  if (state === 'success') {
    return 'success' as const
  }
  if (state === 'pending') {
    return 'pending' as const
  }
  if (state === 'failure' || state === 'error') {
    return 'failure' as const
  }
  return 'neutral' as const
}

async function loadPullRequestFingerprint(
  owner: string,
  repo: string,
  number: number,
  mode: 'read' | 'probe',
) {
  const pull = await restGetCached<PullRequestData>({
    cacheKey: `pr-fingerprint-core:${owner}/${repo}:${number}`,
    ttlS: 20,
    mode,
    route: 'GET /repos/{owner}/{repo}/pulls/{pull_number}',
    params: { owner, repo, pull_number: number },
    path: `/repos/${owner}/${repo}/pulls/${number}`,
  })
  if (!pull) {
    return null
  }

  const combined = await restGetCached<CombinedStatusData>({
    cacheKey: `pr-fingerprint-checks:${owner}/${repo}:${pull.head.sha}`,
    ttlS: 20,
    mode,
    route: 'GET /repos/{owner}/{repo}/commits/{ref}/status',
    params: { owner, repo, ref: pull.head.sha },
    path: `/repos/${owner}/${repo}/commits/${pull.head.sha}/status`,
  })

  return {
    updatedAt: pull.updated_at,
    headSha: pull.head.sha,
    state: pull.state,
    merged: Boolean(pull.merged),
    isDraft: Boolean(pull.draft),
    mergeableState: pull.mergeable_state ?? 'unknown',
    comments: pull.comments,
    reviewComments: pull.review_comments,
    commits: pull.commits,
    checksState: mapCombinedStatusToChecksState(combined?.state),
  }
}

export function fetchPullRequestFingerprint(
  owner: string,
  repo: string,
  number: number,
) {
  return loadPullRequestFingerprint(owner, repo, number, 'read')
}

export function probePullRequestFingerprint(
  owner: string,
  repo: string,
  number: number,
) {
  return loadPullRequestFingerprint(owner, repo, number, 'probe')
}

export function fetchRepoMergeSettings(
  owner: string,
  repo: string,
) {
  return cachedFetch({
    cacheKey: `repo-merge-settings:${owner}/${repo}`,
    ttlS: 3600,
    fetcher: async (etag) => {
      const result = await octokitRestGet<Pick<
        RepoData,
        'allow_merge_commit' | 'allow_squash_merge' | 'allow_rebase_merge'
      >>({
        route: 'GET /repos/{owner}/{repo}',
        params: { owner, repo },
        etag,
      })
      if (result.status === 304 || result.data === null) {
        return { data: null, etag: null, status: result.status }
      }
      return {
        data: {
          allow_merge_commit: result.data.allow_merge_commit ?? true,
          allow_squash_merge: result.data.allow_squash_merge ?? true,
          allow_rebase_merge: result.data.allow_rebase_merge ?? true,
        },
        etag: result.etag,
        status: result.status,
      }
    },
  })
}

// ─── Mutates ───

export async function createPullRequest(input: {
  owner: string
  repo: string
  title: string
  head: string
  base: string
  body?: string
  draft?: boolean
}): Promise<PullRequestData> {
  try {
    const { data } = await (await getOctokit({ requireToken: true })).rest.pulls.create({
      owner: input.owner,
      repo: input.repo,
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body ?? '',
      draft: input.draft ?? true,
    })
    invalidatePullRequestCaches(input.owner, input.repo, data.number)
    return data
  }
  catch (error) {
    throw toGitHubApiError(error, `/repos/${input.owner}/${input.repo}/pulls`)
  }
}

export async function updatePullRequest(input: {
  owner: string
  repo: string
  pullRequestNumber: number
  title?: string
  body?: string
}): Promise<PullRequestData> {
  try {
    const { data } = await (await getOctokit({ requireToken: true })).rest.pulls.update({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
      title: input.title,
      body: input.body,
    })
    invalidatePullRequestCaches(input.owner, input.repo, input.pullRequestNumber)
    return data
  }
  catch (error) {
    throw toGitHubApiError(
      error,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullRequestNumber}`,
    )
  }
}

export async function submitPullRequestReview(input: {
  owner: string
  repo: string
  pullRequestNumber: number
  body?: string
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
}) {
  try {
    const { data } = await (await getOctokit({ requireToken: true })).rest.pulls.createReview({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
      body: input.body ?? '',
      event: input.event,
    })
    invalidatePullRequestCaches(input.owner, input.repo, input.pullRequestNumber)
    return data
  }
  catch (error) {
    throw toGitHubApiError(
      error,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullRequestNumber}/reviews`,
    )
  }
}

type MergePullRequestData = Awaited<
  ReturnType<CradleOctokitInstance['rest']['pulls']['merge']>
>['data']

export async function mergePullRequest(input: {
  owner: string
  repo: string
  pullRequestNumber: number
  mergeMethod: 'merge' | 'squash' | 'rebase'
  commitTitle?: string
  commitMessage?: string
}): Promise<MergePullRequestData> {
  try {
    const { data } = await (await getOctokit({ requireToken: true })).rest.pulls.merge({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
      merge_method: input.mergeMethod,
      commit_title: input.commitTitle,
      commit_message: input.commitMessage,
    })
    if (data.merged) {
      invalidatePullRequestCaches(input.owner, input.repo, input.pullRequestNumber)
    }
    return data
  }
  catch (error) {
    throw toGitHubApiError(
      error,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullRequestNumber}/merge`,
    )
  }
}

export async function createPullRequestIssueComment(input: {
  owner: string
  repo: string
  pullRequestNumber: number
  body: string
}): Promise<IssueCommentData> {
  try {
    const { data } = await (await getOctokit({ requireToken: true })).rest.issues.createComment({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.pullRequestNumber,
      body: input.body,
    })
    invalidatePullRequestCaches(input.owner, input.repo, input.pullRequestNumber)
    return data
  }
  catch (error) {
    throw toGitHubApiError(
      error,
      `/repos/${input.owner}/${input.repo}/issues/${input.pullRequestNumber}/comments`,
    )
  }
}

export async function addPullRequestAssignees(input: {
  owner: string
  repo: string
  pullRequestNumber: number
  assignees: string[]
}): Promise<void> {
  try {
    await (await getOctokit({ requireToken: true })).rest.issues.addAssignees({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.pullRequestNumber,
      assignees: input.assignees,
    })
    invalidatePullRequestCaches(input.owner, input.repo, input.pullRequestNumber)
  }
  catch (error) {
    throw toGitHubApiError(
      error,
      `/repos/${input.owner}/${input.repo}/issues/${input.pullRequestNumber}/assignees`,
    )
  }
}

export async function removePullRequestAssignees(input: {
  owner: string
  repo: string
  pullRequestNumber: number
  assignees: string[]
}): Promise<void> {
  try {
    await (await getOctokit({ requireToken: true })).rest.issues.removeAssignees({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.pullRequestNumber,
      assignees: input.assignees,
    })
    invalidatePullRequestCaches(input.owner, input.repo, input.pullRequestNumber)
  }
  catch (error) {
    throw toGitHubApiError(
      error,
      `/repos/${input.owner}/${input.repo}/issues/${input.pullRequestNumber}/assignees`,
    )
  }
}

export async function requestPullRequestReviewers(input: {
  owner: string
  repo: string
  pullRequestNumber: number
  reviewers: string[]
}): Promise<void> {
  try {
    await (await getOctokit({ requireToken: true })).rest.pulls.requestReviewers({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
      reviewers: input.reviewers,
    })
    invalidatePullRequestCaches(input.owner, input.repo, input.pullRequestNumber)
  }
  catch (error) {
    throw toGitHubApiError(
      error,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullRequestNumber}/requested_reviewers`,
    )
  }
}

export async function removePullRequestReviewers(input: {
  owner: string
  repo: string
  pullRequestNumber: number
  reviewers: string[]
}): Promise<void> {
  try {
    await (await getOctokit({ requireToken: true })).rest.pulls.removeRequestedReviewers({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
      reviewers: input.reviewers,
    })
    invalidatePullRequestCaches(input.owner, input.repo, input.pullRequestNumber)
  }
  catch (error) {
    throw toGitHubApiError(
      error,
      `/repos/${input.owner}/${input.repo}/pulls/${input.pullRequestNumber}/requested_reviewers`,
    )
  }
}

// ─── GraphQL review threads / ready / draft ───

const REVIEW_THREAD_FRAGMENT = `
  fragment CradleReviewThread on PullRequestReviewThread {
    id
    isResolved
    isOutdated
    path
    line
    startLine
    diffSide
    startDiffSide
    comments(first: 100) {
      nodes {
        id
        body
        url
        createdAt
        updatedAt
        author { login }
      }
    }
  }
`

interface GraphQLReviewThread {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  startLine: number | null
  diffSide: 'LEFT' | 'RIGHT'
  startDiffSide: 'LEFT' | 'RIGHT' | null
  comments: {
    nodes: Array<{
      id: string
      body: string
      url: string
      createdAt: string
      updatedAt: string
      author: { login: string } | null
    }>
  }
}

export async function fetchPullRequestReviewThreads(
  owner: string,
  repo: string,
  pullRequestNumber: number,
) {
  const threads: GraphQLReviewThread[] = []
  let after: string | null = null

  for (let page = 0; page < 10; page++) {
    const data = await graphql<{
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: GraphQLReviewThread[]
            pageInfo: { hasNextPage: boolean, endCursor: string | null }
          }
        } | null
      } | null
    }>(
      `query PullRequestReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $after) {
              nodes { ...CradleReviewThread }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
      ${REVIEW_THREAD_FRAGMENT}`,
      { owner, repo, number: pullRequestNumber, after },
    )
    const pullRequest = data.repository?.pullRequest
    if (!pullRequest) {
      throw new GitHubApiError({
        status: 404,
        path: '/graphql',
        message: `GitHub pull request ${owner}/${repo}#${pullRequestNumber} was not found.`,
      })
    }
    threads.push(...pullRequest.reviewThreads.nodes)
    if (!pullRequest.reviewThreads.pageInfo.hasNextPage) {
      break
    }
    after = pullRequest.reviewThreads.pageInfo.endCursor
    if (!after) {
      break
    }
  }
  return threads
}

export async function createPullRequestReviewThread(input: {
  owner: string
  repo: string
  pullRequestNumber: number
  body: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number
  startSide?: 'LEFT' | 'RIGHT'
}) {
  const pullRequestId = await fetchPullRequestNodeId(input.owner, input.repo, input.pullRequestNumber)
  if (!pullRequestId) {
    throw new GitHubApiError({
      status: 502,
      path: `/repos/${input.owner}/${input.repo}/pulls/${input.pullRequestNumber}`,
      message: 'GitHub pull request was unavailable before creating the review thread.',
    })
  }
  const data = await graphql<{
    addPullRequestReviewThread: { thread: GraphQLReviewThread }
  }>(
    `mutation AddPullRequestReviewThread($input: AddPullRequestReviewThreadInput!) {
      addPullRequestReviewThread(input: $input) { thread { ...CradleReviewThread } }
    }
    ${REVIEW_THREAD_FRAGMENT}`,
    {
      input: {
        pullRequestId,
        body: input.body,
        path: input.path,
        line: input.line,
        side: input.side,
        startLine: input.startLine,
        startSide: input.startSide,
      },
    },
  )
  return data.addPullRequestReviewThread.thread
}

export async function replyToPullRequestReviewThread(input: {
  threadId: string
  body: string
}) {
  const data = await graphql<{
    addPullRequestReviewThreadReply: { thread: GraphQLReviewThread }
  }>(
    `mutation AddPullRequestReviewThreadReply($input: AddPullRequestReviewThreadReplyInput!) {
      addPullRequestReviewThreadReply(input: $input) { thread { ...CradleReviewThread } }
    }
    ${REVIEW_THREAD_FRAGMENT}`,
    { input: { pullRequestReviewThreadId: input.threadId, body: input.body } },
  )
  return data.addPullRequestReviewThreadReply.thread
}

export async function resolvePullRequestReviewThread(
  threadId: string,
) {
  const data = await graphql<{
    resolveReviewThread: { thread: GraphQLReviewThread }
  }>(
    `mutation ResolveReviewThread($input: ResolveReviewThreadInput!) {
      resolveReviewThread(input: $input) { thread { ...CradleReviewThread } }
    }
    ${REVIEW_THREAD_FRAGMENT}`,
    { input: { threadId } },
  )
  return data.resolveReviewThread.thread
}

async function fetchPullRequestAfterGraphQlMutation(
  owner: string,
  repo: string,
  number: number,
): Promise<PullRequestData> {
  invalidatePullRequestCaches(owner, repo, number)
  const pullRequest = await fetchPullRequest(owner, repo, number)
  if (!pullRequest) {
    throw new GitHubApiError({
      status: 502,
      path: `/repos/${owner}/${repo}/pulls/${number}`,
      message: `GitHub pull request ${owner}/${repo}#${number} was unavailable after mutation.`,
    })
  }
  return pullRequest
}

export async function markPullRequestReady(
  owner: string,
  repo: string,
  pr: number,
): Promise<PullRequestData> {
  const pullRequestId = await fetchPullRequestNodeId(owner, repo, pr)
  if (!pullRequestId) {
    throw new GitHubApiError({
      status: 502,
      path: `/repos/${owner}/${repo}/pulls/${pr}`,
      message: 'GitHub pull request was unavailable before marking it ready for review.',
    })
  }
  await graphql<{
    markPullRequestReadyForReview: { pullRequest: { number: number } }
  }>(
    `mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
      markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
        pullRequest { number }
      }
    }`,
    { pullRequestId },
  )
  return fetchPullRequestAfterGraphQlMutation(owner, repo, pr)
}

export async function markPullRequestDraft(
  owner: string,
  repo: string,
  number: number,
): Promise<PullRequestData> {
  const pullRequestId = await fetchPullRequestNodeId(owner, repo, number)
  if (!pullRequestId) {
    throw new GitHubApiError({
      status: 404,
      path: `/repos/${owner}/${repo}/pulls/${number}`,
      message: 'Pull request not found.',
    })
  }
  await graphql<{
    convertPullRequestToDraft: { pullRequest: { number: number } }
  }>(
    `mutation ConvertPullRequestToDraft($pullRequestId: ID!) {
      convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
        pullRequest { number }
      }
    }`,
    { pullRequestId },
  )
  return fetchPullRequestAfterGraphQlMutation(owner, repo, number)
}

export async function fetchAssignableUsers(
  owner: string,
  repo: string,
): Promise<Array<{ login: string, avatarUrl: string, url: string }>> {
  return cachedFetch({
    cacheKey: `assignable-users:${owner}/${repo}`,
    ttlS: 900,
    etag: false,
    fetcher: async () => {
      const data = await graphql<{
        repository: {
          assignableUsers: {
            nodes: Array<{ login: string, avatarUrl: string, url: string }>
          }
        } | null
      }>(
        `query AssignableUsers($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            assignableUsers(first: 100) {
              nodes { login avatarUrl url }
            }
          }
        }`,
        { owner, repo },
      )
      return {
        data: { nodes: data.repository?.assignableUsers.nodes ?? [] },
        etag: null,
        status: 200,
      }
    },
  }).then(data => data?.nodes ?? [])
}
