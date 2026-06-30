import { sql } from 'drizzle-orm'
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { providerTargets } from './provider-target'
import { createdAt } from './shared'

export const runtimeAuditLog = sqliteTable('runtime_audit_log', {
  id: int('id').primaryKey({ autoIncrement: true }),
  providerTargetId: text('provider_target_id').references(() => providerTargets.id, { onDelete: 'set null' }),
  providerKind: text('provider_kind', {
    enum: ['openai-compatible', 'anthropic', 'universal'],
  }).notNull(),
  action: text('action').notNull(),
  subject: text('subject'),
  details: text('details').notNull().default('{}'),
  ...createdAt(),
})

export type RuntimeAuditEntry = typeof runtimeAuditLog.$inferSelect

export const providerTargetModelCache = sqliteTable('provider_target_model_cache', {
  providerTargetId: text('provider_target_id').primaryKey().references(() => providerTargets.id, { onDelete: 'cascade' }),
  modelsJson: text('models_json').notNull().default('[]'),
  fetchedAt: int('fetched_at').notNull().default(sql`(unixepoch())`),
})

export type ProviderTargetModelCacheRow = typeof providerTargetModelCache.$inferSelect
