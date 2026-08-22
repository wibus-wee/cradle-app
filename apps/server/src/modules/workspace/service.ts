import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import type { Workspace } from '@cradle/db'
import { automationDefinitions, kanbanBoards, sessions, works, workspaces, workThreads, worktrees } from '@cradle/db'
import { desc, eq, inArray } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import type {
  RemoteWorkspaceFileContent,
  RemoteWorkspaceFileEntry,
  RemoteWorkspaceFileInfo,
  RemoteWorkspaceView,
} from '../../http/upstream'
import { proxyUpstreamRequestWithReconnect, upstreamJsonWithReconnect } from '../../http/upstream'
import { db, getServerConfig } from '../../infra'
import * as ChatRuntime from '../chat-runtime/runtime'
import type { MigrateIssuesOptions, MigrateIssuesResult } from '../issue/service'
import { migrateIssues } from '../issue/service'
import { assertAppFeatureFlagEnabled, isAppFeatureFlagEnabled } from '../preferences/service'
import { getFabricNodeLinkManager } from '../relay-transport/node-link-manager'
import * as Session from '../session/service'
import * as Worktree from '../worktree/service'
import { subscribeWorkspaceFileChanges } from './file-watch'
import {
  createDirectory,
  createEmptyFile,
  createWorkspaceFileWriteBoundary,
  getWorkspaceFileInfo,
  listFileChildren,
  listFiles,
  readTextFile,
  readWorkspaceFileBytes,
  renameWorkspacePath,
  renderWorkspaceFilePdf,
  searchWorkspaceFiles,
  writeTextFile,
} from './files'
import { probeLocalGitIdentity } from './repo-identity'
import type { WorkspaceGitIdentity, WorkspaceLocator } from './workspace-locator'
import {
  isLocalWorkspaceLocator,
  localWorkspaceLocator,
  readWorkspaceGitIdentityJson,
  readWorkspaceLocatorJson,
  serializeWorkspaceGitIdentity,
  serializeWorkspaceLocator,
} from './workspace-locator'

// ── helpers ──

const NON_ALPHA_RE = /[^A-Z]/g
const AD_HOC_WORKSPACE_ROOT_ENV = 'CRADLE_AD_HOC_WORKSPACE_ROOT'
const MULTI_WORKSPACE_ROOT_ENV = 'CRADLE_MULTI_WORKSPACE_ROOT'
const MULTI_WORKSPACE_CONFIG_FILE = 'cradle-workspace.json'
const WORKSPACE_ENTRY_NAME_RE = /^[\w.-]+$/

export interface MultiFolderWorkspaceFolder {
  name: string
  path: string
}

export interface MultiFolderWorkspaceConfig {
  name: string
  folders: MultiFolderWorkspaceFolder[]
}

export interface WorkspaceView {
  id: string
  name: string
  locator: WorkspaceLocator
  gitIdentity: WorkspaceGitIdentity
  identifier: string
  availability: 'available' | 'missing' | 'remote'
  multiFolder: boolean
  pinned: number
  createdAt: number
  updatedAt: number
}

export interface HistoricalWorkspaceEvidence {
  sourceHostId: string
  workspacePath: string
  gitIdentity?: WorkspaceGitIdentity
}

export type HistoricalWorkspacePlan
  = | {
      kind: 'existing'
      reason: 'exact-path' | 'containing-path' | 'git-identity'
      historicalKey: string
      workspace: WorkspaceView
    }
    | {
      kind: 'create'
      reason: 'available-project-root' | 'offline-historical-root'
      historicalKey: string
      name: string
      locator: WorkspaceLocator
      gitIdentity: WorkspaceGitIdentity
      availability: 'available' | 'missing'
    }

type WorkspaceDb = ReturnType<typeof db>
export type WorkspaceTransaction = Parameters<Parameters<WorkspaceDb['transaction']>[0]>[0]
type WorkspaceWriteDatabase = Pick<WorkspaceDb | WorkspaceTransaction, 'select' | 'insert'>

function generateIdentifier(name: string, database: Pick<WorkspaceWriteDatabase, 'select'> = db()): string {
  const base = name.slice(0, 3).toUpperCase().replace(NON_ALPHA_RE, 'X').padEnd(3, 'X')
  const existing = database.select({ identifier: workspaces.identifier }).from(workspaces).all().map(w => w.identifier)
  if (!existing.includes(base)) {
    return base
  }
  for (let i = 1; i <= 99; i++) {
    const candidate = `${base.slice(0, 2)}${i}`
    if (!existing.includes(candidate)) {
      return candidate
    }
  }
  return base
}

export function list(): WorkspaceView[] {
  return db().select().from(workspaces).orderBy(desc(workspaces.pinned), workspaces.name).all().map(toWorkspaceView)
}

export function get(id: string): WorkspaceView | null {
  const record = getRecord(id)
  return record ? toWorkspaceView(record) : null
}

function getRecord(id: string): Workspace | null {
  return db().select().from(workspaces).where(eq(workspaces.id, id)).get() ?? null
}

export function resolveByLocator(locator: WorkspaceLocator): WorkspaceView | null {
  const locatorJson = serializeWorkspaceLocator(locator)
  const record = db().select().from(workspaces).where(eq(workspaces.locatorJson, locatorJson)).get() ?? null
  return record ? toWorkspaceView(record) : null
}

export function resolveByPath(path: string): WorkspaceView | null {
  // Match addFromDirectory / inspectDirectory absolute-path storage so
  // relative and absolute forms resolve the same workspace.
  return resolveByLocator(localWorkspaceLocator(resolve(path.trim())))
}

export function planHistoricalWorkspace(input: HistoricalWorkspaceEvidence): HistoricalWorkspacePlan {
  const rawPath = input.workspacePath.trim()
  const lexicalPath = input.sourceHostId === 'local' ? resolve(rawPath) : rawPath
  const canonicalPath = canonicalWorkspacePath(input.sourceHostId, rawPath)
  const locator: WorkspaceLocator = {
    nodeId: input.sourceHostId,
    path: canonicalPath,
  }
  const exact = resolveByLocator({
    nodeId: input.sourceHostId,
    path: lexicalPath,
  }) ?? resolveByLocator(locator)
  if (exact) {
    return existingHistoricalWorkspacePlan(exact, 'exact-path')
  }

  const containing = findContainingWorkspace({
    nodeId: input.sourceHostId,
    path: lexicalPath,
  }) ?? findContainingWorkspace(locator)
  if (containing) {
    return existingHistoricalWorkspacePlan(containing, 'containing-path')
  }

  const byGitIdentity = findWorkspaceByGitIdentity(input.sourceHostId, input.gitIdentity)
  if (byGitIdentity) {
    return existingHistoricalWorkspacePlan(byGitIdentity, 'git-identity')
  }

  const available = input.sourceHostId === 'local' && isDirectory(canonicalPath)
  const recoveredPath = available
    ? findHistoricalProjectRoot(canonicalPath, input.gitIdentity?.repoRoot)
    : canonicalPath
  const gitIdentity: WorkspaceGitIdentity = {
    ...input.gitIdentity,
    repoRoot: input.gitIdentity?.repoRoot ?? (available ? recoveredPath : null),
  }
  const historicalKey = historicalWorkspaceKey(input.sourceHostId, recoveredPath, gitIdentity)
  return {
    kind: 'create',
    reason: available ? 'available-project-root' : 'offline-historical-root',
    historicalKey,
    name: basename(recoveredPath) || 'Recovered Workspace',
    locator: {
      nodeId: input.sourceHostId,
      path: recoveredPath,
    },
    gitIdentity,
    availability: available ? 'available' : 'missing',
  }
}

export function recoverHistoricalWorkspace(input: HistoricalWorkspaceEvidence): WorkspaceView {
  const plan = planHistoricalWorkspace(input)
  if (plan.kind === 'existing') {
    return plan.workspace
  }
  const existing = resolveByLocator(plan.locator)
  if (existing) {
    return existing
  }
  try {
    return create({
      name: plan.name,
      locator: plan.locator,
      gitIdentity: plan.gitIdentity,
    })
  }
  catch (error) {
    const concurrent = resolveByLocator(plan.locator)
    if (concurrent) {
      return concurrent
    }
    throw error
  }
}

export function recoverHistoricalWorkspaceInTransaction(
  transaction: WorkspaceTransaction,
  input: HistoricalWorkspaceEvidence,
): WorkspaceView {
  const plan = planHistoricalWorkspace(input)
  if (plan.kind === 'existing') {
    return plan.workspace
  }
  return createWithDatabase(transaction, {
    name: plan.name,
    locator: plan.locator,
    gitIdentity: plan.gitIdentity,
  })
}

export async function relinkWorkspace(id: string, path: string): Promise<WorkspaceView | null> {
  const record = getRecord(id)
  if (!record) {
    return null
  }
  const trimmedPath = path.trim()
  const currentLocator = readWorkspaceLocator(record)
  if (!isLocalWorkspaceLocator(currentLocator)) {
    const remoteWorkspace = await resolveRemoteCradleWorkspace(currentLocator)
    const nextLocator: WorkspaceLocator = {
      ...currentLocator,
      path: trimmedPath,
      sourceWorkspaceId: remoteWorkspace.id,
    }
    assertWorkspaceLocatorAvailable(id, nextLocator)
    const updatedRemoteWorkspace = await nodeUpstreamJson<RemoteWorkspaceView>(
      currentLocator.nodeId,
      remoteWorkspacePath(remoteWorkspace.id, '/location'),
      jsonRequestInit('PATCH', { path: trimmedPath }),
    )
    const updatedLocator: WorkspaceLocator = {
      ...nextLocator,
      path: updatedRemoteWorkspace.locator.path,
    }
    assertWorkspaceLocatorAvailable(id, updatedLocator)
    const updated = db().update(workspaces).set({
      locatorJson: serializeWorkspaceLocator(updatedLocator),
      gitIdentityJson: serializeWorkspaceGitIdentity(updatedRemoteWorkspace.gitIdentity),
      updatedAt: Math.floor(Date.now() / 1000),
    }).where(eq(workspaces.id, id)).returning().get()
    return updated ? toWorkspaceView(updated) : null
  }

  if (!isDirectory(trimmedPath)) {
    throw new AppError({
      code: 'workspace_location_not_found',
      status: 400,
      message: 'Workspace location must be an existing directory',
      details: { path: trimmedPath },
    })
  }
  const nextLocator = localWorkspaceLocator(canonicalWorkspacePath('local', trimmedPath))
  assertWorkspaceLocatorAvailable(id, nextLocator)
  const gitIdentity = readWorkspaceGitIdentity(record)
  const probed = await probeLocalGitIdentity(nextLocator.path)
  const updated = db().update(workspaces).set({
    locatorJson: serializeWorkspaceLocator(nextLocator),
    gitIdentityJson: serializeWorkspaceGitIdentity({
      originUrl: gitIdentity.originUrl ?? probed.originUrl ?? null,
      repoRoot: findHistoricalProjectRoot(nextLocator.path, gitIdentity.repoRoot ?? probed.repoRoot),
      headSha: probed.headSha ?? gitIdentity.headSha ?? null,
      branch: probed.branch ?? gitIdentity.branch ?? null,
    }),
    updatedAt: Math.floor(Date.now() / 1000),
  }).where(eq(workspaces.id, id)).returning().get()
  return updated ? toWorkspaceView(updated) : null
}

export async function addFromDirectory(path: string): Promise<WorkspaceView> {
  const absolutePath = resolve(path.trim())
  if (!isDirectory(absolutePath)) {
    throw new AppError({
      code: 'workspace_location_not_found',
      status: 400,
      message: 'Workspace location must be an existing directory',
      details: { path: absolutePath },
    })
  }
  // Probe the git identity up-front so every import path below (existing
  // backfill, single-folder create) can attach cross-machine repo identity.
  const probedIdentity = await probeLocalGitIdentity(absolutePath)
  const configPath = join(absolutePath, MULTI_WORKSPACE_CONFIG_FILE)
  // Recognize a cradle-workspace.json and route to the multi-folder import — but
  // only when the experimental feature flag is on. When the flag is off we fall
  // back to a plain single-folder import instead of blocking the user: the mere
  // presence of an experimental artifact must not break the basic "add this
  // folder" action. The recognition is surfaced up-front via inspectDirectory.
  if (existsSync(configPath) && isAppFeatureFlagEnabled('multiWorkspacePoc')) {
    const existingMulti = resolveByPath(absolutePath)
    if (existingMulti) {
      return existingMulti
    }
    return createMultiFolderWorkspaceFromConfigPath(configPath)
  }

  // Idempotent open/import path: re-importing an already-registered directory
  // returns the existing workspace instead of 409, so CLI `cradle open .` can
  // safely ensure-then-open without a separate resolve round-trip.
  const existing = resolveByPath(absolutePath)
  if (existing) {
    return backfillGitIdentity(existing, probedIdentity)
  }
  return create({
    name: basename(absolutePath),
    locator: localWorkspaceLocator(absolutePath),
    ...(hasGitIdentity(probedIdentity) ? { gitIdentity: probedIdentity } : {}),
  })
}

function hasGitIdentity(identity: WorkspaceGitIdentity): boolean {
  return Boolean(identity.originUrl || identity.repoRoot || identity.headSha || identity.branch)
}

/**
 * Upgrade an already-registered workspace with a freshly probed git identity.
 * Only fills fields the stored identity is missing — never overwrites user-
 * visible values that were set from an authoritative source earlier.
 */
function backfillGitIdentity(workspace: WorkspaceView, probed: WorkspaceGitIdentity): WorkspaceView {
  if (!hasGitIdentity(probed)) {
    return workspace
  }
  const current = workspace.gitIdentity
  const merged: WorkspaceGitIdentity = {
    originUrl: current.originUrl ?? probed.originUrl ?? null,
    repoRoot: current.repoRoot ?? probed.repoRoot ?? null,
    headSha: current.headSha ?? probed.headSha ?? null,
    branch: current.branch ?? probed.branch ?? null,
  }
  if (
    merged.originUrl === workspace.gitIdentity.originUrl
    && merged.repoRoot === workspace.gitIdentity.repoRoot
    && merged.branch === workspace.gitIdentity.branch
    && merged.headSha === workspace.gitIdentity.headSha
  ) {
    return workspace
  }
  db().update(workspaces).set({
    gitIdentityJson: serializeWorkspaceGitIdentity(merged),
    updatedAt: Math.floor(Date.now() / 1000),
  }).where(eq(workspaces.id, workspace.id)).run()
  return get(workspace.id) ?? workspace
}

export type DirectoryInspectionAction = 'multi-folder' | 'single-folder'

export interface DirectoryInspection {
  path: string
  /** Whether a cradle-workspace.json was found at the directory root. */
  cradleWorkspaceDetected: boolean
  /** Best-effort parsed config preview (present even when invalid, so the UI can show what's inside). */
  config: MultiFolderWorkspaceConfig | null
  /** Whether the config parsed AND passed full normalization. */
  configValid: boolean
  /** Human-readable reason when the config is present but invalid. */
  configError: string | null
  /** Whether the multiWorkspacePoc feature flag is currently enabled. */
  featureFlagEnabled: boolean
  /** Whether this path is already registered as a workspace. */
  alreadyImported: boolean
  /** What Cradle would do on import: multi-folder only when detected + valid + flag on. */
  recommendedAction: DirectoryInspectionAction
}

/**
 * Read-only probe of a directory. Recognizes a cradle-workspace.json without
 * creating anything, so the UI can surface the recognition and let the user
 * choose how to open it. Never throws for user-data problems (missing/invalid
 * config) — it reports them in the result instead.
 */
export function inspectDirectory(path: string): DirectoryInspection {
  const absolutePath = resolve(path.trim())
  const configPath = join(absolutePath, MULTI_WORKSPACE_CONFIG_FILE)
  const detected = existsSync(configPath)
  const featureFlagEnabled = isAppFeatureFlagEnabled('multiWorkspacePoc')
  const alreadyImported = resolveByPath(absolutePath) !== null

  if (!detected) {
    return {
      path: absolutePath,
      cradleWorkspaceDetected: false,
      config: null,
      configValid: false,
      configError: null,
      featureFlagEnabled,
      alreadyImported,
      recommendedAction: 'single-folder',
    }
  }

  let config: MultiFolderWorkspaceConfig | null = null
  let configValid = false
  let configError: string | null = null
  try {
    const parsed = readMultiFolderWorkspaceConfig(configPath)
    normalizeMultiFolderWorkspaceConfig(parsed)
    config = parsed
    configValid = true
  }
  catch (error) {
    configError = error instanceof Error ? error.message : String(error)
    config = readMultiFolderWorkspaceConfigRaw(configPath)
  }

  return {
    path: absolutePath,
    cradleWorkspaceDetected: true,
    config,
    configValid,
    configError,
    featureFlagEnabled,
    alreadyImported,
    recommendedAction: configValid && featureFlagEnabled ? 'multi-folder' : 'single-folder',
  }
}

export function createAdHocWorkspace(input: { now?: Date } = {}): WorkspaceView {
  const now = input.now ?? new Date()
  const dateSegment = formatLocalDate(now)
  const workspaceId = randomUUID()
  const path = join(resolveAdHocWorkspaceRoot(), dateSegment, `${formatDateTimeId(now)}-${workspaceId}`)
  mkdirSync(path, { recursive: true })

  return create({
    name: `Chat ${dateSegment}`,
    locator: localWorkspaceLocator(path),
  })
}

export function create(input: { name: string, locator: WorkspaceLocator, gitIdentity?: WorkspaceGitIdentity }): WorkspaceView {
  return createWithDatabase(db(), input)
}

function createWithDatabase(
  database: WorkspaceWriteDatabase,
  input: { name: string, locator: WorkspaceLocator, gitIdentity?: WorkspaceGitIdentity },
): WorkspaceView {
  const id = randomUUID()
  const identifier = generateIdentifier(input.name, database)
  const locatorJson = serializeWorkspaceLocator(input.locator)
  const gitIdentityJson = serializeWorkspaceGitIdentity(input.gitIdentity)
  try {
    return toWorkspaceView(database.insert(workspaces).values({
      id,
      name: input.name,
      locatorJson,
      gitIdentityJson,
      identifier,
    }).returning().get())
  }
  catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('UNIQUE constraint failed: workspaces.locator_json') || message.includes('workspaces_locator_unique')) {
      throw new AppError({
        code: 'workspace_locator_exists',
        status: 409,
        message: 'Workspace locator already exists',
        details: { locator: input.locator },
      })
    }
    throw error
  }
}

export function createMultiFolderWorkspace(input: MultiFolderWorkspaceConfig): WorkspaceView {
  assertMultiWorkspacePocEnabled()
  // Create path requires already-registered local members. Config import keeps
  // path-only validation so recognition can reopen an existing composite root.
  return createMultiFolderWorkspaceFromConfig(input, { requireRegisteredMembers: true })
}

function createMultiFolderWorkspaceFromConfig(
  input: MultiFolderWorkspaceConfig,
  options: { requireRegisteredMembers?: boolean } = {},
): WorkspaceView {
  const config = normalizeMultiFolderWorkspaceConfig(input, options)
  const workspaceRoot = resolveMultiWorkspacePath(config.name)

  // Idempotent re-import / cradle open: if the managed root is already registered,
  // return it instead of racing create() into a locator 409.
  const alreadyRegistered = resolveByPath(workspaceRoot)
  if (alreadyRegistered) {
    return alreadyRegistered
  }

  if (existsSync(workspaceRoot)) {
    // The target directory already exists on disk. This typically happens when
    // the workspace was previously created but later removed from Cradle's
    // registry while the folder was left behind. If a valid config file is
    // present we treat this as a re-import and just register it in the DB;
    // otherwise the path is occupied by something unrelated and we reject it.
    const existingConfigPath = join(workspaceRoot, MULTI_WORKSPACE_CONFIG_FILE)
    if (existsSync(existingConfigPath)) {
      const existingConfig = readMultiFolderWorkspaceConfig(existingConfigPath)
      normalizeMultiFolderWorkspaceConfig(existingConfig)
      return create({ name: config.name, locator: localWorkspaceLocator(workspaceRoot) })
    }
    throw new AppError({
      code: 'multi_workspace_path_exists',
      status: 409,
      message: 'Multi-folder workspace path already exists',
      details: { path: workspaceRoot },
    })
  }

  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(join(workspaceRoot, MULTI_WORKSPACE_CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  for (const folder of config.folders) {
    const linkPath = join(workspaceRoot, folder.name)
    symlinkSync(folder.path, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  }

  return create({ name: config.name, locator: localWorkspaceLocator(workspaceRoot) })
}

export function createMultiFolderWorkspaceFromConfigPath(path: string): WorkspaceView {
  assertMultiWorkspacePocEnabled()
  if (!existsSync(path)) {
    throw new AppError({
      code: 'multi_workspace_config_not_found',
      status: 404,
      message: 'Multi-folder workspace config was not found',
      details: { path },
    })
  }

  // Imported configs are also used to recognize and re-register an existing
  // composite root, so validate their folder paths without requiring every
  // member to be present in the current workspace registry.
  return createMultiFolderWorkspaceFromConfig(readMultiFolderWorkspaceConfig(path))
}

export function update(input: { id: string, name?: string, pinned?: boolean }): WorkspaceView | null {
  const record = getRecord(input.id)
  if (!record) {
    return null
  }

  const patch: Partial<typeof workspaces.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  }

  if (input.name !== undefined) {
    patch.name = input.name
  }
  if (input.pinned !== undefined) {
    patch.pinned = input.pinned ? 1 : 0
  }

  const updated = db().update(workspaces).set(patch).where(eq(workspaces.id, input.id)).returning().get() ?? null
  return updated ? toWorkspaceView(updated) : null
}

export interface WorkspaceRemovalResult {
  removedSessionIds: string[]
  removedWorkIds: string[]
}

export async function remove(id: string): Promise<WorkspaceRemovalResult> {
  const workspace = getRecord(id)
  if (!workspace) {
    return { removedSessionIds: [], removedWorkIds: [] }
  }

  // SQLite cascades only database rows. Remove the owners explicitly so their
  // lifecycle hooks release PTYs/runtime state and managed Git checkouts.
  const sessionIds = db()
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.workspaceId, id))
    .all()
    .map(session => session.id)
  const workIds = sessionIds.length === 0
    ? []
    : db()
        .selectDistinct({ id: workThreads.workId })
        .from(workThreads)
        .where(inArray(workThreads.sessionId, sessionIds))
        .all()
        .map(work => work.id)
  const worktreeIds = db()
    .select({ id: worktrees.id })
    .from(worktrees)
    .where(eq(worktrees.sourceWorkspaceId, id))
    .all()
    .map(worktree => worktree.id)

  for (const sessionId of sessionIds) {
    await ChatRuntime.cancelSession(sessionId)
  }
  for (const sessionId of sessionIds) {
    await Session.remove(sessionId)
  }
  for (const worktreeId of worktreeIds) {
    await Worktree.cleanupWorktree({ worktreeId, mode: 'abandon' })
  }
  if (workIds.length > 0) {
    db().delete(works).where(inArray(works.id, workIds)).run()
  }
  db().delete(workspaces).where(eq(workspaces.id, id)).run()
  return { removedSessionIds: sessionIds, removedWorkIds: workIds }
}

// ── workspace migration ──

export type MigrateEntity = 'issues' | 'kanban' | 'automation'

export interface MigrateWorkspaceOptions extends MigrateIssuesOptions {
  entities?: MigrateEntity[]
}

export interface MigrateWorkspaceResult {
  dryRun: boolean
  issues: MigrateIssuesResult
  kanban: { boardsMoved: number }
  automation: { definitionsMoved: number }
}

export function migrateWorkspace(sourceId: string, targetId: string, options: MigrateWorkspaceOptions = {}): MigrateWorkspaceResult {
  if (options.dryRun) {
    return migrateWorkspaceWithinBoundary(sourceId, targetId, options)
  }
  return db().transaction(() => migrateWorkspaceWithinBoundary(sourceId, targetId, options))
}

function migrateWorkspaceWithinBoundary(sourceId: string, targetId: string, options: MigrateWorkspaceOptions): MigrateWorkspaceResult {
  if (sourceId === targetId) {
    throw new AppError({ code: 'workspace_migrate_same', status: 400, message: 'Source and target workspace must be different' })
  }
  const source = get(sourceId)
  if (!source) {
    throw new AppError({ code: 'workspace_not_found', status: 404, message: 'Source workspace not found', details: { workspaceId: sourceId } })
  }
  const target = get(targetId)
  if (!target) {
    throw new AppError({ code: 'workspace_not_found', status: 404, message: 'Target workspace not found', details: { workspaceId: targetId } })
  }

  const entities = options.entities ?? ['issues', 'kanban', 'automation']
  const dryRun = options.dryRun ?? false

  // Issues
  const issuesResult: MigrateIssuesResult = entities.includes('issues')
    ? migrateIssues(sourceId, targetId, options)
    : { processed: 0, updated: 0, numbersReassigned: 0, statusesMapped: [], milestonesMapped: [], parentIssuesCleared: 0 }

  // Kanban boards
  let boardsMoved = 0
  if (entities.includes('kanban') && !dryRun) {
    const result = db().update(kanbanBoards).set({ workspaceId: targetId, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(kanbanBoards.workspaceId, sourceId)).run()
    boardsMoved = result.changes
  }
 else if (entities.includes('kanban') && dryRun) {
    const rows = db().select({ id: kanbanBoards.id }).from(kanbanBoards).where(eq(kanbanBoards.workspaceId, sourceId)).all()
    boardsMoved = rows.length
  }

  // Automation definitions
  let definitionsMoved = 0
  if (entities.includes('automation') && !dryRun) {
    const result = db().update(automationDefinitions).set({ workspaceId: targetId, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(automationDefinitions.workspaceId, sourceId)).run()
    definitionsMoved = result.changes
  }
 else if (entities.includes('automation') && dryRun) {
    const rows = db().select({ id: automationDefinitions.id }).from(automationDefinitions).where(eq(automationDefinitions.workspaceId, sourceId)).all()
    definitionsMoved = rows.length
  }

  return {
    dryRun,
    issues: issuesResult,
    kanban: { boardsMoved },
    automation: { definitionsMoved },
  }
}

export async function getFiles(workspaceId: string) {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return []
  }
  const locator = readWorkspaceLocator(workspace)
  if (isLocalWorkspaceLocator(locator)) {
    return listFiles(locator.path)
  }
  const remoteWorkspace = await resolveRemoteCradleWorkspace(locator)
  return await nodeUpstreamJson<RemoteWorkspaceFileEntry[]>(
    locator.nodeId,
    `/workspaces/${encodeURIComponent(remoteWorkspace.id)}/files`,
  )
}

export async function getFileChildren(workspaceId: string, relativePath = '') {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return []
  }
  const locator = readWorkspaceLocator(workspace)
  if (isLocalWorkspaceLocator(locator)) {
    return listFileChildren(locator.path, relativePath)
  }
  const remoteWorkspace = await resolveRemoteCradleWorkspace(locator)
  const childrenUrl = new URL(`/workspaces/${encodeURIComponent(remoteWorkspace.id)}/files/children`, 'http://127.0.0.1')
  childrenUrl.searchParams.set('path', relativePath)
  return await nodeUpstreamJson<RemoteWorkspaceFileEntry[]>(locator.nodeId, `${childrenUrl.pathname}${childrenUrl.search}`)
}

export async function searchFiles(workspaceId: string, input: { query?: string, limit?: number }) {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return []
  }
  const locator = readWorkspaceLocator(workspace)
  if (isLocalWorkspaceLocator(locator)) {
    return searchWorkspaceFiles({
      workspacePath: locator.path,
      query: input.query,
      limit: input.limit,
    })
  }
  const remoteWorkspace = await resolveRemoteCradleWorkspace(locator)
  return await nodeUpstreamJson<RemoteWorkspaceFileEntry[]>(
    locator.nodeId,
    remoteWorkspacePath(remoteWorkspace.id, '/files/search', {
      q: input.query,
      limit: input.limit,
    }),
  )
}

export function openLocalFileEvents(workspaceId: string): ReadableStream<Uint8Array> {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
  }

  const locator = readWorkspaceLocator(workspace)
  if (!isLocalWorkspaceLocator(locator)) {
    throw new AppError({
      code: 'workspace_file_events_must_be_proxied',
      status: 500,
      message: 'Remote workspace file events must be opened through the Node upstream proxy.',
    })
  }

  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let keepAlive: NodeJS.Timeout | null = null
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      send({
        type: 'ready',
        workspaceId,
        timestamp: Date.now(),
      })
      unsubscribe = subscribeWorkspaceFileChanges({
        workspaceId,
        workspacePath: locator.path,
        listener(event) {
          if (event.type === 'directory-changed') {
            send(event)
          }
        },
      })
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        }
        catch {
          unsubscribe()
          if (keepAlive) {
            clearInterval(keepAlive)
            keepAlive = null
          }
        }
      }, 15000)
    },
    cancel() {
      unsubscribe()
      if (keepAlive) {
        clearInterval(keepAlive)
        keepAlive = null
      }
    },
  })
}

export async function proxyRemoteWorkspaceRequest(
  workspaceId: string,
  request: Request,
  remoteSuffix: string,
): Promise<Response | null> {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return null
  }
  const locator = readWorkspaceLocator(workspace)
  if (isLocalWorkspaceLocator(locator)) {
    return null
  }
  const remoteWorkspace = await resolveRemoteCradleWorkspace(locator)
  const requestUrl = new URL(request.url)
  return await proxyUpstreamRequestWithReconnect(
    async () => (await getFabricNodeLinkManager().ensure(locator.nodeId)).localBaseUrl,
    request,
    `${remoteWorkspacePath(remoteWorkspace.id, remoteSuffix)}${requestUrl.search}`,
  )
}

export async function getFileContent(workspaceId: string, relativePath: string): Promise<string | null> {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return null
  }
  const locator = readWorkspaceLocator(workspace)
  if (isLocalWorkspaceLocator(locator)) {
    return readTextFile(locator.path, relativePath)
  }
  const remoteWorkspace = await resolveRemoteCradleWorkspace(locator)
  const contentUrl = new URL(`/workspaces/${encodeURIComponent(remoteWorkspace.id)}/files/content`, 'http://127.0.0.1')
  contentUrl.searchParams.set('path', relativePath)
  return (await nodeUpstreamJson<RemoteWorkspaceFileContent>(locator.nodeId, `${contentUrl.pathname}${contentUrl.search}`)).content
}

export async function getFileInfo(workspaceId: string, relativePath: string) {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return null
  }
  const locator = readWorkspaceLocator(workspace)
  if (isLocalWorkspaceLocator(locator)) {
    return getWorkspaceFileInfo(locator.path, relativePath)
  }
  const remoteWorkspace = await resolveRemoteCradleWorkspace(locator)
  const infoUrl = new URL(`/workspaces/${encodeURIComponent(remoteWorkspace.id)}/files/info`, 'http://127.0.0.1')
  infoUrl.searchParams.set('path', relativePath)
  return await nodeUpstreamJson<RemoteWorkspaceFileInfo | null>(locator.nodeId, `${infoUrl.pathname}${infoUrl.search}`)
}

export async function getLocalFileBytes(workspaceId: string, relativePath: string) {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return null
  }
  const locator = readWorkspaceLocator(workspace)
  if (!isLocalWorkspaceLocator(locator)) {
    throw new AppError({
      code: 'workspace_file_bytes_must_be_proxied',
      status: 500,
      message: 'Remote workspace file bytes must be read through the Node upstream proxy.',
    })
  }
  const info = await getWorkspaceFileInfo(locator.path, relativePath)
  if (!info) {
    return null
  }
  const bytes = await readWorkspaceFileBytes(locator.path, relativePath)
  if (!bytes) {
    return null
  }
  return { info, bytes }
}

export async function getFilePdfRendition(workspaceId: string, relativePath: string) {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return null
  }
  const locator = readWorkspaceLocator(workspace)
  if (!isLocalWorkspaceLocator(locator)) {
    throw new AppError({
      code: 'workspace_file_rendition_must_be_proxied',
      status: 500,
      message: 'Remote workspace renditions must be opened through the Node upstream proxy.',
    })
  }
  const config = getServerConfig()
  const cacheRoot = config.dataDir
    ? `${config.dataDir}/workspace/renditions`
    : `${config.dbPath}.workspace-renditions`
  return renderWorkspaceFilePdf({
    workspacePath: locator.path,
    relativePath,
    cacheRoot,
  })
}

export async function setFileContent(input: {
  workspaceId: string
  relativePath: string
  content: string
  confirmedNonCradleOwnedWrite: boolean
}) {
  assertConfirmedWorkspaceWrite(input.confirmedNonCradleOwnedWrite, input.relativePath)

  const { workspaceId, relativePath, content } = input
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return {
      success: false,
      ownerBoundary: createWorkspaceFileWriteBoundary({
        workspacePath: null,
        relativePath,
      }),
    }
  }
  const locator = readWorkspaceLocator(workspace)
  if (!isLocalWorkspaceLocator(locator)) {
    const remoteWorkspace = await resolveRemoteCradleWorkspace(locator)
    return await nodeUpstreamJson<ReturnType<typeof createFileOperationResult>>(
      locator.nodeId,
      remoteWorkspacePath(remoteWorkspace.id, '/files/content'),
      jsonRequestInit('PUT', {
        path: relativePath,
        content,
        confirmedNonCradleOwnedWrite: input.confirmedNonCradleOwnedWrite,
      }),
    )
  }
  return {
    success: await writeTextFile(locator.path, relativePath, content),
    ownerBoundary: createWorkspaceFileWriteBoundary({
      workspacePath: locator.path,
      relativePath,
    }),
  }
}

export async function createFile(input: {
  workspaceId: string
  relativePath: string
  confirmedNonCradleOwnedWrite: boolean
}) {
  assertConfirmedWorkspaceWrite(input.confirmedNonCradleOwnedWrite, input.relativePath)
  const workspace = getRecord(input.workspaceId)
  if (!workspace) {
    return createFileOperationResult(false, null, input.relativePath)
  }
  const locator = readWorkspaceLocator(workspace)
  if (!isLocalWorkspaceLocator(locator)) {
    const remoteWorkspace = await resolveRemoteCradleWorkspace(locator)
    return await nodeUpstreamJson<ReturnType<typeof createFileOperationResult>>(
      locator.nodeId,
      remoteWorkspacePath(remoteWorkspace.id, '/files/file'),
      jsonRequestInit('POST', {
        path: input.relativePath,
        confirmedNonCradleOwnedWrite: input.confirmedNonCradleOwnedWrite,
      }),
    )
  }
  return createFileOperationResult(
    await createEmptyFile(locator.path, input.relativePath),
    locator.path,
    input.relativePath,
  )
}

export async function createFolder(input: {
  workspaceId: string
  relativePath: string
  confirmedNonCradleOwnedWrite: boolean
}) {
  assertConfirmedWorkspaceWrite(input.confirmedNonCradleOwnedWrite, input.relativePath)
  const workspace = getRecord(input.workspaceId)
  if (!workspace) {
    return createFileOperationResult(false, null, input.relativePath)
  }
  const locator = readWorkspaceLocator(workspace)
  if (!isLocalWorkspaceLocator(locator)) {
    const remoteWorkspace = await resolveRemoteCradleWorkspace(locator)
    return await nodeUpstreamJson<ReturnType<typeof createFileOperationResult>>(
      locator.nodeId,
      remoteWorkspacePath(remoteWorkspace.id, '/files/folder'),
      jsonRequestInit('POST', {
        path: input.relativePath,
        confirmedNonCradleOwnedWrite: input.confirmedNonCradleOwnedWrite,
      }),
    )
  }
  return createFileOperationResult(
    await createDirectory(locator.path, input.relativePath),
    locator.path,
    input.relativePath,
  )
}

export async function renameFilePath(input: {
  workspaceId: string
  sourcePath: string
  destinationPath: string
  confirmedNonCradleOwnedWrite: boolean
}) {
  assertConfirmedWorkspaceWrite(input.confirmedNonCradleOwnedWrite, input.sourcePath)
  const workspace = getRecord(input.workspaceId)
  if (!workspace) {
    return {
      success: false,
      sourceBoundary: createWorkspaceFileWriteBoundary({
        workspacePath: null,
        relativePath: input.sourcePath,
      }),
      destinationBoundary: createWorkspaceFileWriteBoundary({
        workspacePath: null,
        relativePath: input.destinationPath,
      }),
    }
  }
  const locator = readWorkspaceLocator(workspace)
  if (!isLocalWorkspaceLocator(locator)) {
    const remoteWorkspace = await resolveRemoteCradleWorkspace(locator)
    return await nodeUpstreamJson<{
      success: boolean
      sourceBoundary: ReturnType<typeof createWorkspaceFileWriteBoundary>
      destinationBoundary: ReturnType<typeof createWorkspaceFileWriteBoundary>
    }>(
      locator.nodeId,
      remoteWorkspacePath(remoteWorkspace.id, '/files/path'),
      jsonRequestInit('PATCH', {
        sourcePath: input.sourcePath,
        destinationPath: input.destinationPath,
        confirmedNonCradleOwnedWrite: input.confirmedNonCradleOwnedWrite,
      }),
    )
  }
  return {
    success: await renameWorkspacePath(locator.path, input.sourcePath, input.destinationPath),
    sourceBoundary: createWorkspaceFileWriteBoundary({
      workspacePath: locator.path,
      relativePath: input.sourcePath,
    }),
    destinationBoundary: createWorkspaceFileWriteBoundary({
      workspacePath: locator.path,
      relativePath: input.destinationPath,
    }),
  }
}

function assertConfirmedWorkspaceWrite(confirmed: boolean, relativePath: string): void {
  if (confirmed) {
    return
  }
  throw new AppError({
    code: 'non_cradle_owned_write_confirmation_required',
    status: 400,
    message: 'Workspace file writes require explicit non-Cradle-owned write confirmation',
    details: {
      ownerBoundary: createWorkspaceFileWriteBoundary({
        workspacePath: null,
        relativePath,
      }),
    },
  })
}

function createFileOperationResult(success: boolean, workspacePath: string | null, relativePath: string) {
  return {
    success,
    ownerBoundary: createWorkspaceFileWriteBoundary({
      workspacePath,
      relativePath,
    }),
  }
}

function toWorkspaceView(row: Workspace): WorkspaceView {
  const locator = readWorkspaceLocator(row)
  return {
    id: row.id,
    name: row.name,
    locator,
    gitIdentity: readWorkspaceGitIdentity(row),
    identifier: row.identifier,
    availability: workspaceAvailability(locator),
    multiFolder: isMultiFolderWorkspaceLocator(locator),
    pinned: row.pinned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Whether a workspace view is a Cradle-owned multi-folder symlink root. */
export function isMultiFolderWorkspace(workspace: Pick<WorkspaceView, 'locator' | 'multiFolder'>): boolean {
  return workspace.multiFolder || isMultiFolderWorkspaceLocator(workspace.locator)
}

function isMultiFolderWorkspaceLocator(locator: WorkspaceLocator): boolean {
  if (locator.nodeId !== 'local') {
    return false
  }
  return existsSync(join(locator.path, MULTI_WORKSPACE_CONFIG_FILE))
}

function existingHistoricalWorkspacePlan(
  workspace: WorkspaceView,
  reason: Extract<HistoricalWorkspacePlan, { kind: 'existing' }>['reason'],
): HistoricalWorkspacePlan {
  return {
    kind: 'existing',
    reason,
    historicalKey: historicalWorkspaceKey(
      workspace.locator.nodeId,
      workspace.locator.path,
      workspace.gitIdentity,
    ),
    workspace,
  }
}

function canonicalWorkspacePath(nodeId: string, path: string): string {
  if (nodeId !== 'local') {
    return path
  }
  const absolutePath = resolve(path)
  try {
    return realpathSync(absolutePath)
  }
  catch {
    return absolutePath
  }
}

function findContainingWorkspace(locator: WorkspaceLocator): WorkspaceView | null {
  const candidates = list()
    .filter(workspace => workspace.locator.nodeId === locator.nodeId)
    .filter(workspace => isPathContainedBy(locator.path, workspace.locator.path))
    .sort((left, right) => right.locator.path.length - left.locator.path.length)
  return candidates[0] ?? null
}

function findWorkspaceByGitIdentity(
  sourceHostId: string,
  gitIdentity: WorkspaceGitIdentity | undefined,
): WorkspaceView | null {
  const originUrl = gitIdentity?.originUrl?.trim()
  if (!originUrl) {
    return null
  }
  const matches = list().filter(workspace =>
    workspace.locator.nodeId === sourceHostId
    && workspace.gitIdentity.originUrl?.trim() === originUrl)
  return matches.length === 1 ? matches[0]! : null
}

function findHistoricalProjectRoot(path: string, reportedRepoRoot: string | null | undefined): string {
  if (reportedRepoRoot && isDirectory(reportedRepoRoot) && isPathContainedBy(path, reportedRepoRoot)) {
    return canonicalWorkspacePath('local', reportedRepoRoot)
  }
  let current = canonicalWorkspacePath('local', path)
  while (true) {
    if (existsSync(join(current, '.git')) || existsSync(join(current, MULTI_WORKSPACE_CONFIG_FILE))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      return canonicalWorkspacePath('local', path)
    }
    current = parent
  }
}

function historicalWorkspaceKey(
  nodeId: string,
  path: string,
  gitIdentity: WorkspaceGitIdentity,
): string {
  const originUrl = gitIdentity.originUrl?.trim()
  return originUrl
    ? `${nodeId}:git:${originUrl}`
    : `${nodeId}:path:${path}`
}

function isPathContainedBy(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  }
  catch {
    return false
  }
}

function workspaceAvailability(locator: WorkspaceLocator): WorkspaceView['availability'] {
  if (!isLocalWorkspaceLocator(locator)) {
    return 'remote'
  }
  return isDirectory(locator.path) ? 'available' : 'missing'
}

export function readWorkspaceLocator(row: Pick<Workspace, 'locatorJson'>): WorkspaceLocator {
  return readWorkspaceLocatorJson(row.locatorJson)
}

export function readWorkspaceGitIdentity(row: Pick<Workspace, 'gitIdentityJson'>): WorkspaceGitIdentity {
  return readWorkspaceGitIdentityJson(row.gitIdentityJson)
}

export function getLocalWorkspacePath(workspaceId: string): string | null {
  const row = getRecord(workspaceId)
  if (!row) {
    return null
  }
  const locator = readWorkspaceLocator(row)
  return isLocalWorkspaceLocator(locator) && workspaceAvailability(locator) === 'available'
    ? locator.path
    : null
}

function assertWorkspaceLocatorAvailable(workspaceId: string, locator: WorkspaceLocator): void {
  const existing = resolveByLocator(locator)
  if (!existing || existing.id === workspaceId) {
    return
  }
  throw new AppError({
    code: 'workspace_locator_exists',
    status: 409,
    message: 'Workspace locator already exists',
    details: { locator, workspaceId: existing.id },
  })
}

async function resolveRemoteCradleWorkspace(locator: WorkspaceLocator) {
  if (locator.sourceWorkspaceId) {
    const remoteWorkspace = await nodeUpstreamJson<RemoteWorkspaceView | null>(
      locator.nodeId,
      `/workspaces/${encodeURIComponent(locator.sourceWorkspaceId)}`,
    )
    if (remoteWorkspace) {
      return remoteWorkspace
    }
  }
  const remoteWorkspaces = await nodeUpstreamJson<RemoteWorkspaceView[]>(locator.nodeId, '/workspaces')
  const remoteWorkspace = remoteWorkspaces.find(workspace => workspace.locator.path === locator.path) ?? null
  if (!remoteWorkspace) {
    throw new AppError({
      code: 'remote_cradle_workspace_not_found',
      status: 404,
      message: 'Remote Cradle Server workspace was not found.',
      details: { nodeId: locator.nodeId, path: locator.path },
    })
  }
  return remoteWorkspace
}

function remoteWorkspacePath(
  remoteWorkspaceId: string,
  suffix = '',
  query: Record<string, string | number | undefined> = {},
): string {
  const url = new URL(`/workspaces/${encodeURIComponent(remoteWorkspaceId)}${suffix}`, 'http://127.0.0.1')
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value))
    }
  }
  return `${url.pathname}${url.search}`
}

function jsonRequestInit(method: 'PATCH' | 'POST' | 'PUT', body: object): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function nodeUpstreamJson<T>(nodeId: string, upstreamPathWithQuery: string, init?: RequestInit): Promise<T> {
  return await upstreamJsonWithReconnect<T>(
    async () => (await getFabricNodeLinkManager().ensure(nodeId)).localBaseUrl,
    upstreamPathWithQuery,
    init,
  )
}

function assertMultiWorkspacePocEnabled(): void {
  assertAppFeatureFlagEnabled('multiWorkspacePoc', {
    code: 'multi_workspace_poc_disabled',
    status: 403,
    message: 'Multi-folder workspace POC is disabled. Enable it in Cradle settings first.',
  })
}

function readMultiFolderWorkspaceConfig(path: string): MultiFolderWorkspaceConfig {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MultiFolderWorkspaceConfig
  }
  catch (error) {
    throw new AppError({
      code: 'multi_workspace_config_invalid',
      status: 400,
      message: 'Multi-folder workspace config could not be parsed',
      details: { path, reason: error instanceof Error ? error.message : String(error) },
    })
  }
}

/**
 * Best-effort raw parse for preview purposes. Returns null if the file is not
 * JSON or does not look like a workspace config. Used by inspectDirectory so an
 * invalid config can still be shown to the user instead of being hidden.
 */
function readMultiFolderWorkspaceConfigRaw(path: string): MultiFolderWorkspaceConfig | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.folders)) {
      return parsed as MultiFolderWorkspaceConfig
    }
    return null
  }
  catch {
    return null
  }
}

function normalizeMultiFolderWorkspaceConfig(
  input: MultiFolderWorkspaceConfig,
  options: { requireRegisteredMembers?: boolean } = {},
): MultiFolderWorkspaceConfig {
  const name = input.name.trim()
  if (!isSafeWorkspaceEntryName(name)) {
    throw new AppError({
      code: 'multi_workspace_name_invalid',
      status: 400,
      message: 'Multi-folder workspace name may only contain letters, numbers, dots, underscores, and dashes',
      details: { name },
    })
  }

  if (!Array.isArray(input.folders) || input.folders.length === 0) {
    throw new AppError({
      code: 'multi_workspace_folders_required',
      status: 400,
      message: 'At least one folder is required for a multi-folder workspace',
    })
  }

  if (options.requireRegisteredMembers && input.folders.length < 2) {
    throw new AppError({
      code: 'multi_workspace_folders_required',
      status: 400,
      message: 'Select at least two registered Cradle workspaces',
      details: { count: input.folders.length },
    })
  }

  const names = new Set<string>()
  const memberWorkspaceIds = new Set<string>()
  const folders = input.folders.map((folder) => {
    const folderName = folder.name.trim()
    const folderPath = resolve(folder.path.trim())
    if (!isSafeWorkspaceEntryName(folderName)) {
      throw new AppError({
        code: 'multi_workspace_folder_name_invalid',
        status: 400,
        message: 'Multi-folder workspace folder names may only contain letters, numbers, dots, underscores, and dashes',
        details: { name: folderName },
      })
    }
    if (names.has(folderName)) {
      throw new AppError({
        code: 'multi_workspace_folder_name_collision',
        status: 409,
        message: 'Multi-folder workspace folder names must be unique',
        details: { name: folderName },
      })
    }
    if (!isAbsolute(folder.path.trim())) {
      throw new AppError({
        code: 'multi_workspace_folder_path_relative',
        status: 400,
        message: 'Multi-folder workspace folder paths must be absolute',
        details: { name: folderName, path: folder.path },
      })
    }
    assertDirectory(folderPath, folderName)

    if (options.requireRegisteredMembers) {
      const member = assertRegisteredMultiFolderMember(folderPath)
      if (memberWorkspaceIds.has(member.id)) {
        throw new AppError({
          code: 'multi_workspace_member_duplicate',
          status: 409,
          message: 'Each registered workspace may only be linked once',
          details: { workspaceId: member.id, path: folderPath },
        })
      }
      memberWorkspaceIds.add(member.id)
    }

    names.add(folderName)
    return { name: folderName, path: folderPath }
  })

  return { name, folders }
}

/**
 * Members for create must already be registered local single-folder workspaces.
 * Arbitrary filesystem paths are rejected so the POC stays inside Cradle's registry.
 */
function assertRegisteredMultiFolderMember(absolutePath: string): WorkspaceView {
  const workspace = resolveByPath(absolutePath)
  if (!workspace || workspace.locator.nodeId !== 'local') {
    throw new AppError({
      code: 'multi_workspace_member_not_registered',
      status: 400,
      message: 'Multi-folder members must be local workspaces already registered in Cradle',
      details: { path: absolutePath },
    })
  }
  if (workspace.availability !== 'available') {
    throw new AppError({
      code: 'multi_workspace_member_unavailable',
      status: 400,
      message: 'Multi-folder members must be available local workspaces',
      details: {
        workspaceId: workspace.id,
        path: absolutePath,
        availability: workspace.availability,
      },
    })
  }
  if (isMultiFolderWorkspaceLocator(workspace.locator)) {
    throw new AppError({
      code: 'multi_workspace_member_is_multi',
      status: 400,
      message: 'Multi-folder workspaces cannot nest other multi-folder workspaces',
      details: { workspaceId: workspace.id, path: absolutePath },
    })
  }
  return workspace
}

function isSafeWorkspaceEntryName(name: string): boolean {
  return name.length > 0
    && name !== '.'
    && name !== '..'
    && !name.includes(sep)
    && !name.includes('/')
    && !name.includes('\\')
    && WORKSPACE_ENTRY_NAME_RE.test(name)
}

function assertDirectory(path: string, name: string): void {
  try {
    if (lstatSync(path).isDirectory()) {
      return
    }
  }
  catch {
    throw new AppError({
      code: 'multi_workspace_folder_not_found',
      status: 400,
      message: 'Multi-folder workspace folder path must point to an existing directory',
      details: { name, path },
    })
  }

  throw new AppError({
    code: 'multi_workspace_folder_not_directory',
    status: 400,
    message: 'Multi-folder workspace folder path must point to a directory',
    details: { name, path },
  })
}

function resolveMultiWorkspacePath(name: string): string {
  return join(resolveMultiWorkspaceRoot(), name)
}

function resolveMultiWorkspaceRoot(): string {
  const configuredRoot = process.env[MULTI_WORKSPACE_ROOT_ENV]?.trim()
  if (configuredRoot) {
    return configuredRoot
  }
  return join(homedir(), 'Documents', 'Cradle', 'workspaces')
}

function resolveAdHocWorkspaceRoot(): string {
  const configuredRoot = process.env[AD_HOC_WORKSPACE_ROOT_ENV]?.trim()
  if (configuredRoot) {
    return configuredRoot
  }
  return join(homedir(), 'Documents', 'Cradle')
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTimeId(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hour}${minute}${second}`
}
