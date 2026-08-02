import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import * as tar from 'tar'
import { z } from 'zod'

import { getDesktopDataDirectoryState } from './data-directory'

const BACKUP_SCHEMA = 'cradle.data-backup'
const BACKUP_SCHEMA_VERSION = 1
const OPERATION_SCHEMA_VERSION = 1
const OPERATION_FILE = 'bootstrap/data-backup-operation.json'
const ARCHIVE_MANIFEST_FILE = '.cradle-data-backup.json'
const BACKUP_EXTENSION = '.cradle-backup'

export type DesktopDataBackupKind = 'export' | 'restore'
export type DesktopDataBackupPhase
  = | 'scheduled'
    | 'running'
    | 'verify'
    | 'health-check'
    | 'completed'
    | 'failed'

interface BackupFileManifestEntry {
  path: string
  type: 'file' | 'directory'
  size: number
  sha256?: string
}

interface DesktopDataBackupManifest {
  schema: typeof BACKUP_SCHEMA
  schemaVersion: typeof BACKUP_SCHEMA_VERSION
  createdAt: string
  cradleVersion: string
  platform: NodeJS.Platform
  files: BackupFileManifestEntry[]
}

interface DesktopDataBackupOperation {
  schemaVersion: typeof OPERATION_SCHEMA_VERSION
  operationId: string
  kind: DesktopDataBackupKind
  phase: DesktopDataBackupPhase
  archivePath: string
  dataRoot: string
  stagingRoot: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  backupRoot?: string
  errorMessage?: string
}

export interface DesktopDataBackupStatus {
  kind: DesktopDataBackupKind | null
  phase: DesktopDataBackupPhase | 'idle'
  archivePath: string | null
  createdAt: string | null
  completedAt: string | null
  backupRoot: string | null
  errorMessage: string | null
}

const BackupFileManifestEntrySchema = z.object({
  path: z.string().min(1),
  type: z.enum(['file', 'directory']),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})

const BackupManifestSchema = z.object({
  schema: z.literal(BACKUP_SCHEMA),
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  createdAt: z.iso.datetime(),
  cradleVersion: z.string().min(1),
  platform: z.enum([
    'aix',
    'android',
    'darwin',
    'freebsd',
    'haiku',
    'linux',
    'openbsd',
    'sunos',
    'win32',
    'cygwin',
    'netbsd',
  ]),
  files: z.array(BackupFileManifestEntrySchema),
})

const BackupOperationSchema = z.object({
  schemaVersion: z.literal(OPERATION_SCHEMA_VERSION),
  operationId: z.string(),
  kind: z.enum(['export', 'restore']),
  phase: z.enum(['scheduled', 'running', 'verify', 'health-check', 'completed', 'failed']),
  archivePath: z.string(),
  dataRoot: z.string(),
  stagingRoot: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  backupRoot: z.string().optional(),
  errorMessage: z.string().optional(),
})

let operation: DesktopDataBackupOperation | null = null

export async function initializeDesktopDataBackup(): Promise<DesktopDataBackupStatus> {
  operation = await readOperation()
  return getDesktopDataBackupStatus()
}

export function getDesktopDataBackupStatus(): DesktopDataBackupStatus {
  return operation
    ? {
        kind: operation.kind,
        phase: operation.phase,
        archivePath: operation.archivePath,
        createdAt: operation.createdAt,
        completedAt: operation.completedAt ?? null,
        backupRoot: operation.backupRoot ?? null,
        errorMessage: operation.errorMessage ?? null,
      }
    : {
        kind: null,
        phase: 'idle',
        archivePath: null,
        createdAt: null,
        completedAt: null,
        backupRoot: null,
        errorMessage: null,
      }
}

export function ensureCradleBackupExtension(path: string): string {
  return path.toLowerCase().endsWith(BACKUP_EXTENSION) ? path : `${path}${BACKUP_EXTENSION}`
}

export async function scheduleDesktopDataBackupExport(archivePath: string): Promise<DesktopDataBackupStatus> {
  await scheduleOperation('export', ensureCradleBackupExtension(archivePath))
  return getDesktopDataBackupStatus()
}

export async function scheduleDesktopDataBackupRestore(archivePath: string): Promise<DesktopDataBackupStatus> {
  await access(archivePath)
  await scheduleOperation('restore', archivePath)
  return getDesktopDataBackupStatus()
}

export async function runPendingDesktopDataBackup(
  cradleVersion: string,
  onPhase?: (phase: DesktopDataBackupPhase) => void,
): Promise<{ exported: boolean, restored: boolean, failed: boolean, message?: string }> {
  const pending = operation
  if (!pending || pending.phase === 'completed' || pending.phase === 'failed') {
    return {
      exported: false,
      restored: false,
      failed: pending?.phase === 'failed',
      message: pending?.errorMessage,
    }
  }

  if (pending.phase === 'health-check') {
    const message = 'The previous restore was interrupted before startup health was confirmed'
    await rollbackDesktopDataBackupAfterHealthFailure(message)
    return { exported: false, restored: false, failed: true, message }
  }

  try {
    assertOperationStillTargetsActiveRoot(pending)
    await updateOperationPhase(pending, 'running', onPhase)
    if (pending.kind === 'export') {
      await exportDataBackup(pending, cradleVersion)
      pending.completedAt = new Date().toISOString()
      await updateOperationPhase(pending, 'completed', onPhase)
      return { exported: true, restored: false, failed: false }
    }

    await restoreDataBackup(pending, onPhase)
    return { exported: false, restored: true, failed: false }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (pending.kind === 'restore' && pending.backupRoot) {
      await rollbackSwappedRestore(pending)
    }
    else if (pending.kind === 'restore') {
      await rm(pending.stagingRoot, { recursive: true, force: true })
    }
    await failOperation(pending, message)
    return { exported: false, restored: false, failed: true, message }
  }
}

export async function completeDesktopDataBackupAfterHealthyStart(): Promise<DesktopDataBackupStatus | null> {
  const pending = operation
  if (!pending || pending.kind !== 'restore' || pending.phase !== 'health-check') {
    return null
  }
  pending.completedAt = new Date().toISOString()
  await updateOperationPhase(pending, 'completed')
  return getDesktopDataBackupStatus()
}

export async function rollbackDesktopDataBackupAfterHealthFailure(message: string): Promise<void> {
  const pending = operation
  if (!pending || pending.kind !== 'restore' || pending.phase !== 'health-check' || !pending.backupRoot) {
    return
  }

  await rollbackSwappedRestore(pending)
  await failOperation(pending, message)
}

async function rollbackSwappedRestore(pending: DesktopDataBackupOperation): Promise<void> {
  if (!pending.backupRoot) {
    return
  }
  const failedRestoreRoot = `${pending.stagingRoot}.failed`
  await rm(failedRestoreRoot, { recursive: true, force: true })
  await rename(pending.dataRoot, failedRestoreRoot)
  try {
    await rename(pending.backupRoot, pending.dataRoot)
  }
  catch (error) {
    await rename(failedRestoreRoot, pending.dataRoot).catch(() => {})
    throw error
  }
  await rm(failedRestoreRoot, { recursive: true, force: true })
  pending.backupRoot = undefined
}

async function scheduleOperation(
  kind: DesktopDataBackupKind,
  archivePathInput: string,
): Promise<DesktopDataBackupStatus> {
  const state = getDesktopDataDirectoryState()
  const migration = state.pendingMigration
  if (migration && !['completed', 'failed'].includes(migration.phase)) {
    throw new Error('Finish the pending data directory migration before backing up or restoring')
  }
  if (operation && !['completed', 'failed'].includes(operation.phase)) {
    throw new Error('Another Cradle data backup operation is already pending')
  }

  const dataRoot = normalizeAbsolutePath(state.serverDataRoot)
  const archivePath = normalizeAbsolutePath(archivePathInput)
  if (pathsEqual(archivePath, dataRoot) || isPathInside(dataRoot, archivePath)) {
    throw new Error('Choose a backup file outside the active Cradle data directory')
  }
  await mkdir(dirname(archivePath), { recursive: true })
  await access(dirname(archivePath))

  const operationId = randomUUID()
  const now = new Date().toISOString()
  operation = {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operationId,
    kind,
    phase: 'scheduled',
    archivePath,
    dataRoot,
    stagingRoot: kind === 'export'
      ? `${archivePath}.partial-${operationId}`
      : `${dataRoot}.cradle-restoring-${operationId}`,
    createdAt: now,
    updatedAt: now,
  }
  await writeOperation(operation)
  return getDesktopDataBackupStatus()
}

async function exportDataBackup(
  pending: DesktopDataBackupOperation,
  cradleVersion: string,
): Promise<void> {
  const manifestPath = join(pending.dataRoot, ARCHIVE_MANIFEST_FILE)
  await rm(pending.stagingRoot, { force: true })
  await rm(manifestPath, { force: true })

  try {
    const manifest: DesktopDataBackupManifest = {
      schema: BACKUP_SCHEMA,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      cradleVersion,
      platform: process.platform,
      files: await createFileManifest(pending.dataRoot),
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await tar.c({
      cwd: pending.dataRoot,
      file: pending.stagingRoot,
      gzip: true,
      portable: true,
      strict: true,
    }, ['.'])
    await replaceFile(pending.stagingRoot, pending.archivePath)
  }
  finally {
    await rm(manifestPath, { force: true })
    await rm(pending.stagingRoot, { force: true })
  }
}

async function restoreDataBackup(
  pending: DesktopDataBackupOperation,
  onPhase?: (phase: DesktopDataBackupPhase) => void,
): Promise<void> {
  await validateArchiveEntries(pending.archivePath)
  await rm(pending.stagingRoot, { recursive: true, force: true })
  await mkdir(pending.stagingRoot, { recursive: true })
  await tar.x({
    cwd: pending.stagingRoot,
    file: pending.archivePath,
    preservePaths: false,
    strict: true,
  })

  const manifestPath = join(pending.stagingRoot, ARCHIVE_MANIFEST_FILE)
  const manifest = BackupManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  await updateOperationPhase(pending, 'verify', onPhase)
  const restoredManifest = await createFileManifest(pending.stagingRoot)
  if (JSON.stringify(restoredManifest) !== JSON.stringify(manifest.files)) {
    throw new Error('The backup failed checksum verification')
  }
  await rm(manifestPath, { force: false })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupRoot = `${pending.dataRoot}.before-restore-${timestamp}`
  await access(dirname(pending.dataRoot))
  await rename(pending.dataRoot, backupRoot)
  try {
    await rename(pending.stagingRoot, pending.dataRoot)
  }
  catch (error) {
    await rename(backupRoot, pending.dataRoot).catch(() => {})
    throw error
  }
  pending.backupRoot = backupRoot
  await updateOperationPhase(pending, 'health-check', onPhase)
}

async function validateArchiveEntries(archivePath: string): Promise<void> {
  let manifestCount = 0
  await tar.t({
    file: archivePath,
    strict: true,
    onentry(entry) {
      const normalizedPath = normalizeArchiveEntryPath(entry.path)
      if (normalizedPath === ARCHIVE_MANIFEST_FILE) {
        manifestCount += 1
      }
      if (!['File', 'Directory'].includes(entry.type)) {
        throw new Error(`Unsupported entry type in Cradle backup: ${entry.type}`)
      }
    },
  })
  if (manifestCount !== 1) {
    throw new Error('The selected file is not a valid Cradle data backup')
  }
}

function normalizeArchiveEntryPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (!normalized) {
    return ''
  }
  if (
    normalized.startsWith('/')
    || /^[a-z]:/i.test(normalized)
    || normalized.split('/').includes('..')
  ) {
    throw new Error(`Unsafe path in Cradle backup: ${path}`)
  }
  return normalized
}

async function createFileManifest(root: string): Promise<BackupFileManifestEntry[]> {
  const entries: BackupFileManifestEntry[] = []
  await appendManifestEntries(root, root, entries)
  return entries.sort((left, right) => {
    if (left.path === right.path) {
      return 0
    }
    return left.path < right.path ? -1 : 1
  })
}

async function appendManifestEntries(
  root: string,
  directory: string,
  entries: BackupFileManifestEntry[],
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === ARCHIVE_MANIFEST_FILE) {
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
    else {
      throw new Error(`Unsupported filesystem entry in Cradle data: ${fullPath}`)
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

async function replaceFile(source: string, destination: string): Promise<void> {
  const replacedPath = `${source}.replaced`
  const destinationExists = await readOptionalStat(destination)
  if (destinationExists?.isDirectory()) {
    throw new Error('The selected backup destination is a directory')
  }
  if (destinationExists) {
    await rm(replacedPath, { force: true })
    await rename(destination, replacedPath)
  }
  try {
    await rename(source, destination)
    await rm(replacedPath, { force: true })
  }
  catch (error) {
    if (destinationExists) {
      await rename(replacedPath, destination).catch(() => {})
    }
    throw error
  }
}

function assertOperationStillTargetsActiveRoot(pending: DesktopDataBackupOperation): void {
  if (!pathsEqual(pending.dataRoot, getDesktopDataDirectoryState().serverDataRoot)) {
    throw new Error('The active Cradle data directory changed after this backup operation was scheduled')
  }
}

async function updateOperationPhase(
  pending: DesktopDataBackupOperation,
  phase: DesktopDataBackupPhase,
  onPhase?: (phase: DesktopDataBackupPhase) => void,
): Promise<void> {
  pending.phase = phase
  pending.errorMessage = undefined
  await writeOperation(pending)
  onPhase?.(phase)
}

async function failOperation(pending: DesktopDataBackupOperation, message: string): Promise<void> {
  pending.phase = 'failed'
  pending.errorMessage = message
  await writeOperation(pending)
}

async function readOperation(): Promise<DesktopDataBackupOperation | null> {
  try {
    const state = getDesktopDataDirectoryState()
    const path = join(state.bootstrapRoot, OPERATION_FILE)
    return BackupOperationSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[desktop] Ignoring invalid data backup operation:', error)
    }
    return null
  }
}

async function writeOperation(pending: DesktopDataBackupOperation): Promise<void> {
  pending.updatedAt = new Date().toISOString()
  const state = getDesktopDataDirectoryState()
  const path = join(state.bootstrapRoot, OPERATION_FILE)
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temporaryPath, `${JSON.stringify(pending, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryPath, path)
  operation = { ...pending }
}

function normalizeAbsolutePath(path: string): string {
  if (!path || !isAbsolute(path)) {
    throw new Error('Cradle data backup paths must be absolute')
  }
  return resolve(path)
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
