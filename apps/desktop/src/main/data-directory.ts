import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from 'node:path'

import { app } from 'electron'
import { z } from 'zod'

const POINTER_SCHEMA_VERSION = 1
const MIGRATION_SCHEMA_VERSION = 1
const POINTER_FILE = 'bootstrap/data-root.json'
const MIGRATION_FILE = 'bootstrap/data-migration.json'
const MIGRATION_MARKER_FILE = '.cradle-data-root.json'

export type DesktopDataDirectorySource = 'default' | 'custom'
export type DesktopDataMigrationPhase
  = | 'validate'
    | 'stage-copy'
    | 'verify'
    | 'promote'
    | 'switch-pointer'
    | 'health-check'
    | 'archive-old-root'
    | 'completed'
    | 'failed'

export interface DesktopDataMigration {
  schemaVersion: 1
  migrationId: string
  sourceRoot: string
  targetRoot: string
  stagingRoot: string
  phase: DesktopDataMigrationPhase
  createdAt: string
  updatedAt: string
  completedAt?: string
  backupRoot?: string
  errorMessage?: string
}

export interface DesktopDataDirectoryState {
  bootstrapRoot: string
  serverDataRoot: string
  source: DesktopDataDirectorySource
  pendingMigration: DesktopDataMigration | null
}

export interface DesktopDataMigrationStatus {
  phase: DesktopDataMigrationPhase | 'idle'
  sourceRoot: string | null
  targetRoot: string | null
  backupRoot: string | null
  errorMessage: string | null
}

interface DataDirectoryEnvironment {
  bootstrapRoot: string
  defaultRoot: string
  installDirectory: string
  pointerPath: string
  migrationPath: string
}

interface FileManifestEntry {
  path: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  sha256?: string
  linkTarget?: string
}

const PointerSchema = z.object({
  schemaVersion: z.literal(POINTER_SCHEMA_VERSION),
  root: z.string(),
  migrationId: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
})

const MigrationSchema = z.object({
  schemaVersion: z.literal(MIGRATION_SCHEMA_VERSION),
  migrationId: z.string(),
  sourceRoot: z.string(),
  targetRoot: z.string(),
  stagingRoot: z.string(),
  phase: z.enum([
    'validate',
    'stage-copy',
    'verify',
    'promote',
    'switch-pointer',
    'health-check',
    'archive-old-root',
    'completed',
    'failed',
  ]),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  backupRoot: z.string().optional(),
  errorMessage: z.string().optional(),
})

let environment: DataDirectoryEnvironment | null = null
let currentState: DesktopDataDirectoryState | null = null

export async function initializeDesktopDataDirectory(input?: {
  bootstrapRoot?: string
  installDirectory?: string
}): Promise<DesktopDataDirectoryState> {
  const bootstrapRoot = normalizeAbsolutePath(input?.bootstrapRoot ?? app.getPath('userData'))
  const installDirectory = normalizeAbsolutePath(input?.installDirectory ?? dirname(app.getPath('exe')))
  const defaultRoot = normalizeAbsolutePath(join(bootstrapRoot, 'data'))
  environment = {
    bootstrapRoot,
    defaultRoot,
    installDirectory,
    pointerPath: join(bootstrapRoot, POINTER_FILE),
    migrationPath: join(bootstrapRoot, MIGRATION_FILE),
  }

  await recoverInterruptedAtomicWrite(environment.pointerPath)
  const pointerRoot = await readPointerRoot(environment)
  const pendingMigration = await readMigration(environment.migrationPath)
  currentState = {
    bootstrapRoot,
    serverDataRoot: pointerRoot ?? defaultRoot,
    source: pointerRoot ? 'custom' : 'default',
    pendingMigration,
  }
  return getDesktopDataDirectoryState()
}

export function getDesktopDataDirectoryState(): DesktopDataDirectoryState {
  if (!currentState) {
    throw new Error('Desktop data directory has not been initialized')
  }
  return {
    ...currentState,
    pendingMigration: currentState.pendingMigration ? { ...currentState.pendingMigration } : null,
  }
}

export function getDesktopDataMigrationStatus(): DesktopDataMigrationStatus {
  const migration = getDesktopDataDirectoryState().pendingMigration
  return migration
    ? {
        phase: migration.phase,
        sourceRoot: migration.sourceRoot,
        targetRoot: migration.targetRoot,
        backupRoot: migration.backupRoot ?? null,
        errorMessage: migration.errorMessage ?? null,
      }
    : {
        phase: 'idle',
        sourceRoot: null,
        targetRoot: null,
        backupRoot: null,
        errorMessage: null,
      }
}

export async function validateDesktopDataDirectoryTarget(targetPath: string): Promise<string> {
  const env = requireEnvironment()
  const targetRoot = normalizeAbsolutePath(targetPath)
  const sourceRoot = getDesktopDataDirectoryState().serverDataRoot
  assertSafeTarget({ sourceRoot, targetRoot, installDirectory: env.installDirectory })

  const existing = await readOptionalStat(targetRoot)
  if (existing && !existing.isDirectory()) {
    throw new Error('The selected data location is not a directory')
  }
  if (existing && (await readdir(targetRoot)).length > 0) {
    throw new Error('The selected data directory must be empty')
  }

  const writableRoot = existing ? targetRoot : dirname(targetRoot)
  await mkdir(writableRoot, { recursive: true })
  await access(writableRoot, constants.W_OK)
  return targetRoot
}

export async function scheduleDesktopDataDirectoryMigration(targetPath: string): Promise<DesktopDataMigration> {
  const env = requireEnvironment()
  const targetRoot = await validateDesktopDataDirectoryTarget(targetPath)
  const migrationId = randomUUID()
  const now = new Date().toISOString()
  const migration: DesktopDataMigration = {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    migrationId,
    sourceRoot: getDesktopDataDirectoryState().serverDataRoot,
    targetRoot,
    stagingRoot: `${targetRoot}.cradle-migrating-${migrationId}`,
    phase: 'validate',
    createdAt: now,
    updatedAt: now,
  }
  await writeMigration(env, migration)
  return { ...migration }
}

export async function runPendingDesktopDataMigration(
  onPhase?: (phase: DesktopDataMigrationPhase) => void,
): Promise<{ migrated: boolean, failed: boolean, message?: string }> {
  const env = requireEnvironment()
  const migration = currentState?.pendingMigration
  if (!migration || migration.phase === 'completed' || migration.phase === 'failed') {
    return { migrated: false, failed: migration?.phase === 'failed', message: migration?.errorMessage }
  }

  try {
    if (migration.phase === 'health-check' || migration.phase === 'archive-old-root') {
      throw new Error('The previous data migration was interrupted before startup health was confirmed')
    }

    await updateMigrationPhase(env, migration, 'validate', onPhase)
    assertSafeTarget({
      sourceRoot: migration.sourceRoot,
      targetRoot: migration.targetRoot,
      installDirectory: env.installDirectory,
    })
    await validateMigrationDestination(migration)

    await updateMigrationPhase(env, migration, 'stage-copy', onPhase)
    await rm(migration.stagingRoot, { recursive: true, force: true })
    await mkdir(migration.stagingRoot, { recursive: true })
    await copyTree(migration.sourceRoot, migration.stagingRoot)

    await updateMigrationPhase(env, migration, 'verify', onPhase)
    const [sourceManifest, stagingManifest] = await Promise.all([
      createFileManifest(migration.sourceRoot),
      createFileManifest(migration.stagingRoot),
    ])
    if (JSON.stringify(sourceManifest) !== JSON.stringify(stagingManifest)) {
      throw new Error('The copied data failed checksum verification')
    }

    await updateMigrationPhase(env, migration, 'promote', onPhase)
    await atomicWriteJson(join(migration.stagingRoot, MIGRATION_MARKER_FILE), {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      migrationId: migration.migrationId,
      sourceRoot: migration.sourceRoot,
      promotedAt: new Date().toISOString(),
    })
    const targetStat = await readOptionalStat(migration.targetRoot)
    if (targetStat) {
      if ((await readdir(migration.targetRoot)).length > 0) {
        throw new Error('The selected data directory is no longer empty')
      }
      await rm(migration.targetRoot, { recursive: false })
    }
    await rename(migration.stagingRoot, migration.targetRoot)

    await updateMigrationPhase(env, migration, 'switch-pointer', onPhase)
    await writePointer(env, migration.targetRoot, migration.migrationId, null, true)
    currentState = {
      ...getDesktopDataDirectoryState(),
      serverDataRoot: migration.targetRoot,
      source: 'custom',
      pendingMigration: migration,
    }
    await updateMigrationPhase(env, migration, 'health-check', onPhase)
    return { migrated: true, failed: false }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await restoreMigrationSource(env, migration, message)
    return { migrated: false, failed: true, message }
  }
}

export async function completeDesktopDataMigrationAfterHealthyStart(): Promise<DesktopDataMigration | null> {
  const env = requireEnvironment()
  const migration = currentState?.pendingMigration
  if (!migration || migration.phase !== 'health-check') {
    return null
  }

  await updateMigrationPhase(env, migration, 'archive-old-root')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupRoot = `${migration.sourceRoot}.bak-${timestamp}`
  if (await readOptionalStat(migration.sourceRoot)) {
    await rename(migration.sourceRoot, backupRoot)
  }
  migration.backupRoot = backupRoot
  migration.completedAt = new Date().toISOString()
  await writePointer(env, migration.targetRoot, migration.migrationId, migration.completedAt, true)
  await updateMigrationPhase(env, migration, 'completed')
  return { ...migration }
}

export async function rollbackDesktopDataMigrationAfterHealthFailure(message: string): Promise<void> {
  const env = requireEnvironment()
  const migration = currentState?.pendingMigration
  if (!migration || migration.phase !== 'health-check') {
    return
  }
  await restoreMigrationSource(env, migration, message)
}

export async function deleteInactiveDesktopDataBackup(backupRoot: string): Promise<void> {
  const state = getDesktopDataDirectoryState()
  const migration = state.pendingMigration
  const normalizedBackup = normalizeAbsolutePath(backupRoot)
  if (!migration || migration.phase !== 'completed' || migration.backupRoot !== normalizedBackup) {
    throw new Error('Only the completed migration backup can be removed')
  }
  if (pathsEqual(normalizedBackup, state.serverDataRoot)) {
    throw new Error('The active data directory cannot be removed')
  }
  await rm(normalizedBackup, { recursive: true, force: false })
}

async function readPointerRoot(env: DataDirectoryEnvironment): Promise<string | null> {
  try {
    const pointer = PointerSchema.parse(JSON.parse(await readFile(env.pointerPath, 'utf8')))
    const root = normalizeAbsolutePath(pointer.root)
    return pathsEqual(root, env.defaultRoot) ? null : root
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[desktop] Ignoring invalid data-root pointer:', error)
    }
    return null
  }
}

async function readMigration(path: string): Promise<DesktopDataMigration | null> {
  try {
    const parsed = MigrationSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    return {
      ...parsed,
      sourceRoot: normalizeAbsolutePath(parsed.sourceRoot),
      targetRoot: normalizeAbsolutePath(parsed.targetRoot),
      stagingRoot: normalizeAbsolutePath(parsed.stagingRoot),
    }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[desktop] Ignoring invalid data migration manifest:', error)
    }
    return null
  }
}

async function writePointer(
  env: DataDirectoryEnvironment,
  root: string,
  migrationId: string | null,
  lastSuccessAt: string | null,
  retainBackup: boolean,
): Promise<void> {
  await atomicWriteJson(env.pointerPath, {
    schemaVersion: POINTER_SCHEMA_VERSION,
    root,
    migrationId,
    lastSuccessAt,
  }, retainBackup)
}

async function writeMigration(env: DataDirectoryEnvironment, migration: DesktopDataMigration): Promise<void> {
  migration.updatedAt = new Date().toISOString()
  await atomicWriteJson(env.migrationPath, migration)
  if (currentState) {
    currentState = { ...currentState, pendingMigration: { ...migration } }
  }
}

async function updateMigrationPhase(
  env: DataDirectoryEnvironment,
  migration: DesktopDataMigration,
  phase: DesktopDataMigrationPhase,
  onPhase?: (phase: DesktopDataMigrationPhase) => void,
): Promise<void> {
  migration.phase = phase
  migration.errorMessage = undefined
  await writeMigration(env, migration)
  onPhase?.(phase)
}

async function restoreMigrationSource(
  env: DataDirectoryEnvironment,
  migration: DesktopDataMigration,
  message: string,
): Promise<void> {
  if (migration.phase === 'switch-pointer' || migration.phase === 'health-check' || migration.phase === 'archive-old-root') {
    await writePointer(
      env,
      migration.sourceRoot,
      null,
      null,
      true,
    )
  }
  migration.phase = 'failed'
  migration.errorMessage = message
  await writeMigration(env, migration)
  currentState = {
    bootstrapRoot: env.bootstrapRoot,
    serverDataRoot: migration.sourceRoot,
    source: pathsEqual(migration.sourceRoot, env.defaultRoot) ? 'default' : 'custom',
    pendingMigration: { ...migration },
  }
}

async function validateMigrationDestination(migration: DesktopDataMigration): Promise<void> {
  await access(migration.sourceRoot, constants.R_OK | constants.W_OK)
  const targetStat = await readOptionalStat(migration.targetRoot)
  if (targetStat && !targetStat.isDirectory()) {
    throw new Error('The selected data location is not a directory')
  }
  if (targetStat && (await readdir(migration.targetRoot)).length > 0) {
    throw new Error('The selected data directory must remain empty until migration starts')
  }
  await mkdir(dirname(migration.targetRoot), { recursive: true })
  await access(dirname(migration.targetRoot), constants.W_OK)
}

function assertSafeTarget(input: { sourceRoot: string, targetRoot: string, installDirectory: string }): void {
  if (pathsEqual(input.targetRoot, parse(input.targetRoot).root)) {
    throw new Error('A filesystem or drive root cannot be used as the Cradle data directory')
  }
  if (pathsEqual(input.sourceRoot, input.targetRoot)) {
    throw new Error('The selected directory is already the active data location')
  }
  if (isPathInside(input.sourceRoot, input.targetRoot)) {
    throw new Error('The selected directory cannot be inside the active data directory')
  }
  if (pathsEqual(input.targetRoot, input.installDirectory) || isPathInside(input.installDirectory, input.targetRoot)) {
    throw new Error('The data directory cannot be placed inside the application install directory')
  }
  if (isPathInside(input.targetRoot, input.installDirectory)) {
    throw new Error('The data directory cannot contain the application install directory')
  }
  if (process.platform === 'win32' && input.targetRoot.startsWith('\\\\')) {
    throw new Error('Network paths are not supported for the Cradle data directory')
  }
  if (process.platform === 'win32' && !/^[A-Z]:\\$/i.test(parse(input.targetRoot).root)) {
    throw new Error('Choose a local Windows drive for the Cradle data directory')
  }
}

function normalizeAbsolutePath(path: string): string {
  if (!path || !isAbsolute(path)) {
    throw new Error('The data directory must be an absolute path')
  }
  return normalize(resolve(path))
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function isPathInside(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

async function copyTree(sourceRoot: string, targetRoot: string): Promise<void> {
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const source = join(sourceRoot, entry.name)
    const target = join(targetRoot, entry.name)
    if (entry.isDirectory()) {
      await mkdir(target, { recursive: true })
      await copyTree(source, target)
    }
    else if (entry.isFile()) {
      await copyFile(source, target)
    }
    else if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported in the server data directory: ${source}`)
    }
    else {
      throw new Error(`Unsupported filesystem entry in the server data directory: ${source}`)
    }
  }
}

async function createFileManifest(root: string): Promise<FileManifestEntry[]> {
  const entries: FileManifestEntry[] = []
  await appendManifestEntries(root, root, entries)
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

async function appendManifestEntries(root: string, directory: string, entries: FileManifestEntry[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === MIGRATION_MARKER_FILE) {
      continue
    }
    const fullPath = join(directory, entry.name)
    const relativePath = relative(root, fullPath).split(sep).join('/')
    const entryStat = await lstat(fullPath)
    if (entryStat.isDirectory()) {
      entries.push({ path: relativePath, type: 'directory', size: 0 })
      await appendManifestEntries(root, fullPath, entries)
    }
    else if (entryStat.isFile()) {
      entries.push({
        path: relativePath,
        type: 'file',
        size: entryStat.size,
        sha256: await hashFile(fullPath),
      })
    }
    else if (entryStat.isSymbolicLink()) {
      entries.push({ path: relativePath, type: 'symlink', size: entryStat.size })
    }
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function atomicWriteJson(path: string, value: object, retainBackup = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  const backupPath = `${path}.bak`
  const pendingBackupPath = `${backupPath}.pending`
  let copiedExisting = false
  if (retainBackup && await readOptionalStat(path)) {
    await rm(pendingBackupPath, { force: true })
    await copyFile(path, pendingBackupPath)
    copiedExisting = true
  }
  try {
    // rename replaces the live pointer atomically. The prior pointer remains
    // readable until this operation succeeds; it is never renamed away first.
    await rename(tempPath, path)
  }
  catch (error) {
    await rm(tempPath, { force: true })
    await rm(pendingBackupPath, { force: true })
    throw error
  }
  if (copiedExisting) {
    await rm(backupPath, { force: true })
    await rename(pendingBackupPath, backupPath)
  }
}

async function recoverInterruptedAtomicWrite(path: string): Promise<void> {
  const backupPath = `${path}.bak`
  const pendingBackupPath = `${backupPath}.pending`
  if (!(await readOptionalStat(pendingBackupPath))) {
    return
  }
  if (await readOptionalStat(path)) {
    // The replacement became durable before the process stopped. Finish
    // publishing the previous pointer as the stable backup.
    await rm(backupPath, { force: true })
    await rename(pendingBackupPath, backupPath)
    return
  }
  // Defensive recovery for an implementation/platform that lost the live
  // pointer unexpectedly: restore the known-good prior pointer.
  await rename(pendingBackupPath, path)
}

async function readOptionalStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function requireEnvironment(): DataDirectoryEnvironment {
  if (!environment) {
    throw new Error('Desktop data directory has not been initialized')
  }
  return environment
}
