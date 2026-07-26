import { AppError } from '../../errors/app-error'
import {
  addPullRequestAssignees,
  createPullRequestIssueComment,
  fetchAssignableUsers,
  fetchPullRequestFingerprint,
  hasGitHubToken,
  markPullRequestDraft as markGitHubPullRequestDraft,
  markPullRequestReady as markGitHubPullRequestReady,
  mergePullRequest,
  probePullRequestFingerprint,
  removePullRequestAssignees,
  removePullRequestReviewers,
  requestPullRequestReviewers,
  submitPullRequestReview,
} from '../../lib/github-api'
import type { PullRequestMergeMethod } from './merge-capability'
import {
  derivePullRequestMergeCapability,
} from './merge-capability'
import { fetchPullRequestDetailByRef, mapGitHubError } from './service'

type PullRequestFingerprint = NonNullable<Awaited<ReturnType<typeof fetchPullRequestFingerprint>>>

async function requireGitHubToken(): Promise<void> {
  if (!(await hasGitHubToken())) {
    throw new AppError({
      code: 'github_auth_required',
      status: 401,
      message: 'GitHub authentication required. Set GH_TOKEN / GITHUB_TOKEN or run `gh auth login`.',
    })
  }
}

function fingerprintEquals(
  left: PullRequestFingerprint,
  right: PullRequestFingerprint,
): boolean {
  return left.updatedAt === right.updatedAt
    && left.headSha === right.headSha
    && left.state === right.state
    && left.merged === right.merged
    && left.isDraft === right.isDraft
    && left.mergeableState === right.mergeableState
    && left.comments === right.comments
    && left.reviewComments === right.reviewComments
    && left.commits === right.commits
    && left.checksState === right.checksState
}

export async function getPullRequestFingerprint(
  owner: string,
  repo: string,
  number: number,
): Promise<{ fingerprint: PullRequestFingerprint, changed: boolean }> {
  await requireGitHubToken()
  const fingerprint = await fetchPullRequestFingerprint(owner, repo, number)
  if (!fingerprint) {
    throw new AppError({
      code: 'github_pr_unavailable',
      status: 502,
      message: 'GitHub pull request fingerprint is currently unavailable.',
      details: { owner, repo, number },
    })
  }
  return { fingerprint, changed: false }
}

export async function probePullRequestFingerprintChange(
  owner: string,
  repo: string,
  number: number,
  previous: PullRequestFingerprint | null,
): Promise<{ fingerprint: PullRequestFingerprint, changed: boolean }> {
  await requireGitHubToken()
  const fingerprint = await probePullRequestFingerprint(owner, repo, number)
  if (!fingerprint) {
    throw new AppError({
      code: 'github_pr_unavailable',
      status: 502,
      message: 'GitHub pull request fingerprint is currently unavailable.',
      details: { owner, repo, number },
    })
  }
  const changed = previous == null ? true : !fingerprintEquals(previous, fingerprint)
  return { fingerprint, changed }
}

export async function commentOnPullRequest(input: {
  owner: string
  repo: string
  number: number
  body: string
}) {
  await requireGitHubToken()
  const body = input.body.trim()
  if (!body) {
    throw new AppError({
      code: 'pull_request_comment_empty',
      status: 400,
      message: 'Comment body is required.',
    })
  }
  const comment = await createPullRequestIssueComment({
    owner: input.owner,
    repo: input.repo,
    pullRequestNumber: input.number,
    body,
  })
  return {
    id: `comment:${comment.id}`,
    body: comment.body ?? '',
    url: comment.html_url,
    createdAt: comment.created_at,
  }
}

export async function submitPullRequestReviewAction(input: {
  owner: string
  repo: string
  number: number
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  body?: string
}) {
  await requireGitHubToken()
  const body = input.body?.trim() ?? ''
  if (input.event !== 'APPROVE' && !body) {
    throw new AppError({
      code: 'pull_request_review_body_required',
      status: 400,
      message: 'Request changes and comment reviews require a body.',
    })
  }
  const review = await submitPullRequestReview({
    owner: input.owner,
    repo: input.repo,
    pullRequestNumber: input.number,
    event: input.event,
    body,
  })
  return {
    id: review.id,
    state: review.state,
    body: body || null,
    htmlUrl: review.html_url ?? '',
  }
}

export async function mergePullRequestByRef(input: {
  owner: string
  repo: string
  number: number
  mergeMethod: PullRequestMergeMethod
  commitTitle?: string
  commitMessage?: string
}) {
  await requireGitHubToken()
  const detail = await fetchPullRequestDetailByRef(input.owner, input.repo, input.number)
  const pr = detail.pullRequest
  const capability = derivePullRequestMergeCapability({
    state: pr.state,
    merged: pr.merged,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeableState,
    checksState: pr.checksState,
    allowMergeCommit: pr.allowedMergeMethods.includes('merge'),
    allowSquashMerge: pr.allowedMergeMethods.includes('squash'),
    allowRebaseMerge: pr.allowedMergeMethods.includes('rebase'),
  })

  // Only pre-block states GitHub can never accept. Check/protection-related
  // blockers are attempted anyway so the caller gets GitHub's real reason.
  const HARD_BLOCKERS = new Set(['merged', 'not_open', 'draft', 'conflicts', 'no_merge_methods'])
  const hardBlockers = capability.mergeBlockers.filter(code => HARD_BLOCKERS.has(code))
  if (hardBlockers.length > 0) {
    throw new AppError({
      code: 'pull_request_not_mergeable',
      status: 409,
      message: 'The pull request cannot be merged in its current state.',
      details: {
        owner: input.owner,
        repo: input.repo,
        number: input.number,
        mergeBlockers: hardBlockers,
        mergeableState: pr.mergeableState,
        checksState: pr.checksState,
      },
    })
  }
  if (!capability.allowedMergeMethods.includes(input.mergeMethod)) {
    throw new AppError({
      code: 'pull_request_merge_method_not_allowed',
      status: 400,
      message: `Merge method "${input.mergeMethod}" is not allowed for this repository.`,
      details: {
        mergeMethod: input.mergeMethod,
        allowedMergeMethods: capability.allowedMergeMethods,
      },
    })
  }

  const result = await mergePullRequest({
    owner: input.owner,
    repo: input.repo,
    pullRequestNumber: input.number,
    mergeMethod: input.mergeMethod,
    commitTitle: input.commitTitle,
    commitMessage: input.commitMessage,
  })
  if (!result.merged) {
    throw new AppError({
      code: 'pull_request_merge_rejected',
      status: 409,
      message: result.message || 'GitHub rejected the merge.',
      details: { mergeMethod: input.mergeMethod },
    })
  }
  return { sha: result.sha ?? '', merged: true as const, message: result.message }
}

export async function updatePullRequestAssignees(input: {
  owner: string
  repo: string
  number: number
  add?: string[]
  remove?: string[]
}) {
  await requireGitHubToken()
  const add = (input.add ?? []).map(login => login.trim()).filter(Boolean)
  const remove = (input.remove ?? []).map(login => login.trim()).filter(Boolean)
  if (add.length === 0 && remove.length === 0) {
    throw new AppError({
      code: 'pull_request_assignees_empty',
      status: 400,
      message: 'Provide at least one assignee to add or remove.',
    })
  }
  if (add.length > 0) {
    await addPullRequestAssignees({
      owner: input.owner,
      repo: input.repo,
      pullRequestNumber: input.number,
      assignees: add,
    })
  }
  if (remove.length > 0) {
    await removePullRequestAssignees({
      owner: input.owner,
      repo: input.repo,
      pullRequestNumber: input.number,
      assignees: remove,
    })
  }
  return { added: add, removed: remove }
}

export async function updatePullRequestReviewers(input: {
  owner: string
  repo: string
  number: number
  add?: string[]
  remove?: string[]
}) {
  await requireGitHubToken()
  const add = (input.add ?? []).map(login => login.trim()).filter(Boolean)
  const remove = (input.remove ?? []).map(login => login.trim()).filter(Boolean)
  if (add.length === 0 && remove.length === 0) {
    throw new AppError({
      code: 'pull_request_reviewers_empty',
      status: 400,
      message: 'Provide at least one reviewer to add or remove.',
    })
  }
  if (add.length > 0) {
    await requestPullRequestReviewers({
      owner: input.owner,
      repo: input.repo,
      pullRequestNumber: input.number,
      reviewers: add,
    })
  }
  if (remove.length > 0) {
    await removePullRequestReviewers({
      owner: input.owner,
      repo: input.repo,
      pullRequestNumber: input.number,
      reviewers: remove,
    })
  }
  return { added: add, removed: remove }
}

export async function markPullRequestReadyByRef(
  owner: string,
  repo: string,
  number: number,
) {
  await requireGitHubToken()
  const pullRequest = await markGitHubPullRequestReady(owner, repo, number)
  return {
    owner,
    repo,
    number: pullRequest.number,
    url: pullRequest.html_url,
    title: pullRequest.title,
    isDraft: Boolean(pullRequest.draft),
    state: pullRequest.state,
    merged: false,
    headRef: pullRequest.head.ref,
    baseRef: pullRequest.base.ref,
    headSha: pullRequest.head.sha,
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
    author: pullRequest.user
      ? {
          login: pullRequest.user.login,
          avatarUrl: pullRequest.user.avatar_url,
          url: pullRequest.user.html_url,
        }
      : null,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
  }
}

export async function markPullRequestDraftByRef(
  owner: string,
  repo: string,
  number: number,
) {
  await requireGitHubToken()
  const pullRequest = await markGitHubPullRequestDraft(owner, repo, number)
  return {
    owner,
    repo,
    number: pullRequest.number,
    url: pullRequest.html_url,
    title: pullRequest.title,
    isDraft: Boolean(pullRequest.draft),
    state: pullRequest.state,
    merged: false,
    headRef: pullRequest.head.ref,
    baseRef: pullRequest.base.ref,
    headSha: pullRequest.head.sha,
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
    author: null,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
  }
}

export async function listAssignableUsers(owner: string, repo: string) {
  await requireGitHubToken()
  try {
    return { users: await fetchAssignableUsers(owner, repo) }
  }
  catch (error) {
    mapGitHubError(error, 'Failed to list users assignable to this repository.')
  }
}
