import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { DownloadResumeState, DownloadTaskView } from '@cradle/download-center'
import { z } from 'zod'

const terminalStatuses = new Set<DesktopDownloadTaskView['status']>(['completed', 'failed', 'cancelled'])
const MAX_TERMINAL_TASKS = 100

export type DesktopDownloadTaskView = DownloadTaskView & { scope: 'desktop' }

export interface DesktopDownloadTaskRecord {
  task: DesktopDownloadTaskView
  resume: DownloadResumeState | null
  artifactReleasedAt: string | null
}

const checksumSchema = z.object({
  algorithm: z.enum(['sha256', 'sha512']),
  expected: z.string().nullable(),
  actual: z.string(),
  matched: z.boolean().nullable(),
}).strict()

const taskErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
}).strict()

/** The durable, redacted public projection of a desktop download task. */
export const desktopDownloadTaskViewSchema: z.ZodType<DesktopDownloadTaskView> = z.object({
  taskId: z.string().min(1),
  scope: z.literal('desktop'),
  owner: z.object({
    namespace: z.string(),
    resourceType: z.string(),
    resourceId: z.string(),
    displayName: z.string(),
  }).strict(),
  fileName: z.string().min(1),
  sourceId: z.string().min(1).nullable(),
  status: z.enum(['queued', 'downloading', 'verifying', 'completed', 'failed', 'cancelled']),
  transferredBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative().nullable(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  error: taskErrorSchema.nullable(),
  result: z.object({
    taskId: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    checksum: checksumSchema,
  }).strict().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
}).strict()

const resumeStateSchema: z.ZodType<DownloadResumeState> = z.object({
  sourceId: z.string().min(1),
  etag: z.string().nullable(),
}).strict()

export const desktopDownloadTaskRecordSchema: z.ZodType<DesktopDownloadTaskRecord> = z.object({
  task: desktopDownloadTaskViewSchema,
  resume: resumeStateSchema.nullable(),
  artifactReleasedAt: z.string().datetime().nullable(),
}).strict()

const storeSchema = z.object({
  version: z.literal(1),
  tasks: z.array(desktopDownloadTaskRecordSchema),
}).strict()

export interface DesktopDownloadTaskStoreOptions {
  userDataPath: string
  now?: () => Date
}

/**
 * Owns the compact, redacted on-disk representation of desktop download tasks.
 * Requests, headers, and source URLs deliberately never cross this boundary.
 */
export class DesktopDownloadTaskStore {
  readonly rootDir: string
  readonly filePath: string

  private readonly records = new Map<string, DesktopDownloadTaskRecord>()
  private readonly now: () => Date
  private initialized = false
  private writes: Promise<void> = Promise.resolve()

  constructor(options: DesktopDownloadTaskStoreOptions) {
    this.rootDir = path.join(options.userDataPath, 'download-center')
    this.filePath = path.join(this.rootDir, 'tasks.json')
    this.now = options.now ?? (() => new Date())
  }

  async load(): Promise<DesktopDownloadTaskRecord[]> {
    if (this.initialized) { return this.list() }
    this.initialized = true

    let contents: string
    try {
      contents = await readFile(this.filePath, 'utf8')
    }
    catch (error) {
      if (isMissingFile(error)) { return [] }
      throw error
    }

    let parsed: z.infer<typeof storeSchema>
    try {
      parsed = storeSchema.parse(JSON.parse(contents))
    }
    catch {
      await this.quarantineMalformedState()
      return []
    }

    for (const record of parsed.tasks) { this.records.set(record.task.taskId, cloneRecord(record)) }
    if (this.prune()) { await this.write() }
    return this.list()
  }

  get(taskId: string): DesktopDownloadTaskRecord | null {
    const record = this.records.get(taskId)
    return record ? cloneRecord(record) : null
  }

  list(): DesktopDownloadTaskRecord[] {
    return [...this.records.values()]
      .sort((left, right) => right.task.updatedAt.localeCompare(left.task.updatedAt))
      .map(cloneRecord)
  }

  async put(record: DesktopDownloadTaskRecord): Promise<void> {
    this.assertInitialized()
    const parsed = desktopDownloadTaskRecordSchema.parse(record)
    this.records.set(parsed.task.taskId, cloneRecord(parsed))
    this.prune()
    await this.write()
  }

  async remove(taskId: string): Promise<void> {
    this.assertInitialized()
    if (!this.records.delete(taskId)) { return }
    await this.write()
  }

  private assertInitialized(): void {
    if (!this.initialized) { throw new Error('DesktopDownloadTaskStore.load() must complete before use.') }
  }

  private prune(): boolean {
    const terminal = [...this.records.values()]
      .filter(record => terminalStatuses.has(record.task.status))
      .sort((left, right) => right.task.updatedAt.localeCompare(left.task.updatedAt))
    const removed = terminal.slice(MAX_TERMINAL_TASKS)
    for (const record of removed) { this.records.delete(record.task.taskId) }
    return removed.length > 0
  }

  private async quarantineMalformedState(): Promise<void> {
    const suffix = this.now().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    try {
      await rename(this.filePath, `${this.filePath}.corrupt-${suffix}`)
    }
    catch {
      // A reset is still safer than allowing malformed state to block startup.
      await rm(this.filePath, { force: true })
    }
    await this.write()
  }

  private async write(): Promise<void> {
    const snapshot = JSON.stringify({ version: 1, tasks: this.list() }, null, 2)
    const write = this.writes.catch(() => undefined).then(async () => {
      await mkdir(this.rootDir, { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      await writeFile(temporaryPath, snapshot, 'utf8')
      await rename(temporaryPath, this.filePath)
    })
    this.writes = write
    return write
  }
}

function cloneRecord(record: DesktopDownloadTaskRecord): DesktopDownloadTaskRecord {
  return structuredClone(record)
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
