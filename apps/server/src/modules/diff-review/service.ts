import { randomUUID } from 'node:crypto'

import type {
  DiffReview,
  DiffReviewAgentFix,
  DiffReviewComment,
  DiffReviewEvent,
  DiffReviewFile,
  DiffReviewPreference,
  DiffReviewRevision,
  DiffReviewSource,
  DiffReviewSubmission,
  DiffReviewThread,
} from '@cradle/db'
import {
  agents,
  diffReviewAgentFixes,
  diffReviewComments,
  diffReviewEvents,
  diffReviewFiles,
  diffReviewFileViewState,
  diffReviewPreferences,
  diffReviewRevisions,
  diffReviews,
  diffReviewSources,
  diffReviewSubmissions,
  diffReviewThreads,
} from '@cradle/db'
import { and, asc, desc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import {
  createPullRequestReviewThread,
  fetchPullRequestReviewThreads,
  hasGitHubToken,
  replyToPullRequestReviewThread,
  resolvePullRequestReviewThread,
} from '../../lib/github-api'
import * as BackgroundJob from '../background-job/service'
import * as ChatRuntime from '../chat-runtime/runtime'
import * as Git from '../git/service'
import type { RuntimeKind } from '../provider-contracts/types'
import * as PullRequestConsole from '../pull-request/console-actions'
import type { SessionPullRequestDetail } from '../pull-request/service'
import * as PullRequest from '../pull-request/service'
import * as Session from '../session/service'
import { buildAgentFixArtifact } from './agent-fix-artifacts'
import { isRangeAnchorInput, normalizeAnchor, remapAnchorToRevision, toAnchorView } from './anchors'
import { isGeneratedReviewFile, parsePatchFileSummaries } from './patch'
import type {
  BranchCompareBinding,
  DiffReviewPreferenceView,
  DiffReviewView,
  DiffRevisionView,
  GitHubPullRequestBinding,
  LocalCommitBinding,
  ReviewActorKind,
  ReviewAgentFixArtifactView,
  ReviewAgentFixView,
  ReviewCommentView,
  ReviewEventKind,
  ReviewEventView,
  ReviewFileDiffView,
  ReviewOutputLocale,
  ReviewRangeAnchorInput,
  ReviewRangeAnchorView,
  ReviewSourceKind,
  ReviewSourceReadinessView,
  ReviewSubmissionView,
  ReviewThreadView,
} from './types'
import { hashText, jsonStringify, safeJsonParse, titleForRepository } from './utils'

type GitHubPullRequestReviewThread = Awaited<
  ReturnType<typeof fetchPullRequestReviewThreads>
>[number]

export type {
  DiffReviewPreferenceView,
  DiffReviewView,
  DiffRevisionView,
  ReviewAgentFixArtifactView,
  ReviewAgentFixView,
  ReviewCommentView,
  ReviewEventView,
  ReviewFileDiffView,
  ReviewOutputLocale,
  ReviewRangeAnchorView,
  ReviewSourceReadinessView,
  ReviewSubmissionView,
  ReviewThreadView,
} from './types'

const LOCAL_USER_ID = 'local-user'
const UNBOUNDED_DIFF_REVIEW_RUN_WAIT = { timeoutMs: null }
const DIFF_REVIEW_JOB_OWNER = 'diff-review'
const GITHUB_REVIEW_THREAD_PREFIX = 'github-review-thread:'
const GITHUB_REVIEW_COMMENT_PREFIX = 'github-review-comment:'

interface ReviewSourceAdapter {
  refreshStored: (workspaceId: string, source: DiffReviewSource) => Promise<DiffReviewView>
}

interface LocalWorkingTreeBinding {
  repositoryPath: string
}

function toRevisionView(row: DiffReviewRevision): DiffRevisionView {
  return {
    id: row.id,
    reviewId: row.reviewId,
    sourceVersion: row.sourceVersion,
    patchHash: row.patchHash,
    fileCount: row.fileCount,
    additions: row.additions,
    deletions: row.deletions,
    generatedAt: row.generatedAt,
    patch: row.patch,
  }
}

function toFileView(row: DiffReviewFile): ReviewFileDiffView {
  return {
    id: row.id,
    revisionId: row.revisionId,
    path: row.path,
    previousPath: row.previousPath,
    status: row.status,
    additions: row.additions,
    deletions: row.deletions,
    isGenerated: row.isGenerated,
    isBinary: row.isBinary,
    isViewed: row.isViewed,
  }
}

function toCommentView(row: DiffReviewComment): ReviewCommentView {
  return {
    id: row.id,
    threadId: row.threadId,
    authorKind: row.authorKind,
    authorId: row.authorId,
    bodyMarkdown: row.bodyMarkdown,
    externalUrl: row.externalUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toSubmissionView(row: DiffReviewSubmission): ReviewSubmissionView {
  return {
    id: row.id,
    reviewId: row.reviewId,
    revisionId: row.revisionId,
    actorId: row.actorId,
    decision: row.decision,
    bodyMarkdown: row.bodyMarkdown,
    submittedAt: row.submittedAt,
    sourceSyncState: row.sourceSyncState,
  }
}

function toPreferenceView(row: DiffReviewPreference): DiffReviewPreferenceView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    diffStyle: row.diffStyle,
    codeTheme: row.codeTheme,
    fontSize: row.fontSize,
    lineHeight: row.lineHeight,
    hideWhitespaceOnly: row.hideWhitespaceOnly,
    structuralHighlighting: row.structuralHighlighting,
    collapseGeneratedFiles: row.collapseGeneratedFiles,
    notificationMode: row.notificationMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toEventView(row: DiffReviewEvent): ReviewEventView {
  return {
    id: row.id,
    reviewId: row.reviewId,
    eventKind: row.eventKind as ReviewEventView['eventKind'],
    actorKind: row.actorKind,
    actorId: row.actorId,
    payload: safeJsonParse(row.payloadJson) ?? {},
    createdAt: row.createdAt,
  }
}

function toAgentFixView(row: DiffReviewAgentFix): ReviewAgentFixView {
  return {
    id: row.id,
    reviewId: row.reviewId,
    targetRevisionId: row.targetRevisionId,
    threadId: row.threadId,
    anchor: toAnchorView(safeJsonParse(row.anchorJson)),
    instruction: row.instruction,
    profileId: row.profileId,
    expectedOutput: row.expectedOutput as ReviewAgentFixView['expectedOutput'],
    status: row.status,
    sessionId: row.sessionId,
    runId: row.runId,
    artifactId: row.artifactId,
    resultRevisionId: row.resultRevisionId,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function ensurePreferences(workspaceId: string, userId = LOCAL_USER_ID): DiffReviewPreference {
  const existing = db()
    .select()
    .from(diffReviewPreferences)
    .where(
      and(
        eq(diffReviewPreferences.workspaceId, workspaceId),
        eq(diffReviewPreferences.userId, userId),
      ),
    )
    .get()
  if (existing) {
    return existing
  }
  const now = currentUnixSeconds()
  return db()
    .insert(diffReviewPreferences)
    .values({
      id: randomUUID(),
      workspaceId,
      userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
}

function recordEvent(input: {
  reviewId: string
  eventKind: ReviewEventKind
  actorKind?: ReviewActorKind
  actorId?: string | null
  payload?: unknown
  createdAt?: number
}): DiffReviewEvent {
  return db()
    .insert(diffReviewEvents)
    .values({
      id: randomUUID(),
      reviewId: input.reviewId,
      eventKind: input.eventKind,
      actorKind: input.actorKind ?? 'system',
      actorId: input.actorId ?? null,
      payloadJson: jsonStringify(input.payload ?? {}),
      createdAt: input.createdAt ?? currentUnixSeconds(),
    })
    .returning()
    .get()
}

function reviewStateForDecision(
  decision: ReviewSubmissionView['decision'],
): DiffReviewView['reviewState'] {
  if (decision === 'approve') {
    return 'approved'
  }
  if (decision === 'request-changes') {
    return 'changes-requested'
  }
  return 'commented'
}

function githubReviewEvent(
  decision: ReviewSubmissionView['decision'],
): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
  if (decision === 'approve') {
    return 'APPROVE'
  }
  if (decision === 'request-changes') {
    return 'REQUEST_CHANGES'
  }
  return 'COMMENT'
}

function loadThreads(reviewId: string): ReviewThreadView[] {
  const threads = db()
    .select()
    .from(diffReviewThreads)
    .where(eq(diffReviewThreads.reviewId, reviewId))
    .orderBy(asc(diffReviewThreads.createdAt))
    .all()
  if (threads.length === 0) {
    return []
  }
  const comments = db()
    .select()
    .from(diffReviewComments)
    .orderBy(asc(diffReviewComments.createdAt))
    .all()
  return threads.map(thread => ({
    id: thread.id,
    reviewId: thread.reviewId,
    originalRevisionId: thread.originalRevisionId,
    currentRevisionId: thread.currentRevisionId,
    fileId: thread.fileId,
    anchor: toAnchorView(safeJsonParse(thread.anchorJson)),
    state: thread.state,
    createdBy: thread.createdBy,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    resolvedBy: thread.resolvedBy,
    resolvedAt: thread.resolvedAt,
    comments: comments.filter(comment => comment.threadId === thread.id).map(toCommentView),
  }))
}

function buildReviewView(
  review: DiffReview,
  revision: DiffReviewRevision | null,
  files: DiffReviewFile[],
  options: { userId?: string } = {},
): DiffReviewView {
  const userId = options.userId ?? LOCAL_USER_ID
  const viewStates = revision
    ? db()
        .select()
        .from(diffReviewFileViewState)
        .where(
          and(
            eq(diffReviewFileViewState.reviewId, review.id),
            eq(diffReviewFileViewState.revisionId, revision.id),
            eq(diffReviewFileViewState.userId, userId),
          ),
        )
        .all()
    : []
  const viewedFileIds = new Set(
    viewStates.filter(state => state.viewed).map(state => state.fileId),
  )
  const filesWithViewed = files.map(file => ({
    ...file,
    isViewed: file.isViewed || viewedFileIds.has(file.id),
  }))
  const threads = loadThreads(review.id)
  const submissions = db()
    .select()
    .from(diffReviewSubmissions)
    .where(eq(diffReviewSubmissions.reviewId, review.id))
    .orderBy(desc(diffReviewSubmissions.submittedAt))
    .all()
    .map(toSubmissionView)
  const events = db()
    .select()
    .from(diffReviewEvents)
    .where(eq(diffReviewEvents.reviewId, review.id))
    .orderBy(desc(diffReviewEvents.createdAt))
    .limit(100)
    .all()
    .map(toEventView)
  const agentFixes = db()
    .select()
    .from(diffReviewAgentFixes)
    .where(eq(diffReviewAgentFixes.reviewId, review.id))
    .orderBy(desc(diffReviewAgentFixes.createdAt))
    .all()
    .map(toAgentFixView)
  const githubPullRequest = review.sourceKind === 'github-pull-request' && review.sourceId
    ? db()
        .select()
        .from(diffReviewSources)
        .where(eq(diffReviewSources.id, review.sourceId))
        .get()
    : null

  return {
    id: review.id,
    workspaceId: review.workspaceId,
    sourceId: review.sourceId,
    repositoryPath: review.repositoryPath,
    sourceKind: review.sourceKind,
    githubPullRequest: githubPullRequest
      ? readSourceBinding<GitHubPullRequestBinding>(githubPullRequest)
      : null,
    title: review.title,
    status: review.status,
    reviewState: review.reviewState,
    currentRevisionId: review.currentRevisionId,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    currentRevision: revision ? toRevisionView(revision) : null,
    files: filesWithViewed.map(toFileView),
    threads,
    submissions,
    events,
    preferences: toPreferenceView(ensurePreferences(review.workspaceId, userId)),
    agentFixes,
  }
}

function findReviewBySource(workspaceId: string, sourceId: string): DiffReview | undefined {
  return db()
    .select()
    .from(diffReviews)
    .where(and(eq(diffReviews.workspaceId, workspaceId), eq(diffReviews.sourceId, sourceId)))
    .get()
}

function ensureReviewSource(input: {
  workspaceId: string
  kind: ReviewSourceKind
  binding: unknown
  refreshPolicy: 'manual' | 'webhook' | 'watch-worktree' | 'session-event'
}): string {
  const bindingJson = jsonStringify(input.binding)
  const existing = db()
    .select()
    .from(diffReviewSources)
    .where(
      and(
        eq(diffReviewSources.workspaceId, input.workspaceId),
        eq(diffReviewSources.kind, input.kind),
      ),
    )
    .all()
    .find(source => source.bindingJson === bindingJson)
  if (existing) {
    return existing.id
  }
  const now = currentUnixSeconds()
  return db()
    .insert(diffReviewSources)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      kind: input.kind,
      ownerNamespace: 'diff-review',
      bindingJson,
      refreshPolicy: input.refreshPolicy,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
.id
}

function ensureLocalWorkingTreeSource(workspaceId: string, repositoryPath: string): string {
  return ensureReviewSource({
    workspaceId,
    kind: 'local-working-tree',
    binding: { repositoryPath, includeUntracked: true },
    refreshPolicy: 'manual',
  })
}

function ensureBranchCompareSource(workspaceId: string, binding: BranchCompareBinding): string {
  return ensureReviewSource({
    workspaceId,
    kind: 'local-branch-compare',
    binding,
    refreshPolicy: 'manual',
  })
}

function ensureLocalCommitSource(workspaceId: string, binding: LocalCommitBinding): string {
  return ensureReviewSource({
    workspaceId,
    kind: 'local-commit',
    binding,
    refreshPolicy: 'manual',
  })
}

function ensureGitHubPullRequestSource(workspaceId: string, binding: GitHubPullRequestBinding): string {
  const existing = db()
    .select()
    .from(diffReviewSources)
    .where(
      and(
        eq(diffReviewSources.workspaceId, workspaceId),
        eq(diffReviewSources.kind, 'github-pull-request'),
      ),
    )
    .all()
    .find((source) => {
      const candidate = readSourceBinding<GitHubPullRequestBinding>(source)
      return candidate.owner === binding.owner
        && candidate.repo === binding.repo
        && candidate.number === binding.number
    })
  if (!existing) {
    return ensureReviewSource({
      workspaceId,
      kind: 'github-pull-request',
      binding,
      refreshPolicy: 'manual',
    })
  }
  db()
    .update(diffReviewSources)
    .set({ bindingJson: jsonStringify(binding), updatedAt: currentUnixSeconds() })
    .where(eq(diffReviewSources.id, existing.id))
    .run()
  return existing.id
}

function readSourceBinding<T>(source: DiffReviewSource): T {
  return JSON.parse(source.bindingJson) as T
}

function getReviewSource(review: DiffReview): DiffReviewSource {
  if (!review.sourceId) {
    throw new AppError({
      code: 'diff_review_source_missing',
      status: 409,
      message: 'Diff review source is missing',
      details: { reviewId: review.id },
    })
  }
  const source = db()
    .select()
    .from(diffReviewSources)
    .where(eq(diffReviewSources.id, review.sourceId))
    .get()
  if (!source) {
    throw new AppError({
      code: 'diff_review_source_not_found',
      status: 404,
      message: 'Diff review source was not found',
      details: { reviewId: review.id, sourceId: review.sourceId },
    })
  }
  return source
}

function getReviewRow(workspaceId: string, reviewId: string): DiffReview {
  const review = db()
    .select()
    .from(diffReviews)
    .where(and(eq(diffReviews.id, reviewId), eq(diffReviews.workspaceId, workspaceId)))
    .get()
  if (!review) {
    throw new AppError({
      code: 'diff_review_not_found',
      status: 404,
      message: 'Diff review not found',
      details: { workspaceId, reviewId },
    })
  }
  return review
}

function loadReviewView(review: DiffReview, options: { userId?: string } = {}): DiffReviewView {
  const revision = review.currentRevisionId
    ? (db()
        .select()
        .from(diffReviewRevisions)
        .where(eq(diffReviewRevisions.id, review.currentRevisionId))
        .get() ?? null)
    : null
  const files = revision
    ? db()
        .select()
        .from(diffReviewFiles)
        .where(eq(diffReviewFiles.revisionId, revision.id))
        .orderBy(asc(diffReviewFiles.path))
        .all()
    : []
  return buildReviewView(review, revision, files, options)
}

function remapReviewThreads(reviewId: string, newRevision: DiffReviewRevision): void {
  const threads = db()
    .select()
    .from(diffReviewThreads)
    .where(eq(diffReviewThreads.reviewId, reviewId))
    .all()
  if (threads.length === 0) {
    return
  }

  const newFiles = db()
    .select()
    .from(diffReviewFiles)
    .where(eq(diffReviewFiles.revisionId, newRevision.id))
    .all()

  for (const thread of threads) {
    const anchor = toAnchorView(safeJsonParse(thread.anchorJson))
    if (!anchor || thread.state === 'resolved') {
      continue
    }
    const oldFile = db()
      .select()
      .from(diffReviewFiles)
      .where(eq(diffReviewFiles.id, anchor.fileId))
      .get()
    const remapped = remapAnchorToRevision({
      anchor,
      oldFile,
      newRevision,
      newFiles,
    })
    if (!remapped) {
      db()
        .update(diffReviewThreads)
        .set({
          currentRevisionId: null,
          state: 'stale',
          updatedAt: currentUnixSeconds(),
        })
        .where(eq(diffReviewThreads.id, thread.id))
        .run()
      continue
    }
    db()
      .update(diffReviewThreads)
      .set({
        currentRevisionId: newRevision.id,
        fileId: remapped.fileId,
        anchorJson: jsonStringify(remapped.anchor),
        state: 'open',
        updatedAt: currentUnixSeconds(),
      })
      .where(eq(diffReviewThreads.id, thread.id))
      .run()
  }
}

function markOpenAnchoredThreadsStale(reviewId: string): void {
  const now = currentUnixSeconds()
  const threads = db()
    .select()
    .from(diffReviewThreads)
    .where(eq(diffReviewThreads.reviewId, reviewId))
    .all()
  for (const thread of threads) {
    if (thread.state === 'resolved' || !thread.anchorJson) {
      continue
    }
    db()
      .update(diffReviewThreads)
      .set({ currentRevisionId: null, state: 'stale', updatedAt: now })
      .where(eq(diffReviewThreads.id, thread.id))
      .run()
  }
}

async function refreshMaterializedPatchReview(input: {
  workspaceId: string
  sourceId: string
  repositoryPath: string
  sourceKind: ReviewSourceKind
  status?: DiffReviewView['status']
  title: string
  patch: string
  patchHash: string
  sourceVersion: string
  statusFiles: Git.GitFileStatusView[]
  fileStats?: Array<{ path: string, additions: number, deletions: number }>
  reviewCreatedPayload: unknown
  revisionUpdatedPayload: Record<string, unknown>
}): Promise<DiffReviewView> {
  const now = currentUnixSeconds()
  let review = findReviewBySource(input.workspaceId, input.sourceId)
  if (!review) {
    review = db()
      .insert(diffReviews)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        sourceId: input.sourceId,
        repositoryPath: input.repositoryPath,
        sourceKind: input.sourceKind,
        title: input.title,
        status: input.status ?? 'open',
        reviewState: 'unreviewed',
        currentRevisionId: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    recordEvent({
      reviewId: review.id,
      eventKind: 'review_created',
      payload: input.reviewCreatedPayload,
      createdAt: now,
    })
  }

  if (input.patch.trim().length === 0) {
    markOpenAnchoredThreadsStale(review.id)
    const updated = db()
      .update(diffReviews)
      .set({
        title: input.title,
        sourceId: input.sourceId,
        status: input.status ?? (input.sourceKind === 'local-working-tree' ? 'open' : review.status),
        currentRevisionId: null,
        updatedAt: now,
      })
      .where(eq(diffReviews.id, review.id))
      .returning()
      .get()
    return loadReviewView(updated)
  }

  const currentRevision = review.currentRevisionId
    ? db()
        .select()
        .from(diffReviewRevisions)
        .where(eq(diffReviewRevisions.id, review.currentRevisionId))
        .get()
    : undefined
  if (currentRevision?.patchHash === input.patchHash) {
    const updated = db()
      .update(diffReviews)
      .set({
        title: input.title,
        sourceId: input.sourceId,
        status: input.status ?? (input.sourceKind === 'local-working-tree' ? 'open' : review.status),
        updatedAt: now,
      })
      .where(eq(diffReviews.id, review.id))
      .returning()
      .get()
    return loadReviewView(updated)
  }

  const fileStatsByPath = new Map(input.fileStats?.map(file => [file.path, file]))
  const summaries = parsePatchFileSummaries(input.patch, input.statusFiles).map((summary) => {
    const fileStats = fileStatsByPath.get(summary.path)
    return fileStats
      ? { ...summary, additions: fileStats.additions, deletions: fileStats.deletions }
      : summary
  })
  const additions = summaries.reduce((total, file) => total + file.additions, 0)
  const deletions = summaries.reduce((total, file) => total + file.deletions, 0)
  const revision = db().transaction((tx) => {
    const existing = tx
      .select()
      .from(diffReviewRevisions)
      .where(
        and(
          eq(diffReviewRevisions.reviewId, review.id),
          eq(diffReviewRevisions.patchHash, input.patchHash),
        ),
      )
      .get()
    if (existing) {
      return existing
    }

    const inserted = tx
      .insert(diffReviewRevisions)
      .values({
        id: randomUUID(),
        reviewId: review.id,
        sourceVersion: input.sourceVersion,
        patchHash: input.patchHash,
        fileCount: summaries.length,
        additions,
        deletions,
        patch: input.patch,
        generatedAt: now,
      })
      .returning()
      .get()
    for (const file of summaries) {
      tx.insert(diffReviewFiles)
        .values({
          id: randomUUID(),
          revisionId: inserted.id,
          path: file.path,
          previousPath: file.previousPath,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          isGenerated: isGeneratedReviewFile(file),
          isBinary: file.isBinary,
          isViewed: false,
        })
        .run()
    }
    return inserted
  })

  const updated = db()
    .update(diffReviews)
    .set({
      title: input.title,
      sourceId: input.sourceId,
      status: input.status ?? (input.sourceKind === 'local-working-tree' ? 'open' : review.status),
      currentRevisionId: revision.id,
      updatedAt: now,
    })
    .where(eq(diffReviews.id, review.id))
    .returning()
    .get()
  remapReviewThreads(review.id, revision)
  recordEvent({
    reviewId: review.id,
    eventKind: 'revision_updated',
    payload: {
      revisionId: revision.id,
      patchHash: revision.patchHash,
      fileCount: revision.fileCount,
      ...input.revisionUpdatedPayload,
    },
    createdAt: now,
  })
  return loadReviewView(updated)
}

export async function refreshLocalWorkingTree(
  workspaceId: string,
  repositoryPath?: string,
): Promise<DiffReviewView> {
  const status = await Git.getStatus(workspaceId, repositoryPath)
  const patch = await Git.getDiff(workspaceId, undefined, status.repositoryPath)
  const patchHash = hashText(patch)
  const sourceVersion = hashText(
    JSON.stringify({
      repositoryPath: status.repositoryPath,
      branch: status.branch,
      files: status.files,
      patchHash,
    }),
  )
  const title = titleForRepository(status.repositoryName)
  const sourceId = ensureLocalWorkingTreeSource(workspaceId, status.repositoryPath)

  return refreshMaterializedPatchReview({
    workspaceId,
    sourceId,
    repositoryPath: status.repositoryPath,
    sourceKind: 'local-working-tree',
    title,
    patch,
    patchHash,
    sourceVersion,
    statusFiles: status.files,
    reviewCreatedPayload: {
      sourceKind: 'local-working-tree',
      repositoryPath: status.repositoryPath,
    },
    revisionUpdatedPayload: {},
  })
}

export async function refreshLocalBranchCompare(input: {
  workspaceId: string
  repositoryPath?: string
  baseRef: string
  headRef: string
}): Promise<DiffReviewView> {
  const compare = await Git.getBranchCompare(
    input.workspaceId,
    input.baseRef,
    input.headRef,
    input.repositoryPath,
  )
  const patch = compare.patch
  const patchHash = hashText(patch)
  const sourceVersion = `${compare.baseSha}...${compare.headSha}:${patchHash}`
  const sourceId = ensureBranchCompareSource(input.workspaceId, {
    repositoryPath: compare.repositoryPath,
    baseRef: input.baseRef,
    headRef: input.headRef,
  })
  const title = `${compare.headRef} into ${compare.baseRef}`

  return refreshMaterializedPatchReview({
    workspaceId: input.workspaceId,
    sourceId,
    repositoryPath: compare.repositoryPath,
    sourceKind: 'local-branch-compare',
    title,
    patch,
    patchHash,
    sourceVersion,
    statusFiles: [],
    reviewCreatedPayload: {
      sourceKind: 'local-branch-compare',
      repositoryPath: compare.repositoryPath,
      baseRef: input.baseRef,
      headRef: input.headRef,
    },
    revisionUpdatedPayload: {
      baseRef: input.baseRef,
      headRef: input.headRef,
      mergeBaseSha: compare.mergeBaseSha,
    },
  })
}

export async function refreshLocalCommit(input: {
  workspaceId: string
  repositoryPath?: string
  commitRef: string
}): Promise<DiffReviewView> {
  const commit = await Git.getCommitDiff(input.workspaceId, input.commitRef, input.repositoryPath)
  const patch = commit.patch
  const patchHash = hashText(patch)
  const sourceVersion = `${commit.parentSha ?? 'root'}..${commit.commitSha}:${patchHash}`
  const sourceId = ensureLocalCommitSource(input.workspaceId, {
    repositoryPath: commit.repositoryPath,
    commitSha: commit.commitSha,
  })
  const title = `${commit.shortSha} ${commit.subject}`

  return refreshMaterializedPatchReview({
    workspaceId: input.workspaceId,
    sourceId,
    repositoryPath: commit.repositoryPath,
    sourceKind: 'local-commit',
    title,
    patch,
    patchHash,
    sourceVersion,
    statusFiles: [],
    reviewCreatedPayload: {
      sourceKind: 'local-commit',
      repositoryPath: commit.repositoryPath,
      commitSha: commit.commitSha,
      parentSha: commit.parentSha,
      subject: commit.subject,
    },
    revisionUpdatedPayload: {
      commitSha: commit.commitSha,
      parentSha: commit.parentSha,
    },
  })
}

function githubFilePatch(file: SessionPullRequestDetail['files'][number]): string {
  const previousPath = file.previousFilename ?? file.filename
  const header = `diff --git a/${previousPath} b/${file.filename}`
  const metadata = file.status === 'added'
    ? `new file mode 100644\n--- /dev/null\n+++ b/${file.filename}`
    : file.status === 'removed' || file.status === 'deleted'
      ? `deleted file mode 100644\n--- a/${previousPath}\n+++ /dev/null`
      : file.status === 'renamed'
        ? `rename from ${previousPath}\nrename to ${file.filename}\n--- a/${previousPath}\n+++ b/${file.filename}`
        : `--- a/${previousPath}\n+++ b/${file.filename}`
  const patch = file.patch?.trimEnd()
  return `${header}\n${metadata}${patch ? `\n${patch}` : '\nPatch unavailable from GitHub'}\n`
}

function githubStatus(status: string): Git.GitFileStatusKind {
  if (status === 'added') { return 'added' }
  if (status === 'removed' || status === 'deleted') { return 'deleted' }
  if (status === 'renamed') { return 'renamed' }
  return 'modified'
}

function githubThreadId(remoteId: string): string {
  return `${GITHUB_REVIEW_THREAD_PREFIX}${remoteId}`
}

function githubCommentId(remoteId: string): string {
  return `${GITHUB_REVIEW_COMMENT_PREFIX}${remoteId}`
}

function remoteId(localId: string, prefix: string): string | null {
  return localId.startsWith(prefix) ? localId.slice(prefix.length) || null : null
}

function githubTimestamp(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000)
}

function syncGitHubReviewThreads(input: {
  review: DiffReview
  revision: DiffReviewRevision
  threads: GitHubPullRequestReviewThread[]
  removeMissing?: boolean
}): void {
  const files = db()
    .select()
    .from(diffReviewFiles)
    .where(eq(diffReviewFiles.revisionId, input.revision.id))
    .all()
  const remoteThreadIds = new Set(input.threads.map(thread => githubThreadId(thread.id)))

  for (const remoteThread of input.threads) {
    const id = githubThreadId(remoteThread.id)
    const existing = db().select().from(diffReviewThreads).where(eq(diffReviewThreads.id, id)).get()
    const file = files.find(candidate => candidate.path === remoteThread.path) ?? null
    const line = remoteThread.line
    let anchor: ReviewRangeAnchorView | null = null
    if (!remoteThread.isOutdated && file && line !== null) {
      try {
        anchor = normalizeAnchor({
          revision: input.revision,
          file,
          anchor: {
            fileId: file.id,
            side: remoteThread.diffSide === 'LEFT' ? 'base' : 'head',
            startLine: remoteThread.startLine ?? line,
            endLine: line,
          },
        })
      }
      catch {
        anchor = null
      }
    }
    const firstComment = remoteThread.comments.nodes[0]
    const createdAt = firstComment ? githubTimestamp(firstComment.createdAt) : currentUnixSeconds()
    const updatedAt = remoteThread.comments.nodes.reduce(
      (latest, comment) => Math.max(latest, githubTimestamp(comment.updatedAt)),
      createdAt,
    )
    const state: DiffReviewThread['state'] = remoteThread.isResolved
      ? 'resolved'
      : remoteThread.isOutdated || !anchor
        ? 'stale'
        : 'open'
    db()
      .insert(diffReviewThreads)
      .values({
        id,
        reviewId: input.review.id,
        originalRevisionId: input.revision.id,
        currentRevisionId: state === 'stale' ? null : input.revision.id,
        fileId: file?.id ?? null,
        anchorJson: anchor ? jsonStringify(anchor) : null,
        state,
        createdBy: firstComment?.author?.login ?? 'github',
        resolvedBy: remoteThread.isResolved ? 'github' : null,
        resolvedAt: remoteThread.isResolved ? (existing?.resolvedAt ?? updatedAt) : null,
        createdAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: diffReviewThreads.id,
        set: {
          currentRevisionId: state === 'stale' ? null : input.revision.id,
          fileId: file?.id ?? null,
          anchorJson: anchor ? jsonStringify(anchor) : null,
          state,
          resolvedBy: remoteThread.isResolved ? 'github' : null,
          resolvedAt: remoteThread.isResolved ? (existing?.resolvedAt ?? updatedAt) : null,
          updatedAt,
        },
      })
      .run()

    db().delete(diffReviewComments).where(eq(diffReviewComments.threadId, id)).run()
    for (const comment of remoteThread.comments.nodes) {
      db().insert(diffReviewComments).values({
        id: githubCommentId(comment.id),
        threadId: id,
        authorKind: 'external',
        authorId: comment.author?.login ?? 'github',
        bodyMarkdown: comment.body,
        externalUrl: comment.url,
        createdAt: githubTimestamp(comment.createdAt),
        updatedAt: githubTimestamp(comment.updatedAt),
      }).run()
    }
  }

  if (input.removeMissing) {
    const storedRemoteThreads = db()
      .select()
      .from(diffReviewThreads)
      .where(eq(diffReviewThreads.reviewId, input.review.id))
      .all()
      .filter(thread => thread.id.startsWith(GITHUB_REVIEW_THREAD_PREFIX))
    for (const thread of storedRemoteThreads) {
      if (!remoteThreadIds.has(thread.id)) {
        db().delete(diffReviewThreads).where(eq(diffReviewThreads.id, thread.id)).run()
      }
    }
  }
}

function requireGitHubThreadId(review: DiffReview, thread: DiffReviewThread): string {
  const id = remoteId(thread.id, GITHUB_REVIEW_THREAD_PREFIX)
  if (!id) {
    throw new AppError({
      code: 'diff_review_github_thread_not_synced',
      status: 409,
      message: 'This thread was created before GitHub thread sync was available. Refresh the review and create a new GitHub-backed thread.',
      details: { reviewId: review.id, threadId: thread.id },
    })
  }
  return id
}

function syncGitHubThreadResult(review: DiffReview, thread: GitHubPullRequestReviewThread): void {
  syncGitHubReviewThreads({
    review,
    revision: getCurrentRevision(review),
    threads: [thread],
  })
}

export async function refreshGitHubPullRequest(input: {
  workspaceId: string
  owner: string
  repo: string
  number: number
}): Promise<DiffReviewView> {
  const owner = input.owner.toLowerCase()
  const repo = input.repo.toLowerCase()
  const [detail, reviewThreads] = await Promise.all([
    PullRequest.fetchPullRequestDetailByRef(owner, repo, input.number),
    await hasGitHubToken()
      ? fetchPullRequestReviewThreads(owner, repo, input.number)
      : Promise.resolve([]),
  ])
  const binding: GitHubPullRequestBinding = {
    owner,
    repo,
    number: input.number,
    detail: {
      url: detail.pullRequest.url,
      title: detail.pullRequest.title,
      body: detail.pullRequest.body,
      isDraft: detail.pullRequest.isDraft,
      state: detail.pullRequest.state,
      merged: detail.pullRequest.merged,
      mergeable: detail.pullRequest.mergeable,
      mergeableState: detail.pullRequest.mergeableState,
      headRef: detail.pullRequest.headRef,
      baseRef: detail.pullRequest.baseRef,
      headSha: detail.pullRequest.headSha,
      author: detail.pullRequest.author,
      reviewers: detail.pullRequest.reviewers,
      assignees: detail.pullRequest.assignees,
      labels: detail.pullRequest.labels,
      checksState: detail.pullRequest.checksState,
      checks: detail.pullRequest.checks,
      timeline: detail.timeline,
    },
  }
  const patch = detail.files.map(githubFilePatch).join('')
  const patchHash = hashText(patch)
  const sourceId = ensureGitHubPullRequestSource(input.workspaceId, binding)
  const sourceVersion = `${detail.pullRequest.headSha}:${patchHash}`
  const repositoryPath = `github:${owner}/${repo}`
  const view = await refreshMaterializedPatchReview({
    workspaceId: input.workspaceId,
    sourceId,
    repositoryPath,
    sourceKind: 'github-pull-request',
    status: detail.pullRequest.merged
      ? 'merged'
      : detail.pullRequest.state === 'closed'
        ? 'closed'
        : 'open',
    title: `${owner}/${repo}#${input.number} ${detail.pullRequest.title}`,
    patch,
    patchHash,
    sourceVersion,
    statusFiles: detail.files.map(file => ({
      path: file.filename,
      workspacePath: file.filename,
      status: githubStatus(file.status),
    })),
    fileStats: detail.files.map(file => ({
      path: file.filename,
      additions: file.additions,
      deletions: file.deletions,
    })),
    reviewCreatedPayload: {
      sourceKind: 'github-pull-request',
      owner,
      repo,
      number: input.number,
      url: detail.pullRequest.url,
    },
    revisionUpdatedPayload: {
      owner,
      repo,
      number: input.number,
      headSha: detail.pullRequest.headSha,
      baseRef: detail.pullRequest.baseRef,
    },
  })
  if (view.currentRevision) {
    const review = getReviewRow(input.workspaceId, view.id)
    const revision = getCurrentRevision(review)
    syncGitHubReviewThreads({ review, revision, threads: reviewThreads, removeMissing: true })
    return loadReviewView(review)
  }
  return view
}

const reviewSourceAdapters: Partial<Record<ReviewSourceKind, ReviewSourceAdapter>> = {
  'local-working-tree': {
    refreshStored: (workspaceId, source) => {
      const binding = readSourceBinding<LocalWorkingTreeBinding>(source)
      return refreshLocalWorkingTree(workspaceId, binding.repositoryPath)
    },
  },
  'local-branch-compare': {
    refreshStored: (workspaceId, source) => {
      const binding = readSourceBinding<BranchCompareBinding>(source)
      return refreshLocalBranchCompare({
        workspaceId,
        repositoryPath: binding.repositoryPath,
        baseRef: binding.baseRef,
        headRef: binding.headRef,
      })
    },
  },
  'local-commit': {
    refreshStored: (workspaceId, source) => {
      const binding = readSourceBinding<LocalCommitBinding>(source)
      return refreshLocalCommit({
        workspaceId,
        repositoryPath: binding.repositoryPath,
        commitRef: binding.commitSha,
      })
    },
  },
  'github-pull-request': {
    refreshStored: (workspaceId, source) => {
      const binding = readSourceBinding<GitHubPullRequestBinding>(source)
      return refreshGitHubPullRequest({ workspaceId, ...binding })
    },
  },
}

export async function get(workspaceId: string, reviewId: string): Promise<DiffReviewView> {
  await BackgroundJob.reconcile({
    workspaceId,
    ownerNamespace: DIFF_REVIEW_JOB_OWNER,
    ownerResourceId: reviewId,
  })
  return loadReviewView(getReviewRow(workspaceId, reviewId))
}

export async function list(workspaceId: string): Promise<DiffReviewView[]> {
  await BackgroundJob.reconcile({
    workspaceId,
    ownerNamespace: DIFF_REVIEW_JOB_OWNER,
  })
  return db()
    .select()
    .from(diffReviews)
    .where(eq(diffReviews.workspaceId, workspaceId))
    .orderBy(desc(diffReviews.updatedAt))
    .all()
    .map(review => loadReviewView(review))
}

export async function refresh(workspaceId: string, reviewId: string): Promise<DiffReviewView> {
  const review = getReviewRow(workspaceId, reviewId)
  const adapter = reviewSourceAdapters[review.sourceKind]
  if (!adapter) {
    throw new AppError({
      code: 'diff_review_refresh_not_supported',
      status: 400,
      message: 'Diff review source cannot be refreshed in this build',
      details: { workspaceId, reviewId, sourceKind: review.sourceKind },
    })
  }
  return adapter.refreshStored(workspaceId, getReviewSource(review))
}

function getCurrentRevision(review: DiffReview): DiffReviewRevision {
  if (!review.currentRevisionId) {
    throw new AppError({
      code: 'diff_review_revision_missing',
      status: 409,
      message: 'Diff review has no current revision',
      details: { reviewId: review.id },
    })
  }
  const revision = db()
    .select()
    .from(diffReviewRevisions)
    .where(eq(diffReviewRevisions.id, review.currentRevisionId))
    .get()
  if (!revision) {
    throw new AppError({
      code: 'diff_review_revision_missing',
      status: 409,
      message: 'Diff review current revision is missing',
      details: { reviewId: review.id, revisionId: review.currentRevisionId },
    })
  }
  return revision
}

function getFileForReview(review: DiffReview, fileId: string): DiffReviewFile {
  const revision = getCurrentRevision(review)
  const file = db()
    .select()
    .from(diffReviewFiles)
    .where(and(eq(diffReviewFiles.id, fileId), eq(diffReviewFiles.revisionId, revision.id)))
    .get()
  if (!file) {
    throw new AppError({
      code: 'diff_review_file_not_found',
      status: 404,
      message: 'Diff review file not found',
      details: { reviewId: review.id, fileId },
    })
  }
  return file
}

function getThreadForReview(reviewId: string, threadId: string): DiffReviewThread {
  const thread = db()
    .select()
    .from(diffReviewThreads)
    .where(and(eq(diffReviewThreads.id, threadId), eq(diffReviewThreads.reviewId, reviewId)))
    .get()
  if (!thread) {
    throw new AppError({
      code: 'diff_review_thread_not_found',
      status: 404,
      message: 'Diff review thread not found',
      details: { reviewId, threadId },
    })
  }
  return thread
}

export function setFileViewed(
  workspaceId: string,
  reviewId: string,
  fileId: string,
  viewed: boolean,
  userId = LOCAL_USER_ID,
): DiffReviewView {
  const review = getReviewRow(workspaceId, reviewId)
  const file = getFileForReview(review, fileId)
  const revision = getCurrentRevision(review)
  const now = currentUnixSeconds()
  db()
    .insert(diffReviewFileViewState)
    .values({
      id: randomUUID(),
      reviewId,
      revisionId: revision.id,
      fileId: file.id,
      userId,
      viewed,
      viewedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        diffReviewFileViewState.reviewId,
        diffReviewFileViewState.revisionId,
        diffReviewFileViewState.fileId,
        diffReviewFileViewState.userId,
      ],
      set: { viewed, viewedAt: now },
    })
    .run()
  recordEvent({
    reviewId,
    eventKind: 'file_viewed',
    actorKind: 'user',
    actorId: userId,
    payload: { fileId: file.id, path: file.path, viewed },
    createdAt: now,
  })
  return loadReviewView(review, { userId })
}

export async function createThread(input: {
  workspaceId: string
  reviewId: string
  fileId?: string | null
  anchor?: ReviewRangeAnchorInput | ReviewRangeAnchorView | null
  bodyMarkdown: string
  userId?: string
}): Promise<DiffReviewView> {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const revision = getCurrentRevision(review)
  const userId = input.userId ?? LOCAL_USER_ID
  const anchorFileId = input.anchor && isRangeAnchorInput(input.anchor) ? input.anchor.fileId : null
  const fileId = input.fileId ?? anchorFileId
  const file = fileId ? getFileForReview(review, fileId) : null
  const anchor = file ? normalizeAnchor({ revision, file, anchor: input.anchor }) : null
  const now = currentUnixSeconds()
  if (review.sourceKind === 'github-pull-request') {
    if (!file || !anchor) {
      throw new AppError({
        code: 'diff_review_github_anchor_required',
        status: 400,
        message: 'GitHub review threads must be attached to a changed line.',
        details: { reviewId: review.id, fileId },
      })
    }
    const binding = readSourceBinding<GitHubPullRequestBinding>(getReviewSource(review))
    const remoteThread = await createPullRequestReviewThread({
      owner: binding.owner,
      repo: binding.repo,
      pullRequestNumber: binding.number,
      body: input.bodyMarkdown,
      path: file.path,
      line: anchor.endLine,
      side: anchor.side === 'base' ? 'LEFT' : 'RIGHT',
      startLine: anchor.startLine === anchor.endLine ? undefined : anchor.startLine,
      startSide: anchor.startLine === anchor.endLine
        ? undefined
        : anchor.side === 'base' ? 'LEFT' : 'RIGHT',
    })
    syncGitHubThreadResult(review, remoteThread)
    db()
      .update(diffReviews)
      .set({ reviewState: 'in-review', updatedAt: now })
      .where(eq(diffReviews.id, review.id))
      .run()
    const threadId = githubThreadId(remoteThread.id)
    recordEvent({
      reviewId: review.id,
      eventKind: 'thread_created',
      actorKind: 'user',
      actorId: userId,
      payload: { threadId, fileId: file.id, path: file.path, anchor, sourceSyncState: 'synced' },
      createdAt: now,
    })
    recordEvent({
      reviewId: review.id,
      eventKind: 'comment_created',
      actorKind: 'user',
      actorId: userId,
      payload: { threadId, sourceSyncState: 'synced' },
      createdAt: now,
    })
    return loadReviewView(getReviewRow(input.workspaceId, input.reviewId), { userId })
  }
  const thread = db()
    .insert(diffReviewThreads)
    .values({
      id: randomUUID(),
      reviewId: review.id,
      originalRevisionId: revision.id,
      currentRevisionId: revision.id,
      fileId: file?.id ?? null,
      anchorJson: anchor ? jsonStringify(anchor) : null,
      state: 'open',
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  db()
    .insert(diffReviewComments)
    .values({
      id: randomUUID(),
      threadId: thread.id,
      authorKind: 'user',
      authorId: userId,
      bodyMarkdown: input.bodyMarkdown,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  db()
    .update(diffReviews)
    .set({ reviewState: 'in-review', updatedAt: now })
    .where(eq(diffReviews.id, review.id))
    .run()
  recordEvent({
    reviewId: review.id,
    eventKind: 'thread_created',
    actorKind: 'user',
    actorId: userId,
    payload: { threadId: thread.id, fileId: file?.id ?? null, path: file?.path ?? null, anchor },
    createdAt: now,
  })
  recordEvent({
    reviewId: review.id,
    eventKind: 'comment_created',
    actorKind: 'user',
    actorId: userId,
    payload: { threadId: thread.id },
    createdAt: now,
  })
  return loadReviewView(getReviewRow(input.workspaceId, input.reviewId), { userId })
}

export async function addComment(input: {
  workspaceId: string
  reviewId: string
  threadId: string
  bodyMarkdown: string
  userId?: string
}): Promise<DiffReviewView> {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const thread = getThreadForReview(review.id, input.threadId)
  const userId = input.userId ?? LOCAL_USER_ID
  const now = currentUnixSeconds()
  if (review.sourceKind === 'github-pull-request') {
    const binding = readSourceBinding<GitHubPullRequestBinding>(getReviewSource(review))
    const remoteThread = await replyToPullRequestReviewThread({
      owner: binding.owner,
      repo: binding.repo,
      threadId: requireGitHubThreadId(review, thread),
      body: input.bodyMarkdown,
    })
    syncGitHubThreadResult(review, remoteThread)
    recordEvent({
      reviewId: review.id,
      eventKind: 'comment_created',
      actorKind: 'user',
      actorId: userId,
      payload: { threadId: thread.id, sourceSyncState: 'synced' },
      createdAt: now,
    })
    return loadReviewView(review, { userId })
  }
  db()
    .insert(diffReviewComments)
    .values({
      id: randomUUID(),
      threadId: thread.id,
      authorKind: 'user',
      authorId: userId,
      bodyMarkdown: input.bodyMarkdown,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  db()
    .update(diffReviewThreads)
    .set({ state: 'open', updatedAt: now, resolvedBy: null, resolvedAt: null })
    .where(eq(diffReviewThreads.id, thread.id))
    .run()
  recordEvent({
    reviewId: review.id,
    eventKind: 'comment_created',
    actorKind: 'user',
    actorId: userId,
    payload: { threadId: thread.id },
    createdAt: now,
  })
  return loadReviewView(review, { userId })
}

export async function resolveThread(
  workspaceId: string,
  reviewId: string,
  threadId: string,
  userId = LOCAL_USER_ID,
): Promise<DiffReviewView> {
  const review = getReviewRow(workspaceId, reviewId)
  const thread = getThreadForReview(review.id, threadId)
  const now = currentUnixSeconds()
  if (review.sourceKind === 'github-pull-request') {
    const binding = readSourceBinding<GitHubPullRequestBinding>(getReviewSource(review))
    const remoteThread = await resolvePullRequestReviewThread({
      owner: binding.owner,
      repo: binding.repo,
      threadId: requireGitHubThreadId(review, thread),
    })
    syncGitHubThreadResult(review, remoteThread)
    recordEvent({
      reviewId: review.id,
      eventKind: 'thread_resolved',
      actorKind: 'user',
      actorId: userId,
      payload: { threadId: thread.id, sourceSyncState: 'synced' },
      createdAt: now,
    })
    return loadReviewView(review, { userId })
  }
  db()
    .update(diffReviewThreads)
    .set({ state: 'resolved', resolvedBy: userId, resolvedAt: now, updatedAt: now })
    .where(eq(diffReviewThreads.id, thread.id))
    .run()
  recordEvent({
    reviewId: review.id,
    eventKind: 'thread_resolved',
    actorKind: 'user',
    actorId: userId,
    payload: { threadId: thread.id },
    createdAt: now,
  })
  return loadReviewView(review, { userId })
}

export async function submitReview(input: {
  workspaceId: string
  reviewId: string
  decision: 'approve' | 'request-changes' | 'comment'
  bodyMarkdown?: string | null
  userId?: string
}): Promise<DiffReviewView> {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const revision = getCurrentRevision(review)
  const userId = input.userId ?? LOCAL_USER_ID
  const now = currentUnixSeconds()
  if (
    review.sourceKind === 'github-pull-request'
    && input.decision !== 'approve'
    && !input.bodyMarkdown?.trim()
  ) {
    throw new AppError({
      code: 'diff_review_github_body_required',
      status: 400,
      message: 'GitHub comments and change requests require a review summary',
      details: { reviewId: review.id, decision: input.decision },
    })
  }
  const submission = db()
    .insert(diffReviewSubmissions)
    .values({
      id: randomUUID(),
      reviewId: review.id,
      revisionId: revision.id,
      actorId: userId,
      decision: input.decision,
      bodyMarkdown: input.bodyMarkdown ?? null,
      submittedAt: now,
      sourceSyncState: review.sourceKind === 'github-pull-request' ? 'pending' : 'local-only',
    })
    .returning()
    .get()

  let sourceSyncState: ReviewSubmissionView['sourceSyncState'] = submission.sourceSyncState
  if (review.sourceKind === 'github-pull-request') {
    const binding = readSourceBinding<GitHubPullRequestBinding>(getReviewSource(review))
    try {
      await PullRequestConsole.submitPullRequestReviewAction({
        owner: binding.owner,
        repo: binding.repo,
        number: binding.number,
        body: input.bodyMarkdown ?? undefined,
        event: githubReviewEvent(input.decision),
      })
      sourceSyncState = 'synced'
    }
    catch (error) {
      db()
        .update(diffReviewSubmissions)
        .set({ sourceSyncState: 'failed' })
        .where(eq(diffReviewSubmissions.id, submission.id))
        .run()
      recordEvent({
        reviewId: review.id,
        eventKind: 'review_submitted',
        actorKind: 'user',
        actorId: userId,
        payload: { revisionId: revision.id, decision: input.decision, sourceSyncState: 'failed' },
        createdAt: now,
      })
      throw error
    }
    db()
      .update(diffReviewSubmissions)
      .set({ sourceSyncState })
      .where(eq(diffReviewSubmissions.id, submission.id))
      .run()
  }
  db()
    .update(diffReviews)
    .set({ reviewState: reviewStateForDecision(input.decision), updatedAt: now })
    .where(eq(diffReviews.id, review.id))
    .run()
  recordEvent({
    reviewId: review.id,
    eventKind: 'review_submitted',
    actorKind: 'user',
    actorId: userId,
    payload: { revisionId: revision.id, decision: input.decision, sourceSyncState },
    createdAt: now,
  })
  return loadReviewView(getReviewRow(input.workspaceId, input.reviewId), { userId })
}

export async function mergeGitHubReview(input: {
  workspaceId: string
  reviewId: string
  mergeMethod: 'merge' | 'squash' | 'rebase'
  userId?: string
}): Promise<DiffReviewView> {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  if (review.sourceKind !== 'github-pull-request') {
    throw new AppError({
      code: 'diff_review_merge_not_supported',
      status: 400,
      message: 'Only GitHub pull request reviews can be merged.',
      details: { reviewId: review.id, sourceKind: review.sourceKind },
    })
  }
  const binding = readSourceBinding<GitHubPullRequestBinding>(getReviewSource(review))

  let result: { sha: string, merged: true, message: string }
  try {
    result = await PullRequestConsole.mergePullRequestByRef({
      owner: binding.owner,
      repo: binding.repo,
      number: binding.number,
      mergeMethod: input.mergeMethod,
    })
  }
  catch (error) {
    recordEvent({
      reviewId: review.id,
      eventKind: 'merge_failed',
      actorKind: 'user',
      actorId: input.userId ?? LOCAL_USER_ID,
      payload: {
        mergeMethod: input.mergeMethod,
        error: error instanceof Error ? error.message : 'GitHub rejected the merge.',
      },
    })
    throw error
  }
  recordEvent({
    reviewId: review.id,
    eventKind: 'merge_completed',
    actorKind: 'user',
    actorId: input.userId ?? LOCAL_USER_ID,
    payload: { mergeMethod: input.mergeMethod, sha: result.sha },
  })
  return refreshGitHubPullRequest({ workspaceId: input.workspaceId, ...binding })
}

export function closeReview(input: {
  workspaceId: string
  reviewId: string
  userId?: string
}): DiffReviewView {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  if (review.sourceKind === 'local-working-tree') {
    throw new AppError({
      code: 'diff_review_live_working_tree_cannot_close',
      status: 400,
      message:
        'Live working tree reviews cannot be closed; commit, stash, or discard the working tree changes instead',
      details: { reviewId: review.id, sourceKind: review.sourceKind },
    })
  }
  if (review.sourceKind === 'github-pull-request') {
    throw new AppError({
      code: 'diff_review_remote_pull_request_cannot_close',
      status: 400,
      message: 'Close the pull request in GitHub, then refresh this review',
      details: { reviewId: review.id, sourceKind: review.sourceKind },
    })
  }
  const userId = input.userId ?? LOCAL_USER_ID
  if (review.status === 'closed') {
    return loadReviewView(review, { userId })
  }

  const now = currentUnixSeconds()
  const updated = db()
    .update(diffReviews)
    .set({ status: 'closed', updatedAt: now })
    .where(eq(diffReviews.id, review.id))
    .returning()
    .get()
  recordEvent({
    reviewId: review.id,
    eventKind: 'review_closed',
    actorKind: 'user',
    actorId: userId,
    payload: { previousStatus: review.status },
    createdAt: now,
  })
  return loadReviewView(updated, { userId })
}

export function updatePreferences(input: {
  workspaceId: string
  userId?: string
  diffStyle?: 'split' | 'unified'
  codeTheme?: string
  fontSize?: number
  lineHeight?: number
  hideWhitespaceOnly?: boolean
  structuralHighlighting?: boolean
  collapseGeneratedFiles?: boolean
  notificationMode?: DiffReviewPreferenceView['notificationMode']
}): DiffReviewPreferenceView {
  const userId = input.userId ?? LOCAL_USER_ID
  const existing = ensurePreferences(input.workspaceId, userId)
  const now = currentUnixSeconds()
  const updated = db()
    .update(diffReviewPreferences)
    .set({
      diffStyle: input.diffStyle ?? existing.diffStyle,
      codeTheme: input.codeTheme ?? existing.codeTheme,
      fontSize: input.fontSize ?? existing.fontSize,
      lineHeight: input.lineHeight ?? existing.lineHeight,
      hideWhitespaceOnly: input.hideWhitespaceOnly ?? existing.hideWhitespaceOnly,
      structuralHighlighting: input.structuralHighlighting ?? existing.structuralHighlighting,
      collapseGeneratedFiles: input.collapseGeneratedFiles ?? existing.collapseGeneratedFiles,
      notificationMode: input.notificationMode ?? existing.notificationMode,
      updatedAt: now,
    })
    .where(eq(diffReviewPreferences.id, existing.id))
    .returning()
    .get()
  return toPreferenceView(updated)
}

export function sourceReadiness(workspaceId: string): ReviewSourceReadinessView[] {
  return [
    {
      sourceKind: 'local-working-tree',
      workspaceId,
      state: 'ready',
      actions: [],
    },
    {
      sourceKind: 'local-branch-compare',
      workspaceId,
      state: 'ready',
      actions: [],
    },
    {
      sourceKind: 'local-commit',
      workspaceId,
      state: 'ready',
      actions: [],
    },
    {
      sourceKind: 'github-pull-request',
      workspaceId,
      state: 'ready',
      actions: [],
    },
  ]
}

export function createAgentFix(input: {
  workspaceId: string
  reviewId: string
  threadId?: string | null
  anchor?: ReviewRangeAnchorInput | ReviewRangeAnchorView | null
  instruction: string
  agentId?: string | null
  expectedOutput: 'working-tree-change' | 'patch-artifact'
  userId?: string
}): DiffReviewView {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  let threadAnchor: ReviewRangeAnchorView | null = null
  if (input.threadId) {
    const thread = getThreadForReview(review.id, input.threadId)
    threadAnchor = toAnchorView(safeJsonParse(thread.anchorJson))
  }
  const revision = getCurrentRevision(review)
  const anchorFileId = input.anchor && isRangeAnchorInput(input.anchor) ? input.anchor.fileId : null
  const file = anchorFileId ? getFileForReview(review, anchorFileId) : null
  const anchor = file ? normalizeAnchor({ revision, file, anchor: input.anchor }) : threadAnchor
  const userId = input.userId ?? LOCAL_USER_ID
  const now = currentUnixSeconds()
  const agentFix = db()
    .insert(diffReviewAgentFixes)
    .values({
      id: randomUUID(),
      reviewId: review.id,
      targetRevisionId: revision.id,
      threadId: input.threadId ?? null,
      anchorJson: anchor ? jsonStringify(anchor) : null,
      instruction: input.instruction,
      profileId: input.agentId ?? null,
      expectedOutput: input.expectedOutput,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  recordEvent({
    reviewId: review.id,
    eventKind: 'agent_fix_created',
    actorKind: 'user',
    actorId: userId,
    payload: {
      agentFixId: agentFix.id,
      threadId: input.threadId ?? null,
      expectedOutput: input.expectedOutput,
      anchor,
    },
    createdAt: now,
  })
  return loadReviewView(review, { userId })
}

function getAgentFixForReview(reviewId: string, agentFixId: string): DiffReviewAgentFix {
  const agentFix = db()
    .select()
    .from(diffReviewAgentFixes)
    .where(
      and(eq(diffReviewAgentFixes.id, agentFixId), eq(diffReviewAgentFixes.reviewId, reviewId)),
    )
    .get()
  if (!agentFix) {
    throw new AppError({
      code: 'diff_review_agent_fix_not_found',
      status: 404,
      message: 'Diff review agent fix was not found',
      details: { reviewId, agentFixId },
    })
  }
  return agentFix
}

function formatAgentFixAnchor(anchor: ReviewRangeAnchorView | null): string {
  if (!anchor) {
    return 'No specific diff range was provided.'
  }
  return [
    `File: ${anchor.path}`,
    `Side: ${anchor.side}`,
    `Lines: ${anchor.startLine}-${anchor.endLine}`,
    `Hunk: ${anchor.hunkHeader}`,
  ].join('\n')
}

function buildAgentFixPrompt(input: {
  review: DiffReview
  revision: DiffReviewRevision | null
  agentFix: DiffReviewAgentFix
  thread: DiffReviewThread | null
  comments: DiffReviewComment[]
  files: DiffReviewFile[]
}): string {
  const anchor = toAnchorView(safeJsonParse(input.agentFix.anchorJson))
  const changedFiles
    = input.files.length > 0
      ? input.files.map(file => `- ${file.status}: ${file.path}`).join('\n')
      : '- No current changed files are recorded.'
  const comments
    = input.comments.length > 0
      ? input.comments
          .map(comment => `- ${comment.authorKind}:${comment.authorId}: ${comment.bodyMarkdown}`)
          .join('\n')
      : '- No review thread comments were provided.'
  const threadState = input.thread ? input.thread.state : 'not attached'
  const patchSummary = input.revision
    ? `Revision ${input.revision.id} has patch hash ${input.revision.patchHash}, ${input.revision.fileCount} files, +${input.revision.additions}/-${input.revision.deletions}.`
    : 'The review currently has no active revision.'

  return [
    'You are working on a Cradle Diffs review fix request.',
    '',
    'Use the workspace repository as the source of truth. Address the requested review feedback with the smallest coherent change.',
    '',
    '## Review',
    `Review id: ${input.review.id}`,
    `Title: ${input.review.title}`,
    `Source: ${input.review.sourceKind}`,
    `Repository path: ${input.review.repositoryPath}`,
    patchSummary,
    '',
    '## Requested Output',
    input.agentFix.expectedOutput === 'patch-artifact'
      ? 'Produce a patch-style change artifact or leave the working tree changes clearly summarized.'
      : 'Apply the fix to the working tree and summarize the changed files.',
    '',
    '## User Instruction',
    input.agentFix.instruction,
    '',
    '## Anchor',
    formatAgentFixAnchor(anchor),
    '',
    '## Thread',
    `State: ${threadState}`,
    comments,
    '',
    '## Changed Files',
    changedFiles,
    '',
    'After finishing, summarize exactly what changed and call out anything you could not complete.',
  ].join('\n')
}

function readAgentFixArtifact(input: {
  reviewId: string
  agentFix: DiffReviewAgentFix
}): ReviewAgentFixArtifactView | null {
  if (!input.agentFix.sessionId || !input.agentFix.runId) {
    return null
  }

  const content = Session.getRunMessageContents([input.agentFix.runId])[0]?.content
  if (!content) {
    return null
  }
  return buildAgentFixArtifact({
    reviewId: input.reviewId,
    agentFixId: input.agentFix.id,
    sessionId: input.agentFix.sessionId,
    runId: input.agentFix.runId,
    content,
    createdAt: input.agentFix.updatedAt,
  })
}

function markAgentFixFailed(input: {
  reviewId: string
  agentFixId: string
  errorMessage: string
  actorKind?: 'system' | 'agent'
  actorId?: string | null
}): void {
  const now = currentUnixSeconds()
  db()
    .update(diffReviewAgentFixes)
    .set({
      status: 'failed',
      errorMessage: input.errorMessage,
      updatedAt: now,
    })
    .where(eq(diffReviewAgentFixes.id, input.agentFixId))
    .run()
  recordEvent({
    reviewId: input.reviewId,
    eventKind: 'agent_fix_failed',
    actorKind: input.actorKind ?? 'system',
    actorId: input.actorId ?? null,
    payload: { agentFixId: input.agentFixId, errorMessage: input.errorMessage },
    createdAt: now,
  })
}

async function watchAgentFixRunCompletion(input: {
  workspaceId: string
  reviewId: string
  agentFixId: string
  runId: string
  sessionId: string
}): Promise<void> {
  try {
    const run = await ChatRuntime.waitForRunCompletion(input.runId, UNBOUNDED_DIFF_REVIEW_RUN_WAIT)
    const current = db()
      .select()
      .from(diffReviewAgentFixes)
      .where(eq(diffReviewAgentFixes.id, input.agentFixId))
      .get()
    if (!current || current.runId !== input.runId || current.status !== 'running') {
      return
    }

    if (run.status !== 'complete') {
      const now = currentUnixSeconds()
      db()
        .update(diffReviewAgentFixes)
        .set({
          status: run.status === 'aborted' ? 'cancelled' : 'failed',
          errorMessage:
            run.errorText
            ?? (run.status === 'aborted' ? 'Agent fix run was aborted' : 'Agent fix run failed'),
          updatedAt: now,
        })
        .where(eq(diffReviewAgentFixes.id, input.agentFixId))
        .run()
      recordEvent({
        reviewId: input.reviewId,
        eventKind: 'agent_fix_failed',
        actorKind: 'system',
        actorId: null,
        payload: {
          agentFixId: input.agentFixId,
          sessionId: input.sessionId,
          runId: input.runId,
          runStatus: run.status,
        },
        createdAt: now,
      })
      return
    }

    const refreshed = await refresh(input.workspaceId, input.reviewId)
    const now = currentUnixSeconds()
    const artifact = readAgentFixArtifact({
      reviewId: input.reviewId,
      agentFix: {
        ...current,
        sessionId: input.sessionId,
        runId: input.runId,
        updatedAt: now,
      },
    })
    db()
      .update(diffReviewAgentFixes)
      .set({
        status: 'completed',
        artifactId: artifact?.id ?? null,
        resultRevisionId: refreshed.currentRevisionId,
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(diffReviewAgentFixes.id, input.agentFixId))
      .run()
    recordEvent({
      reviewId: input.reviewId,
      eventKind: 'agent_fix_completed',
      actorKind: 'agent',
      actorId: current.profileId,
      payload: {
        agentFixId: input.agentFixId,
        sessionId: input.sessionId,
        runId: input.runId,
        artifactId: artifact?.id ?? null,
        artifactKind: artifact?.kind ?? null,
        artifactContentHash: artifact?.contentHash ?? null,
        resultRevisionId: refreshed.currentRevisionId,
      },
      createdAt: now,
    })
  }
 catch (error) {
    markAgentFixFailed({
      reviewId: input.reviewId,
      agentFixId: input.agentFixId,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function startAgentFix(input: {
  workspaceId: string
  reviewId: string
  agentFixId: string
  agentId?: string | null
  providerTargetId?: string | null
  runtimeKind?: RuntimeKind | null
  modelId?: string | null
  outputLocale?: ReviewOutputLocale | null
  userId?: string
}): Promise<DiffReviewView> {
  return startAgentFixRun(input, { rerun: false })
}

async function startAgentFixRun(
  input: {
    workspaceId: string
    reviewId: string
    agentFixId: string
    agentId?: string | null
    providerTargetId?: string | null
    runtimeKind?: RuntimeKind | null
    modelId?: string | null
    outputLocale?: ReviewOutputLocale | null
    userId?: string
  },
  options: { rerun: boolean },
): Promise<DiffReviewView> {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const agentFix = getAgentFixForReview(review.id, input.agentFixId)
  if (agentFix.status === 'running') {
    return loadReviewView(review, { userId: input.userId })
  }
  if (agentFix.status === 'completed' && !options.rerun) {
    return loadReviewView(review, { userId: input.userId })
  }
  if (agentFix.status === 'cancelled' && !options.rerun) {
    throw new AppError({
      code: 'diff_review_agent_fix_cancelled',
      status: 409,
      message: 'Cancelled agent fix work orders cannot be started',
      details: { reviewId: review.id, agentFixId: agentFix.id },
    })
  }

  const providerTargetId = input.providerTargetId?.trim() || undefined
  const agentId
    = input.agentId?.trim() || (providerTargetId ? undefined : agentFix.profileId) || undefined
  const runtimeKind = input.runtimeKind?.trim() || undefined
  if (!agentId && !providerTargetId) {
    throw new AppError({
      code: 'diff_review_agent_fix_target_missing',
      status: 400,
      message: 'Starting a diff review agent fix requires an agentId or providerTargetId',
      details: { reviewId: review.id, agentFixId: agentFix.id },
    })
  }
  if (providerTargetId && !runtimeKind) {
    throw new AppError({
      code: 'diff_review_agent_fix_runtime_missing',
      status: 400,
      message: 'Starting a provider-backed diff review agent fix requires runtimeKind',
      details: { reviewId: review.id, agentFixId: agentFix.id, providerTargetId },
    })
  }

  const revision = review.currentRevisionId
    ? (db()
        .select()
        .from(diffReviewRevisions)
        .where(eq(diffReviewRevisions.id, review.currentRevisionId))
        .get() ?? null)
    : null
  const files = revision
    ? db()
        .select()
        .from(diffReviewFiles)
        .where(eq(diffReviewFiles.revisionId, revision.id))
        .orderBy(asc(diffReviewFiles.path))
        .all()
    : []
  const thread = agentFix.threadId
    ? (db()
        .select()
        .from(diffReviewThreads)
        .where(eq(diffReviewThreads.id, agentFix.threadId))
        .get() ?? null)
    : null
  const comments = agentFix.threadId
    ? db()
        .select()
        .from(diffReviewComments)
        .where(eq(diffReviewComments.threadId, agentFix.threadId))
        .orderBy(asc(diffReviewComments.createdAt))
        .all()
    : []

  try {
    const agentRow = agentId
      ? db()
          .select({ modelId: agents.modelId, thinkingEffort: agents.thinkingEffort })
          .from(agents)
          .where(eq(agents.id, agentId))
          .get()
      : null
    const session = await Session.create({
      workspaceId: review.workspaceId,
      title: `Diff fix: ${review.title}`,
      origin: 'cradle-review',
      agentId,
      providerTargetId,
      runtimeKind,
      modelId: input.modelId ?? agentRow?.modelId ?? null,
      runtimeSettings: { accessMode: 'full-access' },
    })
    const run = await ChatRuntime.createRun({
      sessionId: session.id,
      text: buildAgentFixPrompt({ review, revision, agentFix, thread, comments, files }),
      modelId: input.modelId ?? agentRow?.modelId ?? undefined,
      thinkingEffort: agentRow?.thinkingEffort ?? undefined,
      runtimeSettingsOverride: { accessMode: 'full-access' },
    })
    const now = currentUnixSeconds()
    db()
      .update(diffReviewAgentFixes)
      .set({
        status: 'running',
        sessionId: session.id,
        runId: run.runId,
        profileId: agentId ?? providerTargetId ?? agentFix.profileId,
        artifactId: null,
        resultRevisionId: null,
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(diffReviewAgentFixes.id, agentFix.id))
      .run()
    recordEvent({
      reviewId: review.id,
      eventKind: 'agent_fix_started',
      actorKind: 'system',
      actorId: null,
      payload: {
        agentFixId: agentFix.id,
        sessionId: session.id,
        runId: run.runId,
        status: 'running',
        rerun: options.rerun,
        runtimeKind,
      },
      createdAt: now,
    })
    void watchAgentFixRunCompletion({
      workspaceId: review.workspaceId,
      reviewId: review.id,
      agentFixId: agentFix.id,
      sessionId: session.id,
      runId: run.runId,
    })
    return loadReviewView(getReviewRow(input.workspaceId, input.reviewId), { userId: input.userId })
  }
 catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    markAgentFixFailed({
      reviewId: review.id,
      agentFixId: agentFix.id,
      errorMessage: message,
    })
    throw error
  }
}

export async function rerunAgentFix(input: {
  workspaceId: string
  reviewId: string
  agentFixId: string
  agentId?: string | null
  providerTargetId?: string | null
  runtimeKind?: RuntimeKind | null
  modelId?: string | null
  outputLocale?: ReviewOutputLocale | null
  userId?: string
}): Promise<DiffReviewView> {
  return startAgentFixRun(input, { rerun: true })
}

export function getAgentFixArtifact(input: {
  workspaceId: string
  reviewId: string
  agentFixId: string
}): ReviewAgentFixArtifactView {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const agentFix = getAgentFixForReview(review.id, input.agentFixId)
  const artifact = readAgentFixArtifact({ reviewId: review.id, agentFix })
  if (!artifact || artifact.id !== agentFix.artifactId) {
    throw new AppError({
      code: 'diff_review_agent_fix_artifact_not_found',
      status: 404,
      message: 'Diff review agent fix artifact was not found',
      details: {
        reviewId: review.id,
        agentFixId: agentFix.id,
        artifactId: agentFix.artifactId,
      },
    })
  }
  return artifact
}

export async function cancelAgentFix(input: {
  workspaceId: string
  reviewId: string
  agentFixId: string
  userId?: string
}): Promise<DiffReviewView> {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const agentFix = getAgentFixForReview(review.id, input.agentFixId)
  if (agentFix.status === 'completed') {
    throw new AppError({
      code: 'diff_review_agent_fix_completed',
      status: 409,
      message: 'Completed agent fix work orders cannot be cancelled',
      details: { reviewId: review.id, agentFixId: agentFix.id },
    })
  }
  if (agentFix.status === 'cancelled') {
    return loadReviewView(review, { userId: input.userId })
  }
  if (agentFix.status === 'running' && agentFix.sessionId) {
    await ChatRuntime.cancelSession(agentFix.sessionId)
  }

  const now = currentUnixSeconds()
  db()
    .update(diffReviewAgentFixes)
    .set({
      status: 'cancelled',
      errorMessage: null,
      updatedAt: now,
    })
    .where(eq(diffReviewAgentFixes.id, agentFix.id))
    .run()
  recordEvent({
    reviewId: review.id,
    eventKind: 'agent_fix_cancelled',
    actorKind: 'user',
    actorId: input.userId ?? LOCAL_USER_ID,
    payload: {
      agentFixId: agentFix.id,
      sessionId: agentFix.sessionId,
      runId: agentFix.runId,
      previousStatus: agentFix.status,
    },
    createdAt: now,
  })
  return loadReviewView(getReviewRow(input.workspaceId, input.reviewId), { userId: input.userId })
}

export async function deleteAgentFix(input: {
  workspaceId: string
  reviewId: string
  agentFixId: string
  userId?: string
}): Promise<DiffReviewView> {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const agentFix = getAgentFixForReview(review.id, input.agentFixId)
  if (agentFix.status === 'pending') {
    throw new AppError({
      code: 'diff_review_agent_fix_pending',
      status: 409,
      message:
        'Pending agent fix work orders must be started or cancelled before they can be deleted',
      details: { reviewId: review.id, agentFixId: agentFix.id },
    })
  }
  if (agentFix.status === 'running') {
    throw new AppError({
      code: 'diff_review_agent_fix_running',
      status: 409,
      message: 'Running agent fix work orders must be cancelled before they can be deleted',
      details: { reviewId: review.id, agentFixId: agentFix.id },
    })
  }

  const now = currentUnixSeconds()
  db().delete(diffReviewAgentFixes).where(eq(diffReviewAgentFixes.id, agentFix.id)).run()
  recordEvent({
    reviewId: review.id,
    eventKind: 'agent_fix_deleted',
    actorKind: 'user',
    actorId: input.userId ?? LOCAL_USER_ID,
    payload: {
      agentFixId: agentFix.id,
      previousStatus: agentFix.status,
      sessionId: agentFix.sessionId,
      runId: agentFix.runId,
      artifactId: agentFix.artifactId,
      resultRevisionId: agentFix.resultRevisionId,
    },
    createdAt: now,
  })
  return loadReviewView(getReviewRow(input.workspaceId, input.reviewId), { userId: input.userId })
}
