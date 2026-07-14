import { index, int, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { messages, sessions } from './chat'
import { textPk, timestamps } from './shared'

export const sessionEnvironmentNotes = sqliteTable('session_environment_notes', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  notes: text('notes').notNull().default(''),
  ...timestamps(),
})

export const sessionPinnedMessages = sqliteTable('session_pinned_messages', {
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  label: text('label'),
  done: int('done', { mode: 'boolean' }).notNull().default(false),
  pinnedAt: int('pinned_at').notNull(),
  updatedAt: int('updated_at').notNull(),
}, table => ({
  pk: primaryKey({ columns: [table.sessionId, table.messageId] }),
  bySession: index('session_pinned_messages_session_idx').on(table.sessionId, table.pinnedAt),
}))

export const sessionTextMarkers = sqliteTable('session_text_markers', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  startOffset: int('start_offset').notNull(),
  endOffset: int('end_offset').notNull(),
  selectedText: text('selected_text').notNull(),
  style: text('style', { enum: ['highlight', 'underline'] }).notNull(),
  color: text('color', { enum: ['yellow', 'blue', 'green', 'pink'] }).notNull(),
  label: text('label'),
  done: int('done', { mode: 'boolean' }).notNull().default(false),
  ...timestamps(),
}, table => ({
  bySession: index('session_text_markers_session_idx').on(table.sessionId, table.createdAt),
  byMessageRange: index('session_text_markers_message_range_idx').on(
    table.messageId,
    table.startOffset,
    table.endOffset,
  ),
}))

export type SessionEnvironmentNote = typeof sessionEnvironmentNotes.$inferSelect
export type SessionPinnedMessage = typeof sessionPinnedMessages.$inferSelect
export type SessionTextMarker = typeof sessionTextMarkers.$inferSelect
