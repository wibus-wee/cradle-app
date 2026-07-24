import { databaseMaintenanceTasks } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { z } from 'zod'

import type { ServerBootstrapReporter } from '../bootstrap-lifecycle'
import type { Logger } from '../logging/logger'
import type { DatabaseConfig } from './database.config'
import type { DbProvider } from './database.provider'

const ErrorCauseCarrierSchema = z
  .object({
    cause: z
      .object({
        message: z.string().optional(),
        code: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export class MigrationRunner {
  constructor(
    private readonly provider: DbProvider,
    private readonly config: DatabaseConfig,
    private readonly logger: Logger,
    private readonly bootstrapReporter?: ServerBootstrapReporter,
  ) {}

  onModuleInit(): void {
    const db = this.provider.getDb()
    const { dbPath, migrationsDir } = this.config.getOptions()

    try {
      this.bootstrapReporter?.runSync('database-migration', () => {
        migrate(db, { migrationsFolder: migrationsDir })
      })
      this.runPendingMaintenanceTasks()
    }
 catch (error) {
      const cause = ErrorCauseCarrierSchema.parse(error).cause
      this.logger.error('Database migration failed', {
        dbPath,
        migrationsDir,
        errorMessage: error instanceof Error ? error.message : String(error),
        causeMessage: cause instanceof Error ? cause.message : (cause?.message ?? cause?.code),
        error,
      })
      throw error
    }
  }

  private runPendingMaintenanceTasks(): void {
    this.bootstrapReporter?.started('database-maintenance')
    try {
      const pendingTasks = this.provider
        .getDb()
        .select()
        .from(databaseMaintenanceTasks)
        .where(eq(databaseMaintenanceTasks.status, 'pending'))
        .all()

      let failedTask: unknown = null
      for (const task of pendingTasks) {
        if (task.id !== 'compact-chat-storage-v1') {
          this.logger.warn('Unknown database maintenance task remains pending', { taskId: task.id })
          continue
        }

        try {
          const result = this.provider.compactDatabase()
          if (result.status === 'deferred') {
            this.logger.warn('Database compaction deferred because free space is insufficient', {
              taskId: task.id,
            })
            continue
          }

          this.provider
            .getDb()
            .update(databaseMaintenanceTasks)
            .set({
              status: 'completed',
              completedAt: Math.floor(Date.now() / 1000),
              detailJson: JSON.stringify({
                request: JSON.parse(task.detailJson),
                result,
              }),
            })
            .where(eq(databaseMaintenanceTasks.id, task.id))
            .run()
          this.logger.info('Database maintenance task completed', {
            taskId: task.id,
            result,
          })
        }
 catch (error) {
          failedTask ??= error
          this.logger.error('Database maintenance task failed and remains pending', {
            taskId: task.id,
            error,
          })
        }
      }
      if (failedTask) {
        this.bootstrapReporter?.failed('database-maintenance', failedTask)
      }
 else {
        this.bootstrapReporter?.completed('database-maintenance')
      }
    }
 catch (error) {
      this.bootstrapReporter?.failed('database-maintenance', error)
      throw error
    }
  }
}
