import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import type { Work } from '@cradle/db'
import { nodeSessionLinks, nodeWorkLinks, sessions, works, workThreads } from '@cradle/db'
import { and, desc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import {
  hasPendingRuntimeToolApproval,
  listSessionIdsWithPendingRuntimeToolApproval,
} from '../chat-runtime/pending-tool-approval'
import { listPendingRuntimeUserInputSummaries } from '../chat-runtime/pending-user-input'
import type { CreateRunResult } from '../chat-runtime/run/run-coordinator'
import * as ChatRuntime from '../chat-runtime/runtime'
import { buildWorkPullRequestBody } from '../pull-request/pr-body'
import * as PullRequest from '../pull-request/service'
import * as NodeSession from '../session/node-projection'
import * as Session from '../session/service'
import * as SessionAwait from '../session-await/service'
import type { SessionAwaitSource } from '../session-await/types'
import * as Workspace from '../workspace/service'
import * as Worktree from '../worktree/service'
import * as NodeWork from './node-projection'

export type WorkActivity = 'idle' | 'running' | 'waiting' | 'blocked'
export const WORK_LIST_DEFAULT_LIMIT = 100
export const WORK_LIST_MAX_LIMIT = 200
export type WorkSummary = Work & {
  workspaceId: string
  primarySessionId: string
  activity: WorkActivity
  pullRequest: PullRequest.SessionPullRequestView | null
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

export interface ReconcileNodeWorksResult {
  workspaceId: string
  nodeId: string
  remoteWorkspaceId: string
  discovered: number
  updated: number
  removed: number
}

interface WorkListCursor {
  updatedAt: number
  createdAt: number
  id: string
}
export interface WorkDetail {
  work: Work
  primaryThread: Session.SessionView
  execution: Worktree.SessionIsolationView
  readiness: PullRequest.PullRequestReadiness
  pullRequest: PullRequest.SessionPullRequestView | null
  activity: WorkActivity
  initialRun?: CreateRunResult
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

function projectConversationTitle(
  work: Work,
  primaryThread: Pick<Session.SessionView, 'title'>,
): Work {
  const title = primaryThread.title?.trim()
  return title && title !== work.title ? { ...work, title } : work
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

function readActivity(session: Session.SessionView): WorkActivity {
  const awaitSummary = SessionAwait.getSessionSummary(session.id)
  const waitingForInteraction = listPendingRuntimeUserInputSummaries({ sessionId: session.id }).length > 0
    || hasPendingRuntimeToolApproval(session.id)
  return deriveActivity({
    sessionStatus: session.status,
    worktreeHealth: session.execution.kind === 'node' ? 'ok' : session.worktreeHealth,
    awaiting: awaitSummary.awaiting,
    waitingForInteraction,
  })
}

function toSummary(work: Work, primaryThread: Session.SessionView): WorkSummary {
  if (!primaryThread.workspaceId) {
    throw new AppError({
      code: 'work_workspace_missing',
      status: 500,
      message: 'Work primary Session has no workspace',
      details: { workId: work.id, sessionId: primaryThread.id },
    })
  }
  return {
    ...projectConversationTitle(work, primaryThread),
    workspaceId: primaryThread.workspaceId,
    primarySessionId: primaryThread.id,
    activity: readActivity(primaryThread),
    pullRequest: PullRequest.getBoundPullRequest(primaryThread.id),
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
  return {
    ...projectConversationTitle(work, primaryThread),
    workspaceId: primaryThread.workspaceId,
    primarySessionId: primaryThread.id,
    activity: deriveActivity({
      sessionStatus: primaryThread.status,
      worktreeHealth: primaryThread.worktreeHealth,
      awaiting: input.awaitingSessionIds.has(primaryThread.id),
      waitingForInteraction:
        input.pendingUserInputSessionIds.has(primaryThread.id)
        || input.pendingToolApprovalSessionIds.has(primaryThread.id),
    }),
    pullRequest: PullRequest.readBoundPullRequest(primaryThread.configJson),
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
  const items = pageRows.flatMap(({ work, primaryThread }) => {
    const projectedThread = primaryThreadById.get(primaryThread.id)
    return projectedThread
      ? [toListSummary({
          work,
          primaryThread: projectedThread,
          awaitingSessionIds,
          pendingUserInputSessionIds,
          pendingToolApprovalSessionIds,
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

export async function listFresh(input: WorkListInput = {}): Promise<WorkPage> {
  if (input.workspaceId) {
    const authority = await NodeWork.resolveNodeWorkAuthority(input.workspaceId)
    if (authority) {
      await reconcileNodeWorksForWorkspace(input.workspaceId, authority)
    }
  }
  return list(input)
}

/** Rebuild the controller's Work projections from one mounted Node authority. */
export async function reconcileNodeWorksForWorkspace(
  workspaceId: string,
  resolvedAuthority?: { nodeId: string, remoteWorkspaceId: string, baseUrl: string },
): Promise<ReconcileNodeWorksResult> {
  const authority = resolvedAuthority ?? await NodeWork.resolveNodeWorkAuthority(workspaceId)
  if (!authority) {
    throw new AppError({
      code: 'node_workspace_required',
      status: 409,
      message: 'Work reconciliation requires a workspace mounted from a Fabric Node.',
      details: { workspaceId },
    })
  }

  await NodeSession.reconcileNodeSessionsForWorkspace(workspaceId)
  const remoteWorksById = new Map<string, WorkSummary>()
  for (const archived of [false, true]) {
    let cursor: string | undefined
    do {
      const page = await NodeWork.listRemoteWorks(authority, {
        archived,
        cursor,
        limit: WORK_LIST_MAX_LIMIT,
      })
      for (const remote of page.items) {
        remoteWorksById.set(remote.id, remote)
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }

  let discovered = 0
  let updated = 0
  for (const remote of remoteWorksById.values()) {
    const localSession = db()
      .select({ id: nodeSessionLinks.localSessionId })
      .from(nodeSessionLinks)
      .where(and(
        eq(nodeSessionLinks.nodeId, authority.nodeId),
        eq(nodeSessionLinks.remoteSessionId, remote.primarySessionId),
      ))
      .get()
    if (!localSession) {
      throw new AppError({
        code: 'node_work_primary_session_missing',
        status: 502,
        message: 'Remote Work primary Session was not projected during reconciliation.',
        details: {
          nodeId: authority.nodeId,
          remoteWorkId: remote.id,
          remoteSessionId: remote.primarySessionId,
        },
      })
    }
    const existing = db()
      .select({ localWorkId: nodeWorkLinks.localWorkId, updatedAt: works.updatedAt })
      .from(nodeWorkLinks)
      .innerJoin(works, eq(works.id, nodeWorkLinks.localWorkId))
      .where(and(
        eq(nodeWorkLinks.nodeId, authority.nodeId),
        eq(nodeWorkLinks.remoteWorkId, remote.id),
      ))
      .get()
    const projectedValues = {
      title: remote.title,
      objective: remote.objective,
      handoffTitle: remote.handoffTitle,
      handoffSummary: remote.handoffSummary,
      handoffTestPlan: remote.handoffTestPlan,
      preparedAt: remote.preparedAt,
      lastSubmittedAt: remote.lastSubmittedAt,
      closedAt: remote.closedAt,
      archivedAt: remote.archivedAt,
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
    }
    if (existing) {
      const primarySessionId = getPrimarySessionId(existing.localWorkId)
      if (existing.updatedAt < remote.updatedAt || primarySessionId !== localSession.id) {
        db().transaction((tx) => {
          tx.update(works).set(projectedValues).where(eq(works.id, existing.localWorkId)).run()
          if (primarySessionId !== localSession.id) {
            tx.delete(workThreads).where(and(
              eq(workThreads.workId, existing.localWorkId),
              eq(workThreads.role, 'primary'),
            )).run()
            tx.insert(workThreads).values({
              workId: existing.localWorkId,
              sessionId: localSession.id,
              role: 'primary',
              createdAt: remote.createdAt,
            }).run()
          }
        })
        updated += 1
      }
      continue
    }

    const localWorkId = randomUUID()
    db().transaction((tx) => {
      tx.insert(works).values({
        id: localWorkId,
        ...projectedValues,
        linkedIssueId: null,
      }).run()
      tx.insert(workThreads).values({
        workId: localWorkId,
        sessionId: localSession.id,
        role: 'primary',
        createdAt: remote.createdAt,
      }).run()
      tx.insert(nodeWorkLinks).values({
        localWorkId,
        nodeId: authority.nodeId,
        remoteWorkId: remote.id,
        remoteWorkspaceId: authority.remoteWorkspaceId,
      }).run()
    })
    discovered += 1
  }

  const staleLocalWorkIds = db()
    .select({ localWorkId: nodeWorkLinks.localWorkId, remoteWorkId: nodeWorkLinks.remoteWorkId })
    .from(nodeWorkLinks)
    .where(and(
      eq(nodeWorkLinks.nodeId, authority.nodeId),
      eq(nodeWorkLinks.remoteWorkspaceId, authority.remoteWorkspaceId),
    ))
    .all()
    .filter(link => !remoteWorksById.has(link.remoteWorkId))
    .map(link => link.localWorkId)
  if (staleLocalWorkIds.length > 0) {
    db().delete(works).where(inArray(works.id, staleLocalWorkIds)).run()
  }

  return {
    workspaceId,
    nodeId: authority.nodeId,
    remoteWorkspaceId: authority.remoteWorkspaceId,
    discovered,
    updated,
    removed: staleLocalWorkIds.length,
  }
}

export async function get(id: string): Promise<WorkDetail | null> {
  const work = getWorkRow(id)
  if (!work) {
    return null
  }
  const nodeLink = NodeWork.getNodeWorkLink(id)
  if (nodeLink) {
    return await projectRemoteDetail(id, await NodeWork.readRemoteWork(nodeLink))
  }
  const primaryThread = requirePrimaryThread(work.id)
  const [execution, readiness, pullRequest] = await Promise.all([
    Worktree.readSessionIsolationAsync(primaryThread),
    PullRequest.inspectPullRequestReadiness(primaryThread.id),
    PullRequest.getPullRequest(primaryThread.id),
  ])
  return {
    work: projectConversationTitle(work, primaryThread),
    primaryThread,
    execution,
    readiness,
    pullRequest,
    activity: readActivity({ ...primaryThread, ...execution }),
  }
}

async function projectRemoteDetail(
  localWorkId: string,
  remote: NodeWork.RemoteWorkDetail,
): Promise<WorkDetail> {
  const link = NodeWork.getNodeWorkLink(localWorkId)
  if (!link) {
    throw new AppError({
      code: 'node_work_link_not_found',
      status: 404,
      message: 'Node Work link was not found for this local projection.',
      details: { workId: localWorkId },
    })
  }
  const localSessionId = getPrimarySessionId(localWorkId)
  if (!localSessionId) {
    throw new AppError({
      code: 'work_primary_thread_missing',
      status: 500,
      message: 'Work primary Session is missing',
      details: { workId: localWorkId },
    })
  }

  db().transaction((tx) => {
    tx.update(works).set({
      title: remote.work.title,
      objective: remote.work.objective,
      handoffTitle: remote.work.handoffTitle,
      handoffSummary: remote.work.handoffSummary,
      handoffTestPlan: remote.work.handoffTestPlan,
      preparedAt: remote.work.preparedAt,
      lastSubmittedAt: remote.work.lastSubmittedAt,
      closedAt: remote.work.closedAt,
      archivedAt: remote.work.archivedAt,
      updatedAt: remote.work.updatedAt,
    }).where(eq(works.id, localWorkId)).run()
    tx.update(sessions).set({
      title: remote.primaryThread.title ?? remote.work.title,
      archivedAt: remote.primaryThread.archivedAt,
      updatedAt: remote.primaryThread.updatedAt,
    }).where(eq(sessions.id, localSessionId)).run()
  })

  const localThread = requirePrimaryThread(localWorkId)
  return {
    work: { ...remote.work, id: localWorkId },
    primaryThread: {
      ...remote.primaryThread,
      id: localSessionId,
      workspaceId: localThread.workspaceId,
      execution: localThread.execution,
    },
    execution: remote.execution,
    readiness: remote.readiness,
    pullRequest: remote.pullRequest,
    activity: remote.activity,
  }
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
  const nodeAuthority = await NodeWork.resolveNodeWorkAuthority(input.workspaceId)
  if (nodeAuthority) {
    return await createNodeWork(input, nodeAuthority)
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

async function createNodeWork(
  input: CreateWorkInput,
  authority: { nodeId: string, remoteWorkspaceId: string, baseUrl: string },
): Promise<WorkDetail> {
  const {
    workspaceId: _workspaceId,
    linkedIssueId: _linkedIssueId,
    ...remoteInput
  } = input
  const remote = await NodeWork.createRemoteWork(authority, remoteInput)
  const localWorkId = randomUUID()
  let localSessionId: string | null = null

  try {
    localSessionId = NodeSession.attachExistingNodeSessionProjection({
      workspaceId: input.workspaceId,
      nodeId: authority.nodeId,
      remoteWorkspaceId: authority.remoteWorkspaceId,
      remoteSession: remote.primaryThread,
      projectionKind: 'controller-created',
    }).localSessionId

    db().transaction((tx) => {
      tx.insert(works).values({
        ...remote.work,
        id: localWorkId,
        linkedIssueId: input.linkedIssueId ?? null,
      }).run()
      tx.insert(workThreads).values({
        workId: localWorkId,
        sessionId: localSessionId!,
        role: 'primary',
        createdAt: remote.work.createdAt,
      }).run()
      tx.insert(nodeWorkLinks).values({
        localWorkId,
        nodeId: authority.nodeId,
        remoteWorkId: remote.work.id,
        remoteWorkspaceId: authority.remoteWorkspaceId,
      }).run()
    })
    return await projectRemoteDetail(localWorkId, remote)
  }
  catch (error) {
    if (localSessionId) {
      db().delete(sessions).where(eq(sessions.id, localSessionId)).run()
    }
    try {
      await NodeWork.mutateRemoteWork({
        localWorkId,
        nodeId: authority.nodeId,
        remoteWorkId: remote.work.id,
        remoteWorkspaceId: authority.remoteWorkspaceId,
        createdAt: remote.work.createdAt,
        updatedAt: remote.work.updatedAt,
      }, 'archive', { archived: true })
    }
    catch {
      // The remote Work remains authoritative and can be reconciled later.
    }
    throw error
  }
}

export async function setArchived(input: { id: string, archived: boolean }): Promise<WorkDetail> {
  const work = requireWork(input.id)
  const nodeLink = NodeWork.getNodeWorkLink(work.id)
  if (nodeLink) {
    return await projectRemoteDetail(work.id, await NodeWork.mutateRemoteWork(
      nodeLink,
      'archive',
      { archived: input.archived },
    ))
  }
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
  const nodeLink = NodeWork.getNodeWorkLink(work.id)
  if (nodeLink) {
    return await projectRemoteDetail(work.id, await NodeWork.mutateRemoteWork(
      nodeLink,
      'prepare',
      { title: input.title, summary: input.summary, testPlan: input.testPlan },
    ))
  }
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
  const nodeLink = NodeWork.getNodeWorkLink(work.id)
  if (nodeLink) {
    return await projectRemoteDetail(work.id, await NodeWork.mutateRemoteWork(
      nodeLink,
      'branch',
      { branch: input.branch },
    ))
  }
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
  const nodeLink = NodeWork.getNodeWorkLink(work.id)
  if (nodeLink) {
    const { id: _id, ...body } = input
    return await projectRemoteDetail(work.id, await NodeWork.mutateRemoteWork(
      nodeLink,
      'submit',
      body,
    ))
  }
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
