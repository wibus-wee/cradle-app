import type { dbSchema, DownloadCenterTask, NewDownloadCenterTask } from '@cradle/db'
import { downloadCenterTasks } from '@cradle/db'
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export const RETRYABLE_DOWNLOAD_ERROR_CODES = ['interrupted', 'timeout', 'network_error', 'http_server_error'] as const

export interface DownloadCenterListFilters {
  status?: DownloadCenterTask['status']
  ownerNamespace?: string
  ownerResourceType?: string
  ownerResourceId?: string
  limit: number
}

export class DownloadCenterRepository {
  constructor(private readonly database: BetterSQLite3Database<typeof dbSchema>) {}

  create(values: NewDownloadCenterTask): DownloadCenterTask {
    this.database.insert(downloadCenterTasks).values(values).run()
    return this.get(values.id)!
  }

  get(id: string): DownloadCenterTask | null {
    return this.database.select().from(downloadCenterTasks).where(eq(downloadCenterTasks.id, id)).get() ?? null
  }

  list(filters: DownloadCenterListFilters): DownloadCenterTask[] {
    const conditions = [
      filters.status ? eq(downloadCenterTasks.status, filters.status) : undefined,
      filters.ownerNamespace ? eq(downloadCenterTasks.ownerNamespace, filters.ownerNamespace) : undefined,
      filters.ownerResourceType ? eq(downloadCenterTasks.ownerResourceType, filters.ownerResourceType) : undefined,
      filters.ownerResourceId ? eq(downloadCenterTasks.ownerResourceId, filters.ownerResourceId) : undefined,
    ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined)
    return this.database.select().from(downloadCenterTasks).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(downloadCenterTasks.updatedAt)).limit(filters.limit).all()
  }

  latestRetryable(owner: { namespace: string, resourceType: string, resourceId: string }, sourceId: string): DownloadCenterTask | null {
    return this.database.select().from(downloadCenterTasks).where(and(
      eq(downloadCenterTasks.ownerNamespace, owner.namespace),
      eq(downloadCenterTasks.ownerResourceType, owner.resourceType),
      eq(downloadCenterTasks.ownerResourceId, owner.resourceId),
      eq(downloadCenterTasks.sourceId, sourceId),
      or(
        eq(downloadCenterTasks.status, 'cancelled'),
        and(eq(downloadCenterTasks.status, 'failed'), inArray(downloadCenterTasks.errorCode, RETRYABLE_DOWNLOAD_ERROR_CODES)),
      ),
    )).orderBy(desc(downloadCenterTasks.updatedAt)).limit(1).get() ?? null
  }

  update(id: string, values: Partial<NewDownloadCenterTask>): DownloadCenterTask | null {
    this.database.update(downloadCenterTasks).set({ ...values, updatedAt: sql`(unixepoch())` }).where(eq(downloadCenterTasks.id, id)).run()
    return this.get(id)
  }

  retry(id: string, values: Partial<NewDownloadCenterTask>): DownloadCenterTask | null {
    const result = this.database.update(downloadCenterTasks).set({ ...values, updatedAt: sql`(unixepoch())` }).where(and(
      eq(downloadCenterTasks.id, id),
      inArray(downloadCenterTasks.status, ['failed', 'cancelled']),
    )).run()
    return result.changes > 0 ? this.get(id) : null
  }

  updateIfActive(id: string, values: Partial<NewDownloadCenterTask>): DownloadCenterTask | null {
    const result = this.database.update(downloadCenterTasks).set({ ...values, updatedAt: sql`(unixepoch())` }).where(and(
      eq(downloadCenterTasks.id, id),
      inArray(downloadCenterTasks.status, ['downloading', 'verifying']),
    )).run()
    return result.changes > 0 ? this.get(id) : null
  }

  transitionToDownloading(id: string): DownloadCenterTask | null {
    const result = this.database.update(downloadCenterTasks).set({
      status: 'downloading',
      attempts: sql`${downloadCenterTasks.attempts} + 1`,
      startedAt: sql`coalesce(${downloadCenterTasks.startedAt}, unixepoch())`,
      errorCode: null,
      errorMessage: null,
      updatedAt: sql`(unixepoch())`,
    }).where(and(eq(downloadCenterTasks.id, id), eq(downloadCenterTasks.status, 'queued'))).run()
    return result.changes > 0 ? this.get(id) : null
  }

  cancel(id: string): DownloadCenterTask | null {
    const result = this.database.update(downloadCenterTasks).set({
      status: 'cancelled',
      errorCode: 'cancelled',
      errorMessage: 'The download was cancelled.',
      finishedAt: sql`(unixepoch())`,
      updatedAt: sql`(unixepoch())`,
    }).where(and(eq(downloadCenterTasks.id, id), inArray(downloadCenterTasks.status, ['queued', 'downloading', 'verifying']))).run()
    return result.changes > 0 ? this.get(id) : null
  }

  releaseArtifact(id: string): DownloadCenterTask | null {
    const result = this.database.update(downloadCenterTasks).set({ artifactReleasedAt: sql`coalesce(${downloadCenterTasks.artifactReleasedAt}, unixepoch())`, updatedAt: sql`(unixepoch())` }).where(and(eq(downloadCenterTasks.id, id), eq(downloadCenterTasks.status, 'completed'), isNull(downloadCenterTasks.artifactReleasedAt))).run()
    return result.changes > 0 ? this.get(id) : null
  }

  interruptActive(): void {
    this.database.update(downloadCenterTasks).set({
      status: 'failed',
errorCode: 'interrupted',
errorMessage: 'The download was interrupted by a server restart.',
finishedAt: sql`(unixepoch())`,
updatedAt: sql`(unixepoch())`,
    }).where(inArray(downloadCenterTasks.status, ['queued', 'downloading', 'verifying'])).run()
  }

  expiredForCleanup(cutoff: number): DownloadCenterTask[] {
    return this.database.select().from(downloadCenterTasks).where(and(
      lt(downloadCenterTasks.updatedAt, cutoff),
      or(
        inArray(downloadCenterTasks.status, ['failed', 'cancelled']),
        and(
          eq(downloadCenterTasks.status, 'completed'),
          isNull(downloadCenterTasks.artifactReleasedAt),
        ),
      ),
    )).all()
  }
}
