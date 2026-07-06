import { randomUUID } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Session, Worktree } from '@cradle/db'
import { backendRuns, sessions, workspaces, worktrees } from '@cradle/db'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { parseJsonObjectOrEmpty } from '../../helpers/json-record'
import { db } from '../../infra'
import {
  addGitWorktree,
  addGitWorktreeExistingBranch,
  branchExists,
  deleteLocalBranch,
  getHeadSha,
  isWorkingTreeDirty,
  mergeBranch,
  pruneGitWorktrees,
  removeGitWorktree,
  resolveGitRepoRoot,
  stashAndPopAcrossCheckouts,
} from '../git/worktree-ops'
import * as Workspace from '../workspace/service'
import { ensureWorktreeCheckoutParentDir, resolveWorktreeCheckoutPath } from './worktree-paths'
import type { WorktreeHealth } from './worktree-reconcile'
import {
  assessWorktreeHealthSync,
  reconcileWorktreeRecord,
} from './worktree-reconcile'
import { runWorktreeSetupHooks } from './worktree-setup'
import {
  grantWorktreeSetupHookTrust,
  hasWorktreeSetupHookTrust,
  isRelayHostExposed,
} from './worktree-setup-trust'

const BRANCH_PREFIX = 'cradle/wt/'

export interface WorktreeView {
  id: string
  sourceWorkspaceId: string
  name: string
  path: string
  branch: string
  baseRef: string
  status: 'active' | 'merged' | 'abandoned'
  createdBySessionId: string | null
  createdAt: number
  updatedAt: number
}

export interface ManagedWorktreeView extends WorktreeView {
  workspaceName: string
  sizeBytes: number
  sessionCount: number
}

export interface ManagedWorktreeCleanupResult {
  cleaned: ManagedWorktreeView[]
  skipped: number
  totalSizeBytes: number
}

export interface SessionExecutionRoot {
  rootPath: string
  sourceWorkspaceId: string | null
  worktreeId: string | null
  branch: string | null
  isIsolated: boolean
  worktreeHealth: WorktreeHealth | null
}

export interface SessionIsolationView {
  isIsolated: boolean
  worktreeId: string | null
  worktreeBranch: string | null
  worktreePath: string | null
  worktreeHealth: WorktreeHealth | null
  pendingWorktreeId: string | null
  isolationBoundaryRequired: boolean
}

export type { WorktreeHealth } from './worktree-reconcile'

export interface IssueIsolationContextGroup {
  worktreeId: string
  name: string
  branch: string
  sessionIds: string[]
  sessionTitles: string[]
}

function isSessionStreaming(sessionId: string): boolean {
  const latestRun = db()
    .select({ status: backendRuns.status })
    .from(backendRuns)
    .where(eq(backendRuns.chatSessionId, sessionId))
    .orderBy(desc(backendRuns.startedAt), desc(sql`backend_runs.rowid`))
    .get()
  return latestRun?.status === 'streaming'
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function toWorktreeView(record: Worktree): WorktreeView {
  return {
    id: record.id,
    sourceWorkspaceId: record.sourceWorkspaceId,
    name: record.name,
    path: record.path,
    branch: record.branch,
    baseRef: record.baseRef,
    status: record.status,
    createdBySessionId: record.createdBySessionId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

async function directorySizeBytes(path: string): Promise<number> {
  let entry
  try {
    entry = await lstat(path)
  }
  catch {
    return 0
  }
  if (!entry.isDirectory()) {
    return entry.size
  }

  let total = 0
  let children
  try {
    children = await readdir(path, { withFileTypes: true })
  }
  catch {
    return 0
  }
  for (const child of children) {
    const childPath = join(path, child.name)
    if (child.isDirectory()) {
      total += await directorySizeBytes(childPath)
      continue
    }
    try {
      total += (await lstat(childPath)).size
    }
    catch {
      // The checkout may be changing while Settings is open.
    }
  }
  return total
}

async function toManagedWorktreeView(
  record: Worktree,
  workspaceName: string,
): Promise<ManagedWorktreeView> {
  return {
    ...toWorktreeView(record),
    workspaceName,
    sizeBytes: await directorySizeBytes(record.path),
    sessionCount: countSessionsUsingWorktree(record.id),
  }
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'isolated'
}

export function buildWorktreeName(sessionId: string, slug: string): string {
  return `${sessionId.slice(0, 8)}-${slugify(slug)}`
}

function readIsolationBoundaryConfig(configJson: string): { required: boolean } {
  const config = parseJsonObjectOrEmpty(configJson)
  const boundary = config.isolationBoundary
  if (!boundary || typeof boundary !== 'object') {
    return { required: false }
  }
  return { required: (boundary as { required?: boolean }).required === true }
}

function writeIsolationBoundaryConfig(
  configJson: string,
  boundary: { required: boolean, pendingWorktreeId?: string | null } | null,
): string {
  const config = parseJsonObjectOrEmpty(configJson)
  if (!boundary) {
    delete config.isolationBoundary
  }
  else {
    config.isolationBoundary = boundary
  }
  return JSON.stringify(config)
}

function getWorktreeRecord(id: string): Worktree | null {
  return db().select().from(worktrees).where(eq(worktrees.id, id)).get() ?? null
}

function buildIsolationView(
  session: Session,
  worktreeRecord: Worktree | null,
  health: WorktreeHealth | null,
): SessionIsolationView {
  const boundary = readIsolationBoundaryConfig(session.configJson)
  const isIsolated = !!session.worktreeId && health === 'ok'
  return {
    isIsolated,
    worktreeId: session.worktreeId,
    worktreeBranch: worktreeRecord?.branch ?? null,
    worktreePath: worktreeRecord?.path ?? null,
    worktreeHealth: session.worktreeId ? health : null,
    pendingWorktreeId: session.pendingWorktreeId,
    isolationBoundaryRequired: boundary.required && session.pendingWorktreeId !== null,
  }
}

export function assertIsolationExecutionReady(session: Session): void {
  if (!session.worktreeId) {
    return
  }
  const worktreeRecord = getWorktreeRecord(session.worktreeId)
  const health = assessWorktreeHealthSync(worktreeRecord)
  if (health !== 'ok') {
    throw new AppError({
      code: 'worktree_unavailable',
      status: 409,
      message: 'Isolated checkout is unavailable. Repair or leave isolation before continuing.',
      details: {
        sessionId: session.id,
        worktreeId: session.worktreeId,
        worktreeHealth: health ?? 'missing',
      },
    })
  }
}

export function getWorktree(id: string): WorktreeView | null {
  const record = getWorktreeRecord(id)
  return record ? toWorktreeView(record) : null
}

export function listWorktreesByWorkspace(sourceWorkspaceId: string): WorktreeView[] {
  return db()
    .select()
    .from(worktrees)
    .where(and(eq(worktrees.sourceWorkspaceId, sourceWorkspaceId), eq(worktrees.status, 'active')))
    .all()
    .map(toWorktreeView)
}

export async function listManagedWorktrees(): Promise<{ worktrees: ManagedWorktreeView[], totalSizeBytes: number }> {
  const workspaceNames = new Map(
    db()
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .all()
      .map(workspace => [workspace.id, workspace.name] as const),
  )
  const records = db()
    .select()
    .from(worktrees)
    .where(eq(worktrees.status, 'active'))
    .all()
    .sort((left, right) => right.createdAt - left.createdAt)

  const managed = await Promise.all(records.map(record => toManagedWorktreeView(
    record,
    workspaceNames.get(record.sourceWorkspaceId) ?? record.sourceWorkspaceId,
  )))

  return {
    worktrees: managed,
    totalSizeBytes: managed.reduce((total, worktree) => total + worktree.sizeBytes, 0),
  }
}

export function resolveSessionExecutionRoot(session: Session): SessionExecutionRoot {
  const workspacePath = session.workspaceId
    ? Workspace.getLocalWorkspacePath(session.workspaceId)
    : null
  const base = {
    sourceWorkspaceId: session.workspaceId,
    worktreeId: null as string | null,
    branch: null as string | null,
    isIsolated: false,
    worktreeHealth: null as WorktreeHealth | null,
  }
  if (!session.workspaceId || !workspacePath) {
    return { ...base, rootPath: workspacePath ?? '' }
  }

  if (!session.worktreeId) {
    return { ...base, rootPath: workspacePath }
  }

  const worktreeRecord = getWorktreeRecord(session.worktreeId)
  const health = assessWorktreeHealthSync(worktreeRecord)
  if (!worktreeRecord || health !== 'ok') {
    return {
      ...base,
      rootPath: workspacePath,
      worktreeId: session.worktreeId,
      branch: worktreeRecord?.branch ?? null,
      worktreeHealth: health ?? 'missing',
    }
  }

  return {
    rootPath: worktreeRecord.path,
    sourceWorkspaceId: session.workspaceId,
    worktreeId: worktreeRecord.id,
    branch: worktreeRecord.branch,
    isIsolated: true,
    worktreeHealth: 'ok',
  }
}

export function resolveSessionExecutionRootById(sessionId: string): SessionExecutionRoot | null {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    return null
  }
  return resolveSessionExecutionRoot(session)
}

export function getSessionForIsolation(sessionId: string): Session | null {
  return db().select().from(sessions).where(eq(sessions.id, sessionId)).get() ?? null
}

export function readSessionIsolation(session: Session): SessionIsolationView {
  const worktreeRecord = session.worktreeId ? getWorktreeRecord(session.worktreeId) : null
  const health = session.worktreeId ? assessWorktreeHealthSync(worktreeRecord) : null
  return buildIsolationView(session, worktreeRecord, health)
}

export async function readSessionIsolationAsync(session: Session): Promise<SessionIsolationView> {
  const worktreeRecord = session.worktreeId ? getWorktreeRecord(session.worktreeId) : null
  if (!session.worktreeId || !worktreeRecord) {
    return buildIsolationView(session, worktreeRecord, null)
  }
  const health = await reconcileWorktreeRecord(worktreeRecord)
  return buildIsolationView(session, worktreeRecord, health)
}

async function recreateWorktreeCheckout(worktree: Worktree, workspacePath: string, repoRoot: string): Promise<string> {
  const checkoutPath = resolveWorktreeCheckoutPath(worktree.sourceWorkspaceId, worktree.name)
  ensureWorktreeCheckoutParentDir(checkoutPath)

  const branchExistsOnRepo = await branchExists(repoRoot, worktree.branch)
  if (branchExistsOnRepo) {
    await addGitWorktreeExistingBranch({
      repoPath: repoRoot,
      worktreePath: checkoutPath,
      branch: worktree.branch,
    })
  }
  else {
    await addGitWorktree({
      repoPath: repoRoot,
      worktreePath: checkoutPath,
      branch: worktree.branch,
      baseRef: worktree.baseRef,
    })
  }

  if (checkoutPath !== worktree.path) {
    db().update(worktrees).set({
      path: checkoutPath,
      status: 'active',
      updatedAt: now(),
    }).where(eq(worktrees.id, worktree.id)).run()
  }

  await runWorktreeSetupHooks(workspacePath, checkoutPath, {
    trusted: hasWorktreeSetupHookTrust(worktree.sourceWorkspaceId),
    relayExposed: isRelayHostExposed(),
  })
  return checkoutPath
}

export async function repairSessionWorktree(sessionId: string): Promise<WorktreeView> {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session?.worktreeId || !session.workspaceId) {
    throw new AppError({
      code: 'session_isolation_missing',
      status: 409,
      message: 'Session has no isolated worktree to repair',
    })
  }

  const worktreeRecord = getWorktreeRecord(session.worktreeId)
  if (!worktreeRecord) {
    throw new AppError({ code: 'worktree_not_found', status: 404, message: 'Worktree not found' })
  }

  const health = await reconcileWorktreeRecord(worktreeRecord)
  if (health === 'ok') {
    return toWorktreeView(worktreeRecord)
  }

  const workspacePath = Workspace.getLocalWorkspacePath(session.workspaceId)
  if (!workspacePath) {
    throw new AppError({
      code: 'workspace_local_path_required',
      status: 409,
      message: 'Repair requires a local workspace',
    })
  }

  const repoRoot = await resolveGitRepoRoot(workspacePath)
  await recreateWorktreeCheckout(worktreeRecord, workspacePath, repoRoot)

  const repaired = getWorktree(worktreeRecord.id)
  if (!repaired) {
    throw new AppError({
      code: 'worktree_repair_failed',
      status: 500,
      message: 'Worktree repair did not persist',
    })
  }
  return repaired
}

export async function createWorktree(input: {
  sourceWorkspaceId: string
  sessionId: string
  slug: string
  confirmedSetupHooks?: boolean
}): Promise<WorktreeView> {
  const workspacePath = Workspace.getLocalWorkspacePath(input.sourceWorkspaceId)
  if (!workspacePath) {
    throw new AppError({
      code: 'workspace_local_path_required',
      status: 409,
      message: 'Worktree creation requires a local workspace',
      details: { workspaceId: input.sourceWorkspaceId },
    })
  }

  const repoRoot = await resolveGitRepoRoot(workspacePath)
  const name = buildWorktreeName(input.sessionId, input.slug)
  const branch = `${BRANCH_PREFIX}${name}`
  const absolutePath = resolveWorktreeCheckoutPath(input.sourceWorkspaceId, name)
  const baseRef = await getHeadSha(repoRoot)

  ensureWorktreeCheckoutParentDir(absolutePath)
  await addGitWorktree({
    repoPath: repoRoot,
    worktreePath: absolutePath,
    branch,
    baseRef,
  })
  if (input.confirmedSetupHooks === true) {
    grantWorktreeSetupHookTrust(input.sourceWorkspaceId, 'Confirmed during worktree creation.')
  }
  await runWorktreeSetupHooks(workspacePath, absolutePath, {
    trusted: hasWorktreeSetupHookTrust(input.sourceWorkspaceId),
    relayExposed: isRelayHostExposed(),
  })

  const timestamp = now()
  const id = randomUUID()
  db().insert(worktrees).values({
    id,
    sourceWorkspaceId: input.sourceWorkspaceId,
    name,
    path: absolutePath,
    branch,
    baseRef,
    status: 'active',
    createdBySessionId: input.sessionId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run()

  const created = getWorktree(id)
  if (!created) {
    throw new AppError({
      code: 'worktree_create_failed',
      status: 500,
      message: 'Worktree record was not persisted',
    })
  }
  return created
}

export function attachSessionToWorktree(input: {
  sessionId: string
  worktreeId: string
}): void {
  const worktree = getWorktree(input.worktreeId)
  if (!worktree || worktree.status !== 'active') {
    throw new AppError({ code: 'worktree_not_found', status: 404, message: 'Worktree not found' })
  }
  db().update(sessions).set({
    worktreeId: input.worktreeId,
    pendingWorktreeId: null,
    configJson: writeIsolationBoundaryConfig(
      db().select({ configJson: sessions.configJson }).from(sessions).where(eq(sessions.id, input.sessionId)).get()?.configJson ?? '{}',
      null,
    ),
    updatedAt: now(),
  }).where(eq(sessions.id, input.sessionId)).run()
}

export async function bindSessionWorktree(input: {
  sessionId: string
  worktreeId: string
  pending?: boolean
}): Promise<void> {
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()
  if (!session) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found' })
  }
  const worktree = getWorktree(input.worktreeId)
  if (!worktree || worktree.status !== 'active') {
    throw new AppError({ code: 'worktree_not_found', status: 404, message: 'Worktree not found' })
  }

  db().update(sessions).set({
    ...(input.pending
      ? { pendingWorktreeId: input.worktreeId }
      : { worktreeId: input.worktreeId, pendingWorktreeId: null }),
    updatedAt: now(),
  }).where(eq(sessions.id, input.sessionId)).run()
}

export async function startSessionIsolation(input: {
  sessionId: string
  slug?: string
}): Promise<{ worktree: WorktreeView, pending: boolean }> {
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()
  if (!session?.workspaceId) {
    throw new AppError({
      code: 'session_workspace_required',
      status: 409,
      message: 'Isolation requires a project-bound session',
    })
  }

  const slug = input.slug ?? session.title ?? 'isolated'
  const worktree = await createWorktree({
    sourceWorkspaceId: session.workspaceId,
    sessionId: session.id,
    slug,
  })

  const streaming = isSessionStreaming(session.id)
  // Keep the worktree pending when the session is mid-run OR the main checkout
  // has uncommitted changes. In the dirty-main case the user must decide whether
  // to migrate those changes into the isolated checkout before we switch the
  // session's execution root, so we surface the boundary dialog and hold the
  // worktree in pending state until they choose.
  const workspacePath = Workspace.getLocalWorkspacePath(session.workspaceId)
  const dirty = workspacePath ? await isWorkingTreeDirty(workspacePath) : false
  const pending = streaming || dirty

  await bindSessionWorktree({
    sessionId: session.id,
    worktreeId: worktree.id,
    pending,
  })

  if (dirty && !streaming) {
    // Idle session with a dirty main checkout: surface the boundary dialog
    // immediately. Streaming sessions defer this to evaluateIsolationBoundary
    // (called from the terminal finalizer after the run terminates), and the
    // dialog is suppressed while streaming anyway, so we only set it eagerly
    // for idle sessions — which otherwise never go through the finalizer path
    // and would silently skip the migrate/leave-main choice.
    db().update(sessions).set({
      configJson: writeIsolationBoundaryConfig(session.configJson, {
        required: true,
        pendingWorktreeId: worktree.id,
      }),
      updatedAt: now(),
    }).where(eq(sessions.id, session.id)).run()
  }
  else if (!pending) {
    db().update(sessions).set({
      worktreeId: worktree.id,
      pendingWorktreeId: null,
      updatedAt: now(),
    }).where(eq(sessions.id, session.id)).run()
  }

  return { worktree, pending }
}

export async function evaluateIsolationBoundary(sessionId: string): Promise<void> {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session?.pendingWorktreeId || !session.workspaceId) {
    return
  }

  const workspacePath = Workspace.getLocalWorkspacePath(session.workspaceId)
  if (!workspacePath) {
    return
  }

  const dirty = await isWorkingTreeDirty(workspacePath)
  if (!dirty) {
    db().update(sessions).set({
      worktreeId: session.pendingWorktreeId,
      pendingWorktreeId: null,
      configJson: writeIsolationBoundaryConfig(session.configJson, null),
      updatedAt: now(),
    }).where(eq(sessions.id, sessionId)).run()
    return
  }

  db().update(sessions).set({
    configJson: writeIsolationBoundaryConfig(session.configJson, {
      required: true,
      pendingWorktreeId: session.pendingWorktreeId,
    }),
    updatedAt: now(),
  }).where(eq(sessions.id, sessionId)).run()
}

export async function activateSessionIsolation(input: {
  sessionId: string
  mode: 'migrate' | 'leave-main' | 'cancel'
}): Promise<void> {
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()
  if (!session) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found' })
  }

  const pendingWorktreeId = session.pendingWorktreeId
  if (!pendingWorktreeId) {
    if (input.mode === 'leave-main' || input.mode === 'cancel') {
      return
    }
    throw new AppError({
      code: 'isolation_pending_missing',
      status: 409,
      message: 'No pending isolation to activate',
    })
  }

  const pendingWorktree = getWorktree(pendingWorktreeId)
  if (!pendingWorktree) {
    throw new AppError({ code: 'worktree_not_found', status: 404, message: 'Pending worktree not found' })
  }

  if (input.mode === 'cancel' || input.mode === 'leave-main') {
    db().update(sessions).set({
      pendingWorktreeId: null,
      configJson: writeIsolationBoundaryConfig(session.configJson, null),
      updatedAt: now(),
    }).where(eq(sessions.id, session.id)).run()
    return
  }

  const workspacePath = session.workspaceId ? Workspace.getLocalWorkspacePath(session.workspaceId) : null
  if (!workspacePath) {
    throw new AppError({
      code: 'workspace_local_path_required',
      status: 409,
      message: 'Migration requires a local workspace path',
    })
  }

  const result = await stashAndPopAcrossCheckouts({
    mainRepoPath: workspacePath,
    worktreePath: pendingWorktree.path,
    message: `cradle-isolate:${session.id}:${pendingWorktree.id}`,
  })

  if (result.conflict) {
    throw new AppError({
      code: 'isolation_migration_conflict',
      status: 409,
      message: 'Failed to migrate uncommitted changes into the isolated checkout',
    })
  }

  db().update(sessions).set({
    worktreeId: pendingWorktreeId,
    pendingWorktreeId: null,
    configJson: writeIsolationBoundaryConfig(session.configJson, null),
    updatedAt: now(),
  }).where(eq(sessions.id, session.id)).run()
}

export function leaveSessionIsolation(sessionId: string): void {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    return
  }
  db().update(sessions).set({
    worktreeId: null,
    pendingWorktreeId: null,
    configJson: writeIsolationBoundaryConfig(session.configJson, null),
    updatedAt: now(),
  }).where(eq(sessions.id, sessionId)).run()
}

export async function cleanupWorktree(input: {
  worktreeId: string
  mode: 'merge-and-close' | 'abandon'
  targetBranch?: string
}): Promise<void> {
  const worktree = db().select().from(worktrees).where(eq(worktrees.id, input.worktreeId)).get()
  if (!worktree) {
    throw new AppError({ code: 'worktree_not_found', status: 404, message: 'Worktree not found' })
  }

  const workspacePath = Workspace.getLocalWorkspacePath(worktree.sourceWorkspaceId)
  if (!workspacePath) {
    throw new AppError({
      code: 'workspace_local_path_required',
      status: 409,
      message: 'Cleanup requires a local workspace',
    })
  }

  const repoRoot = await resolveGitRepoRoot(workspacePath)

  if (input.mode === 'merge-and-close') {
    await mergeBranch(workspacePath, worktree.branch)
    await removeGitWorktree({ repoPath: repoRoot, worktreePath: worktree.path })
    await deleteLocalBranch(repoRoot, worktree.branch).catch(() => undefined)
    db().update(worktrees).set({ status: 'merged', updatedAt: now() }).where(eq(worktrees.id, worktree.id)).run()
  }
  else {
    await removeGitWorktree({ repoPath: repoRoot, worktreePath: worktree.path, force: true })
    await deleteLocalBranch(repoRoot, worktree.branch).catch(() => undefined)
    db().update(worktrees).set({ status: 'abandoned', updatedAt: now() }).where(eq(worktrees.id, worktree.id)).run()
  }

  const boundSessions = db()
    .select({ id: sessions.id })
    .from(sessions)
    .where(inArray(sessions.worktreeId, [worktree.id]))
    .all()
  for (const bound of boundSessions) {
    leaveSessionIsolation(bound.id)
  }
}

export async function cleanupManagedWorktrees(input: {
  maxWorktrees: number
  maxTotalSizeGb: number
}): Promise<ManagedWorktreeCleanupResult> {
  const initial = await listManagedWorktrees()
  const candidates = [...initial.worktrees].sort((left, right) => left.createdAt - right.createdAt)
  const countLimit = input.maxWorktrees > 0
    ? input.maxWorktrees
    : Number.POSITIVE_INFINITY
  const sizeLimitBytes = input.maxTotalSizeGb > 0
    ? input.maxTotalSizeGb * 1024 * 1024 * 1024
    : Number.POSITIVE_INFINITY

  const cleaned: ManagedWorktreeView[] = []
  let skipped = 0
  let remainingCount = initial.worktrees.length
  let remainingSizeBytes = initial.totalSizeBytes

  for (const candidate of candidates) {
    const exceedsCount = remainingCount > countLimit
    const exceedsSize = remainingSizeBytes > sizeLimitBytes
    if (!exceedsCount && !exceedsSize) {
      break
    }

    if (candidate.sessionCount > 0) {
      skipped += 1
      continue
    }

    await cleanupWorktree({ worktreeId: candidate.id, mode: 'abandon' })
    cleaned.push(candidate)
    remainingCount -= 1
    remainingSizeBytes = Math.max(0, remainingSizeBytes - candidate.sizeBytes)
  }

  return {
    cleaned,
    skipped,
    totalSizeBytes: (await listManagedWorktrees()).totalSizeBytes,
  }
}

export function countSessionsUsingWorktree(worktreeId: string): number {
  return db()
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.worktreeId, worktreeId))
    .all()
    .length
}

export function getIssueIsolationContext(issueId: string): IssueIsolationContextGroup[] {
  const rows = db()
    .select({
      sessionId: sessions.id,
      title: sessions.title,
      worktreeId: sessions.worktreeId,
    })
    .from(sessions)
    .where(and(eq(sessions.linkedIssueId, issueId), isNotNull(sessions.worktreeId)))
    .all()

  const groups = new Map<string, IssueIsolationContextGroup>()
  for (const row of rows) {
    if (!row.worktreeId) {
      continue
    }
    const worktree = getWorktree(row.worktreeId)
    if (!worktree) {
      continue
    }
    const existing = groups.get(row.worktreeId)
    if (existing) {
      existing.sessionIds.push(row.sessionId)
      existing.sessionTitles.push(row.title)
      continue
    }
    groups.set(row.worktreeId, {
      worktreeId: row.worktreeId,
      name: worktree.name,
      branch: worktree.branch,
      sessionIds: [row.sessionId],
      sessionTitles: [row.title],
    })
  }
  return Array.from(groups.values())
}

export async function pruneWorkspaceWorktrees(sourceWorkspaceId: string): Promise<void> {
  const workspacePath = Workspace.getLocalWorkspacePath(sourceWorkspaceId)
  if (!workspacePath) {
    return
  }
  const repoRoot = await resolveGitRepoRoot(workspacePath)
  await pruneGitWorktrees(repoRoot)
}
