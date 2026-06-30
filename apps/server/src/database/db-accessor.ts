import type { dbSchema } from '@cradle/db'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type { DbProvider } from './database.provider'

export class DbAccessor {
  constructor(private readonly provider: DbProvider) {}

  get(): BetterSQLite3Database<typeof dbSchema> {
    return this.provider.getDb()
  }
}
