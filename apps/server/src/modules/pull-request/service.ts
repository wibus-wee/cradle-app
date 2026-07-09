import { sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'

import { db } from '../../infra'
import { AppError } from '../../errors/app-error'
import { parseJsonObjectOrEmpty } from '../../helpers/json-record'
import {
  createPullRequest as createGitHubPullRequest,
  fetchPullRequest,
  fetchRepo,
  GitHubApiError,
  hasGitHubToken,
  markPullRequestReady as markGitHubPullRequestReady,
} from '../../lib/github-api'
import * as Worktree from '../worktree/service'

import { parseGitHubOwnerRepo } from './github-remote'
import { withCradlePullRequestFooter } from './pr-body'

import type { pullRequestViewSchema } from './model'
import type { Static } from 'elysia'

export type SessionPullRequestView = Static<typeof pullRequestViewSchema>
export { parseGitHubOwnerRepo } from './github-remote'
export { withCradlePullRequestFooter } from './pr-body'

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
  }
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

  try {
    await git.push(input.remoteName, input.branch, ['--set-upstream'])
  }
  catch (error) {
    throw new AppError({
      code: 'git_push_failed',
      status: 502,
      message: error instanceof Error ? error.message : 'Failed to push branch to remote.',
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
  }

  return persistPullRequest(input.sessionId, stored)
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
