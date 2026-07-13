import { execSync } from 'node:child_process'

import { z } from 'zod'

import { getCached, isCacheStale, setCache } from './github-cache'

let cachedToken: string | null | undefined

const GITHUB_REQUEST_TIMEOUT_MS = 20_000

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

export function resolveGitHubToken(): string | null {
  if (cachedToken !== undefined) {
    return cachedToken
  }

  const envToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (envToken) {
    cachedToken = envToken
    return envToken
  }

  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 5000 }).trim()
    if (token && !token.includes(' ')) {
      cachedToken = token
      return token
    }
  }
  catch {
    // gh is optional; unauthenticated public GitHub reads can still work.
  }

  cachedToken = null
  return null
}

export function resetTokenCache() {
  cachedToken = undefined
  etagCache.clear()
  rateLimitRemaining = 5000
  rateLimitReset = 0
}

const etagCache = new Map<string, { etag: string, data: unknown }>()

interface JsonSchema<T> {
  parse: (data: unknown) => T
}

let rateLimitRemaining = 5000
let rateLimitReset = 0

export function isGitHubRateLimited(): boolean {
  if (rateLimitRemaining > 100) {
    return false
  }
  const now = Math.floor(Date.now() / 1000)
  return now < rateLimitReset
}

function recordRateLimit(headers: Headers): void {
  const remaining = headers.get('X-RateLimit-Remaining')
  const reset = headers.get('X-RateLimit-Reset')
  if (remaining) {
    rateLimitRemaining = Number.parseInt(remaining, 10)
  }
  if (reset) {
    rateLimitReset = Number.parseInt(reset, 10)
  }
}

async function readGitHubErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json() as { message?: unknown }
    return typeof data.message === 'string' && data.message.trim().length > 0
      ? data.message
      : `GitHub API returned ${res.status}`
  }
  catch {
    return `GitHub API returned ${res.status}`
  }
}

export function isGitHubMissingTarget(err: unknown): boolean {
  return err instanceof GitHubApiError && (err.status === 404 || err.status === 422)
}

function buildGitHubHeaders(options?: { etag?: string, requireToken?: boolean }): Record<string, string> {
  const token = resolveGitHubToken()
  if (options?.requireToken && !token) {
    throw new GitHubApiError({
      status: 401,
      path: '',
      message: 'GitHub authentication required. Set GH_TOKEN / GITHUB_TOKEN or run `gh auth login`.',
    })
  }

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  if (options?.etag) {
    headers['If-None-Match'] = options.etag
  }
  return headers
}

async function githubGet<T>(path: string, schema: JsonSchema<T>): Promise<T | null> {
  const url = `https://api.github.com${path}`
  const cached = etagCache.get(url)
  const headers = buildGitHubHeaders({ etag: cached?.etag })

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  })
  recordRateLimit(res.headers)

  if (res.status === 304) {
    return cached ? schema.parse(cached.data) : null
  }
  if (!res.ok) {
    if (res.status === 404 || res.status === 422) {
      throw new GitHubApiError({
        status: res.status,
        path,
        message: await readGitHubErrorMessage(res),
      })
    }
    return null
  }

  const data = schema.parse(await res.json())
  const etag = res.headers.get('ETag')
  if (etag) {
    etagCache.set(url, { etag, data })
  }
  return data
}

async function githubMutate<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>,
  schema: JsonSchema<T>,
): Promise<T> {
  const headers = buildGitHubHeaders({ requireToken: true })
  headers['Content-Type'] = 'application/json'

  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  })
  recordRateLimit(res.headers)

  if (!res.ok) {
    throw new GitHubApiError({
      status: res.status,
      path,
      message: await readGitHubErrorMessage(res),
    })
  }

  return schema.parse(await res.json())
}

const GitHubGraphQLResponseSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
}).passthrough()

async function githubGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  schema: JsonSchema<T>,
): Promise<T> {
  const path = '/graphql'
  const headers = buildGitHubHeaders({ requireToken: true })
  headers['Content-Type'] = 'application/json'

  const res = await fetch(`https://api.github.com${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  })
  recordRateLimit(res.headers)

  const payload = GitHubGraphQLResponseSchema.parse(await res.json())
  const errorMessage = payload.errors?.map(error => error.message).join('; ')
  if (!res.ok || errorMessage || payload.data === undefined) {
    throw new GitHubApiError({
      status: res.ok ? 422 : res.status,
      path,
      message: errorMessage || `GitHub GraphQL API returned ${res.status}`,
    })
  }

  return schema.parse(payload.data)
}

async function githubGetPaged<T>(path: string, schema: JsonSchema<T[]>, maxPages = 10): Promise<T[] | null> {
  const items: T[] = []
  for (let page = 1; page <= maxPages; page++) {
    const separator = path.includes('?') ? '&' : '?'
    const batch = await githubGet(`${path}${separator}per_page=100&page=${page}`, schema)
    if (!batch) {
      return null
    }
    items.push(...batch)
    if (batch.length < 100) {
      break
    }
  }
  return items
}

export interface GitHubPullRequestAuthor {
  login: string
  avatar_url: string
  html_url: string
}

export interface GitHubPullRequest {
  number: number
  title: string
  state: 'open' | 'closed'
  draft?: boolean
  merged: boolean
  mergeable: boolean | null
  mergeable_state?: string
  html_url?: string
  user?: GitHubPullRequestAuthor | null
  head: { sha: string, ref: string }
  base: { ref: string }
  // Only present on the single-PR resource (not the list-pulls endpoint).
  // `fetchPullRequest` always hits the single-PR endpoint, so these are
  // populated in practice, but kept optional for older cached shapes.
  additions?: number
  deletions?: number
}

export interface CreatePullRequestInput {
  owner: string
  repo: string
  title: string
  head: string
  base: string
  body?: string
  draft?: boolean
}

export interface UpdatePullRequestInput {
  owner: string
  repo: string
  pullRequestNumber: number
  title: string
  body: string
}

export interface CreatedGitHubPullRequest {
  number: number
  title: string
  draft: boolean
  html_url: string
  state: 'open' | 'closed'
  user?: GitHubPullRequestAuthor | null
  head: { sha: string, ref: string }
  base: { ref: string }
  additions?: number
  deletions?: number
}

export interface GitHubCheckRun {
  id?: number
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
  head_sha?: string | null
  html_url?: string | null
  details_url?: string | null
}

interface GitHubCheckRunsResponse {
  total_count: number
  check_runs: GitHubCheckRun[]
}

export interface GitHubCommitStatus {
  context: string
  state: 'error' | 'failure' | 'pending' | 'success'
  description: string | null
  target_url: string | null
}

export interface GitHubCombinedStatus {
  state: 'error' | 'failure' | 'pending' | 'success'
  total_count: number
  statuses: GitHubCommitStatus[]
}

export interface GitHubPullRequestReview {
  id: number
  user: GitHubPullRequestAuthor | null
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  commit_id: string
  submitted_at: string | null
  body: string | null
  html_url: string | null
}

export interface GitHubPullRequestDetail {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  draft: boolean
  merged: boolean
  mergeable: boolean | null
  mergeable_state: string
  html_url: string
  user: {
    login: string
    avatar_url: string
    html_url: string
  } | null
  head: { sha: string, ref: string }
  base: { ref: string }
  additions: number
  deletions: number
  changed_files: number
  commits: number
  comments: number
  review_comments: number
  created_at: string
  updated_at: string
  closed_at: string | null
  merged_at: string | null
  requested_reviewers: GitHubPullRequestAuthor[]
  assignees: Array<{
    login: string
    avatar_url: string
    html_url: string
  }>
  labels: Array<{
    name: string
    color: string
  }>
}

export interface GitHubPullRequestComment {
  id: number
  body: string
  html_url: string
  created_at: string
  updated_at: string
  user: {
    login: string
    avatar_url: string
    html_url: string
  } | null
}

export interface GitHubPullRequestFile {
  sha: string
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  blob_url: string
  raw_url: string
  contents_url: string
  patch: string | null
  previous_filename: string | null
}

export interface GitHubWorkflowRun {
  id: number
  name: string | null
  display_title: string | null
  run_number: number
  run_attempt: number
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'
  conclusion: string | null
  head_sha: string
  html_url: string | null
  created_at: string
  updated_at: string
}

interface GitHubWorkflowRunsResponse {
  total_count: number
  workflow_runs: GitHubWorkflowRun[]
}

export interface GitHubWorkflowJobStep {
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'pending'
  conclusion: string | null
  number: number
  started_at: string | null
  completed_at: string | null
}

export interface GitHubWorkflowJob {
  id: number
  run_id: number
  run_attempt: number
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'
  conclusion: string | null
  workflow_name: string | null
  head_sha: string
  html_url: string | null
  check_run_url: string | null
  started_at: string | null
  completed_at: string | null
  runner_name: string | null
  labels: string[]
  steps: GitHubWorkflowJobStep[]
}

interface GitHubWorkflowJobsResponse {
  total_count: number
  jobs: GitHubWorkflowJob[]
}

const GitHubUserSchema = z.object({
  login: z.string(),
  avatar_url: z.string(),
  html_url: z.string(),
}).passthrough()

const GitHubPullRequestSchema = z.object({
  number: z.number().finite(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().optional(),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
  mergeable_state: z.string().optional(),
  html_url: z.string().optional(),
  user: GitHubUserSchema.nullable().optional(),
  head: z.object({ sha: z.string(), ref: z.string() }),
  base: z.object({ ref: z.string() }),
  additions: z.number().finite().optional(),
  deletions: z.number().finite().optional(),
}).passthrough()

const GitHubPullRequestDetailSchema = z.object({
  number: z.number().finite(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean(),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
  mergeable_state: z.string(),
  html_url: z.string(),
  user: GitHubUserSchema.nullable(),
  head: z.object({ sha: z.string(), ref: z.string() }),
  base: z.object({ ref: z.string() }),
  additions: z.number().finite(),
  deletions: z.number().finite(),
  changed_files: z.number().finite(),
  commits: z.number().finite(),
  comments: z.number().finite(),
  review_comments: z.number().finite(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable(),
  merged_at: z.string().nullable(),
  requested_reviewers: z.array(GitHubUserSchema),
  assignees: z.array(GitHubUserSchema),
  labels: z.array(z.object({
    name: z.string(),
    color: z.string(),
  }).passthrough()),
}).passthrough()

const GitHubPullRequestCommentSchema = z.object({
  id: z.number().finite(),
  body: z.string(),
  html_url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  user: GitHubUserSchema.nullable(),
}).passthrough()

const GitHubPullRequestFileSchema = z.object({
  sha: z.string(),
  filename: z.string(),
  status: z.string(),
  additions: z.number().finite(),
  deletions: z.number().finite(),
  changes: z.number().finite(),
  blob_url: z.string(),
  raw_url: z.string(),
  contents_url: z.string(),
  patch: z.string().nullable().optional(),
  previous_filename: z.string().nullable().optional(),
}).passthrough().transform(file => ({
  ...file,
  patch: file.patch ?? null,
  previous_filename: file.previous_filename ?? null,
}))

const GitHubPullRequestNodeSchema = z.object({
  node_id: z.string(),
}).passthrough()

const CreatedGitHubPullRequestSchema = z.object({
  number: z.number().finite(),
  title: z.string(),
  draft: z.boolean(),
  html_url: z.string(),
  state: z.enum(['open', 'closed']),
  user: GitHubUserSchema.nullable().optional(),
  head: z.object({ sha: z.string(), ref: z.string() }),
  base: z.object({ ref: z.string() }),
  additions: z.number().finite().optional(),
  deletions: z.number().finite().optional(),
}).passthrough()

const MarkPullRequestReadyDataSchema = z.object({
  markPullRequestReadyForReview: z.object({
    pullRequest: z.object({
      number: z.number().finite(),
      title: z.string(),
      isDraft: z.boolean(),
      url: z.string(),
      state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
      headRefName: z.string(),
      baseRefName: z.string(),
      headRefOid: z.string(),
    }),
  }),
})

const GitHubCheckRunSchema = z.object({
  id: z.number().finite().optional(),
  name: z.string(),
  status: z.enum(['queued', 'in_progress', 'completed']),
  conclusion: z.string().nullable(),
  head_sha: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
  details_url: z.string().nullable().optional(),
}).passthrough()

const GitHubCheckRunsResponseSchema = z.object({
  total_count: z.number().finite(),
  check_runs: z.array(GitHubCheckRunSchema),
}).passthrough()

const GitHubCommitStatusSchema = z.object({
  context: z.string(),
  state: z.enum(['error', 'failure', 'pending', 'success']),
  description: z.string().nullable(),
  target_url: z.string().nullable(),
}).passthrough()

const GitHubCombinedStatusSchema = z.object({
  state: z.enum(['error', 'failure', 'pending', 'success']),
  total_count: z.number().finite(),
  statuses: z.array(GitHubCommitStatusSchema),
}).passthrough()

const GitHubPullRequestReviewSchema = z.object({
  id: z.number().finite(),
  user: GitHubUserSchema.nullable(),
  state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']),
  commit_id: z.string(),
  submitted_at: z.string().nullable(),
  body: z.string().nullable(),
  html_url: z.string().nullable().optional().transform(value => value ?? null),
}).passthrough()

const GitHubWorkflowRunSchema = z.object({
  id: z.number().finite(),
  name: z.string().nullable(),
  display_title: z.string().nullable(),
  run_number: z.number().finite(),
  run_attempt: z.number().finite(),
  status: z.enum(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending']),
  conclusion: z.string().nullable(),
  head_sha: z.string(),
  html_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

const GitHubWorkflowRunsResponseSchema = z.object({
  total_count: z.number().finite(),
  workflow_runs: z.array(GitHubWorkflowRunSchema),
}).passthrough()

const GitHubWorkflowJobStepSchema = z.object({
  name: z.string(),
  status: z.enum(['queued', 'in_progress', 'completed', 'pending']),
  conclusion: z.string().nullable(),
  number: z.number().finite(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
}).passthrough()

const GitHubWorkflowJobSchema = z.object({
  id: z.number().finite(),
  run_id: z.number().finite(),
  run_attempt: z.number().finite(),
  name: z.string(),
  status: z.enum(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending']),
  conclusion: z.string().nullable(),
  workflow_name: z.string().nullable(),
  head_sha: z.string(),
  html_url: z.string().nullable(),
  check_run_url: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  runner_name: z.string().nullable(),
  labels: z.array(z.string()),
  steps: z.array(GitHubWorkflowJobStepSchema),
}).passthrough()

const GitHubWorkflowJobsResponseSchema = z.object({
  total_count: z.number().finite(),
  jobs: z.array(GitHubWorkflowJobSchema),
}).passthrough()

export function hasGitHubToken(): boolean {
  return resolveGitHubToken() !== null
}

export interface GitHubViewer {
  login: string
  avatarUrl: string
  url: string
}

const GitHubViewerDataSchema = z.object({
  viewer: z.object({
    login: z.string(),
    avatarUrl: z.string(),
    url: z.string(),
  }).passthrough(),
})

export function fetchAuthenticatedUser(): Promise<GitHubViewer> {
  return githubGraphQL(
    `query ViewerIdentity {
      viewer {
        login
        avatarUrl
        url
      }
    }`,
    {},
    GitHubViewerDataSchema,
  ).then(data => data.viewer)
}

export type GitHubPullRequestChecksState = 'success' | 'failure' | 'pending' | 'neutral'

export interface GitHubActor {
  login: string
  avatarUrl: string
  url: string
}

export interface GitHubSearchPullRequest {
  owner: string
  repo: string
  number: number
  title: string
  url: string
  isDraft: boolean
  state: 'open' | 'closed'
  merged: boolean
  headRef: string
  baseRef: string
  headSha: string | null
  createdAt: string
  updatedAt: string
  author: GitHubActor | null
  additions: number
  deletions: number
  checksState: GitHubPullRequestChecksState
}

// GitHub's search only exposes a coarse commit status rollup, not individual
// check runs - good enough for a list-level signal, detail views still fetch
// the full check-run breakdown via fetchCheckRuns/fetchCombinedStatus.
const GitHubStatusCheckRollupStateSchema = z.enum(['EXPECTED', 'ERROR', 'FAILURE', 'PENDING', 'SUCCESS'])

function mapStatusCheckRollupState(
  state: z.infer<typeof GitHubStatusCheckRollupStateSchema> | undefined,
): GitHubPullRequestChecksState {
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'ERROR':
    case 'FAILURE':
      return 'failure'
    case 'EXPECTED':
    case 'PENDING':
      return 'pending'
    default:
      return 'neutral'
  }
}

const GitHubSearchPullRequestNodeSchema = z.object({
  number: z.number().finite(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  headRefName: z.string(),
  baseRefName: z.string(),
  additions: z.number().finite(),
  deletions: z.number().finite(),
  createdAt: z.string(),
  updatedAt: z.string(),
  repository: z.object({
    name: z.string(),
    owner: z.object({ login: z.string() }).passthrough(),
  }).passthrough(),
  author: z.object({
    login: z.string(),
    avatarUrl: z.string(),
    url: z.string(),
  }).nullable(),
  commits: z.object({
    nodes: z.array(z.object({
      commit: z.object({
        oid: z.string(),
        statusCheckRollup: z.object({
          state: GitHubStatusCheckRollupStateSchema,
        }).nullable(),
      }).passthrough(),
    })),
  }).passthrough(),
}).passthrough()

const GitHubSearchPullRequestsDataSchema = z.object({
  search: z.object({
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }).passthrough(),
    nodes: z.array(GitHubSearchPullRequestNodeSchema),
  }).passthrough(),
})

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

function mapSearchPullRequestNode(
  node: z.infer<typeof GitHubSearchPullRequestNodeSchema>,
): GitHubSearchPullRequest {
  const headCommit = node.commits.nodes[0]?.commit
  return {
    owner: node.repository.owner.login,
    repo: node.repository.name,
    number: node.number,
    title: node.title,
    url: node.url,
    isDraft: node.isDraft,
    state: node.state === 'OPEN' ? 'open' : 'closed',
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

export interface GitHubSearchPullRequestPage {
  items: GitHubSearchPullRequest[]
  hasNextPage: boolean
  endCursor: string | null
}

const SEARCH_PULL_REQUESTS_PAGE_SIZE = 25

/**
 * Fetches a single page of the given search query, most-recently-updated
 * first. Callers drive pagination explicitly via `after` - there is no
 * internal multi-page loop or item cap here, because GitHub search results
 * are NOT capped in this codebase: a viewer who has authored hundreds of PRs
 * must be able to page through all of them, not have the tail silently
 * dropped. `sort:updated-desc` is appended so that cursor pages remain a
 * stable, recency-ordered sequence.
 */
async function searchPullRequestsPage(searchQuery: string, after: string | null): Promise<GitHubSearchPullRequestPage> {
  const data = await githubGraphQL(
    SEARCH_PULL_REQUESTS_QUERY,
    { searchQuery: `${searchQuery} sort:updated-desc`, first: SEARCH_PULL_REQUESTS_PAGE_SIZE, after },
    GitHubSearchPullRequestsDataSchema,
  )
  return {
    items: data.search.nodes.map(mapSearchPullRequestNode),
    hasNextPage: data.search.pageInfo.hasNextPage,
    endCursor: data.search.pageInfo.endCursor,
  }
}

export function searchAuthoredPullRequests(login: string, after: string | null = null): Promise<GitHubSearchPullRequestPage> {
  return searchPullRequestsPage(`is:pr author:${login}`, after)
}

export function searchReviewRequestedPullRequests(login: string, after: string | null = null): Promise<GitHubSearchPullRequestPage> {
  return searchPullRequestsPage(`is:pr review-requested:${login}`, after)
}

export function fetchPullRequest(owner: string, repo: string, pr: number): Promise<GitHubPullRequest | null> {
  return githubGet(`/repos/${owner}/${repo}/pulls/${pr}`, GitHubPullRequestSchema)
}

export function fetchPullRequestDetail(owner: string, repo: string, pr: number): Promise<GitHubPullRequestDetail | null> {
  return githubGet(`/repos/${owner}/${repo}/pulls/${pr}`, GitHubPullRequestDetailSchema)
}

export function fetchPullRequestComments(owner: string, repo: string, pr: number): Promise<GitHubPullRequestComment[] | null> {
  return githubGetPaged(`/repos/${owner}/${repo}/issues/${pr}/comments`, z.array(GitHubPullRequestCommentSchema))
}

export function fetchPullRequestFiles(owner: string, repo: string, pr: number): Promise<GitHubPullRequestFile[] | null> {
  return githubGetPaged(`/repos/${owner}/${repo}/pulls/${pr}/files`, z.array(GitHubPullRequestFileSchema))
}

function fetchPullRequestNode(owner: string, repo: string, pr: number): Promise<{ node_id: string } | null> {
  return githubGet(`/repos/${owner}/${repo}/pulls/${pr}`, GitHubPullRequestNodeSchema)
}

export function createPullRequest(input: CreatePullRequestInput): Promise<CreatedGitHubPullRequest> {
  return githubMutate(
    'POST',
    `/repos/${input.owner}/${input.repo}/pulls`,
    {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body ?? '',
      draft: input.draft ?? true,
    },
    CreatedGitHubPullRequestSchema,
  )
}

export function updatePullRequest(input: UpdatePullRequestInput): Promise<CreatedGitHubPullRequest> {
  return githubMutate(
    'PATCH',
    `/repos/${input.owner}/${input.repo}/pulls/${input.pullRequestNumber}`,
    {
      title: input.title,
      body: input.body,
    },
    CreatedGitHubPullRequestSchema,
  )
}

export async function markPullRequestReady(
  owner: string,
  repo: string,
  pr: number,
): Promise<CreatedGitHubPullRequest> {
  const current = await fetchPullRequestNode(owner, repo, pr)
  if (!current) {
    throw new GitHubApiError({
      status: 502,
      path: `/repos/${owner}/${repo}/pulls/${pr}`,
      message: 'GitHub pull request was unavailable before marking it ready for review.',
    })
  }

  const data = await githubGraphQL(
    `mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
      markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
        pullRequest {
          number
          title
          isDraft
          url
          state
          headRefName
          baseRefName
          headRefOid
        }
      }
    }`,
    { pullRequestId: current.node_id },
    MarkPullRequestReadyDataSchema,
  )
  const updated = data.markPullRequestReadyForReview.pullRequest

  return {
    number: updated.number,
    title: updated.title,
    draft: updated.isDraft,
    html_url: updated.url,
    state: updated.state === 'OPEN' ? 'open' : 'closed',
    head: { sha: updated.headRefOid, ref: updated.headRefName },
    base: { ref: updated.baseRefName },
  }
}

export async function fetchCheckRuns(owner: string, repo: string, ref: string): Promise<GitHubCheckRunsResponse | null> {
  const runs: GitHubCheckRun[] = []
  let totalCount = 0
  for (let page = 1; page <= 10; page++) {
    const data = await githubGet(
      `/repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=100&page=${page}`,
      GitHubCheckRunsResponseSchema,
    )
    if (!data) {
      return null
    }
    totalCount = data.total_count
    runs.push(...data.check_runs)
    if (data.check_runs.length < 100 || runs.length >= data.total_count) {
      break
    }
  }
  return { total_count: totalCount, check_runs: runs }
}

export function fetchCheckRun(owner: string, repo: string, checkRunId: number): Promise<GitHubCheckRun | null> {
  return githubGet(`/repos/${owner}/${repo}/check-runs/${checkRunId}`, GitHubCheckRunSchema)
}

export async function fetchWorkflowRunsForHead(owner: string, repo: string, headSha: string): Promise<GitHubWorkflowRunsResponse | null> {
  const runs: GitHubWorkflowRun[] = []
  let totalCount = 0
  for (let page = 1; page <= 3; page++) {
    const data = await githubGet(
      `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=100&page=${page}`,
      GitHubWorkflowRunsResponseSchema,
    )
    if (!data) {
      return null
    }
    totalCount = data.total_count
    runs.push(...data.workflow_runs)
    if (data.workflow_runs.length < 100 || runs.length >= data.total_count) {
      break
    }
  }
  return { total_count: totalCount, workflow_runs: runs }
}

export async function fetchWorkflowRunJobs(owner: string, repo: string, runId: number): Promise<GitHubWorkflowJobsResponse | null> {
  const jobs: GitHubWorkflowJob[] = []
  let totalCount = 0
  for (let page = 1; page <= 10; page++) {
    const data = await githubGet(
      `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`,
      GitHubWorkflowJobsResponseSchema,
    )
    if (!data) {
      return null
    }
    totalCount = data.total_count
    jobs.push(...data.jobs)
    if (data.jobs.length < 100 || jobs.length >= data.total_count) {
      break
    }
  }
  return { total_count: totalCount, jobs }
}

const GitHubRepoSchema = z.object({
  default_branch: z.string(),
}).passthrough()

export function fetchRepo(owner: string, repo: string): Promise<{ default_branch: string } | null> {
  return githubGet(`/repos/${owner}/${repo}`, GitHubRepoSchema)
}

const GitHubBranchHeadSchema = z.object({
  commit: z.object({ sha: z.string() }).passthrough(),
}).passthrough()

export function fetchBranchHead(owner: string, repo: string, branch: string): Promise<{ sha: string } | null> {
  return githubGet(`/repos/${owner}/${repo}/branches/${branch}`, GitHubBranchHeadSchema)
    .then(data => data ? { sha: data.commit.sha } : null)
}

export function fetchCombinedStatus(owner: string, repo: string, ref: string): Promise<GitHubCombinedStatus | null> {
  return githubGet(`/repos/${owner}/${repo}/commits/${ref}/status`, GitHubCombinedStatusSchema)
}

export function fetchPullRequestReviews(owner: string, repo: string, pr: number): Promise<GitHubPullRequestReview[] | null> {
  return githubGetPaged(`/repos/${owner}/${repo}/pulls/${pr}/reviews`, z.array(GitHubPullRequestReviewSchema))
}

export interface BranchProtectionResult {
  requiredContexts: string[]
}

const BranchProtectionSchema = z.object({
  required_status_checks: z.object({
    contexts: z.array(z.string()),
  }).nullable(),
}).passthrough()

const BRANCH_PROTECTION_CACHE_TTL_S = 60 * 60 // 1 hour

export async function fetchBranchProtection(owner: string, repo: string, branch: string): Promise<BranchProtectionResult | null> {
  const cacheKey = `branch-protection:${owner}/${repo}:${branch}`

  if (!isCacheStale(cacheKey, BRANCH_PROTECTION_CACHE_TTL_S)) {
    const cached = getCached<BranchProtectionResult>(cacheKey)
    if (cached) {
      return cached.data
    }
  }

  const token = resolveGitHubToken()
  const url = `https://api.github.com/repos/${owner}/${repo}/branches/${branch}/protection`
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const cachedEntry = getCached<{ etag?: string }>(cacheKey)
  if (cachedEntry?.etag) {
    headers['If-None-Match'] = cachedEntry.etag
  }

  const res = await fetch(url, { headers })
  recordRateLimit(res.headers)

  if (res.status === 304) {
    const cached = getCached<BranchProtectionResult>(cacheKey)
    return cached?.data ?? null
  }

  if (res.status === 404) {
    const result: BranchProtectionResult = { requiredContexts: [] }
    setCache(cacheKey, result, null)
    return result
  }

  if (!res.ok) {
    return getCached<BranchProtectionResult>(cacheKey)?.data ?? null
  }

  const raw = BranchProtectionSchema.parse(await res.json())
  const result: BranchProtectionResult = {
    requiredContexts: raw.required_status_checks?.contexts ?? [],
  }
  const etag = res.headers.get('ETag')
  setCache(cacheKey, result, etag)
  return result
}
