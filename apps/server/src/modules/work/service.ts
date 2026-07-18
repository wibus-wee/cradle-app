import { randomUUID } from 'node:crypto'

import type { Work } from '@cradle/db'
import { works, workThreads } from '@cradle/db'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { hasPendingRuntimeToolApproval } from '../chat-runtime/pending-tool-approval'
import { listPendingRuntimeUserInputSummaries } from '../chat-runtime/pending-user-input'
import type { CreateRunResult } from '../chat-runtime/run/run-coordinator'
import * as ChatRuntime from '../chat-runtime/runtime'
import * as PullRequest from '../pull-request/service'
import * as Session from '../session/service'
import * as SessionAwait from '../session-await/service'
import type { SessionAwaitSource } from '../session-await/types'
import * as Worktree from '../worktree/service'

export type WorkActivity = 'idle' | 'running' | 'waiting' | 'blocked'
export type WorkSummary = Work & {
  workspaceId: string
  primarySessionId: string
  activity: WorkActivity
  pullRequest: PullRequest.SessionPullRequestView | null
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
export type WorkBaseStrategy = Worktree.WorkBaseStrategy
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
   * Isolation base selection. Defaults to `source-head` (clean local HEAD).
   * Pass `remote-default` to start from origin's default branch tip even when
   * the source checkout has uncommitted changes.
   */
  baseStrategy?: WorkBaseStrategy
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

function projectConversationTitle(work: Work, primaryThread: Session.SessionView): Work {
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
    worktreeHealth: session.worktreeHealth,
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

export function list(input: {
  workspaceId?: string
  linkedIssueId?: string
  archived?: boolean
} = {}): WorkSummary[] {
  const predicates = [
    input.linkedIssueId ? eq(works.linkedIssueId, input.linkedIssueId) : undefined,
    input.archived ? isNotNull(works.archivedAt) : isNull(works.archivedAt),
  ].filter(predicate => predicate !== undefined)
  const where = predicates.length > 0 ? and(...predicates) : undefined
  const query = db().select().from(works).orderBy(desc(works.updatedAt), desc(works.createdAt))
  const rows = where ? query.where(where).all() : query.all()

  return rows.flatMap((work) => {
    const primaryThread = requirePrimaryThread(work.id)
    if (input.workspaceId && primaryThread.workspaceId !== input.workspaceId) {
      return []
    }
    return [toSummary(work, primaryThread)]
  })
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
  return {
    work: projectConversationTitle(work, primaryThread),
    primaryThread,
    execution,
    readiness,
    pullRequest,
    activity: readActivity({ ...primaryThread, ...execution }),
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

  const baseStrategy: WorkBaseStrategy = input.baseStrategy ?? 'source-head'
  // Remote-default isolation never copies uncommitted local files into the
  // managed worktree, so a dirty source checkout is safe. Source-head still
  // requires a clean tree so Work does not silently drop or mix WIP.
  if (baseStrategy === 'source-head') {
    await Worktree.assertWorkspaceCleanForManagedIsolation(input.workspaceId)
  }

  const workId = randomUUID()
  let sessionId: string | null = null
  let worktreeId: string | null = null
  let workPersisted = false

  try {
    const {
      baseStrategy: _baseStrategy,
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
      baseStrategy,
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

export async function setArchived(input: { id: string, archived: boolean }): Promise<WorkDetail> {
  const work = requireWork(input.id)
  const primaryThread = requirePrimaryThread(work.id)
  const timestamp = now()
  db().update(works).set({
    archivedAt: input.archived ? timestamp : null,
    updatedAt: timestamp,
  }).where(eq(works.id, work.id)).run()
  Session.setArchived({ id: primaryThread.id, archived: input.archived })
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
  const body = `## Summary\n${summary}\n\n## Test plan\n${testPlan}`

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
    { source: 'github-review', filterJson: reviewFilter, reason: `Review approval for PR #${pr.number}` },
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
  const body = `## Summary\n${summary}\n\n## Test plan\n${testPlan}`
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
