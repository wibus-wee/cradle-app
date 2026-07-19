import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import type { Workspace } from '@cradle/db'
import { automationDefinitions, kanbanBoards, workspaces } from '@cradle/db'
import { desc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db, getServerConfig } from '../../infra'
import type { MigrateIssuesOptions, MigrateIssuesResult } from '../issue/service'
import { migrateIssues } from '../issue/service'
import { assertAppFeatureFlagEnabled, isAppFeatureFlagEnabled } from '../preferences/service'
import * as RemoteHosts from '../remote-hosts/service'
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
    hostId: input.sourceHostId,
    path: canonicalPath,
  }
  const exact = resolveByLocator({
    hostId: input.sourceHostId,
    path: lexicalPath,
  }) ?? resolveByLocator(locator)
  if (exact) {
    return existingHistoricalWorkspacePlan(exact, 'exact-path')
  }

  const containing = findContainingWorkspace({
    hostId: input.sourceHostId,
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
      hostId: input.sourceHostId,
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

export function relinkWorkspace(id: string, path: string): WorkspaceView | null {
  const record = getRecord(id)
  if (!record) {
    return null
  }
  const trimmedPath = path.trim()
  if (!isDirectory(trimmedPath)) {
    throw new AppError({
      code: 'workspace_location_not_found',
      status: 400,
      message: 'Workspace location must be an existing directory',
      details: { path: trimmedPath },
    })
  }
  const currentLocator = readWorkspaceLocator(record)
  if (!isLocalWorkspaceLocator(currentLocator)) {
    throw unsupportedRemoteWorkspaceOperation('relink workspace location')
  }
  const nextLocator = localWorkspaceLocator(canonicalWorkspacePath('local', trimmedPath))
  const existing = resolveByLocator(nextLocator)
  if (existing && existing.id !== id) {
    throw new AppError({
      code: 'workspace_locator_exists',
      status: 409,
      message: 'Workspace locator already exists',
      details: { locator: nextLocator, workspaceId: existing.id },
    })
  }
  const gitIdentity = readWorkspaceGitIdentity(record)
  const updated = db().update(workspaces).set({
    locatorJson: serializeWorkspaceLocator(nextLocator),
    gitIdentityJson: serializeWorkspaceGitIdentity({
      ...gitIdentity,
      repoRoot: findHistoricalProjectRoot(nextLocator.path, gitIdentity.repoRoot),
    }),
    updatedAt: Math.floor(Date.now() / 1000),
  }).where(eq(workspaces.id, id)).returning().get()
  return updated ? toWorkspaceView(updated) : null
}

export function addFromDirectory(path: string): WorkspaceView {
  const absolutePath = resolve(path.trim())
  if (!isDirectory(absolutePath)) {
    throw new AppError({
      code: 'workspace_location_not_found',
      status: 400,
      message: 'Workspace location must be an existing directory',
      details: { path: absolutePath },
    })
  }
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
    return existing
  }
  return create({ name: basename(absolutePath), locator: localWorkspaceLocator(absolutePath) })
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
  const config = normalizeMultiFolderWorkspaceConfig(input)
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

  return createMultiFolderWorkspace(readMultiFolderWorkspaceConfig(path))
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

export function remove(id: string): void {
  db().delete(workspaces).where(eq(workspaces.id, id)).run()
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
  return await RemoteHosts.listRemoteCradleWorkspaceFiles(locator.hostId, remoteWorkspace.id)
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
  return await RemoteHosts.listRemoteCradleWorkspaceFileChildren(locator.hostId, remoteWorkspace.id, relativePath)
}

export async function searchFiles(workspaceId: string, input: { query?: string, limit?: number }) {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return []
  }
  const locator = readWorkspaceLocator(workspace)
  if (!isLocalWorkspaceLocator(locator)) {
    throw unsupportedRemoteWorkspaceOperation('search workspace files')
  }
  return searchWorkspaceFiles({
    workspacePath: locator.path,
    query: input.query,
    limit: input.limit,
  })
}

export function openFileEvents(workspaceId: string): ReadableStream<Uint8Array> {
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
    throw unsupportedRemoteWorkspaceOperation('subscribe to file changes')
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
        listener: send,
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
  return (await RemoteHosts.readRemoteCradleWorkspaceFileContent(locator.hostId, remoteWorkspace.id, relativePath)).content
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
  return await RemoteHosts.readRemoteCradleWorkspaceFileInfo(locator.hostId, remoteWorkspace.id, relativePath)
}

export async function getFileBytes(workspaceId: string, relativePath: string) {
  const workspace = getRecord(workspaceId)
  if (!workspace) {
    return null
  }
  const locator = readWorkspaceLocator(workspace)
  if (!isLocalWorkspaceLocator(locator)) {
    throw unsupportedRemoteWorkspaceOperation('read raw file bytes')
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
    throw unsupportedRemoteWorkspaceOperation('render PDF rendition')
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
    throw unsupportedRemoteWorkspaceOperation('write file content')
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
    throw unsupportedRemoteWorkspaceOperation('create file')
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
    throw unsupportedRemoteWorkspaceOperation('create folder')
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
    throw unsupportedRemoteWorkspaceOperation('rename file path')
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
    pinned: row.pinned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function existingHistoricalWorkspacePlan(
  workspace: WorkspaceView,
  reason: Extract<HistoricalWorkspacePlan, { kind: 'existing' }>['reason'],
): HistoricalWorkspacePlan {
  return {
    kind: 'existing',
    reason,
    historicalKey: historicalWorkspaceKey(
      workspace.locator.hostId,
      workspace.locator.path,
      workspace.gitIdentity,
    ),
    workspace,
  }
}

function canonicalWorkspacePath(hostId: string, path: string): string {
  if (hostId !== 'local') {
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
    .filter(workspace => workspace.locator.hostId === locator.hostId)
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
    workspace.locator.hostId === sourceHostId
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
  hostId: string,
  path: string,
  gitIdentity: WorkspaceGitIdentity,
): string {
  const originUrl = gitIdentity.originUrl?.trim()
  return originUrl
    ? `${hostId}:git:${originUrl}`
    : `${hostId}:path:${path}`
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

function unsupportedRemoteWorkspaceOperation(operation: string): never {
  throw new AppError({
    code: 'workspace_operation_not_supported_for_remote_cradle_server',
    status: 409,
    message: `This workspace operation is not available for remote Cradle Server workspaces yet: ${operation}.`,
  })
}

async function resolveRemoteCradleWorkspace(locator: WorkspaceLocator) {
  const remoteWorkspace = await RemoteHosts.resolveRemoteWorkspaceByPath(locator.hostId, locator.path)
  if (!remoteWorkspace) {
    throw new AppError({
      code: 'remote_cradle_workspace_not_found',
      status: 404,
      message: 'Remote Cradle Server workspace was not found.',
      details: { hostId: locator.hostId, path: locator.path },
    })
  }
  return remoteWorkspace
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

function normalizeMultiFolderWorkspaceConfig(input: MultiFolderWorkspaceConfig): MultiFolderWorkspaceConfig {
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

  const names = new Set<string>()
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
    names.add(folderName)
    return { name: folderName, path: folderPath }
  })

  return { name, folders }
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
