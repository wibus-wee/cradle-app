import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import type { Work } from '@cradle/db'
import { sessions, works, workThreads } from '@cradle/db'
import { and, desc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import {
  hasPendingRuntimeToolApproval,
  listSessionIdsWithPendingRuntimeToolApproval,
} from '../chat-runtime/pending-tool-approval'
import { listPendingRuntimeUserInputSummaries } from '../chat-runtime/pending-user-input'
import type { CreateRunResult } from '../chat-runtime/run/run-coordinator'
import * as ChatRuntime from '../chat-runtime/runtime'
import {
  listDurableProviderRuntimeBindingsByChatSessionIds,
  readDurableProviderRuntimeBinding,
} from '../provider-runtime/service'
import { buildWorkPullRequestBody } from '../pull-request/pr-body'
import * as PullRequest from '../pull-request/service'
import * as Session from '../session/service'
import * as SessionAwait from '../session-await/service'
import type { SessionAwaitSource } from '../session-await/types'
import * as Workspace from '../workspace/service'
import * as Worktree from '../worktree/service'
import type { WorkDeliveryState, WorkProjection, WorkRecovery, WorkStateExplanation } from './projection'
import {
  deriveWorkProjection,
} from './projection'

export type WorkActivity = 'idle' | 'running' | 'waiting' | 'blocked'
export const WORK_LIST_DEFAULT_LIMIT = 100
export const WORK_LIST_MAX_LIMIT = 200
export type WorkView = Omit<Work, 'acceptanceCriteriaJson'> & {
  acceptanceCriteria: string[]
}
export type WorkSummary = WorkView & {
  workspaceId: string
  primarySessionId: string
  activity: WorkActivity
  pullRequest: PullRequest.SessionPullRequestView | null
  state: WorkDeliveryState
  stateSinceAt: number
  stateExplanation: WorkStateExplanation
  recovery: WorkRecovery
}
export interface WorkPage {
  items: WorkSummary[]
  nextCursor: string | null
}
export interface WorkListInput {
  workspaceId?: string
  linkedIssueId?: string
  archived?: boolean
  cursor?: string
  limit?: number
}

interface WorkListCursor {
  updatedAt: number
  createdAt: number
  id: string
}
export interface WorkDetail {
  work: WorkView
  primaryThread: Session.SessionView
  execution: Worktree.SessionIsolationView
  readiness: PullRequest.PullRequestReadiness
  pullRequest: PullRequest.SessionPullRequestView | null
  activity: WorkActivity
  state: WorkDeliveryState
  stateSinceAt: number
  stateExplanation: WorkStateExplanation
  recovery: WorkRecovery
  initialRun?: CreateRunResult
}

export type WorkAttentionCategory
  = | 'approve_or_answer'
    | 'handle_failure'
    | 'review_work'
    | 'merge_or_archive'

export type WorkAttentionRisk = 'low' | 'medium' | 'high'

export interface WorkAttentionItem {
  id: string
  category: WorkAttentionCategory
  risk: WorkAttentionRisk
  workId: string
  workTitle: string
  workspaceId: string
  sessionId: string
  runtimeKind: string
  providerTargetId: string | null
  agentId: string | null
  state: WorkDeliveryState
  stateSinceAt: number
  waitingSeconds: number
  reason: string
  authority: WorkStateExplanation['authority']
  nextAction: string
  recovery: WorkRecovery
}

type SessionCreateInput = Parameters<typeof Session.create>[0]
export type CreateWorkInput = Omit<
  SessionCreateInput,
  'id' | 'workspaceId' | 'title' | 'origin' | 'linkedIssueId' | 'sessionGroupId' | 'worktreeId'
> & {
  workspaceId: string
  title: string
  goal?: string
  objective?: string
  acceptanceCriteria?: string[]
  linkedIssueId?: string | null
  /**
   * Exact local or remote branch ref to use as the isolation base.
   * When omitted, the current workspace HEAD is used.
   */
  baseBranch?: string
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function nextTimestampAfter(...values: Array<number | null | undefined>): number {
  return Math.max(now(), ...values.map(value => (value ?? 0) + 1))
}

function getWorkRow(id: string): Work | null {
  return db().select().from(works).where(eq(works.id, id)).get() ?? null
}

function getPrimarySessionId(workId: string): string | null {
  return db()
    .select({ sessionId: workThreads.sessionId })
    .from(workThreads)
    .where(and(eq(workThreads.workId, workId), eq(workThreads.role, 'primary')))
    .get()
    ?.sessionId ?? null
}

function requireWork(id: string): Work {
  const work = getWorkRow(id)
  if (!work) {
    throw new AppError({ code: 'work_not_found', status: 404, message: 'Work not found' })
  }
  return work
}

function requirePrimaryThread(workId: string): Session.SessionView {
  const sessionId = getPrimarySessionId(workId)
  const session = sessionId ? Session.get(sessionId) : null
  if (!session) {
    throw new AppError({
      code: 'work_primary_thread_missing',
      status: 500,
      message: 'Work primary Session is missing',
      details: { workId, sessionId },
    })
  }
  return session
}

async function archiveWorkForPrimarySession(sessionId: string): Promise<void> {
  const membership = db()
    .select({ workId: workThreads.workId })
    .from(workThreads)
    .where(and(eq(workThreads.sessionId, sessionId), eq(workThreads.role, 'primary')))
    .get()
  if (!membership) {
    return
  }

  const session = Session.get(sessionId)
  const worktreeId = session?.worktreeId ?? session?.pendingWorktreeId
  if (worktreeId) {
    await Worktree.cleanupWorktree({ worktreeId, mode: 'abandon' })
  }

  const timestamp = now()
  db().update(works).set({
    archivedAt: timestamp,
    updatedAt: timestamp,
  }).where(eq(works.id, membership.workId)).run()
}

Session.onSessionArchiving(archiveWorkForPrimarySession)

function readAcceptanceCriteria(work: Work): string[] {
  try {
    const parsed = JSON.parse(work.acceptanceCriteriaJson)
    return Array.isArray(parsed)
      ? parsed.filter((criterion): criterion is string => typeof criterion === 'string')
      : []
  }
  catch {
    return []
  }
}

function projectWorkView(work: Work, primaryThread: Session.SessionView): WorkView {
  const { acceptanceCriteriaJson: _acceptanceCriteriaJson, ...record } = work
  const title = primaryThread.title?.trim()
  return {
    ...record,
    title: title || work.title,
    acceptanceCriteria: readAcceptanceCriteria(work),
  }
}

export function deriveActivity(input: {
  sessionStatus: Session.SessionStatus
  worktreeHealth: Worktree.WorktreeHealth | null
  awaiting: boolean
  waitingForInteraction: boolean
}): WorkActivity {
  if (input.worktreeHealth !== 'ok' || input.sessionStatus === 'error') {
    return 'blocked'
  }
  if (input.awaiting || input.waitingForInteraction) {
    return 'waiting'
  }
  if (input.sessionStatus === 'streaming') {
    return 'running'
  }
  return 'idle'
}

interface WorkSignals {
  awaiting: boolean
  awaitPrimarySource: string | null
  awaitReason: string | null
  pendingUserInput: ReturnType<typeof listPendingRuntimeUserInputSummaries>[number] | null
  hasPendingUserInput: boolean
  pendingToolApproval: boolean
  hasActiveRun: boolean
  hasDurableProviderBinding: boolean
}

function readWorkSignals(session: Session.SessionView): WorkSignals {
  const awaitSummary = SessionAwait.getSessionSummary(session.id)
  const pendingUserInput = listPendingRuntimeUserInputSummaries({ sessionId: session.id })[0] ?? null
  return {
    awaiting: awaitSummary.awaiting,
    awaitPrimarySource: awaitSummary.primarySource,
    awaitReason: awaitSummary.reason,
    pendingUserInput,
    hasPendingUserInput: pendingUserInput !== null,
    pendingToolApproval: hasPendingRuntimeToolApproval(session.id),
    hasActiveRun: ChatRuntime.getActiveSessionRun(session.id) !== null,
    hasDurableProviderBinding: readDurableProviderRuntimeBinding(session.id) !== undefined,
  }
}

function readActivity(
  session: Session.SessionView,
  signals: WorkSignals = readWorkSignals(session),
): WorkActivity {
  return deriveActivity({
    sessionStatus: session.status,
    worktreeHealth: session.worktreeHealth,
    awaiting: signals.awaiting,
    waitingForInteraction: signals.hasPendingUserInput || signals.pendingToolApproval,
  })
}

function projectWorkState(input: {
  work: Work
  primaryThread: Session.SessionView
  pullRequest: PullRequest.SessionPullRequestView | null
  signals?: WorkSignals
}): WorkProjection {
  const signals = input.signals ?? readWorkSignals(input.primaryThread)
  const firstPendingInput = signals.pendingUserInput
  let pendingHumanEvidence: string | null = null
  if (firstPendingInput) {
    pendingHumanEvidence = firstPendingInput.firstQuestion
      ? `The Agent asked: ${firstPendingInput.firstQuestion}`
      : `The Agent requested ${firstPendingInput.providerMethod} input.`
  }
  else if (signals.pendingToolApproval) {
    pendingHumanEvidence = 'The Agent requested approval for a tool call.'
  }
  else if (signals.hasPendingUserInput) {
    pendingHumanEvidence = 'The Agent requested user input.'
  }
  const pendingDependencyEvidence = signals.awaiting
    ? [signals.awaitPrimarySource, signals.awaitReason].filter(Boolean).join(': ') || 'The Agent is waiting for a dependency.'
    : null

  return deriveWorkProjection({
    observedAt: now(),
    workUpdatedAt: input.work.updatedAt,
    sessionUpdatedAt: input.primaryThread.updatedAt,
    archivedAt: input.work.archivedAt,
    sessionArchivedAt: input.primaryThread.archivedAt,
    sessionStatus: input.primaryThread.status,
    worktreeHealth: input.primaryThread.worktreeHealth,
    isIsolated: input.primaryThread.isIsolated,
    hasPersistedSession: true,
    hasDurableProviderBinding: signals.hasDurableProviderBinding,
    hasActiveRun: signals.hasActiveRun,
    pendingHumanInteraction: signals.hasPendingUserInput || signals.pendingToolApproval,
    pendingHumanSinceAt: firstPendingInput?.createdAt ?? null,
    pendingHumanEvidence,
    pendingDependency: signals.awaiting,
    pendingDependencySinceAt: null,
    pendingDependencyEvidence,
    preparedAt: input.work.preparedAt,
    lastSubmittedAt: input.work.lastSubmittedAt,
    pullRequest: input.pullRequest,
  })
}

function toSummary(
  work: Work,
  primaryThread: Session.SessionView,
  pullRequest: PullRequest.SessionPullRequestView | null = PullRequest.getBoundPullRequest(primaryThread.id),
): WorkSummary {
  if (!primaryThread.workspaceId) {
    throw new AppError({
      code: 'work_workspace_missing',
      status: 500,
      message: 'Work primary Session has no workspace',
      details: { workId: work.id, sessionId: primaryThread.id },
    })
  }
  const signals = readWorkSignals(primaryThread)
  const projection = projectWorkState({ work, primaryThread, pullRequest, signals })
  return {
    ...projectWorkView(work, primaryThread),
    workspaceId: primaryThread.workspaceId,
    primarySessionId: primaryThread.id,
    activity: readActivity(primaryThread, signals),
    pullRequest,
    state: projection.state,
    stateSinceAt: projection.stateSinceAt,
    stateExplanation: projection.explanation,
    recovery: projection.recovery,
  }
}

function encodeWorkListCursor(cursor: WorkListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeWorkListCursor(cursor: string): WorkListCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as WorkListCursor
    if (
      !Number.isFinite(value.updatedAt)
      || !Number.isFinite(value.createdAt)
      || typeof value.id !== 'string'
      || value.id.length === 0
    ) {
      throw new Error('invalid cursor fields')
    }
    return value
  }
  catch {
    throw new AppError({
      code: 'invalid_work_cursor',
      status: 400,
      message: 'Work cursor is invalid',
    })
  }
}

function toListSummary(input: {
  work: Work
  primaryThread: Session.SessionView
  awaitingSessionIds: ReadonlySet<string>
  pendingUserInputSessionIds: ReadonlySet<string>
  pendingToolApprovalSessionIds: ReadonlySet<string>
  activeSessionIds: ReadonlySet<string>
  durableBindingSessionIds: ReadonlySet<string>
}): WorkSummary {
  const { work, primaryThread } = input
  if (!primaryThread.workspaceId) {
    throw new AppError({
      code: 'work_workspace_missing',
      status: 500,
      message: 'Work primary Session has no workspace',
      details: { workId: work.id, sessionId: primaryThread.id },
    })
  }
  const signals: WorkSignals = {
    awaiting: input.awaitingSessionIds.has(primaryThread.id),
    awaitPrimarySource: null,
    awaitReason: null,
    pendingUserInput: null,
    hasPendingUserInput: input.pendingUserInputSessionIds.has(primaryThread.id),
    pendingToolApproval: input.pendingToolApprovalSessionIds.has(primaryThread.id),
    hasActiveRun: input.activeSessionIds.has(primaryThread.id),
    hasDurableProviderBinding: input.durableBindingSessionIds.has(primaryThread.id),
  }
  const pullRequest = PullRequest.readBoundPullRequest(primaryThread.configJson)
  const projection = projectWorkState({ work, primaryThread, pullRequest, signals })
  return {
    ...projectWorkView(work, primaryThread),
    workspaceId: primaryThread.workspaceId,
    primarySessionId: primaryThread.id,
    activity: deriveActivity({
      sessionStatus: primaryThread.status,
      worktreeHealth: primaryThread.worktreeHealth,
      awaiting: signals.awaiting,
      waitingForInteraction: signals.hasPendingUserInput || signals.pendingToolApproval,
    }),
    pullRequest,
    state: projection.state,
    stateSinceAt: projection.stateSinceAt,
    stateExplanation: projection.explanation,
    recovery: projection.recovery,
  }
}

export function list(input: WorkListInput = {}): WorkPage {
  const limit = Math.min(Math.max(input.limit ?? WORK_LIST_DEFAULT_LIMIT, 1), WORK_LIST_MAX_LIMIT)
  const cursor = input.cursor ? decodeWorkListCursor(input.cursor) : null
  const predicates = [
    eq(workThreads.role, 'primary'),
    input.workspaceId ? eq(sessions.workspaceId, input.workspaceId) : undefined,
    input.linkedIssueId ? eq(works.linkedIssueId, input.linkedIssueId) : undefined,
    input.archived ? isNotNull(works.archivedAt) : isNull(works.archivedAt),
    cursor
      ? or(
          lt(works.updatedAt, cursor.updatedAt),
          and(eq(works.updatedAt, cursor.updatedAt), lt(works.createdAt, cursor.createdAt)),
          and(
            eq(works.updatedAt, cursor.updatedAt),
            eq(works.createdAt, cursor.createdAt),
            lt(works.id, cursor.id),
          ),
        )
      : undefined,
  ].filter(predicate => predicate !== undefined)
  const rows = db()
    .select({ work: works, primaryThread: sessions })
    .from(works)
    .innerJoin(workThreads, eq(workThreads.workId, works.id))
    .innerJoin(sessions, eq(sessions.id, workThreads.sessionId))
    .where(and(...predicates))
    .orderBy(desc(works.updatedAt), desc(works.createdAt), desc(works.id))
    .limit(limit + 1)
    .all()
  const hasNextPage = rows.length > limit
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows
  const primaryThreads = Session.projectSessionRows(pageRows.map(row => row.primaryThread))
  const primaryThreadById = new Map(primaryThreads.map(thread => [thread.id, thread]))
  const sessionIds = primaryThreads.map(thread => thread.id)
  const awaitingSessionIds = SessionAwait.listAwaitingSessionIds(sessionIds)
  const sessionIdSet = new Set(sessionIds)
  const pendingUserInputSessionIds = new Set(
    listPendingRuntimeUserInputSummaries()
      .map(summary => summary.sessionId)
      .filter(sessionId => sessionIdSet.has(sessionId)),
  )
  const pendingToolApprovalSessionIds = listSessionIdsWithPendingRuntimeToolApproval()
  const activeSessionIds = new Set(
    ChatRuntime.listActiveRunSummaries().map(run => run.sessionId),
  )
  const durableBindingSessionIds = new Set(
    listDurableProviderRuntimeBindingsByChatSessionIds(sessionIds)
      .map(binding => binding.chatSessionId),
  )
  const items = pageRows.flatMap(({ work, primaryThread }) => {
    const projectedThread = primaryThreadById.get(primaryThread.id)
    return projectedThread
      ? [toListSummary({
          work,
          primaryThread: projectedThread,
          awaitingSessionIds,
          pendingUserInputSessionIds,
          pendingToolApprovalSessionIds,
          activeSessionIds,
          durableBindingSessionIds,
        })]
      : []
  })
  const last = pageRows.at(-1)?.work
  return {
    items,
    nextCursor: hasNextPage && last
      ? encodeWorkListCursor({
          updatedAt: last.updatedAt,
          createdAt: last.createdAt,
          id: last.id,
        })
      : null,
  }
}

export async function get(id: string): Promise<WorkDetail | null> {
  const work = getWorkRow(id)
  if (!work) {
    return null
  }
  const primaryThread = requirePrimaryThread(work.id)
  const [execution, readiness, pullRequest] = await Promise.all([
    Worktree.readSessionIsolationAsync(primaryThread),
    PullRequest.inspectPullRequestReadiness(primaryThread.id),
    PullRequest.getPullRequest(primaryThread.id),
  ])
  const livePrimaryThread = { ...primaryThread, ...execution }
  const signals = readWorkSignals(livePrimaryThread)
  const projection = projectWorkState({
    work,
    primaryThread: livePrimaryThread,
    pullRequest,
    signals,
  })
  return {
    work: projectWorkView(work, primaryThread),
    primaryThread,
    execution,
    readiness,
    pullRequest,
    activity: readActivity(livePrimaryThread, signals),
    state: projection.state,
    stateSinceAt: projection.stateSinceAt,
    stateExplanation: projection.explanation,
    recovery: projection.recovery,
  }
}

function attentionCategoryForState(state: WorkDeliveryState): {
  category: WorkAttentionCategory
  risk: WorkAttentionRisk
} | null {
  switch (state) {
    case 'awaiting_human':
      return { category: 'approve_or_answer', risk: 'medium' }
    case 'failed':
      return { category: 'handle_failure', risk: 'high' }
    case 'unknown':
      return { category: 'handle_failure', risk: 'medium' }
    case 'ready_for_review':
      return { category: 'review_work', risk: 'low' }
    case 'merging':
      return { category: 'merge_or_archive', risk: 'medium' }
    case 'done':
    case 'cancelled':
      return { category: 'merge_or_archive', risk: 'low' }
    default:
      return null
  }
}

const attentionRiskRank: Record<WorkAttentionRisk, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

export async function listAttention(): Promise<WorkAttentionItem[]> {
  const observedAt = now()
  const summaries = list().items
  return summaries
    .flatMap((summary): WorkAttentionItem[] => {
      const attention = attentionCategoryForState(summary.state)
      if (!attention) {
        return []
      }
      const primaryThread = requirePrimaryThread(summary.id)
      return [{
        id: `work:${summary.id}:${attention.category}`,
        category: attention.category,
        risk: attention.risk,
        workId: summary.id,
        workTitle: summary.title,
        workspaceId: summary.workspaceId,
        sessionId: summary.primarySessionId,
        runtimeKind: primaryThread.runtimeKind,
        providerTargetId: primaryThread.providerTargetId,
        agentId: primaryThread.agentId,
        state: summary.state,
        stateSinceAt: summary.stateSinceAt,
        waitingSeconds: Math.max(0, observedAt - summary.stateSinceAt),
        reason: summary.stateExplanation.evidence,
        authority: summary.stateExplanation.authority,
        nextAction: summary.stateExplanation.nextAction,
        recovery: summary.recovery,
      }]
    })
    .sort((left, right) =>
      attentionRiskRank[right.risk] - attentionRiskRank[left.risk]
      || right.waitingSeconds - left.waitingSeconds
      || left.workTitle.localeCompare(right.workTitle))
}

export async function redetect(id: string): Promise<WorkDetail> {
  const detail = await get(id)
  if (!detail) {
    throw new AppError({ code: 'work_not_found', status: 404, message: 'Work not found' })
  }
  return detail
}

export function getBySessionId(sessionId: string): WorkSummary | null {
  const membership = db()
    .select({ workId: workThreads.workId })
    .from(workThreads)
    .where(eq(workThreads.sessionId, sessionId))
    .get()
  if (!membership) {
    return null
  }
  const work = requireWork(membership.workId)
  return toSummary(work, requirePrimaryThread(work.id))
}

export async function create(input: CreateWorkInput): Promise<WorkDetail> {
  const title = input.title.trim()
  const goal = (input.goal ?? input.objective ?? '').trim()
  if (!title || !goal) {
    throw new AppError({
      code: 'invalid_work_input',
      status: 400,
      message: 'Work title and goal are required',
    })
  }

  const baseBranch = input.baseBranch?.trim() || null
  const sourceWorkspace = Workspace.get(input.workspaceId)
  if (!sourceWorkspace) {
    throw new AppError({
      code: 'workspace_not_found',
      status: 404,
      message: 'Workspace not found',
      details: { workspaceId: input.workspaceId },
    })
  }
  if (Workspace.isMultiFolderWorkspace(sourceWorkspace)) {
    throw new AppError({
      code: 'work_multi_folder_unsupported',
      status: 400,
      message: 'Work requires a single-folder local Git workspace. Multi-folder workspaces are for Agent context only.',
      details: { workspaceId: input.workspaceId },
    })
  }
  // An explicit branch never copies uncommitted local files into the managed
  // worktree, so a dirty source checkout is safe. Current HEAD still requires
  // a clean tree so Work does not silently drop or mix WIP.
  if (!baseBranch) {
    await Worktree.assertWorkspaceCleanForManagedIsolation(input.workspaceId)
  }

  const workId = randomUUID()
  let sessionId: string | null = null
  let worktreeId: string | null = null
  let workPersisted = false

  try {
    const {
      baseBranch: _baseBranch,
      title: _title,
      goal: _goal,
      objective: _objective,
      acceptanceCriteria: _acceptanceCriteria,
      linkedIssueId: _linkedIssueId,
      workspaceId: _workspaceId,
      ...sessionInput
    } = input
    const primaryThread = await Session.create({
      ...sessionInput,
      workspaceId: input.workspaceId,
      title,
      origin: 'work',
      linkedIssueId: input.linkedIssueId ?? null,
    })
    sessionId = primaryThread.id

    const worktree = await Worktree.createWorktree({
      sourceWorkspaceId: input.workspaceId,
      sessionId,
      slug: title,
      baseBranch: baseBranch ?? undefined,
    })
    worktreeId = worktree.id
    await Worktree.bindSessionWorktree({ sessionId, worktreeId, pending: false })

    const timestamp = now()
    db().transaction((tx) => {
      tx.insert(works).values({
        id: workId,
        title,
        objective: goal,
        acceptanceCriteriaJson: JSON.stringify(
          (input.acceptanceCriteria ?? []).map(criterion => criterion.trim()).filter(Boolean),
        ),
        linkedIssueId: input.linkedIssueId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run()
      tx.insert(workThreads).values({
        workId,
        sessionId: sessionId!,
        role: 'primary',
        createdAt: timestamp,
      }).run()
    })
    workPersisted = true

    const initialRun = await ChatRuntime.createRun({
      sessionId,
      text: goal,
    })

    const detail = await get(workId)
    if (!detail) {
      throw new AppError({
        code: 'work_create_failed',
        status: 500,
        message: 'Work was not available after creation',
      })
    }
    return { ...detail, initialRun }
  }
  catch (error) {
    const compensationErrors: string[] = []
    if (workPersisted) {
      try {
        db().delete(works).where(eq(works.id, workId)).run()
      }
      catch (compensationError) {
        compensationErrors.push(String(compensationError))
      }
    }
    if (worktreeId) {
      try {
        await Worktree.cleanupWorktree({ worktreeId, mode: 'abandon' })
      }
      catch (compensationError) {
        compensationErrors.push(String(compensationError))
      }
    }
    if (sessionId) {
      try {
        await Session.remove(sessionId)
      }
      catch (compensationError) {
        compensationErrors.push(String(compensationError))
      }
    }
    if (compensationErrors.length > 0) {
      throw new AppError({
        code: 'work_create_compensation_failed',
        status: 500,
        message: 'Work creation failed and cleanup was incomplete',
        details: {
          originalError: error instanceof Error ? error.message : String(error),
          compensationErrors,
        },
      })
    }
    throw error
  }
}

export async function setArchived(input: { id: string, archived: boolean }): Promise<WorkDetail> {
  const work = requireWork(input.id)
  const primaryThread = requirePrimaryThread(work.id)
  await Session.setArchived({ id: primaryThread.id, archived: input.archived })
  if (!input.archived) {
    const timestamp = now()
    db().update(works).set({
      archivedAt: null,
      updatedAt: timestamp,
    }).where(eq(works.id, work.id)).run()
  }
  return (await get(work.id))!
}

function assertReadyForDelivery(readiness: PullRequest.PullRequestReadiness): void {
  if (!readiness.isolated) {
    throw new AppError({
      code: 'work_isolation_unavailable',
      status: 409,
      message: 'Work requires a healthy isolated checkout before delivery',
    })
  }
  if (!readiness.clean) {
    throw new AppError({
      code: 'work_checkout_dirty',
      status: 409,
      message: 'Commit or discard all Work changes before preparing delivery',
      details: { changedFiles: readiness.changedFiles },
    })
  }
  if (readiness.commitsAhead <= 0) {
    throw new AppError({
      code: 'work_no_commits',
      status: 409,
      message: 'Work has no committed changes ahead of its base',
    })
  }
}

export async function prepare(input: {
  id: string
  title: string
  summary: string
  testPlan: string
}): Promise<WorkDetail> {
  const work = requireWork(input.id)
  const primaryThread = requirePrimaryThread(work.id)
  const readiness = await PullRequest.inspectPullRequestReadiness(primaryThread.id)
  assertReadyForDelivery(readiness)
  const title = requireHandoffValue(input.title, 'title')
  const summary = requireHandoffValue(input.summary, 'summary')
  const testPlan = requireHandoffValue(input.testPlan, 'testPlan')
  const body = buildWorkPullRequestBody({ summary, testPlan })

  const existing = await PullRequest.getPullRequest(primaryThread.id)
  const hasOpenPR = existing !== null && existing.state === 'open' && !existing.merged

  if (hasOpenPR) {
    const updated = await PullRequest.updatePullRequest({
      sessionId: primaryThread.id,
      title,
      body,
    })
    const pr = {
      owner: updated.owner,
      repo: updated.repo,
      number: updated.number,
      headSha: requirePullRequestHeadSha(updated),
    }
    await registerWorkAwaits(work.id, primaryThread.id, primaryThread.workspaceId!, pr)
  }

  const preparedAt = nextTimestampAfter(work.preparedAt, work.lastSubmittedAt)
  const lastSubmittedAt = hasOpenPR
    ? nextTimestampAfter(preparedAt, work.lastSubmittedAt)
    : work.lastSubmittedAt
  db().update(works).set({
    handoffTitle: title,
    handoffSummary: summary,
    handoffTestPlan: testPlan,
    preparedAt,
    lastSubmittedAt,
    updatedAt: preparedAt,
  }).where(eq(works.id, work.id)).run()
  return (await get(work.id))!
}

function requireHandoffValue(value: string | null | undefined, field: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new AppError({
      code: 'work_handoff_required',
      status: 409,
      message: 'Prepare a complete Work handoff before submitting',
      details: { field },
    })
  }
  return normalized
}

function requirePullRequestHeadSha(pullRequest: PullRequest.SessionPullRequestView): string {
  if (!pullRequest.headSha) {
    throw new AppError({
      code: 'work_pull_request_head_unavailable',
      status: 502,
      message: 'GitHub did not return the pull request head commit.',
    })
  }
  return pullRequest.headSha
}

async function registerWorkAwaits(
  workId: string,
  sessionId: string,
  workspaceId: string,
  pr: { owner: string, repo: string, number: number, headSha: string },
): Promise<void> {
  const existing = SessionAwait.listBySession(sessionId)
  const viewerOwnsPersonalRepository = await PullRequest.isViewerPersonalRepositoryOwner(pr.owner, pr.repo)
  const ciFilter = JSON.stringify({
    repo: `${pr.owner}/${pr.repo}`,
    pr: pr.number,
    headSha: pr.headSha,
    workId,
  })
  const reviewFilter = JSON.stringify({
    repo: `${pr.owner}/${pr.repo}`,
    pr: pr.number,
    mode: 'approved',
    headSha: pr.headSha,
    workId,
  })

  const desired = [
    { source: 'github-ci', filterJson: ciFilter, reason: `CI checks for PR #${pr.number}` },
    ...(!viewerOwnsPersonalRepository
      ? [{ source: 'github-review' as const, filterJson: reviewFilter, reason: `Review approval for PR #${pr.number}` }]
      : []),
  ] as const

  const pending = existing.filter(row => row.status === 'pending')
  const desiredKeys = new Set(desired.map(item => `${item.source}:${item.filterJson}`))
  const stale: string[] = []
  for (const row of pending) {
    const filter = JSON.parse(row.filterJson) as { repo?: string, pr?: number, workId?: string }
    const belongsToWork = filter.workId === workId
      || (filter.workId === undefined
        && filter.repo === `${pr.owner}/${pr.repo}`
        && filter.pr === pr.number)
    if (belongsToWork
      && (row.source === 'github-ci' || row.source === 'github-review')
      && !desiredKeys.has(`${row.source}:${row.filterJson}`)) {
      stale.push(row.id)
    }
  }

  await Promise.all(desired
    .filter(item => !pending.some(row => row.source === item.source && row.filterJson === item.filterJson))
    .map(item => SessionAwait.register({
      chatSessionId: sessionId,
      workspaceId,
      source: item.source satisfies SessionAwaitSource['source'],
      filterJson: item.filterJson,
      reason: item.reason,
    })))

  for (const awaitId of stale) {
    SessionAwait.cancel(awaitId)
  }
}

export async function renameBranch(input: {
  id: string
  branch: string
}): Promise<WorkDetail> {
  const work = requireWork(input.id)
  const primaryThread = requirePrimaryThread(work.id)

  // Any stored pull request (even closed/merged) pins the old head ref —
  // GitHub cannot PATCH a PR's head branch — so rename is pre-PR only.
  if (PullRequest.getBoundPullRequest(primaryThread.id) !== null) {
    throw new AppError({
      code: 'work_pull_request_exists',
      status: 409,
      message: 'Branch can only be renamed before the first pull request exists.',
    })
  }

  const worktreeRecord = primaryThread.worktreeId
    ? Worktree.getWorktree(primaryThread.worktreeId)
    : null
  if (!worktreeRecord) {
    throw new AppError({
      code: 'work_isolation_unavailable',
      status: 409,
      message: 'Work requires a healthy isolated checkout before delivery',
    })
  }

  if (await PullRequest.isBranchOnRemote(worktreeRecord.path, worktreeRecord.branch)) {
    throw new AppError({
      code: 'work_branch_already_pushed',
      status: 409,
      message: 'The Work branch already exists on the remote and can no longer be renamed.',
    })
  }

  await Worktree.renameWorktreeBranch({
    worktreeId: worktreeRecord.id,
    branch: input.branch,
  })
  return (await get(work.id))!
}

export async function submit(input: {
  id: string
  title?: string
  summary?: string
  testPlan?: string
  base?: string
}): Promise<WorkDetail> {
  const work = requireWork(input.id)
  const primaryThread = requirePrimaryThread(work.id)
  const readiness = await PullRequest.inspectPullRequestReadiness(primaryThread.id)
  assertReadyForDelivery(readiness)

  const title = requireHandoffValue(input.title ?? work.handoffTitle, 'title')
  const summary = requireHandoffValue(input.summary ?? work.handoffSummary, 'summary')
  const testPlan = requireHandoffValue(input.testPlan ?? work.handoffTestPlan, 'testPlan')
  const body = buildWorkPullRequestBody({ summary, testPlan })
  const existing = await PullRequest.getPullRequest(primaryThread.id)
  if (existing && (existing.state !== 'open' || existing.merged)) {
    throw new AppError({
      code: 'work_pull_request_closed',
      status: 409,
      message: 'The Work pull request is closed or merged. Create a new Work for another delivery.',
      details: { pullRequest: existing },
    })
  }

  let pr: { owner: string, repo: string, number: number, headSha: string }
  if (existing) {
    const updated = await PullRequest.updatePullRequest({
      sessionId: primaryThread.id,
      title,
      body,
    })
    pr = {
      owner: updated.owner,
      repo: updated.repo,
      number: updated.number,
      headSha: requirePullRequestHeadSha(updated),
    }
  }
  else {
    const created = await PullRequest.createDraftPullRequest({
      sessionId: primaryThread.id,
      title,
      body,
      base: input.base,
    })
    pr = {
      owner: created.owner,
      repo: created.repo,
      number: created.number,
      headSha: requirePullRequestHeadSha(created),
    }
  }

  await registerWorkAwaits(work.id, primaryThread.id, primaryThread.workspaceId!, pr)

  const timestamp = nextTimestampAfter(work.preparedAt, work.lastSubmittedAt)
  db().update(works).set({
    handoffTitle: title,
    handoffSummary: summary,
    handoffTestPlan: testPlan,
    preparedAt: work.preparedAt ?? timestamp,
    lastSubmittedAt: timestamp,
    updatedAt: timestamp,
  }).where(eq(works.id, work.id)).run()
  return (await get(work.id))!
}
