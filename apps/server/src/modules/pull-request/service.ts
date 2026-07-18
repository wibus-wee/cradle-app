import { sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'
import type { Static } from 'elysia'
import { simpleGit } from 'simple-git'

import { AppError } from '../../errors/app-error'
import { parseJsonObjectOrEmpty } from '../../helpers/json-record'
import { db } from '../../infra'
import type { GitHubSearchPullRequest, GitHubViewer } from '../../lib/github-api'
import {
  createPullRequest as createGitHubPullRequest,
  fetchAuthenticatedUser,
  fetchCheckRuns,
  fetchCombinedStatus,
  fetchPullRequest,
  fetchPullRequestComments,
  fetchPullRequestDetail,
  fetchPullRequestFiles,
  fetchPullRequestReviews,
  fetchRepo,
  GitHubApiError,
  hasGitHubToken,
  markPullRequestReady as markGitHubPullRequestReady,
  searchAuthoredPullRequests,
  searchReviewingPullRequests,
  updatePullRequest as updateGitHubPullRequest,
} from '../../lib/github-api'
import * as Worktree from '../worktree/service'
import { isForceWithLeaseRejection, resolveDeliveryPushArgs } from './delivery-push'
import { parseGitHubOwnerRepo } from './github-remote'
import type { pullRequestSearchViewSchema, pullRequestViewSchema } from './model'
import { withCradlePullRequestFooter } from './pr-body'

export { resolveDeliveryPushArgs } from './delivery-push'

export type SessionPullRequestView = Static<typeof pullRequestViewSchema>
export type PullRequestSearchView = Static<typeof pullRequestSearchViewSchema>
export interface PullRequestSearchPage {
  items: PullRequestSearchView[]
  hasNextPage: boolean
  endCursor: string | null
}
export interface PullRequestReadiness {
  isolated: boolean
  clean: boolean
  branch: string | null
  baseRef: string | null
  commitsAhead: number
  changedFiles: number
}
export type PullRequestCheckState = 'success' | 'failure' | 'pending' | 'neutral'
export interface SessionPullRequestDetail {
  pullRequest: SessionPullRequestView & {
    body: string | null
    author: {
      login: string
      avatarUrl: string
      url: string
    } | null
    additions: number
    deletions: number
    changedFiles: number
    commits: number
    comments: number
    reviewComments: number
    mergeable: boolean | null
    mergeableState: string
    createdAtIso: string
    updatedAtIso: string
    closedAtIso: string | null
    mergedAtIso: string | null
    reviewers: Array<{
      login: string
      avatarUrl: string
      url: string
    }>
    assignees: Array<{
      login: string
      avatarUrl: string
      url: string
    }>
    labels: Array<{ name: string, color: string }>
    checksState: PullRequestCheckState
    checks: Array<{
      id: string
      name: string
      status: 'queued' | 'in_progress' | 'completed'
      conclusion: string | null
      url: string | null
    }>
  }
  timeline: Array<{
    id: string
    kind: 'comment' | 'review'
    author: {
      login: string
      avatarUrl: string | null
      url: string | null
    } | null
    body: string | null
    state: string | null
    createdAt: string
    url: string | null
  }>
  files: Array<{
    sha: string
    filename: string
    previousFilename: string | null
    status: string
    additions: number
    deletions: number
    changes: number
    patch: string | null
    blobUrl: string
    rawUrl: string
  }>
}
export { parseGitHubOwnerRepo } from './github-remote'
export { withCradlePullRequestFooter } from './pr-body'

interface StoredSessionPullRequestAuthor {
  login: string
  avatarUrl: string
  url: string
}

interface StoredSessionPullRequest {
  owner: string
  repo: string
  number: number
  url: string
  title: string
  isDraft: boolean
  state: 'open' | 'closed'
  merged: boolean
  headRef: string
  baseRef: string
  headSha: string | null
  createdAt: number
  updatedAt: number
  author?: StoredSessionPullRequestAuthor | null
  additions?: number
  deletions?: number
}

function toStoredAuthor(user: { login: string, avatar_url: string, html_url: string } | null | undefined): StoredSessionPullRequestAuthor | null {
  return user ? { login: user.login, avatarUrl: user.avatar_url, url: user.html_url } : null
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function mapGitHubError(err: unknown, fallbackMessage: string): never {
  if (err instanceof GitHubApiError) {
    throw new AppError({
      code: err.status === 401 || err.status === 403
        ? 'github_auth_required'
        : err.status === 404 || err.status === 422
          ? 'github_pr_request_failed'
          : 'github_api_error',
      status: err.status === 401 || err.status === 403
        ? 401
        : err.status === 404 || err.status === 422
          ? 400
          : 502,
      message: err.message || fallbackMessage,
      details: { path: err.path, status: err.status },
    })
  }
  throw err instanceof Error
    ? new AppError({
        code: 'github_api_error',
        status: 502,
        message: err.message || fallbackMessage,
      })
    : new AppError({
        code: 'github_api_error',
        status: 502,
        message: fallbackMessage,
      })
}

function readStoredPullRequest(configJson: string | null | undefined): StoredSessionPullRequest | null {
  const config = parseJsonObjectOrEmpty(configJson)
  const github = config.github
  if (!github || typeof github !== 'object') {
    return null
  }
  const pullRequest = (github as { pullRequest?: unknown }).pullRequest
  if (!pullRequest || typeof pullRequest !== 'object') {
    return null
  }
  const value = pullRequest as Record<string, unknown>
  if (
    typeof value.owner !== 'string'
    || typeof value.repo !== 'string'
    || typeof value.number !== 'number'
    || typeof value.url !== 'string'
    || typeof value.title !== 'string'
    || typeof value.isDraft !== 'boolean'
    || (value.state !== 'open' && value.state !== 'closed')
    || typeof value.merged !== 'boolean'
    || typeof value.headRef !== 'string'
    || typeof value.baseRef !== 'string'
    || typeof value.createdAt !== 'number'
    || typeof value.updatedAt !== 'number'
  ) {
    return null
  }

  return {
    owner: value.owner,
    repo: value.repo,
    number: value.number,
    url: value.url,
    title: value.title,
    isDraft: value.isDraft,
    state: value.state,
    merged: value.merged,
    headRef: value.headRef,
    baseRef: value.baseRef,
    headSha: typeof value.headSha === 'string' ? value.headSha : null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    author: readStoredAuthor(value.author),
    additions: typeof value.additions === 'number' ? value.additions : undefined,
    deletions: typeof value.deletions === 'number' ? value.deletions : undefined,
  }
}

function readStoredAuthor(value: unknown): StoredSessionPullRequestAuthor | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const author = value as Record<string, unknown>
  if (
    typeof author.login !== 'string'
    || typeof author.avatarUrl !== 'string'
    || typeof author.url !== 'string'
  ) {
    return null
  }
  return { login: author.login, avatarUrl: author.avatarUrl, url: author.url }
}

function writeStoredPullRequest(
  configJson: string | null | undefined,
  pullRequest: StoredSessionPullRequest | null,
): string {
  const config = parseJsonObjectOrEmpty(configJson)
  const github
    = config.github && typeof config.github === 'object'
      ? { ...(config.github as Record<string, unknown>) }
      : {}

  if (!pullRequest) {
    delete github.pullRequest
  }
  else {
    github.pullRequest = pullRequest
  }

  if (Object.keys(github).length === 0) {
    delete config.github
  }
  else {
    config.github = github
  }

  return JSON.stringify(config)
}

function toView(stored: StoredSessionPullRequest): SessionPullRequestView {
  return { ...stored }
}

async function resolveGitHubRemote(rootPath: string): Promise<{ owner: string, repo: string, remoteName: string }> {
  const git = simpleGit(rootPath)
  const remotes = await git.getRemotes(true)
  const preferred = remotes.find(remote => remote.name === 'origin') ?? remotes[0]
  if (!preferred) {
    throw new AppError({
      code: 'github_remote_missing',
      status: 400,
      message: 'No git remotes configured for this workspace.',
    })
  }

  const remoteUrl = preferred.refs.push || preferred.refs.fetch
  if (!remoteUrl) {
    throw new AppError({
      code: 'github_remote_missing',
      status: 400,
      message: `Remote "${preferred.name}" has no URL.`,
    })
  }

  const parsed = parseGitHubOwnerRepo(remoteUrl)
  if (!parsed) {
    throw new AppError({
      code: 'github_remote_not_github',
      status: 400,
      message: `Remote "${preferred.name}" is not a GitHub repository URL.`,
      details: { remoteUrl },
    })
  }

  return { ...parsed, remoteName: preferred.name }
}

async function readRemoteBranchSha(input: {
  rootPath: string
  remoteName: string
  branch: string
}): Promise<string | null> {
  const git = simpleGit(input.rootPath)
  const output = await git.raw(['ls-remote', '--heads', input.remoteName, input.branch])
  const line = output
    .split('\n')
    .map(entry => entry.trim())
    .find(entry => entry.length > 0)
  if (!line) {
    return null
  }
  const sha = line.split(/\s/)[0]?.trim()
  return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null
}

export async function isBranchOnRemote(rootPath: string, branch: string): Promise<boolean> {
  let remote: { owner: string, repo: string, remoteName: string }
  try {
    remote = await resolveGitHubRemote(rootPath)
  }
  catch (error) {
    if (error instanceof AppError
      && (error.code === 'github_remote_missing' || error.code === 'github_remote_not_github')) {
      return false
    }
    throw error
  }
  return (await readRemoteBranchSha({ rootPath, remoteName: remote.remoteName, branch })) !== null
}

async function ensureBranchPushed(input: {
  rootPath: string
  branch: string
  remoteName: string
}): Promise<void> {
  const git = simpleGit(input.rootPath)
  const status = await git.status()
  if (status.files.length > 0) {
    throw new AppError({
      code: 'pull_request_dirty_worktree',
      status: 409,
      message: 'Working tree has uncommitted changes. Commit or stash before opening a pull request.',
      details: { changedFiles: status.files.length },
    })
  }

  let remoteSha: string | null = null
  try {
    remoteSha = await readRemoteBranchSha(input)
  }
  catch (error) {
    throw new AppError({
      code: 'git_push_failed',
      status: 502,
      message: error instanceof Error
        ? error.message
        : 'Failed to inspect the remote branch before pushing.',
      details: { branch: input.branch, remoteName: input.remoteName },
    })
  }

  const pushArgs = resolveDeliveryPushArgs({
    branch: input.branch,
    remoteSha,
  })

  try {
    await git.push(input.remoteName, input.branch, pushArgs)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to push branch to remote.'
    if (remoteSha && isForceWithLeaseRejection(message)) {
      throw new AppError({
        code: 'git_push_lease_rejected',
        status: 409,
        message: 'Remote branch tip changed since Cradle inspected it. Fetch/rebase the worktree branch, or resolve the remote update before submitting again.',
        details: {
          branch: input.branch,
          remoteName: input.remoteName,
          expectedRemoteSha: remoteSha,
          cause: message,
        },
      })
    }
    throw new AppError({
      code: 'git_push_failed',
      status: 502,
      message,
      details: { branch: input.branch, remoteName: input.remoteName },
    })
  }
}

function requireSession(sessionId: string) {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found' })
  }
  return session
}

function persistPullRequest(sessionId: string, pullRequest: StoredSessionPullRequest): SessionPullRequestView {
  const session = requireSession(sessionId)
  const configJson = writeStoredPullRequest(session.configJson, pullRequest)
  const updatedAt = nowSeconds()
  db()
    .update(sessions)
    .set({ configJson, updatedAt })
    .where(eq(sessions.id, sessionId))
    .run()
  return toView(pullRequest)
}

export function getBoundPullRequest(sessionId: string): SessionPullRequestView | null {
  const session = requireSession(sessionId)
  const stored = readStoredPullRequest(session.configJson)
  return stored ? toView(stored) : null
}

export async function getPullRequest(sessionId: string): Promise<SessionPullRequestView | null> {
  const session = requireSession(sessionId)
  const stored = readStoredPullRequest(session.configJson)
  if (!stored) {
    return null
  }

  try {
    const live = await fetchPullRequest(stored.owner, stored.repo, stored.number)
    if (!live) {
      return toView(stored)
    }

    const next: StoredSessionPullRequest = {
      ...stored,
      title: live.title,
      isDraft: live.draft ?? stored.isDraft,
      state: live.state,
      merged: live.merged,
      headRef: live.head.ref,
      baseRef: live.base.ref,
      headSha: live.head.sha,
      url: live.html_url ?? stored.url,
      updatedAt: nowSeconds(),
      author: live.user !== undefined ? toStoredAuthor(live.user) : stored.author,
      additions: live.additions ?? stored.additions,
      deletions: live.deletions ?? stored.deletions,
    }
    return persistPullRequest(sessionId, next)
  }
  catch (error) {
    if (error instanceof GitHubApiError && (error.status === 404 || error.status === 422)) {
      return toView(stored)
    }
    return toView(stored)
  }
}

function deriveChecksState(checks: SessionPullRequestDetail['pullRequest']['checks']): PullRequestCheckState {
  if (checks.length === 0) {
    return 'neutral'
  }
  if (checks.some(check => check.status !== 'completed' || check.conclusion === null)) {
    return 'pending'
  }
  const failedConclusions = new Set([
    'action_required',
    'cancelled',
    'failure',
    'stale',
    'startup_failure',
    'timed_out',
  ])
  return checks.some(check => check.conclusion && failedConclusions.has(check.conclusion))
    ? 'failure'
    : 'success'
}

export async function getPullRequestDetail(sessionId: string): Promise<SessionPullRequestDetail> {
  const session = requireSession(sessionId)
  const stored = readStoredPullRequest(session.configJson)
  if (!stored) {
    throw new AppError({
      code: 'pull_request_not_bound',
      status: 404,
      message: 'No pull request is bound to this session.',
    })
  }
  return fetchPullRequestDetailByRef(stored.owner, stored.repo, stored.number)
}

/**
 * Fetches live GitHub pull request detail directly by owner/repo/number.
 * This is the generic, session-independent core of PR detail lookup - a
 * session is just one optional way to have already resolved these three
 * values (see `getPullRequestDetail` above). PRs discovered via GitHub
 * search (not created through Cradle Work) use this function directly.
 */
export async function fetchPullRequestDetailByRef(
  owner: string,
  repo: string,
  number: number,
): Promise<SessionPullRequestDetail> {
  const [live, comments, reviews, files] = await Promise.all([
    fetchPullRequestDetail(owner, repo, number),
    fetchPullRequestComments(owner, repo, number),
    fetchPullRequestReviews(owner, repo, number),
    fetchPullRequestFiles(owner, repo, number),
  ])
  if (!live) {
    throw new AppError({
      code: 'github_pr_unavailable',
      status: 502,
      message: 'GitHub pull request details are currently unavailable.',
      details: { owner, repo, number },
    })
  }
  const [checkRuns, combinedStatus] = await Promise.all([
    fetchCheckRuns(owner, repo, live.head.sha),
    fetchCombinedStatus(owner, repo, live.head.sha),
  ])

  const checks: SessionPullRequestDetail['pullRequest']['checks'] = [
    ...(checkRuns?.check_runs ?? []).map(check => ({
      id: `check-run:${check.id ?? check.name}`,
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      url: check.html_url ?? check.details_url ?? null,
    })),
    ...(combinedStatus?.statuses ?? []).map((status, index) => ({
      id: `commit-status:${status.context}:${index}`,
      name: status.context,
      status: status.state === 'pending' ? 'in_progress' as const : 'completed' as const,
      conclusion: status.state === 'success' ? 'success' : status.state === 'pending' ? null : 'failure',
      url: status.target_url,
    })),
  ]

  const timeline: SessionPullRequestDetail['timeline'] = [
    ...(comments ?? []).map(comment => ({
      id: `comment:${comment.id}`,
      kind: 'comment' as const,
      author: comment.user
        ? {
            login: comment.user.login,
            avatarUrl: comment.user.avatar_url,
            url: comment.user.html_url,
          }
        : null,
      body: comment.body,
      state: null,
      createdAt: comment.created_at,
      url: comment.html_url,
    })),
    ...(reviews ?? []).flatMap(review => review.submitted_at
      ? [{
          id: `review:${review.id}`,
          kind: 'review' as const,
          author: review.user
            ? { login: review.user.login, avatarUrl: null, url: null }
            : null,
          body: review.body,
          state: review.state,
          createdAt: review.submitted_at,
          url: review.html_url,
        }]
      : []),
  ].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))

  const reviewers = new Map<string, {
    login: string
    avatarUrl: string
    url: string
  }>()
  for (const reviewer of live.requested_reviewers) {
    reviewers.set(reviewer.login, {
      login: reviewer.login,
      avatarUrl: reviewer.avatar_url,
      url: reviewer.html_url,
    })
  }
  for (const review of reviews ?? []) {
    if (review.user) {
      reviewers.set(review.user.login, {
        login: review.user.login,
        avatarUrl: review.user.avatar_url ?? '',
        url: review.user.html_url ?? '',
      })
    }
  }

  return {
    pullRequest: {
      owner,
      repo,
      number: live.number,
      url: live.html_url,
      title: live.title,
      isDraft: live.draft,
      state: live.state,
      merged: live.merged,
      headRef: live.head.ref,
      baseRef: live.base.ref,
      headSha: live.head.sha,
      createdAt: Math.floor(new Date(live.created_at).getTime() / 1000),
      updatedAt: Math.floor(new Date(live.updated_at).getTime() / 1000),
      body: live.body,
      author: live.user
        ? {
            login: live.user.login,
            avatarUrl: live.user.avatar_url,
            url: live.user.html_url,
          }
        : null,
      additions: live.additions,
      deletions: live.deletions,
      changedFiles: live.changed_files,
      commits: live.commits,
      comments: live.comments,
      reviewComments: live.review_comments,
      mergeable: live.mergeable,
      mergeableState: live.mergeable_state,
      createdAtIso: live.created_at,
      updatedAtIso: live.updated_at,
      closedAtIso: live.closed_at,
      mergedAtIso: live.merged_at,
      reviewers: [...reviewers.values()],
      assignees: live.assignees.map(assignee => ({
        login: assignee.login,
        avatarUrl: assignee.avatar_url,
        url: assignee.html_url,
      })),
      labels: live.labels,
      checksState: deriveChecksState(checks),
      checks,
    },
    timeline,
    files: (files ?? []).map(file => ({
      sha: file.sha,
      filename: file.filename,
      previousFilename: file.previous_filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
      blobUrl: file.blob_url,
      rawUrl: file.raw_url,
    })),
  }
}

function toSearchView(pr: GitHubSearchPullRequest): PullRequestSearchView {
  return {
    owner: pr.owner,
    repo: pr.repo,
    number: pr.number,
    url: pr.url,
    title: pr.title,
    isDraft: pr.isDraft,
    state: pr.state,
    merged: pr.merged,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    headSha: pr.headSha,
    createdAt: Math.floor(new Date(pr.createdAt).getTime() / 1000),
    updatedAt: Math.floor(new Date(pr.updatedAt).getTime() / 1000),
    author: pr.author,
    additions: pr.additions,
    deletions: pr.deletions,
    checksState: pr.checksState,
  }
}

function requireGitHubToken(): void {
  if (!hasGitHubToken()) {
    throw new AppError({
      code: 'github_auth_required',
      status: 401,
      message: 'GitHub authentication required. Set GH_TOKEN / GITHUB_TOKEN or run `gh auth login`.',
    })
  }
}

/**
 * Resolves the GitHub identity the "authored"/"reviewing" feeds below are
 * scoped to. The standalone Pull Requests surface fetches this once, then
 * passes `login` into `listAuthoredPullRequests`/`listReviewingPullRequests`
 * itself - the identity rarely changes and each feed page shouldn't have to
 * re-resolve it.
 */
export async function getViewerIdentity(): Promise<GitHubViewer> {
  requireGitHubToken()
  try {
    return await fetchAuthenticatedUser()
  }
  catch (error) {
    mapGitHubError(error, 'Failed to resolve the authenticated GitHub identity.')
  }
}

/**
 * Pull requests authored by `login`, most recently updated first. Not
 * bounded to any Cradle session - Work-bound PRs are a separate, optional
 * overlay resolved client-side by matching owner/repo/number. Paginated via
 * `after` (GitHub search cursor); there is no server-side item cap, so a
 * viewer with a long history can page through all of it.
 */
export async function listAuthoredPullRequests(login: string, after?: string): Promise<PullRequestSearchPage> {
  requireGitHubToken()
  try {
    const page = await searchAuthoredPullRequests(login, after || null)
    return { items: page.items.map(toSearchView), hasNextPage: page.hasNextPage, endCursor: page.endCursor }
  }
  catch (error) {
    mapGitHubError(error, 'Failed to list pull requests you authored.')
  }
}

/**
 * Pull requests where `login` is involved as a reviewer (either requested or
 * already reviewed), most recently updated first. See
 * `listAuthoredPullRequests` for pagination semantics.
 */
export async function listReviewingPullRequests(login: string, after?: string): Promise<PullRequestSearchPage> {
  requireGitHubToken()
  try {
    const page = await searchReviewingPullRequests(login, after || null)
    return { items: page.items.map(toSearchView), hasNextPage: page.hasNextPage, endCursor: page.endCursor }
  }
  catch (error) {
    mapGitHubError(error, 'Failed to list pull requests you review.')
  }
}

export async function inspectPullRequestReadiness(sessionId: string): Promise<PullRequestReadiness> {
  const session = requireSession(sessionId)
  const execution = Worktree.resolveSessionExecutionRoot(session)
  if (!execution.isIsolated || !execution.rootPath || !execution.branch || !execution.worktreeId) {
    return {
      isolated: false,
      clean: false,
      branch: execution.branch,
      baseRef: null,
      commitsAhead: 0,
      changedFiles: 0,
    }
  }

  Worktree.assertIsolationExecutionReady(session)
  const worktree = Worktree.getWorktree(execution.worktreeId)
  const git = simpleGit(execution.rootPath)
  const status = await git.status()
  const baseRef = worktree?.baseRef ?? null
  const countOutput = baseRef
    ? await git.raw(['rev-list', '--count', `${baseRef}..HEAD`])
    : '0'
  const commitsAhead = Number.parseInt(countOutput.trim(), 10)

  return {
    isolated: true,
    clean: status.files.length === 0,
    branch: execution.branch,
    baseRef,
    commitsAhead: Number.isFinite(commitsAhead) ? commitsAhead : 0,
    changedFiles: status.files.length,
  }
}

export async function createDraftPullRequest(input: {
  sessionId: string
  title: string
  body?: string
  base?: string
}): Promise<SessionPullRequestView> {
  if (!hasGitHubToken()) {
    throw new AppError({
      code: 'github_auth_required',
      status: 401,
      message: 'GitHub authentication required. Set GH_TOKEN / GITHUB_TOKEN or run `gh auth login`.',
    })
  }

  const session = requireSession(input.sessionId)
  const existing = readStoredPullRequest(session.configJson)
  if (existing && existing.state === 'open') {
    throw new AppError({
      code: 'pull_request_already_bound',
      status: 409,
      message: `Session already has open PR #${existing.number}.`,
      details: { pullRequest: existing },
    })
  }

  const execution = Worktree.resolveSessionExecutionRoot(session)
  if (!execution.isIsolated || !execution.branch || !execution.rootPath) {
    throw new AppError({
      code: 'session_not_isolated',
      status: 409,
      message: 'Open a draft PR only from an isolated session worktree.',
      details: {
        isIsolated: execution.isIsolated,
        branch: execution.branch,
      },
    })
  }

  Worktree.assertIsolationExecutionReady(session)

  const remote = await resolveGitHubRemote(execution.rootPath)
  await ensureBranchPushed({
    rootPath: execution.rootPath,
    branch: execution.branch,
    remoteName: remote.remoteName,
  })

  let base = input.base?.trim() || ''
  if (!base) {
    try {
      const repo = await fetchRepo(remote.owner, remote.repo)
      base = repo?.default_branch ?? 'main'
    }
    catch (error) {
      mapGitHubError(error, 'Failed to resolve repository default branch.')
    }
  }

  let created: Awaited<ReturnType<typeof createGitHubPullRequest>>
  try {
    created = await createGitHubPullRequest({
      owner: remote.owner,
      repo: remote.repo,
      title: input.title.trim(),
      body: withCradlePullRequestFooter(input.body),
      head: execution.branch,
      base,
      draft: true,
    })
  }
  catch (error) {
    mapGitHubError(error, 'Failed to create GitHub pull request.')
  }

  const timestamp = nowSeconds()
  const stored: StoredSessionPullRequest = {
    owner: remote.owner,
    repo: remote.repo,
    number: created.number,
    url: created.html_url,
    title: created.title,
    isDraft: created.draft,
    state: created.state,
    merged: false,
    headRef: created.head.ref,
    baseRef: created.base.ref,
    headSha: created.head.sha,
    createdAt: timestamp,
    updatedAt: timestamp,
    author: toStoredAuthor(created.user),
    additions: created.additions,
    deletions: created.deletions,
  }

  return persistPullRequest(input.sessionId, stored)
}

export async function updatePullRequest(input: {
  sessionId: string
  title: string
  body: string
}): Promise<SessionPullRequestView> {
  if (!hasGitHubToken()) {
    throw new AppError({
      code: 'github_auth_required',
      status: 401,
      message: 'GitHub authentication required. Set GH_TOKEN / GITHUB_TOKEN or run `gh auth login`.',
    })
  }

  const session = requireSession(input.sessionId)
  const stored = readStoredPullRequest(session.configJson)
  if (!stored) {
    throw new AppError({
      code: 'pull_request_not_bound',
      status: 404,
      message: 'No pull request is bound to this session.',
    })
  }
  if (stored.state !== 'open' || stored.merged) {
    throw new AppError({
      code: 'pull_request_closed',
      status: 409,
      message: 'The bound pull request is closed or merged.',
      details: { pullRequest: stored },
    })
  }

  const execution = Worktree.resolveSessionExecutionRoot(session)
  if (!execution.isIsolated || !execution.branch || !execution.rootPath) {
    throw new AppError({
      code: 'session_not_isolated',
      status: 409,
      message: 'Update a pull request only from an isolated session worktree.',
    })
  }
  Worktree.assertIsolationExecutionReady(session)
  const remote = await resolveGitHubRemote(execution.rootPath)
  await ensureBranchPushed({
    rootPath: execution.rootPath,
    branch: execution.branch,
    remoteName: remote.remoteName,
  })

  let updated: Awaited<ReturnType<typeof updateGitHubPullRequest>>
  try {
    updated = await updateGitHubPullRequest({
      owner: stored.owner,
      repo: stored.repo,
      pullRequestNumber: stored.number,
      title: input.title.trim(),
      body: withCradlePullRequestFooter(input.body),
    })
  }
  catch (error) {
    mapGitHubError(error, 'Failed to update GitHub pull request.')
  }

  return persistPullRequest(input.sessionId, {
    ...stored,
    title: updated.title,
    isDraft: updated.draft,
    state: updated.state,
    headRef: updated.head.ref,
    baseRef: updated.base.ref,
    headSha: updated.head.sha,
    url: updated.html_url,
    updatedAt: nowSeconds(),
    author: updated.user !== undefined ? toStoredAuthor(updated.user) : stored.author,
    additions: updated.additions ?? stored.additions,
    deletions: updated.deletions ?? stored.deletions,
  })
}

export async function markPullRequestReady(sessionId: string): Promise<SessionPullRequestView> {
  if (!hasGitHubToken()) {
    throw new AppError({
      code: 'github_auth_required',
      status: 401,
      message: 'GitHub authentication required. Set GH_TOKEN / GITHUB_TOKEN or run `gh auth login`.',
    })
  }

  const session = requireSession(sessionId)
  const stored = readStoredPullRequest(session.configJson)
  if (!stored) {
    throw new AppError({
      code: 'pull_request_not_bound',
      status: 404,
      message: 'No pull request is bound to this session.',
    })
  }

  if (!stored.isDraft) {
    return toView(stored)
  }

  let updated: Awaited<ReturnType<typeof markGitHubPullRequestReady>>
  try {
    updated = await markGitHubPullRequestReady(stored.owner, stored.repo, stored.number)
  }
  catch (error) {
    mapGitHubError(error, 'Failed to mark pull request ready for review.')
  }

  const next: StoredSessionPullRequest = {
    ...stored,
    title: updated.title,
    isDraft: updated.draft,
    state: updated.state,
    headRef: updated.head.ref,
    baseRef: updated.base.ref,
    headSha: updated.head.sha,
    url: updated.html_url,
    updatedAt: nowSeconds(),
  }

  return persistPullRequest(sessionId, next)
}
