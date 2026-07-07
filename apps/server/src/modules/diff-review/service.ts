import { randomUUID } from 'node:crypto'

import type {
  DiffReview,
  DiffReviewAgentFix,
  DiffReviewComment,
  DiffReviewCommitPlan,
  DiffReviewEvent,
  DiffReviewFile,
  DiffReviewGuide,
  DiffReviewPreference,
  DiffReviewRevision,
  DiffReviewSource,
  DiffReviewSourceOperation,
  DiffReviewSubmission,
  DiffReviewThread,
  DiffReviewThreadReaction,
} from '@cradle/db'
import {
  agents,
  diffReviewAgentFixes,
  diffReviewComments,
  diffReviewCommitPlans,
  diffReviewEvents,
  diffReviewFiles,
  diffReviewFileViewState,
  diffReviewGuides,
  diffReviewPreferences,
  diffReviewRevisions,
  diffReviews,
  diffReviewSourceOperations,
  diffReviewSources,
  diffReviewSubmissions,
  diffReviewThreadReactions,
  diffReviewThreads,
} from '@cradle/db'
import { and, asc, desc, eq, ne } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { getRuntimeRegistry, listRuntimeCatalog } from '../chat-runtime/chat-runtime-provider-registry'
import * as ChatRuntime from '../chat-runtime/runtime'
import type {
  ChatRuntimeSettings,
  RuntimeProviderTargetProfile,
} from '../chat-runtime/runtime-provider-types'
import * as Git from '../git/service'
import * as ModelRegistry from '../model-registry/service'
import { runtimeOwnsProviderBinding, runtimeSupportsProviderKind } from '../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../provider-contracts/types'
import { resolveProviderTarget } from '../provider-targets/service'
import * as Session from '../session/service'
import { buildAgentFixArtifact } from './agent-fix-artifacts'
import { isRangeAnchorInput, normalizeAnchor, remapAnchorToRevision, toAnchorView } from './anchors'
import { commitGroupsForPlan, normalizeCommitPlanGroups } from './commit-plans'
import { isGeneratedReviewFile, parsePatchFileSummaries } from './patch'
import type {
  BranchCompareBinding,
  DiffReviewPreferenceView,
  DiffReviewView,
  DiffRevisionView,
  LocalCommitBinding,
  ReviewActorKind,
  ReviewAgentFixArtifactView,
  ReviewAgentFixView,
  ReviewCommentView,
  ReviewCommitPlanConflictView,
  ReviewCommitPlanGroupInput,
  ReviewCommitPlanGroupView,
  ReviewCommitPlanView,
  ReviewEventKind,
  ReviewEventView,
  ReviewFileDiffView,
  ReviewGuideStatus,
  ReviewGuideStepView,
  ReviewGuideView,
  ReviewOutputLocale,
  ReviewRangeAnchorInput,
  ReviewRangeAnchorView,
  ReviewSourceKind,
  ReviewSourceReadinessView,
  ReviewSubmissionView,
  ReviewThreadReactionView,
  ReviewThreadView,
} from './types'
import { hashText, jsonStringify, safeJsonParse, shortHash, titleForRepository } from './utils'

export type {
  DiffReviewPreferenceView,
  DiffReviewView,
  DiffRevisionView,
  ReviewAgentFixArtifactView,
  ReviewAgentFixView,
  ReviewCommentView,
  ReviewCommitPlanGroupView,
  ReviewCommitPlanView,
  ReviewEventView,
  ReviewFileDiffView,
  ReviewGuideStepView,
  ReviewGuideView,
  ReviewOutputLocale,
  ReviewRangeAnchorView,
  ReviewSourceReadinessView,
  ReviewSubmissionView,
  ReviewThreadReactionView,
  ReviewThreadView,
} from './types'

const LOCAL_USER_ID = 'local-user'
const GUIDE_ARTIFACT_START = '<cradle_guide>'
const GUIDE_ARTIFACT_END = '</cradle_guide>'
const COMMIT_PLAN_ARTIFACT_START = '<cradle_commit_plan>'
const COMMIT_PLAN_ARTIFACT_END = '</cradle_commit_plan>'
const GUIDE_RUNTIME_SETTINGS: ChatRuntimeSettings = {
  accessMode: 'full-access',
  interactionMode: 'default',
}
const DEFAULT_OUTPUT_LOCALE: ReviewOutputLocale = 'en-US'
const OUTPUT_LOCALE_LABELS = {
  'en-US': 'English (US)',
  'zh-CN': 'Simplified Chinese (zh-CN)',
  'ja-JP': 'Japanese (ja-JP)',
  'es-ES': 'Spanish (es-ES)',
} satisfies Record<ReviewOutputLocale, string>

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

function toReactionView(row: DiffReviewThreadReaction): ReviewThreadReactionView {
  return {
    id: row.id,
    threadId: row.threadId,
    userId: row.userId,
    reaction: row.reaction,
    createdAt: row.createdAt,
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
    eventKind: row.eventKind,
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
    expectedOutput: row.expectedOutput,
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

function toCommitPlanView(row: DiffReviewCommitPlan): ReviewCommitPlanView {
  const parsed = safeJsonParse(row.groupsJson)
  const groups: ReviewCommitPlanGroupView[] = Array.isArray(parsed)
    ? (parsed as ReviewCommitPlanGroupView[])
    : []
  const conflicts = computeCommitPlanConflicts(groups)
  return {
    id: row.id,
    reviewId: row.reviewId,
    revisionId: row.revisionId,
    actorId: row.actorId,
    strategy: 'manual',
    status: row.status,
    groups,
    conflicts,
    rationale: row.rationale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function computeCommitPlanConflicts(
  groups: ReviewCommitPlanGroupView[],
): ReviewCommitPlanConflictView[] {
  const fileIdToGroupIds = new Map<string, string[]>()
  const fileIdToPath = new Map<string, string>()
  for (const group of groups) {
    for (let i = 0; i < group.fileIds.length; i++) {
      const fileId = group.fileIds[i]
      const path = group.paths[i] ?? fileId
      fileIdToPath.set(fileId, path)
      const existing = fileIdToGroupIds.get(fileId)
      if (existing) {
        existing.push(group.id)
      }
 else {
        fileIdToGroupIds.set(fileId, [group.id])
      }
    }
  }
  const conflicts: ReviewCommitPlanConflictView[] = []
  for (const [fileId, groupIds] of fileIdToGroupIds) {
    if (groupIds.length > 1) {
      conflicts.push({
        fileId,
        path: fileIdToPath.get(fileId) ?? fileId,
        groupIds,
      })
    }
  }
  return conflicts
}

function emptyGuideView(revisionId: string | null): ReviewGuideView {
  return {
    revisionId,
    status: null,
    providerTargetId: null,
    runtimeKind: null,
    modelId: null,
    sessionId: null,
    runId: null,
    errorMessage: null,
    createdAt: null,
    updatedAt: null,
    title: null,
    steps: [],
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
  const reactions = db()
    .select()
    .from(diffReviewThreadReactions)
    .orderBy(asc(diffReviewThreadReactions.createdAt))
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
    reactions: reactions.filter(reaction => reaction.threadId === thread.id).map(toReactionView),
  }))
}

function toGuideView(
  row: DiffReviewGuide | null | undefined,
  revision: DiffReviewRevision | null,
): ReviewGuideView {
  if (!revision) {
    return emptyGuideView(null)
  }
  if (!row) {
    return emptyGuideView(revision.id)
  }
  const parsed = safeJsonParse(row.stepsJson)
  return {
    revisionId: revision.id,
    status: row.status,
    providerTargetId: row.providerTargetId,
    runtimeKind: row.runtimeKind,
    modelId: row.modelId,
    sessionId: row.sessionId,
    runId: row.runId,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    title: readString(row.title) ?? null,
    steps: row.status === 'ready' ? normalizeStoredGuideSteps(parsed) : [],
  }
}

function normalizeStoredGuideSteps(parsed: unknown): ReviewGuideStepView[] {
  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed
    .flatMap((rawStep, index): ReviewGuideStepView[] => {
      const step
        = rawStep && typeof rawStep === 'object' ? (rawStep as Record<string, unknown>) : null
      if (!step) {
        return []
      }

      const title = readString(step.title)
      const rationale = readString(step.rationale)
      if (!title || !rationale) {
        return []
      }

      const fileIds = readStringArray(step.fileIds)
      const threadIds = readStringArray(step.threadIds)
      const anchors = Array.isArray(step.anchors)
        ? step.anchors.flatMap(anchor => toAnchorView(anchor) ?? [])
        : []
      const order
        = typeof step.order === 'number' && Number.isFinite(step.order) ? step.order : index
      return [
        {
          id:
            readString(step.id)
            || `step-${index + 1}-${shortHash(JSON.stringify({ title, fileIds }))}`,
          title,
          rationale,
          fileIds,
          threadIds,
          anchors,
          order,
        },
      ]
    })
    .toSorted((left, right) => left.order - right.order)
}

function loadCurrentGuide(reviewId: string, revision: DiffReviewRevision | null): ReviewGuideView {
  if (!revision) {
    return emptyGuideView(null)
  }
  const row = db()
    .select()
    .from(diffReviewGuides)
    .where(
      and(eq(diffReviewGuides.reviewId, reviewId), eq(diffReviewGuides.revisionId, revision.id)),
    )
    .get()
  return toGuideView(row, revision)
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
  const commitPlans = revision
    ? db()
        .select()
        .from(diffReviewCommitPlans)
        .where(
          and(
            eq(diffReviewCommitPlans.reviewId, review.id),
            eq(diffReviewCommitPlans.revisionId, revision.id),
            eq(diffReviewCommitPlans.strategy, 'manual'),
          ),
        )
        .orderBy(desc(diffReviewCommitPlans.createdAt))
        .all()
        .map(toCommitPlanView)
    : []

  return {
    id: review.id,
    workspaceId: review.workspaceId,
    sourceId: review.sourceId,
    repositoryPath: review.repositoryPath,
    sourceKind: review.sourceKind,
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
    guide: loadCurrentGuide(review.id, revision),
    agentFixes,
    commitPlans,
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

function includeCommitPlanInReviewView(
  view: DiffReviewView,
  plan: DiffReviewCommitPlan,
): DiffReviewView {
  const planView = toCommitPlanView(plan)
  return {
    ...view,
    commitPlans: [
      planView,
      ...view.commitPlans.filter(candidate => candidate.id !== planView.id),
    ],
  }
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

/**
 * Mark non-applied commit plans as abandoned when the review revision changes or becomes empty.
 * Plans that were already applied are preserved as historical records.
 */
function markStaleCommitPlans(reviewId: string): void {
  db()
    .update(diffReviewCommitPlans)
    .set({ status: 'abandoned', updatedAt: currentUnixSeconds() })
    .where(
      and(
        eq(diffReviewCommitPlans.reviewId, reviewId),
        ne(diffReviewCommitPlans.status, 'applied'),
        ne(diffReviewCommitPlans.status, 'abandoned'),
      ),
    )
    .run()
}

async function refreshMaterializedPatchReview(input: {
  workspaceId: string
  sourceId: string
  repositoryPath: string
  sourceKind: ReviewSourceKind
  title: string
  patch: string
  patchHash: string
  sourceVersion: string
  statusFiles: Git.GitFileStatusView[]
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
        status: 'open',
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
    markStaleCommitPlans(review.id)
    const updated = db()
      .update(diffReviews)
      .set({
        title: input.title,
        sourceId: input.sourceId,
        status: input.sourceKind === 'local-working-tree' ? 'open' : review.status,
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
        status: input.sourceKind === 'local-working-tree' ? 'open' : review.status,
        updatedAt: now,
      })
      .where(eq(diffReviews.id, review.id))
      .returning()
      .get()
    return loadReviewView(updated)
  }

  const summaries = parsePatchFileSummaries(input.patch, input.statusFiles)
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

  markStaleCommitPlans(review.id)
  const updated = db()
    .update(diffReviews)
    .set({
      title: input.title,
      sourceId: input.sourceId,
      status: input.sourceKind === 'local-working-tree' ? 'open' : review.status,
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
}

export function get(workspaceId: string, reviewId: string): DiffReviewView {
  return loadReviewView(getReviewRow(workspaceId, reviewId))
}

export function list(workspaceId: string): DiffReviewView[] {
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

function getCommitPlanForReview(reviewId: string, commitPlanId: string): DiffReviewCommitPlan {
  const plan = db()
    .select()
    .from(diffReviewCommitPlans)
    .where(
      and(
        eq(diffReviewCommitPlans.id, commitPlanId),
        eq(diffReviewCommitPlans.reviewId, reviewId),
        eq(diffReviewCommitPlans.strategy, 'manual'),
      ),
    )
    .get()
  if (!plan) {
    throw new AppError({
      code: 'diff_review_commit_plan_not_found',
      status: 404,
      message: 'Diff review commit plan not found',
      details: { reviewId, commitPlanId },
    })
  }
  return plan
}

function createOrResetSourceOperation(input: {
  sourceId: string
  reviewId: string
  operationKind: string
  idempotencyKey: string
  request: unknown
}): DiffReviewSourceOperation {
  const existing = db()
    .select()
    .from(diffReviewSourceOperations)
    .where(
      and(
        eq(diffReviewSourceOperations.sourceId, input.sourceId),
        eq(diffReviewSourceOperations.operationKind, input.operationKind),
        eq(diffReviewSourceOperations.idempotencyKey, input.idempotencyKey),
      ),
    )
    .get()
  const now = currentUnixSeconds()
  if (existing) {
    if (existing.status === 'succeeded') {
      return existing
    }
    return db()
      .update(diffReviewSourceOperations)
      .set({
        status: 'pending',
        requestJson: jsonStringify(input.request),
        responseJson: null,
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(diffReviewSourceOperations.id, existing.id))
      .returning()
      .get()
  }

  return db()
    .insert(diffReviewSourceOperations)
    .values({
      id: randomUUID(),
      sourceId: input.sourceId,
      reviewId: input.reviewId,
      operationKind: input.operationKind,
      idempotencyKey: input.idempotencyKey,
      status: 'pending',
      requestJson: jsonStringify(input.request),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
}

function finishSourceOperation(input: {
  operationId: string
  status: 'succeeded' | 'failed'
  response?: unknown
  errorMessage?: string | null
}): void {
  db()
    .update(diffReviewSourceOperations)
    .set({
      status: input.status,
      responseJson: input.response === undefined ? null : jsonStringify(input.response),
      errorMessage: input.errorMessage ?? null,
      updatedAt: currentUnixSeconds(),
    })
    .where(eq(diffReviewSourceOperations.id, input.operationId))
    .run()
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

export function createThread(input: {
  workspaceId: string
  reviewId: string
  fileId?: string | null
  anchor?: ReviewRangeAnchorInput | ReviewRangeAnchorView | null
  bodyMarkdown: string
  userId?: string
}): DiffReviewView {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const revision = getCurrentRevision(review)
  const userId = input.userId ?? LOCAL_USER_ID
  const anchorFileId = input.anchor && isRangeAnchorInput(input.anchor) ? input.anchor.fileId : null
  const fileId = input.fileId ?? anchorFileId
  const file = fileId ? getFileForReview(review, fileId) : null
  const anchor = file ? normalizeAnchor({ revision, file, anchor: input.anchor }) : null
  const now = currentUnixSeconds()
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

export function addComment(input: {
  workspaceId: string
  reviewId: string
  threadId: string
  bodyMarkdown: string
  userId?: string
}): DiffReviewView {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const thread = getThreadForReview(review.id, input.threadId)
  const userId = input.userId ?? LOCAL_USER_ID
  const now = currentUnixSeconds()
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

export function addReaction(input: {
  workspaceId: string
  reviewId: string
  threadId: string
  reaction: string
  userId?: string
}): DiffReviewView {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const thread = getThreadForReview(review.id, input.threadId)
  const userId = input.userId ?? LOCAL_USER_ID
  db()
    .insert(diffReviewThreadReactions)
    .values({
      id: randomUUID(),
      threadId: thread.id,
      userId,
      reaction: input.reaction,
      createdAt: currentUnixSeconds(),
    })
    .onConflictDoNothing({
      target: [
        diffReviewThreadReactions.threadId,
        diffReviewThreadReactions.userId,
        diffReviewThreadReactions.reaction,
      ],
    })
    .run()
  return loadReviewView(review, { userId })
}

export function resolveThread(
  workspaceId: string,
  reviewId: string,
  threadId: string,
  userId = LOCAL_USER_ID,
): DiffReviewView {
  const review = getReviewRow(workspaceId, reviewId)
  const thread = getThreadForReview(review.id, threadId)
  const now = currentUnixSeconds()
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

export function submitReview(input: {
  workspaceId: string
  reviewId: string
  decision: 'approve' | 'request-changes' | 'comment'
  bodyMarkdown?: string | null
  userId?: string
}): DiffReviewView {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const revision = getCurrentRevision(review)
  const userId = input.userId ?? LOCAL_USER_ID
  const now = currentUnixSeconds()
  db()
    .insert(diffReviewSubmissions)
    .values({
      id: randomUUID(),
      reviewId: review.id,
      revisionId: revision.id,
      actorId: userId,
      decision: input.decision,
      bodyMarkdown: input.bodyMarkdown ?? null,
      submittedAt: now,
      sourceSyncState: 'local-only',
    })
    .run()
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
    payload: { revisionId: revision.id, decision: input.decision, sourceSyncState: 'local-only' },
    createdAt: now,
  })
  return loadReviewView(getReviewRow(input.workspaceId, input.reviewId), { userId })
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
      state: 'workspace-integration-missing',
      actions: [
        {
          label: 'Connect GitHub integration',
          ownerKind: 'workspace-admin',
        },
      ],
    },
  ]
}

function selectGuideRuntimeKind(input: {
  providerKind: RuntimeProviderTargetProfile['providerKind']
  runtimeKind?: RuntimeKind
  providerTargetId: string
}): RuntimeKind {
  const requestedRuntimeKind = input.runtimeKind?.trim()
  if (requestedRuntimeKind) {
    assertGuideRuntimeSupportsProvider({
      runtimeKind: requestedRuntimeKind,
      providerKind: input.providerKind,
      providerTargetId: input.providerTargetId,
    })
    return requestedRuntimeKind
  }

  const runtime = listRuntimeCatalog().find(item =>
    item.providerBinding !== 'runtime-owned'
    && item.surfaces?.includes('chat') === true
    && runtimeSupportsProviderKind(item.runtimeKind, input.providerKind)
    && Boolean(getRuntimeRegistry().get(item.runtimeKind)))
  if (runtime) {
    return runtime.runtimeKind
  }

  throw new AppError({
    code: 'diff_review_guide_runtime_required',
    status: 400,
    message: 'No compatible change walkthrough runtime is available for the provider target',
    details: { providerTargetId: input.providerTargetId, providerKind: input.providerKind },
  })
}

function assertGuideRuntimeSupportsProvider(input: {
  runtimeKind: RuntimeKind
  providerKind: RuntimeProviderTargetProfile['providerKind']
  providerTargetId: string
}): void {
  const runtime = getRuntimeRegistry().get(input.runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'diff_review_guide_provider_unsupported',
      status: 400,
      message: 'Provider target runtime does not support change walkthrough generation',
      details: { runtimeKind: input.runtimeKind, providerTargetId: input.providerTargetId },
    })
  }

  const catalogItem = listRuntimeCatalog().find(item => item.runtimeKind === input.runtimeKind)
  if (
    !runtimeOwnsProviderBinding(input.runtimeKind)
    && catalogItem?.surfaces?.includes('chat') === true
    && runtimeSupportsProviderKind(input.runtimeKind, input.providerKind)
  ) {
    return
  }

  throw new AppError({
    code: 'diff_review_guide_runtime_incompatible',
    status: 400,
    message: 'Provider target is not compatible with the requested change walkthrough runtime',
    details: {
      providerTargetId: input.providerTargetId,
      providerKind: input.providerKind,
      runtimeKind: input.runtimeKind,
    },
  })
}

function buildGuideProfile(providerTargetId: string): RuntimeProviderTargetProfile {
  const target = resolveProviderTarget(providerTargetId)
  if (!target.enabled) {
    throw new AppError({
      code: 'diff_review_guide_provider_disabled',
      status: 409,
      message: 'Guided review provider target is disabled',
      details: { providerTargetId },
    })
  }
  return {
    id: target.id,
    name: target.label,
    providerKind: target.providerKind,
    enabled: target.enabled,
    configJson: JSON.stringify({
      ...((safeJsonParse(target.configJson) as Record<string, unknown> | null) ?? {}),
      modelRegistryMappings: ModelRegistry.listMappingEntries(),
    }),
    credentialRef: target.credentialRef,
    customModels: target.customModelsJson,
    iconSlug: target.iconSlug,
    providerTargetKind: target.target.kind,
    providerTargetId: target.target.id,
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, '\'\\\'\'')}'`
}

function outputLocaleLabel(locale: ReviewOutputLocale): string {
  return OUTPUT_LOCALE_LABELS[locale]
}

function normalizeOutputLocale(locale?: ReviewOutputLocale | null): ReviewOutputLocale {
  return locale ?? DEFAULT_OUTPUT_LOCALE
}

function buildGuideAgentInstruction(input: {
  review: DiffReview
  revision: DiffReviewRevision
  files: DiffReviewFile[]
  threads: ReviewThreadView[]
  outputLocale: ReviewOutputLocale
}): string {
  const files = input.files.map(file => ({
    id: file.id,
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    isGenerated: file.isGenerated,
    isBinary: file.isBinary,
  }))
  const threads = input.threads.map(thread => ({
    id: thread.id,
    state: thread.state,
    fileId: thread.fileId,
    anchor: thread.anchor
      ? {
          fileId: thread.anchor.fileId,
          path: thread.anchor.path,
          side: thread.anchor.side,
          startLine: thread.anchor.startLine,
          endLine: thread.anchor.endLine,
        }
      : null,
    comments: thread.comments.map(comment => ({
      authorKind: comment.authorKind,
      bodyMarkdown: comment.bodyMarkdown,
    })),
  }))
  const gitTarget
    = input.review.repositoryPath === '.'
      ? 'the current directory'
      : `repository path ${input.review.repositoryPath}`
  const gitPrefix
    = input.review.repositoryPath === '.'
      ? 'git'
      : `git -C ${shellQuote(input.review.repositoryPath)}`

  return [
    'You are generating a Cradle change walkthrough for the current local working tree.',
    '',
    'This is not a code review, not a risk assessment, and not a fix task. Build the reading path that helps a human understand how this change was constructed.',
    'Use the available shell and file tools to inspect the repository. Do not rely only on the file inventory below.',
    'Do not modify files, do not apply patches, do not commit, and do not run formatting or install commands.',
    '',
    'Repository:',
    `- Workspace command cwd starts at the Cradle workspace root.`,
    `- The diff review repository is ${gitTarget}.`,
    `- Use commands with this prefix when inspecting git state: ${gitPrefix}`,
    '',
    'Useful read-only commands:',
    `- ${gitPrefix} status --short`,
    `- ${gitPrefix} diff --stat HEAD`,
    `- ${gitPrefix} diff --name-status HEAD`,
    `- ${gitPrefix} diff --unified=80 HEAD -- <path>`,
    '- rg / sed / cat for surrounding source context.',
    '',
    'Final output contract:',
    `- Emit the final artifact between ${GUIDE_ARTIFACT_START} and ${GUIDE_ARTIFACT_END}.`,
    '- The text inside those tags must be one JSON object.',
    '- Do not put Markdown fences inside the tags.',
    '- Do not generate ids, order numbers, fileIds, or Cradle anchors. Cradle will derive those.',
    '- Do not include risk scores, verdicts, approval guidance, or correctness judgments.',
    '',
    'Artifact shape:',
    '{"title":"string","steps":[{"title":"string","rationale":"string","threadIds":["thread-id"],"paths":["path"],"ranges":[{"path":"path","side":"head|base","startLine":1,"endLine":1}]}]}',
    '',
    'Output language:',
    `- Write the artifact "title", every step "title", and every step "rationale" in ${outputLocaleLabel(input.outputLocale)}.`,
    '- Keep file paths, ids, commands, code identifiers, branch names, and quoted repository text unchanged.',
    '',
    'Rules:',
    '- The artifact "title" is the headline a reader sees before diving in. Keep it short (under 70 characters), specific to the change, and free of trailing punctuation. Do not echo the review title verbatim — write a fresh framing of what this change accomplishes.',
    '- Prefer 2 to 8 steps. Use fewer for small diffs.',
    '- Each step must reference at least one changed path or changed range.',
    '- Use only paths from the provided changed files list.',
    '- Use only threadIds from the provided threads list.',
    '- Order steps by the change story, not alphabetically and not necessarily patch order.',
    '- Prefer exact ranges for the important changed regions. Use file-level paths only when line ranges would be misleading.',
    '- For deleted lines use side "base". For added or current lines use side "head".',
    '- Start with the intent and public contract of the change, then the core implementation, then call sites, generated artifacts, tests, and docs when present.',
    '- Files with active comments should come near the related part of the walkthrough.',
    '- Generated files and binary files should be late unless they define the contract being explained.',
    '- Rationale explains what role this step plays in understanding how the change was made, not whether the code is correct.',
    '',
    'Review:',
    JSON.stringify({
      id: input.review.id,
      title: input.review.title,
      sourceKind: input.review.sourceKind,
      repositoryPath: input.review.repositoryPath,
      revision: {
        id: input.revision.id,
        patchHash: input.revision.patchHash,
        fileCount: input.revision.fileCount,
        additions: input.revision.additions,
        deletions: input.revision.deletions,
      },
      files,
      threads,
    }),
  ].join('\n')
}

function parseGuideJson(raw: string): unknown {
  const taggedStart = raw.indexOf(GUIDE_ARTIFACT_START)
  const taggedEnd = raw.lastIndexOf(GUIDE_ARTIFACT_END)
  if (taggedStart >= 0 && taggedEnd > taggedStart) {
    const tagged = raw.slice(taggedStart + GUIDE_ARTIFACT_START.length, taggedEnd).trim()
    const parsed = safeJsonParse(tagged)
    if (parsed) {
      return parsed
    }
  }

  const direct = safeJsonParse(raw.trim())
  if (direct) {
    return direct
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  if (fenced?.[1]) {
    const parsed = safeJsonParse(fenced[1].trim())
    if (parsed) {
      return parsed
    }
  }
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return safeJsonParse(raw.slice(start, end + 1))
  }
  return null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim())
    : []
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function readGuideStepRecords(parsed: unknown): Record<string, unknown>[] {
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  const rawSteps = Array.isArray(record?.steps) ? record.steps : null
  if (!rawSteps) {
    throw new Error('Guide output is missing steps[]')
  }
  return rawSteps.map(rawStep =>
    rawStep && typeof rawStep === 'object' ? (rawStep as Record<string, unknown>) : {})
}

function readGuideTitle(parsed: unknown): string | null {
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  if (!record) {
    return null
  }
  const raw = readString(record.title)
  if (!raw) {
    return null
  }
  // Trim and cap length so a runaway model can't blow up the surface bar.
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed
}

function buildFileLookup(files: DiffReviewFile[]): Map<string, DiffReviewFile> {
  const lookup = new Map<string, DiffReviewFile>()
  for (const file of files) {
    lookup.set(file.id, file)
    lookup.set(file.path, file)
    if (file.previousPath) {
      lookup.set(file.previousPath, file)
    }
  }
  return lookup
}

function resolveGuideFile(
  value: unknown,
  lookup: Map<string, DiffReviewFile>,
): DiffReviewFile | null {
  const key = readString(value)
  return key ? (lookup.get(key) ?? null) : null
}

function readGuidePathFiles(
  step: Record<string, unknown>,
  lookup: Map<string, DiffReviewFile>,
): DiffReviewFile[] {
  const candidates = [
    ...readStringArray(step.fileIds),
    ...readStringArray(step.paths),
    ...readStringArray(step.files),
    ...readStringArray(step.filePaths),
  ]
  const files = candidates.flatMap((candidate) => {
    const file = lookup.get(candidate)
    return file ? [file] : []
  })
  return Array.from(new Map(files.map(file => [file.id, file])).values())
}

function readGuideRangeRecords(step: Record<string, unknown>): Record<string, unknown>[] {
  const ranges = Array.isArray(step.ranges)
    ? step.ranges
    : Array.isArray(step.anchors)
      ? step.anchors
      : Array.isArray(step.locations)
        ? step.locations
        : []
  return ranges.flatMap(range =>
    range && typeof range === 'object' ? [range as Record<string, unknown>] : [])
}

function resolveGuideRangeAnchor(input: {
  revision: DiffReviewRevision
  range: Record<string, unknown>
  lookup: Map<string, DiffReviewFile>
}): ReviewRangeAnchorView | null {
  const file = resolveGuideFile(input.range.path ?? input.range.fileId, input.lookup)
  if (!file) {
    return null
  }
  const startLine = readPositiveInteger(input.range.startLine)
  if (!startLine) {
    return null
  }
  const endLine = readPositiveInteger(input.range.endLine) ?? startLine
  if (endLine < startLine) {
    return null
  }
  const sideValue = readString(input.range.side)
  const side
    = sideValue === 'base' || sideValue === 'head'
      ? sideValue
      : file.status === 'deleted'
        ? 'base'
        : 'head'
  try {
    return normalizeAnchor({
      revision: input.revision,
      file,
      anchor: {
        fileId: file.id,
        side,
        startLine,
        endLine,
      },
    })
  }
 catch {
    return null
  }
}

function normalizeGuideSteps(input: {
  parsed: unknown
  revision: DiffReviewRevision
  files: DiffReviewFile[]
  threads: ReviewThreadView[]
}): ReviewGuideStepView[] {
  const rawSteps = readGuideStepRecords(input.parsed)
  const lookup = buildFileLookup(input.files)
  const threadIds = new Set(input.threads.map(thread => thread.id))
  return rawSteps.map((step, index): ReviewGuideStepView => {
    const title = readString(step.title)
    const rationale = readString(step.rationale)
    const rangeRecords = readGuideRangeRecords(step)
    const pathFiles = readGuidePathFiles(step, lookup)
    const rangeFiles = rangeRecords.flatMap((range) => {
      const file = resolveGuideFile(range.path ?? range.fileId, lookup)
      return file ? [file] : []
    })
    const anchors = rangeRecords.flatMap(
      range => resolveGuideRangeAnchor({ revision: input.revision, range, lookup }) ?? [],
    )
    const stepFileIds = [
      ...new Set([
        ...pathFiles.map(file => file.id),
        ...rangeFiles.map(file => file.id),
        ...anchors.map(anchor => anchor.fileId),
      ]),
    ]
    const stepThreadIds = [...new Set(readStringArray(step.threadIds))].filter(threadId =>
      threadIds.has(threadId))
    if (!title) {
      throw new Error(`Guide step ${index + 1} is missing title`)
    }
    if (!rationale) {
      throw new Error(`Guide step ${index + 1} is missing rationale`)
    }
    if (stepFileIds.length === 0) {
      throw new Error(`Guide step ${index + 1} must reference at least one current revision file`)
    }
    const order = index
    return {
      id: `step-${index + 1}-${shortHash(JSON.stringify({ title, fileIds: stepFileIds }))}`,
      title,
      rationale,
      fileIds: stepFileIds,
      threadIds: stepThreadIds,
      anchors,
      order,
    }
  })
}

function upsertGuide(input: {
  reviewId: string
  revisionId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  modelId?: string | null
  sessionId?: string | null
  runId?: string | null
  inputHash: string
  status: ReviewGuideStatus
  title?: string | null
  steps?: ReviewGuideStepView[]
  errorMessage?: string | null
}): void {
  const now = currentUnixSeconds()
  const steps = input.steps ?? []
  const title = input.title ?? null
  db()
    .insert(diffReviewGuides)
    .values({
      id: randomUUID(),
      reviewId: input.reviewId,
      revisionId: input.revisionId,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind,
      modelId: input.modelId ?? null,
      sessionId: input.sessionId ?? null,
      runId: input.runId ?? null,
      inputHash: input.inputHash,
      status: input.status,
      title,
      stepsJson: jsonStringify(steps),
      errorMessage: input.errorMessage ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [diffReviewGuides.reviewId, diffReviewGuides.revisionId],
      set: {
        providerTargetId: input.providerTargetId,
        runtimeKind: input.runtimeKind,
        modelId: input.modelId ?? null,
        sessionId: input.sessionId ?? null,
        runId: input.runId ?? null,
        inputHash: input.inputHash,
        status: input.status,
        title,
        stepsJson: jsonStringify(steps),
        errorMessage: input.errorMessage ?? null,
        updatedAt: now,
      },
    })
    .run()
}

function validateGuideSourceKind(review: DiffReview): void {
  if (review.sourceKind === 'local-working-tree') {
    return
  }
  throw new AppError({
    code: 'diff_review_local_source_unsupported',
    status: 400,
    message: 'Diff review generation currently supports local working tree reviews only',
    details: {
      reviewId: review.id,
      sourceKind: review.sourceKind,
    },
  })
}

function isGuideGenerationActive(status: DiffReviewGuide['status'] | undefined): boolean {
  return status === 'pending' || status === 'running'
}

function isCurrentGuideGeneration(input: {
  reviewId: string
  revisionId: string
  inputHash: string
}): boolean {
  const current = db()
    .select()
    .from(diffReviewGuides)
    .where(
      and(
        eq(diffReviewGuides.reviewId, input.reviewId),
        eq(diffReviewGuides.revisionId, input.revisionId),
      ),
    )
    .get()
  return current?.inputHash === input.inputHash && isGuideGenerationActive(current.status)
}

async function runGuideGenerationTask(input: {
  workspaceId: string
  review: DiffReview
  revision: DiffReviewRevision
  files: DiffReviewFile[]
  threads: ReviewThreadView[]
  providerTargetId: string
  runtimeKind: RuntimeKind
  modelId?: string | null
  inputHash: string
  sessionId: string
  runId: string
}): Promise<void> {
  try {
    const run = await ChatRuntime.waitForRunCompletion(input.runId)
    if (run.status !== 'complete') {
      throw new Error(
        run.errorText
        ?? (run.status === 'aborted'
            ? 'Guide generation run was aborted'
            : 'Guide generation run failed'),
      )
    }
    const rawOutput = Session.getRunMessageContents([input.runId])[0]?.content?.trim()
    if (!rawOutput) {
      throw new Error('Guide generation completed without assistant output')
    }
    const parsedArtifact = parseGuideJson(rawOutput)
    const steps = normalizeGuideSteps({
      parsed: parsedArtifact,
      revision: input.revision,
      files: input.files,
      threads: input.threads,
    })
    const title = readGuideTitle(parsedArtifact)
    if (
      !isCurrentGuideGeneration({
        reviewId: input.review.id,
        revisionId: input.revision.id,
        inputHash: input.inputHash,
      })
    ) {
      return
    }
    upsertGuide({
      reviewId: input.review.id,
      revisionId: input.revision.id,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind,
      modelId: input.modelId,
      sessionId: input.sessionId,
      runId: input.runId,
      inputHash: input.inputHash,
      status: 'ready',
      title,
      steps,
      errorMessage: null,
    })
  }
 catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      !isCurrentGuideGeneration({
        reviewId: input.review.id,
        revisionId: input.revision.id,
        inputHash: input.inputHash,
      })
    ) {
      return
    }
    upsertGuide({
      reviewId: input.review.id,
      revisionId: input.revision.id,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind,
      modelId: input.modelId,
      sessionId: input.sessionId,
      runId: input.runId,
      inputHash: input.inputHash,
      status: 'failed',
      steps: [],
      errorMessage: message,
    })
  }
}

export async function generateGuide(input: {
  workspaceId: string
  reviewId: string
  providerTargetId: string
  runtimeKind?: RuntimeKind
  modelId?: string | null
  force?: boolean
  outputLocale?: ReviewOutputLocale | null
  userId?: string
}): Promise<DiffReviewView> {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  validateGuideSourceKind(review)
  const revision = getCurrentRevision(review)
  const files = db()
    .select()
    .from(diffReviewFiles)
    .where(eq(diffReviewFiles.revisionId, revision.id))
    .orderBy(asc(diffReviewFiles.path))
    .all()
  if (files.length === 0) {
    throw new AppError({
      code: 'diff_review_guide_empty_revision',
      status: 409,
      message: 'Guided review generation requires a revision with changed files',
      details: { reviewId: review.id, revisionId: revision.id },
    })
  }
  const existing = db()
    .select()
    .from(diffReviewGuides)
    .where(
      and(eq(diffReviewGuides.reviewId, review.id), eq(diffReviewGuides.revisionId, revision.id)),
    )
    .get()
  if (existing?.status === 'ready' && !input.force) {
    return loadReviewView(review, { userId: input.userId })
  }
  if (isGuideGenerationActive(existing?.status) && !input.force) {
    return loadReviewView(review, { userId: input.userId })
  }

  const profile = buildGuideProfile(input.providerTargetId)
  const runtimeKind = selectGuideRuntimeKind({
    providerKind: profile.providerKind,
    runtimeKind: input.runtimeKind,
    providerTargetId: input.providerTargetId,
  })

  const threads = loadThreads(review.id)
  const outputLocale = normalizeOutputLocale(input.outputLocale)
  const instruction = buildGuideAgentInstruction({ review, revision, files, threads, outputLocale })
  const inputHash = hashText(
    JSON.stringify({
      revisionId: revision.id,
      patchHash: revision.patchHash,
      providerTargetId: input.providerTargetId,
      runtimeKind,
      modelId: input.modelId ?? null,
      outputLocale,
      instructionHash: hashText(instruction),
    }),
  )
  if (!getRuntimeRegistry().get(runtimeKind)) {
    throw new AppError({
      code: 'diff_review_guide_provider_unsupported',
      status: 400,
      message: 'Provider target runtime does not support change walkthrough generation',
      details: { runtimeKind, providerTargetId: input.providerTargetId },
    })
  }

  const session = Session.create({
    workspaceId: review.workspaceId,
    title: `Diff guide: ${review.title}`,
    origin: 'cradle-review',
    providerTargetId: input.providerTargetId,
    modelId: input.modelId ?? null,
    runtimeKind,
    runtimeSettings: GUIDE_RUNTIME_SETTINGS,
  })
  const run = await ChatRuntime.createRun({
    sessionId: session.id,
    text: instruction,
    modelId: input.modelId ?? undefined,
    runtimeSettings: GUIDE_RUNTIME_SETTINGS,
  })

  upsertGuide({
    reviewId: review.id,
    revisionId: revision.id,
    providerTargetId: input.providerTargetId,
    runtimeKind,
    modelId: input.modelId,
    sessionId: session.id,
    runId: run.runId,
    inputHash,
    status: 'running',
    steps: [],
    errorMessage: null,
  })
  void runGuideGenerationTask({
    workspaceId: input.workspaceId,
    review,
    revision,
    files,
    threads,
    providerTargetId: input.providerTargetId,
    runtimeKind,
    modelId: input.modelId,
    inputHash,
    sessionId: session.id,
    runId: run.runId,
  }).catch((error) => {
    console.error('Diff review guide generation background task failed', error)
  })

  return loadReviewView(review, { userId: input.userId })
}

export async function cancelGuide(input: {
  workspaceId: string
  reviewId: string
  userId?: string
}): Promise<DiffReviewView> {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const revision = getCurrentRevision(review)
  const guide = db()
    .select()
    .from(diffReviewGuides)
    .where(
      and(eq(diffReviewGuides.reviewId, review.id), eq(diffReviewGuides.revisionId, revision.id)),
    )
    .get()

  if (!guide || guide.status === 'cancelled') {
    return loadReviewView(review, { userId: input.userId })
  }
  if (guide.status === 'ready') {
    throw new AppError({
      code: 'diff_review_guide_ready',
      status: 409,
      message: 'Completed guide generation cannot be cancelled',
      details: { reviewId: review.id, revisionId: revision.id },
    })
  }
  if (isGuideGenerationActive(guide.status) && guide.sessionId) {
    await ChatRuntime.cancelSession(guide.sessionId)
  }

  const now = currentUnixSeconds()
  db()
    .update(diffReviewGuides)
    .set({
      status: 'cancelled',
      stepsJson: '[]',
      errorMessage: null,
      updatedAt: now,
    })
    .where(eq(diffReviewGuides.id, guide.id))
    .run()
  recordEvent({
    reviewId: review.id,
    eventKind: 'guide_cancelled',
    actorKind: 'user',
    actorId: input.userId ?? LOCAL_USER_ID,
    payload: {
      revisionId: revision.id,
      sessionId: guide.sessionId,
      runId: guide.runId,
      previousStatus: guide.status,
    },
    createdAt: now,
  })
  return loadReviewView(getReviewRow(input.workspaceId, input.reviewId), { userId: input.userId })
}

export function createAgentFix(input: {
  workspaceId: string
  reviewId: string
  threadId?: string | null
  anchor?: ReviewRangeAnchorInput | ReviewRangeAnchorView | null
  instruction: string
  agentId?: string | null
  expectedOutput: 'commit' | 'working-tree-change' | 'patch-artifact'
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

function buildCommitPlanAgentPrompt(input: {
  review: DiffReview
  revision: DiffReviewRevision | null
  agentFix: DiffReviewAgentFix
  files: DiffReviewFile[]
  outputLocale: ReviewOutputLocale
}): string {
  const files = input.files.map(file => ({
    id: file.id,
    path: file.path,
    previousPath: file.previousPath,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    isGenerated: file.isGenerated,
    isBinary: file.isBinary,
  }))
  const gitTarget
    = input.review.repositoryPath === '.'
      ? 'the current directory'
      : `repository path ${input.review.repositoryPath}`
  const gitPrefix
    = input.review.repositoryPath === '.'
      ? 'git'
      : `git -C ${shellQuote(input.review.repositoryPath)}`
  return [
    'You are generating a Cradle Diffs commit plan for the current local working tree.',
    '',
    'This is not a code review and not a fix task. Decide how the existing diff should be split into clean native git commits.',
    'Use the available shell and file tools to inspect the repository. Do not rely only on the file inventory below.',
    'Do not modify files, do not apply patches, do not commit, and do not run formatting or install commands.',
    '',
    'Repository:',
    `- Workspace command cwd starts at the Cradle workspace root.`,
    `- The diff review repository is ${gitTarget}.`,
    `- Use commands with this prefix when inspecting git state: ${gitPrefix}`,
    '',
    'Useful read-only commands:',
    `- ${gitPrefix} status --short`,
    `- ${gitPrefix} diff --stat HEAD`,
    `- ${gitPrefix} diff --name-status HEAD`,
    `- ${gitPrefix} diff --unified=80 HEAD -- <path>`,
    '- rg / sed / cat for surrounding source context.',
    '',
    'Final output contract:',
    `- Emit the final artifact between ${COMMIT_PLAN_ARTIFACT_START} and ${COMMIT_PLAN_ARTIFACT_END}.`,
    '- The text inside those tags must be one JSON object.',
    '- Do not put Markdown fences inside the tags.',
    '- Do not generate Cradle ids. Cradle will derive group ids.',
    '',
    'Artifact shape:',
    '{"rationale":"string","groups":[{"title":"string","message":"type(scope): summary","rationale":"string","fileIds":["changed-file-id"],"dependsOn":[1]}]}',
    '',
    'Output language:',
    `- Write the artifact "rationale", every group "title", and every group "rationale" in ${outputLocaleLabel(input.outputLocale)}.`,
    '- The group "message" field is a git commit subject: follow this repository\'s existing commit style and language. Do not translate or localize commit messages solely because of the output language.',
    '- Keep file ids, paths, commands, code identifiers, branch names, and quoted repository text unchanged.',
    '',
    'Rules:',
    '- Prefer 1 to 6 commit groups. Use one group for a single coherent change.',
    '- Every changed file id from the provided file list must appear in at least one group.',
    '- A file MAY appear in multiple groups if it contains changes for different features. The first group will get the file; later groups will skip it.',
    '- Avoid duplicate files when possible. Only use duplicates when a file truly contains independent changes that belong in separate commits.',
    '- Use only fileIds from the provided changed files list.',
    '- Order groups in the order they should be committed.',
    '- dependsOn is optional and uses 1-based group indexes, not ids or titles.',
    '- Keep commit messages imperative, specific, and suitable for git commit subjects.',
    '- Separate generated files, docs, tests, migrations, and implementation only when that produces a clearer reviewable history.',
    '- Do not split files that must be committed together for the repository to stay coherent.',
    '- Rationale explains why the grouping is clean and how dependencies should be applied.',
    '',
    'User instruction:',
    input.agentFix.instruction,
    '',
    'Review:',
    JSON.stringify({
      id: input.review.id,
      title: input.review.title,
      sourceKind: input.review.sourceKind,
      repositoryPath: input.review.repositoryPath,
      revision: input.revision
        ? {
            id: input.revision.id,
            patchHash: input.revision.patchHash,
            fileCount: input.revision.fileCount,
            additions: input.revision.additions,
            deletions: input.revision.deletions,
          }
        : null,
      files,
    }),
  ].join('\n')
}

function buildAgentFixPrompt(input: {
  review: DiffReview
  revision: DiffReviewRevision | null
  agentFix: DiffReviewAgentFix
  thread: DiffReviewThread | null
  comments: DiffReviewComment[]
  files: DiffReviewFile[]
  outputLocale: ReviewOutputLocale
}): string {
  if (input.agentFix.expectedOutput === 'commit') {
    return buildCommitPlanAgentPrompt({
      review: input.review,
      revision: input.revision,
      agentFix: input.agentFix,
      files: input.files,
      outputLocale: input.outputLocale,
    })
  }

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

function parseCommitPlanJson(raw: string): unknown {
  const taggedStart = raw.indexOf(COMMIT_PLAN_ARTIFACT_START)
  const taggedEnd = raw.lastIndexOf(COMMIT_PLAN_ARTIFACT_END)
  if (taggedStart >= 0 && taggedEnd > taggedStart) {
    const tagged = raw.slice(taggedStart + COMMIT_PLAN_ARTIFACT_START.length, taggedEnd).trim()
    const parsed = safeJsonParse(tagged)
    if (parsed) {
      return parsed
    }
    throw new Error('Commit plan artifact is not valid JSON')
  }

  const direct = safeJsonParse(raw.trim())
  if (direct) {
    return direct
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  if (fenced?.[1]) {
    const parsed = safeJsonParse(fenced[1].trim())
    if (parsed) {
      return parsed
    }
  }
  throw new Error(`Commit plan output is missing ${COMMIT_PLAN_ARTIFACT_START}`)
}

function readCommitPlanGroupRecords(parsed: unknown): Record<string, unknown>[] {
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  const rawGroups = Array.isArray(record?.groups) ? record.groups : null
  if (!rawGroups) {
    throw new Error('Commit plan output is missing groups[]')
  }
  return rawGroups.map(rawGroup =>
    rawGroup && typeof rawGroup === 'object' ? (rawGroup as Record<string, unknown>) : {})
}

function readCommitPlanDependencyIndexes(
  value: unknown,
  groupCount: number,
  groupIndex: number,
): number[] {
  if (!Array.isArray(value)) {
    return []
  }
  const indexes = value.flatMap((item): number[] => {
    const index = readPositiveInteger(item)
    return index ? [index] : []
  })
  for (const index of indexes) {
    if (index > groupCount) {
      throw new Error(`Commit plan group ${groupIndex + 1} depends on missing group ${index}`)
    }
    if (index === groupIndex + 1) {
      throw new Error(`Commit plan group ${groupIndex + 1} cannot depend on itself`)
    }
    if (index > groupIndex + 1) {
      throw new Error(`Commit plan group ${groupIndex + 1} can only depend on earlier groups`)
    }
  }
  return [...new Set(indexes)]
}

function normalizeGeneratedCommitPlan(input: {
  parsed: unknown
  revision: DiffReviewRevision
  files: DiffReviewFile[]
}): { groups: ReviewCommitPlanGroupView[], rationale: string } {
  const record
    = input.parsed && typeof input.parsed === 'object'
      ? (input.parsed as Record<string, unknown>)
      : null
  const rationale = readString(record?.rationale)
  if (!rationale) {
    throw new Error('Commit plan output is missing rationale')
  }

  const groupRecords = readCommitPlanGroupRecords(input.parsed)
  const groupIds = groupRecords.map((group, index) => {
    const title = readString(group.title)
    return `commit:${index + 1}-${shortHash(title || `group-${index + 1}`)}`
  })
  const groups: ReviewCommitPlanGroupInput[] = groupRecords.map((group, index) => {
    const title = readString(group.title)
    const message = readString(group.message)
    const groupRationale = readString(group.rationale)
    const fileIds = [...new Set(readStringArray(group.fileIds))]
    if (!title) {
      throw new Error(`Commit plan group ${index + 1} is missing title`)
    }
    if (!message) {
      throw new Error(`Commit plan group ${index + 1} is missing message`)
    }
    if (!groupRationale) {
      throw new Error(`Commit plan group ${index + 1} is missing rationale`)
    }
    const dependsOn = readCommitPlanDependencyIndexes(
      group.dependsOn,
      groupRecords.length,
      index,
    ).map(dependencyIndex => groupIds[dependencyIndex - 1])
    return {
      id: groupIds[index],
      title,
      message,
      rationale: groupRationale,
      fileIds,
      dependsOn,
    }
  })

  const { groups: normalized } = normalizeCommitPlanGroups(input.revision.id, groups)
  return { groups: normalized, rationale }
}

async function createCommitPlanFromAgentOutput(input: {
  review: DiffReview
  revision: DiffReviewRevision
  files: DiffReviewFile[]
  agentFix: DiffReviewAgentFix
  rawOutput: string
}): Promise<DiffReviewCommitPlan> {
  const parsed = parseCommitPlanJson(input.rawOutput)
  const plan = normalizeGeneratedCommitPlan({
    parsed,
    revision: input.revision,
    files: input.files,
  })
  const now = currentUnixSeconds()
  const row = db()
    .insert(diffReviewCommitPlans)
    .values({
      id: randomUUID(),
      reviewId: input.review.id,
      revisionId: input.revision.id,
      actorId: input.agentFix.profileId ?? LOCAL_USER_ID,
      strategy: 'manual',
      status: 'draft',
      groupsJson: jsonStringify(plan.groups),
      rationale: plan.rationale,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  recordEvent({
    reviewId: input.review.id,
    eventKind: 'commit_plan_created',
    actorKind: 'agent',
    actorId: input.agentFix.profileId,
    payload: {
      commitPlanId: row.id,
      agentFixId: input.agentFix.id,
      groupCount: plan.groups.length,
    },
    createdAt: now,
  })
  return row
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
    const run = await ChatRuntime.waitForRunCompletion(input.runId)
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

    if (current.expectedOutput === 'commit') {
      const now = currentUnixSeconds()
      const rawOutput = Session.getRunMessageContents([input.runId])[0]?.content?.trim()
      if (!rawOutput) {
        throw new Error('Commit plan generation completed without assistant output')
      }
      const review = getReviewRow(input.workspaceId, input.reviewId)
      const revision = getCurrentRevision(review)
      const files = db()
        .select()
        .from(diffReviewFiles)
        .where(eq(diffReviewFiles.revisionId, revision.id))
        .orderBy(asc(diffReviewFiles.path))
        .all()
      const artifact = readAgentFixArtifact({
        reviewId: input.reviewId,
        agentFix: {
          ...current,
          sessionId: input.sessionId,
          runId: input.runId,
          updatedAt: now,
        },
      })
      const commitPlan = await createCommitPlanFromAgentOutput({
        review,
        revision,
        files,
        agentFix: current,
        rawOutput,
      })
      db()
        .update(diffReviewAgentFixes)
        .set({
          status: 'completed',
          artifactId: artifact?.id ?? null,
          resultRevisionId: revision.id,
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
          resultRevisionId: revision.id,
          commitPlanId: commitPlan.id,
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
  const outputLocale = normalizeOutputLocale(input.outputLocale)
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
    const session = Session.create({
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
      text: buildAgentFixPrompt({ review, revision, agentFix, thread, comments, files, outputLocale }),
      modelId: input.modelId ?? agentRow?.modelId ?? undefined,
      thinkingEffort: agentRow?.thinkingEffort ?? undefined,
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

export function updateCommitPlan(input: {
  workspaceId: string
  reviewId: string
  commitPlanId: string
  groups?: ReviewCommitPlanGroupInput[]
  rationale?: string
  status?: 'draft' | 'accepted' | 'abandoned'
  userId?: string
}): DiffReviewView {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  const revision = getCurrentRevision(review)
  const plan = getCommitPlanForReview(review.id, input.commitPlanId)
  if (plan.revisionId !== revision.id) {
    throw new AppError({
      code: 'diff_review_commit_plan_revision_stale',
      status: 409,
      message: 'Diff review commit plan cannot be edited after the review revision changes',
      details: {
        reviewId: review.id,
        commitPlanId: plan.id,
        planRevisionId: plan.revisionId,
        currentRevisionId: revision.id,
      },
    })
  }
  if (plan.status === 'applied') {
    throw new AppError({
      code: 'diff_review_commit_plan_applied',
      status: 409,
      message: 'Diff review commit plan has already been applied',
      details: { reviewId: review.id, commitPlanId: plan.id },
    })
  }

  const groups = input.groups
    ? normalizeCommitPlanGroups(plan.revisionId, input.groups).groups
    : toCommitPlanView(plan).groups
  const now = currentUnixSeconds()
  const userId = input.userId ?? LOCAL_USER_ID
  db()
    .update(diffReviewCommitPlans)
    .set({
      groupsJson: jsonStringify(groups),
      rationale: input.rationale ?? plan.rationale,
      status: input.status ?? plan.status,
      strategy: input.groups ? 'manual' : plan.strategy,
      updatedAt: now,
    })
    .where(eq(diffReviewCommitPlans.id, plan.id))
    .run()

  recordEvent({
    reviewId: review.id,
    eventKind: 'commit_plan_updated',
    actorKind: 'user',
    actorId: userId,
    payload: {
      commitPlanId: plan.id,
      status: input.status ?? plan.status,
      groupCount: groups.length,
      strategy: input.groups ? 'manual' : plan.strategy,
    },
    createdAt: now,
  })
  return loadReviewView(review, { userId })
}

export async function applyCommitPlan(input: {
  workspaceId: string
  reviewId: string
  commitPlanId: string
  idempotencyKey?: string
  userId?: string
}): Promise<DiffReviewView> {
  const review = getReviewRow(input.workspaceId, input.reviewId)
  if (review.sourceKind !== 'local-working-tree') {
    throw new AppError({
      code: 'diff_review_commit_plan_apply_unsupported_source',
      status: 400,
      message: 'Diff review commit plans can only be applied for local working tree reviews',
      details: { reviewId: review.id, sourceKind: review.sourceKind },
    })
  }
  if (!review.sourceId) {
    throw new AppError({
      code: 'diff_review_source_missing',
      status: 409,
      message: 'Diff review source is missing',
      details: { reviewId: review.id },
    })
  }

  const plan = getCommitPlanForReview(review.id, input.commitPlanId)
  if (plan.status === 'applied') {
    return includeCommitPlanInReviewView(loadReviewView(review, { userId: input.userId }), plan)
  }
  const revision = getCurrentRevision(review)
  if (plan.status !== 'accepted') {
    throw new AppError({
      code: 'diff_review_commit_plan_not_accepted',
      status: 409,
      message: 'Diff review commit plan must be accepted before it can be applied',
      details: { reviewId: review.id, commitPlanId: plan.id, status: plan.status },
    })
  }
  if (plan.revisionId !== revision.id) {
    throw new AppError({
      code: 'diff_review_commit_plan_revision_stale',
      status: 409,
      message: 'Diff review commit plan cannot be applied after the review revision changes',
      details: {
        reviewId: review.id,
        commitPlanId: plan.id,
        planRevisionId: plan.revisionId,
        currentRevisionId: revision.id,
      },
    })
  }

  const currentPatch = await Git.getDiff(input.workspaceId, undefined, review.repositoryPath)
  const currentPatchHash = hashText(currentPatch)
  if (currentPatchHash !== revision.patchHash) {
    throw new AppError({
      code: 'diff_review_commit_plan_source_changed',
      status: 409,
      message: 'Diff review commit plan source changed; refresh the review before applying',
      details: {
        reviewId: review.id,
        commitPlanId: plan.id,
        planPatchHash: revision.patchHash,
        currentPatchHash,
      },
    })
  }

  const planView = toCommitPlanView(plan)
  const groups = commitGroupsForPlan(plan.revisionId, planView.groups)
  const idempotencyKey = input.idempotencyKey ?? `commit-plan:${plan.id}:apply`
  const operation = createOrResetSourceOperation({
    sourceId: review.sourceId,
    reviewId: review.id,
    operationKind: 'commit_plan_apply',
    idempotencyKey,
    request: { commitPlanId: plan.id, revisionId: revision.id, groupCount: groups.length },
  })
  if (operation.status === 'succeeded') {
    return includeCommitPlanInReviewView(loadReviewView(review, { userId: input.userId }), plan)
  }

  const userId = input.userId ?? LOCAL_USER_ID
  try {
    const result = await Git.commitFileGroups(input.workspaceId, groups, review.repositoryPath)
    const now = currentUnixSeconds()
    const appliedPlan = db()
      .update(diffReviewCommitPlans)
      .set({
        status: 'applied',
        updatedAt: now,
      })
      .where(eq(diffReviewCommitPlans.id, plan.id))
      .returning()
      .get()
    finishSourceOperation({
      operationId: operation.id,
      status: 'succeeded',
      response: result,
    })
    recordEvent({
      reviewId: review.id,
      eventKind: 'commit_plan_applied',
      actorKind: 'user',
      actorId: userId,
      payload: {
        commitPlanId: plan.id,
        operationId: operation.id,
        commits: result.commits,
      },
      createdAt: now,
    })
    const refreshed = await refreshLocalWorkingTree(input.workspaceId, review.repositoryPath)
    return includeCommitPlanInReviewView(refreshed, appliedPlan)
  }
 catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    finishSourceOperation({
      operationId: operation.id,
      status: 'failed',
      errorMessage: message,
    })
    recordEvent({
      reviewId: review.id,
      eventKind: 'commit_plan_apply_failed',
      actorKind: 'user',
      actorId: userId,
      payload: { commitPlanId: plan.id, operationId: operation.id, errorMessage: message },
    })
    throw error
  }
}
