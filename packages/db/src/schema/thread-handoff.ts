import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { providerTargets } from './provider-target'
import { textPk } from './shared'

export const threadHandoffs = sqliteTable('thread_handoffs', {
  id: textPk(),
  requestId: text('request_id').notNull(),
  sourceSessionId: text('source_session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  destinationSessionId: text('destination_session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  sourceProviderTargetId: text('source_provider_target_id')
    .references(() => providerTargets.id, { onDelete: 'set null' }),
  destinationProviderTargetId: text('destination_provider_target_id')
    .notNull()
    .references(() => providerTargets.id, { onDelete: 'restrict' }),
  importedMessageCount: int('imported_message_count').notNull(),
  createdAt: int('created_at').notNull(),
}, table => ({
  request: uniqueIndex('thread_handoffs_request_unique').on(table.requestId),
  destination: uniqueIndex('thread_handoffs_destination_unique').on(table.destinationSessionId),
  bySource: index('thread_handoffs_source_idx').on(table.sourceSessionId, table.createdAt),
}))

export type ThreadHandoff = typeof threadHandoffs.$inferSelect
export type NewThreadHandoff = typeof threadHandoffs.$inferInsert
