import { sql } from 'drizzle-orm'
import { int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const textPk = () => text('id').primaryKey()

export const timestamps = () => ({
  createdAt: int('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: int('updated_at').notNull().default(sql`(unixepoch())`),
})

export const createdAt = () => ({
  createdAt: int('created_at').notNull().default(sql`(unixepoch())`),
})

export const workspaces = sqliteTable('workspaces', {
  id: textPk(),
  name: text('name').notNull(),
  locatorJson: text('locator_json').notNull(),
  gitIdentityJson: text('git_identity_json').notNull().default('{}'),
  identifier: text('identifier').notNull().default(''),
  pinned: int('pinned').notNull().default(0),
  ...timestamps(),
}, table => ({
  byLocator: uniqueIndex('workspaces_locator_unique').on(table.locatorJson),
}))

export const kvCache = sqliteTable('kv_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  expiresAt: int('expires_at').notNull(),
})

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
