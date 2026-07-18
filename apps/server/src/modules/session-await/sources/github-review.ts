import { z } from 'zod'

import type { GitHubPullRequestReview } from '../../../lib/github-api'
import {
  fetchPullRequest,
  fetchPullRequestReviews,
  GitHubTargetValidationError,
  hasGitHubToken,
  isGitHubMissingTarget,
  isGitHubRateLimited,
} from '../../../lib/github-api'
import type { CheckResult, SessionAwait, SessionAwaitSource } from '../types'

const GitHubReviewModeSchema = z.enum(['approved', 'changes-requested', 'reviewed'])

type GitHubReviewMode = z.infer<typeof GitHubReviewModeSchema>

export interface LiveReview {
  id: number
  reviewer: string | null
  state: GitHubPullRequestReview['state']
  commitId: string
  submittedAt: string | null
}

export interface LiveReviewStatus {
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

interface ResolvedReviewTarget {
  owner: string
  repo: string
  prNumber: number
  prTitle: string | null
  mode: GitHubReviewMode
  headSha: string
  currentHeadSha: string
  prState: 'open' | 'closed'
  merged: boolean
}

interface ReviewAggregate {
  reviews: LiveReview[]
  approvedCount: number
  changesRequestedCount: number
  matched: boolean
}

const GitHubRepoSchema = z.string().min(1).regex(/^[^/]+\/[^/]+$/).transform((repoFullName) => {
    const [owner, repo] = repoFullName.split('/')
    return { owner, repo }
  })

const GitHubReviewFilterSchema = z.object({
  repo: GitHubRepoSchema,
  pr: z.number().int().positive(),
  mode: GitHubReviewModeSchema.default('approved'),
  headSha: z.string().min(1).optional(),
  workId: z.string().min(1).optional(),
}).transform(({ repo, ...filter }) => ({
  ...filter,
  owner: repo.owner,
  repo: repo.repo,
}))

export const GitHubReviewFilterJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(GitHubReviewFilterSchema)

type GitHubReviewFilter = z.infer<typeof GitHubReviewFilterSchema>

async function resolveTarget(filter: GitHubReviewFilter): Promise<ResolvedReviewTarget | null> {
  const prData = await fetchPullRequest(filter.owner, filter.repo, filter.pr)
  if (!prData) {
    return null
  }

  return {
    owner: filter.owner,
    repo: filter.repo,
    prNumber: filter.pr,
    prTitle: prData.title,
    mode: filter.mode,
    headSha: filter.headSha ?? prData.head.sha,
    currentHeadSha: prData.head.sha,
    prState: prData.state,
    merged: prData.merged,
  }
}

function buildTerminalResult(awaitId: string, target: ResolvedReviewTarget): CheckResult | null {
  // headSha mismatch means the await is stale (new push happened).
  // Mark it superseded so the agent can re-register with the new head.
  if (target.currentHeadSha !== target.headSha) {
    return {
      awaitId,
      matched: true,
      resumeText: `GitHub PR #${target.prNumber} head changed from ${target.headSha} to ${target.currentHeadSha}.`,
      resumePayloadJson: JSON.stringify({
        kind: 'github-review',
        repo: `${target.owner}/${target.repo}`,
        pr: target.prNumber,
        mode: target.mode,
        headSha: target.headSha,
        currentHeadSha: target.currentHeadSha,
        outcome: 'superseded',
        approvedCount: 0,
        changesRequestedCount: 0,
        reviews: [],
      }),
    }
  }

  const outcome = target.merged
    ? 'merged'
    : target.prState === 'closed'
      ? 'closed'
      : null
  if (!outcome) {
    return null
  }

  const resumeText = outcome === 'merged'
    ? `GitHub PR #${target.prNumber} was merged before the review await matched.`
    : `GitHub PR #${target.prNumber} was closed before the review await matched.`

  return {
    awaitId,
    matched: true,
    resumeText,
    resumePayloadJson: JSON.stringify({
      kind: 'github-review',
      repo: `${target.owner}/${target.repo}`,
      pr: target.prNumber,
      mode: target.mode,
      headSha: target.headSha,
      currentHeadSha: target.currentHeadSha,
      outcome,
      approvedCount: 0,
      changesRequestedCount: 0,
      reviews: [],
    }),
  }
}

function buildMissingTargetMessage(filter: GitHubReviewFilter): string {
  return `GitHub review target not found or inaccessible: ${filter.owner}/${filter.repo} PR #${filter.pr}.`
}

function latestSubmittedReviewsForHead(reviews: GitHubPullRequestReview[], headSha: string): LiveReview[] {
  const latestByReviewer = new Map<string, LiveReview>()

  for (const review of reviews) {
    if (!review.submitted_at || review.commit_id !== headSha || review.state === 'PENDING') {
      continue
    }
    const reviewer = review.user?.login ?? `review-${review.id}`
    const current = latestByReviewer.get(reviewer)
    if (current?.submittedAt && current.submittedAt >= review.submitted_at) {
      continue
    }
    latestByReviewer.set(reviewer, {
      id: review.id,
      reviewer: review.user?.login ?? null,
      state: review.state,
      commitId: review.commit_id,
      submittedAt: review.submitted_at,
    })
  }

  return [...latestByReviewer.values()].sort((a, b) =>
    (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))
}

function aggregateReviews(reviews: GitHubPullRequestReview[], target: ResolvedReviewTarget): ReviewAggregate {
  const latest = latestSubmittedReviewsForHead(reviews, target.headSha)
  const activeReviews = latest.filter(r => r.state !== 'DISMISSED' && r.state !== 'COMMENTED')
  const approvedCount = activeReviews.filter(r => r.state === 'APPROVED').length
  const changesRequestedCount = activeReviews.filter(r => r.state === 'CHANGES_REQUESTED').length

  const matched = (() => {
    if (target.mode === 'changes-requested') {
      return changesRequestedCount > 0
    }
    if (target.mode === 'reviewed') {
      return activeReviews.length > 0 || latest.some(r => r.state === 'COMMENTED')
    }
    return approvedCount > 0 && changesRequestedCount === 0
  })()

  return {
    reviews: latest,
    approvedCount,
    changesRequestedCount,
    matched,
  }
}

function buildReviewPayload(target: ResolvedReviewTarget, aggregate: ReviewAggregate): string {
  return JSON.stringify({
    kind: 'github-review',
    repo: `${target.owner}/${target.repo}`,
    pr: target.prNumber,
    mode: target.mode,
    headSha: target.headSha,
    approvedCount: aggregate.approvedCount,
    changesRequestedCount: aggregate.changesRequestedCount,
    reviews: aggregate.reviews,
  })
}

function buildResumeText(target: ResolvedReviewTarget, aggregate: ReviewAggregate): string {
  if (target.mode === 'changes-requested') {
    return `GitHub PR #${target.prNumber} has requested changes.`
  }
  if (target.mode === 'reviewed') {
    return `GitHub PR #${target.prNumber} has new review activity.`
  }
  return `GitHub PR #${target.prNumber} is approved by ${aggregate.approvedCount} reviewer${aggregate.approvedCount === 1 ? '' : 's'}.`
}

export const githubReviewSource: SessionAwaitSource = {
  source: 'github-review',
  pollIntervalMs: 30_000,

  async checkPending(awaits: SessionAwait[]): Promise<CheckResult[]> {
    if (isGitHubRateLimited()) {
      return awaits.map(a => ({ awaitId: a.id, matched: false, transientError: 'GitHub API rate limited' }))
    }

    const results: CheckResult[] = []

    for (const row of awaits) {
      const filter = GitHubReviewFilterJsonSchema.parse(row.filterJson)

      let target: ResolvedReviewTarget | null
      try {
        target = await resolveTarget(filter)
      }
      catch (err) {
        if (isGitHubMissingTarget(err)) {
          results.push({ awaitId: row.id, matched: false, permanentError: buildMissingTargetMessage(filter) })
          continue
        }
        results.push({ awaitId: row.id, matched: false, transientError: 'Unable to resolve GitHub review target' })
        continue
      }
      if (!target) {
        results.push({ awaitId: row.id, matched: false, transientError: 'Unable to resolve GitHub review target' })
        continue
      }

      const terminalResult = buildTerminalResult(row.id, target)
      if (terminalResult) {
        results.push(terminalResult)
        continue
      }

      let reviews: GitHubPullRequestReview[] | null
      try {
        reviews = await fetchPullRequestReviews(target.owner, target.repo, target.prNumber)
      }
      catch (err) {
        if (isGitHubMissingTarget(err)) {
          results.push({ awaitId: row.id, matched: false, permanentError: buildMissingTargetMessage(filter) })
          continue
        }
        results.push({ awaitId: row.id, matched: false, transientError: 'GitHub review API unavailable' })
        continue
      }
      if (!reviews) {
        results.push({ awaitId: row.id, matched: false, transientError: 'GitHub review API unavailable' })
        continue
      }

      const aggregate = aggregateReviews(reviews, target)
      if (!aggregate.matched) {
        results.push({ awaitId: row.id, matched: false })
        continue
      }

      results.push({
        awaitId: row.id,
        matched: true,
        resumeText: buildResumeText(target, aggregate),
        resumePayloadJson: buildReviewPayload(target, aggregate),
      })
    }

    return results
  },
}

export async function validateGitHubReviewTarget(filterJson: string): Promise<void> {
  const filter = GitHubReviewFilterJsonSchema.parse(filterJson)
  let target: ResolvedReviewTarget | null
  try {
    target = await resolveTarget(filter)
    const reviews = target ? await fetchPullRequestReviews(target.owner, target.repo, target.prNumber) : null
    if (!target || !reviews) {
      throw new GitHubTargetValidationError({
        category: 'unavailable',
        message: 'Unable to validate GitHub review target right now.',
      })
    }
  }
  catch (err) {
    if (isGitHubMissingTarget(err)) {
      throw new GitHubTargetValidationError({
        category: 'invalid',
        message: buildMissingTargetMessage(filter),
      })
    }
    throw err
  }
}

export async function fetchLiveReviewStatus(filterJson: string): Promise<LiveReviewStatus | null> {
  const filter = GitHubReviewFilterJsonSchema.parse(filterJson)

  if (!hasGitHubToken()) {
    return {
      kind: 'github-review',
      owner: filter.owner,
      repo: filter.repo,
      prNumber: filter.pr,
      prTitle: null,
      mode: filter.mode,
      headSha: filter.headSha ?? null,
      matched: false,
      approvedCount: 0,
      changesRequestedCount: 0,
      reviews: [],
      hasToken: false,
    }
  }

  let target: ResolvedReviewTarget | null
  try {
    target = await resolveTarget(filter)
  }
  catch (err) {
    if (isGitHubMissingTarget(err)) {
      throw new GitHubTargetValidationError({
        category: 'invalid',
        message: buildMissingTargetMessage(filter),
      })
    }
    throw err
  }
  if (!target) {
    return null
  }

  let reviews: GitHubPullRequestReview[] | null
  try {
    reviews = await fetchPullRequestReviews(target.owner, target.repo, target.prNumber)
  }
  catch (err) {
    if (isGitHubMissingTarget(err)) {
      throw new GitHubTargetValidationError({
        category: 'invalid',
        message: buildMissingTargetMessage(filter),
      })
    }
    throw err
  }
  if (!reviews) {
    return {
      kind: 'github-review',
      owner: target.owner,
      repo: target.repo,
      prNumber: target.prNumber,
      prTitle: target.prTitle,
      mode: target.mode,
      headSha: target.headSha,
      matched: false,
      approvedCount: 0,
      changesRequestedCount: 0,
      reviews: [],
      hasToken: true,
    }
  }

  const aggregate = aggregateReviews(reviews, target)
  return {
    kind: 'github-review',
    owner: target.owner,
    repo: target.repo,
    prNumber: target.prNumber,
    prTitle: target.prTitle,
    mode: target.mode,
    headSha: target.headSha,
    matched: aggregate.matched,
    approvedCount: aggregate.approvedCount,
    changesRequestedCount: aggregate.changesRequestedCount,
    reviews: aggregate.reviews,
    hasToken: true,
  }
}
