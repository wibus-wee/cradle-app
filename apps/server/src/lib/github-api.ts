import { execSync } from 'node:child_process'

import { z } from 'zod'

import { getCached, isCacheStale, setCache } from './github-cache'

let cachedToken: string | null | undefined

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

async function githubGet<T>(path: string, schema: JsonSchema<T>): Promise<T | null> {
  const token = resolveGitHubToken()
  const url = `https://api.github.com${path}`
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const cached = etagCache.get(url)
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag
  }

  const res = await fetch(url, { headers })
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

export interface GitHubPullRequest {
  number: number
  title: string
  state: 'open' | 'closed'
  merged: boolean
  mergeable: boolean | null
  mergeable_state?: string
  head: { sha: string, ref: string }
  base: { ref: string }
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

export interface GitHubReviewUser {
  login: string
}

export interface GitHubPullRequestReview {
  id: number
  user: GitHubReviewUser | null
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  commit_id: string
  submitted_at: string | null
  body: string | null
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

const GitHubPullRequestSchema = z.object({
  number: z.number().finite(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
  mergeable_state: z.string().optional(),
  head: z.object({ sha: z.string(), ref: z.string() }),
  base: z.object({ ref: z.string() }),
}).passthrough()

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
  user: z.object({ login: z.string() }).nullable(),
  state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']),
  commit_id: z.string(),
  submitted_at: z.string().nullable(),
  body: z.string().nullable(),
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

export function fetchPullRequest(owner: string, repo: string, pr: number): Promise<GitHubPullRequest | null> {
  return githubGet(`/repos/${owner}/${repo}/pulls/${pr}`, GitHubPullRequestSchema)
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
