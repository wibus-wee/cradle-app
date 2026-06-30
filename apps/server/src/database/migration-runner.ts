import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { z } from 'zod'

import type { Logger } from '../logging/logger'
import type { DatabaseConfig } from './database.config'
import type { DbProvider } from './database.provider'

const ErrorCauseCarrierSchema = z.object({
  cause: z.object({
    message: z.string().optional(),
    code: z.string().optional(),
  }).passthrough().optional(),
}).passthrough()

export class MigrationRunner {
  constructor(
    private readonly provider: DbProvider,
    private readonly config: DatabaseConfig,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    const db = this.provider.getDb()
    const { dbPath, migrationsDir } = this.config.getOptions()

    try {
      migrate(db, { migrationsFolder: migrationsDir })
    }
    catch (error) {
      const cause = ErrorCauseCarrierSchema.parse(error).cause
      this.logger.error('Database migration failed', {
        dbPath,
        migrationsDir,
        errorMessage: error instanceof Error ? error.message : String(error),
        causeMessage: cause instanceof Error ? cause.message : cause?.message ?? cause?.code,
        error,
      })
      throw error
    }
  }
}
