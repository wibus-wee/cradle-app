import { dbSchema } from '@cradle/db'
import Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import type { DatabaseConfig } from './database.config'

export class DbProvider {
  private sqlite?: Database.Database
  private db?: BetterSQLite3Database<typeof dbSchema>

  constructor(private readonly config: DatabaseConfig) {}

  getDb(): BetterSQLite3Database<typeof dbSchema> {
    if (!this.db) {
      const { dbPath } = this.config.getOptions()
      try {
        this.sqlite = new Database(dbPath)
        this.sqlite.pragma('foreign_keys = ON')
        this.sqlite.pragma('journal_mode = WAL')
        this.sqlite.pragma('busy_timeout = 5000')
        this.db = drizzle(this.sqlite, { schema: dbSchema })
      }
      catch (error) {
        this.sqlite?.close()
        this.sqlite = undefined
        this.db = undefined
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new Error(`Failed to open database at ${dbPath}: ${message}`, { cause: error })
      }
    }
    return this.db
  }

  onApplicationShutdown(): void {
    this.sqlite?.close()
    this.sqlite = undefined
    this.db = undefined
  }
}
